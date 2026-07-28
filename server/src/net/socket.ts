import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { decode, encode, type ClientMsg, type WelcomeMsg } from '@shared/protocol.js';
import { clamp } from '@shared/math.js';
import { getBalance } from '../game/balance.js';
import type { World } from '../game/world.js';
import type { WorldManager } from '../game/world-manager.js';
import type { Player } from '../game/entities.js';
import { tryBuyWeapon, tryBuyFood, trySellWeapon, tryReorder, tryEat, tryEquip, tryWeaponLootbox } from '../game/economy.js';
import { tryPlaceBuilding, removePlayerBuildings, tryWithdraw } from '../game/buildings.js';
import { restoreBase, storeBase } from '../game/base.js';
import { releaseBase } from '../game/offline-bases.js';
import { tryLootbox, tryEquipHat, recomputeMaxHp } from '../game/hats.js';
import { tryPrestige } from '../game/prestige.js';
import { tr, normalizeLang, type Lang } from '../game/i18n.js';
import { telemetry } from '../db/telemetry.js';
import { accountExists, login, register, loginYandex, loginCrazyGames, saveProgress, claimDailyReward, type Account } from '../db/accounts.js';
import { verifyYandexSignature } from '../game/yandex-auth.js';
import { verifyCrazyGamesToken } from '../game/crazygames-auth.js';
import { adminRouter } from '../admin/stats.js';

const sessionIds = new WeakMap<Player, number>();

export function startServer(worlds: WorldManager): http.Server {
  const app = express();

  // Allow the Yandex-hosted client (different origin) to call read-only API
  // endpoints like /servers. WebSocket upgrades are not subject to CORS.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  app.use('/admin', adminRouter(() => worlds.active()));

  // live server list for the client's server picker
  app.get('/servers', (_req, res) => {
    res.json(worlds.list());
  });

  // serve built client in production
  const clientDist = process.env.CLIENT_DIST ?? path.resolve(process.cwd(), '../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
    console.log(`[http] serving client from ${clientDist}`);
  } else {
    app.get('/', (_req, res) => res.send('FarmClash server. Client build not found — use Vite dev server.'));
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  // --- heartbeat: reap half-open sockets ---
  // A silent drop (mobile switching networks, TCP going half-open) never sends
  // a close frame, so `ws.readyState` stays OPEN forever: 'close' never fires,
  // the player lingers in the world as a "ghost" (duplicating on reconnect), the
  // session is never closed, and — for accounts — the single-session check locks
  // that account out permanently. We ping every client and terminate any that
  // failed to pong since the previous tick; terminate() fires 'close', so all the
  // normal cleanup (session end, remove player, drop buildings) runs.
  const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 30_000;
  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false);
      try { ws.ping(); } catch { /* socket already gone */ }
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  // Spawns a player into a world and sends the welcome payload. Shared by the
  // direct-join path and the queue-admit path.
  function enterWorld(ws: WebSocket, world: World, name: string, account?: Account, lang: Lang = 'ru'): Player {
    const bal = getBalance();
    const player = world.spawnPlayer(name, ws, account, lang);
    recomputeMaxHp(world, player); // fold in restored level + hat
    player.hp = player.maxHp; // (re)join at full HP for the restored level
    // if this world was hosting their base as a raid target, hand it back first
    if (account) for (const w of worlds.active()) releaseBase(w, account.name);
    restoreBase(world, player); // saved base, or a free starter one for newcomers
    try {
      sessionIds.set(player, telemetry.sessionStart(name));
    } catch (err) {
      console.error('[telemetry] session start failed', err);
    }
    const welcome: WelcomeMsg = {
      t: 'welcome',
      id: player.id,
      time: Date.now(),
      registered: !!account,
      server: world.serverId,
      servers: worlds.list(),
      world: { size: bal.world.size, viewRadius: bal.world.viewRadius },
      player: { speed: bal.player.speed, radius: bal.player.radius },
      weapons: bal.weapons,
      buildings: bal.buildings,
      food: { heal: bal.food.heal, cooldownSec: bal.food.cooldownSec, maxCarry: bal.food.maxCarry, price: bal.food.price },
      hats: { items: bal.hats.items, lootboxPrice: bal.hats.lootboxPrice, dupGold: bal.hats.dupGold },
      weaponLootboxPrice: bal.weaponLootbox.price,
      prestige: bal.prestige,
      levels: bal.levels,
      rank: bal.rank,
      economy: { sellFrac: bal.economy.sellFrac },
      maxBuildings: bal.economy.maxBuildingsPerPlayer,
      maxWalls: bal.economy.maxWallsPerPlayer,
    };
    ws.send(encode(welcome));
    console.log(`[ws] ${name}${account ? ' (аккаунт)' : ''} joined server ${world.serverId} (${world.connectedPlayers().length} online)`);
    return player;
  }

  // Waiting queue: auto-join players that hit the hard cap wait here (FIFO) and
  // are admitted as slots free up, instead of being turned away.
  interface QueueEntry { ws: WebSocket; name: string; account?: Account; lang: Lang; bind: (p: Player, w: World) => void; }
  const queue: QueueEntry[] = [];

  function tryAdmit(): void {
    while (queue.length) {
      const e = queue[0];
      if (e.ws.readyState !== WebSocket.OPEN) { queue.shift(); continue; }
      const world = worlds.assign();
      if (!world) break; // still at the hard cap
      queue.shift();
      e.bind(enterWorld(e.ws, world, e.name, e.account, e.lang), world);
    }
    queue.forEach((e, i) => {
      if (e.ws.readyState === WebSocket.OPEN) e.ws.send(encode({ t: 'queued', pos: i + 1 }));
    });
  }
  setInterval(tryAdmit, 2000);

  // Leaderboard: top players by net worth (money), pushed to each world every 2s.
  setInterval(() => {
    for (const w of worlds.active()) {
      const players = [...w.players.values()].filter((p) => p.ws && p.ws.readyState === WebSocket.OPEN);
      if (!players.length) continue;
      const sorted = [...players].sort((a, b) => b.money - a.money);
      const top = sorted.slice(0, 5).map((p) => ({ name: p.name, money: p.money, prestige: p.prestige }));
      const rankOf = new Map(sorted.map((p, i) => [p, i + 1]));
      const msg = { top, total: sorted.length };
      for (const p of players) {
        p.ws!.send(encode({ t: 'leaderboard', ...msg, rank: rankOf.get(p) ?? 0 }));
      }
    }
  }, 2000);

  wss.on('connection', (ws: WebSocket) => {
    let player: Player | null = null;
    let world: World | null = null;

    // heartbeat liveness: browsers auto-reply to a protocol ping with a pong
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));

    ws.on('message', (data) => {
      const msg = decode<ClientMsg>(data.toString());
      if (!msg || typeof msg.t !== 'string') return;

      if (!player || !world) {
        if (msg.t !== 'join') return;
        const bal = getBalance();
        const lang = normalizeLang(msg.lang);
        const name = String(msg.name ?? '').trim().slice(0, 16) || tr(lang, 'anon');
        const password = typeof msg.password === 'string' ? msg.password.slice(0, 64) : '';

        // authenticate first, so the same account can't queue/play twice
        let account: Account | undefined;
        // one live session per account — across all worlds and the queue
        const isLive = (accName: string): boolean => {
          const acc = accName.toLowerCase();
          return worlds.active().some((w) => [...w.players.values()].some((o) => o.ws && o.account?.toLowerCase() === acc))
            || queue.some((e) => e.account?.name.toLowerCase() === acc);
        };
        try {
          if (typeof msg.cgToken === 'string' && msg.cgToken) {
            // CrazyGames: identity proven by the signed user token
            const cgUser = verifyCrazyGamesToken(msg.cgToken);
            if (!cgUser) {
              ws.send(encode({ t: 'reject', reason: tr(lang, 'authError') }));
              return;
            }
            account = loginCrazyGames(cgUser.userId, cgUser.username || name, bal.player.startMoney);
            if (isLive(account.name)) {
              ws.send(encode({ t: 'reject', reason: tr(lang, 'accountInGame') }));
              return;
            }
          } else if (typeof msg.yandexId === 'string' && msg.yandexId) {
            // Yandex Games Player API: identity proven by the signed player id
            if (!verifyYandexSignature(msg.yandexId, msg.yandexSig)) {
              ws.send(encode({ t: 'reject', reason: tr(lang, 'authError') }));
              return;
            }
            account = loginYandex(msg.yandexId, name, bal.player.startMoney);
            if (isLive(account.name)) {
              ws.send(encode({ t: 'reject', reason: tr(lang, 'accountInGame') }));
              return;
            }
          } else if (password) {
            const res = msg.register ? register(name, password, bal.player.startMoney, lang) : login(name, password, lang);
            if (!res.ok) {
              ws.send(encode({ t: 'reject', reason: res.reason ?? tr(lang, 'authError') }));
              return;
            }
            if (isLive(res.account!.name)) {
              ws.send(encode({ t: 'reject', reason: tr(lang, 'accountInGame') }));
              return;
            }
            account = res.account;
          } else if (accountExists(name)) {
            ws.send(encode({ t: 'reject', reason: tr(lang, 'nameRegistered') }));
            return;
          }
        } catch (err) {
          console.error('[auth] failed', err);
          ws.send(encode({ t: 'reject', reason: tr(lang, 'authServerError') }));
          return;
        }

        // grant any daily reward for accounts (before spawning, so welcome + event flow cleanly)
        const daily = account ? claimDailyReward(account.name) : null;
        if (daily && account) account.money += daily.gold;

        const finishJoin = (p: Player): void => {
          if (daily) p.ws?.send(encode({ t: 'event', ev: { e: 'dailyReward', gold: daily.gold, streak: daily.streak } }));
        };

        // explicit server pick: no queue — just tell them to try another
        if (typeof msg.server === 'number' && Number.isInteger(msg.server)) {
          const chosen = worlds.get(msg.server);
          if (!chosen) {
            ws.send(encode({ t: 'reject', reason: tr(lang, 'serverNotExist', { n: msg.server }) }));
            return;
          }
          if (!worlds.hasRoom(chosen)) {
            ws.send(encode({ t: 'reject', reason: tr(lang, 'serverFull', { n: msg.server }) }));
            return;
          }
          world = chosen;
          player = enterWorld(ws, chosen, name, account, lang);
          finishJoin(player);
          return;
        }

        // auto-assign, or wait in the queue when the whole machine is at capacity
        const assigned = worlds.assign();
        if (assigned) {
          world = assigned;
          player = enterWorld(ws, assigned, name, account, lang);
          finishJoin(player);
          return;
        }
        queue.push({ ws, name, account, lang, bind: (p, w) => { player = p; world = w; finishJoin(p); } });
        ws.send(encode({ t: 'queued', pos: queue.length }));
        return;
      }

      switch (msg.t) {
        case 'input': {
          if (typeof msg.seq !== 'number' || typeof msg.aim !== 'number') return;
          player.input = {
            seq: msg.seq,
            mx: clamp(Number(msg.mx) || 0, -1, 1),
            my: clamp(Number(msg.my) || 0, -1, 1),
            aim: Number.isFinite(msg.aim) ? msg.aim : 0,
            attack: !!msg.attack,
          };
          break;
        }
        case 'buy': {
          const res = msg.item === 'food' ? tryBuyFood(world, player) : tryBuyWeapon(world, player, msg.item as never);
          world.sendEvent(player, { e: 'purchase', ok: res.ok, item: String(msg.item), reason: res.reason });
          break;
        }
        case 'sell': {
          const res = trySellWeapon(world, player, msg.weapon);
          world.sendEvent(player, { e: 'purchase', ok: res.ok, item: `sell:${msg.weapon}`, reason: res.reason });
          break;
        }
        case 'reorder': {
          tryReorder(world, player, msg.weapons);
          break;
        }
        case 'eat': {
          tryEat(world, player, Date.now());
          break;
        }
        case 'withdraw': {
          const res = tryWithdraw(world, player);
          if (!res.ok) world.sendEvent(player, { e: 'purchase', ok: false, item: 'withdraw', reason: res.reason });
          break;
        }
        case 'respawn': {
          if (player.dead && Date.now() >= player.respawnAt) world.respawnPlayer(player);
          break;
        }
        case 'lootbox': {
          const res = tryLootbox(world, player);
          if (!res.ok) world.sendEvent(player, { e: 'purchase', ok: false, item: 'lootbox', reason: res.reason });
          break;
        }
        case 'weaponLootbox': {
          const res = tryWeaponLootbox(world, player);
          if (!res.ok) world.sendEvent(player, { e: 'purchase', ok: false, item: 'weaponLootbox', reason: res.reason });
          break;
        }
        case 'prestige': {
          const res = tryPrestige(world, player);
          if (!res.ok) world.sendEvent(player, { e: 'purchase', ok: false, item: 'prestige', reason: res.reason });
          break;
        }
        case 'equipHat': {
          tryEquipHat(world, player, typeof msg.hat === 'string' ? msg.hat : null);
          break;
        }
        case 'equip': {
          tryEquip(world, player, msg.weapon);
          break;
        }
        case 'place': {
          const res = tryPlaceBuilding(world, player, msg.building, Number(msg.x), Number(msg.y));
          world.sendEvent(player, { e: 'placed', ok: res.ok, reason: res.reason });
          break;
        }
        case 'ping': {
          ws.send(encode({ t: 'pong', ts: msg.ts }));
          break;
        }
      }
    });

    ws.on('close', () => {
      const qi = queue.findIndex((e) => e.ws === ws);
      if (qi >= 0) queue.splice(qi, 1); // was waiting, never entered a world
      if (!player) return;
      const sid = sessionIds.get(player);
      if (sid !== undefined) {
        try {
          telemetry.sessionEnd(sid, player.session.kills, player.session.deaths, player.session.moneyEarned);
        } catch (err) {
          console.error('[telemetry] session end failed', err);
        }
      }
      // account progress (gold + weapons + hats) survives the session
      if (player.account) {
        try {
          saveProgress(player.account, player.money, player.banked, player.bankedTotal, player.withdrawCredit, player.weapons, player.hats, player.hat, player.prestige, player.level, player.food);
        } catch (err) {
          console.error('[auth] progress save failed', err);
        }
      }
      // the base is saved and then cleared from this world; it is rebuilt
      // wherever the player logs in next
      if (world) {
        storeBase(world, player);
        removePlayerBuildings(world, player);
        if (!player.dead) world.removeEntity(player);
        player.ws = null;
        world.players.delete(player.id);
        console.log(`[ws] ${player.name} left server ${world.serverId} (${world.connectedPlayers().length} online)`);
      }
      player = null;
      world = null;
      tryAdmit(); // a slot may have freed up for someone waiting
    });

    ws.on('error', () => ws.close());
  });

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`[http] listening on :${port}`));
  return server;
}

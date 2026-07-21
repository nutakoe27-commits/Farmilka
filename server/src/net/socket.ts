import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { decode, encode, type ClientMsg, type WelcomeMsg } from '@shared/protocol.js';
import { clamp } from '@shared/math.js';
import { getBalance } from '../game/balance.js';
import type { World } from '../game/world.js';
import type { Player } from '../game/entities.js';
import { tryBuyWeapon, tryBuyFood, trySellWeapon, tryReorder, tryEat, tryEquip } from '../game/economy.js';
import { tryPlaceBuilding, removePlayerBuildings } from '../game/buildings.js';
import { tryLootbox, tryEquipHat, applyHatMaxHp } from '../game/hats.js';
import { tryPrestige } from '../game/prestige.js';
import { telemetry } from '../db/telemetry.js';
import { accountExists, login, register, saveProgress, type Account } from '../db/accounts.js';
import { adminRouter } from '../admin/stats.js';

const sessionIds = new WeakMap<Player, number>();

export function startServer(worlds: World[]): http.Server {
  const app = express();
  app.use('/admin', adminRouter(worlds));

  // live server list for the client's server picker
  app.get('/servers', (_req, res) => {
    const max = getBalance().world.maxPlayers;
    res.json(worlds.map((w) => ({ id: w.serverId, online: w.connectedPlayers().length, max })));
  });

  // serve built client in production
  const clientDist = process.env.CLIENT_DIST ?? path.resolve(process.cwd(), '../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
    console.log(`[http] serving client from ${clientDist}`);
  } else {
    app.get('/', (_req, res) => res.send('Farmilka server. Client build not found — use Vite dev server.'));
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    let player: Player | null = null;
    let world: World | null = null;

    ws.on('message', (data) => {
      const msg = decode<ClientMsg>(data.toString());
      if (!msg || typeof msg.t !== 'string') return;

      if (!player || !world) {
        if (msg.t !== 'join') return;
        const bal = getBalance();

        // pick a world: explicit choice or first with a free slot
        if (typeof msg.server === 'number' && Number.isInteger(msg.server)) {
          const chosen = worlds[msg.server - 1];
          if (!chosen) {
            ws.send(encode({ t: 'reject', reason: `Сервера ${msg.server} не существует` }));
            return;
          }
          if (chosen.connectedPlayers().length >= bal.world.maxPlayers) {
            ws.send(encode({ t: 'reject', reason: `Сервер ${msg.server} заполнен — выберите другой` }));
            return;
          }
          world = chosen;
        } else {
          world = worlds.find((w) => w.connectedPlayers().length < bal.world.maxPlayers) ?? null;
          if (!world) {
            ws.send(encode({ t: 'reject', reason: 'Все серверы заполнены' }));
            ws.close();
            return;
          }
        }
        const name = String(msg.name ?? '').trim().slice(0, 16) || 'Безымянный';
        const password = typeof msg.password === 'string' ? msg.password.slice(0, 64) : '';

        let account: Account | undefined;
        try {
          if (password) {
            const res = msg.register ? register(name, password, bal.player.startMoney) : login(name, password);
            if (!res.ok) {
              ws.send(encode({ t: 'reject', reason: res.reason ?? 'Ошибка авторизации' }));
              return;
            }
            // one live session per account — across all game servers
            for (const w of worlds) {
              for (const other of w.players.values()) {
                if (other.ws && other.account && other.account.toLowerCase() === res.account!.name.toLowerCase()) {
                  ws.send(encode({ t: 'reject', reason: 'Этот аккаунт уже в игре' }));
                  return;
                }
              }
            }
            account = res.account;
          } else if (accountExists(name)) {
            ws.send(encode({ t: 'reject', reason: 'Это имя зарегистрировано — введите пароль' }));
            return;
          }
        } catch (err) {
          console.error('[auth] failed', err);
          ws.send(encode({ t: 'reject', reason: 'Ошибка сервера при авторизации' }));
          return;
        }

        player = world.spawnPlayer(name, ws, account);
        applyHatMaxHp(world, player);
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
          servers: worlds.map((w) => ({ id: w.serverId, online: w.connectedPlayers().length, max: bal.world.maxPlayers })),
          world: {
            size: bal.world.size,
            viewRadius: bal.world.viewRadius,
          },
          player: { speed: bal.player.speed, radius: bal.player.radius },
          weapons: bal.weapons,
          buildings: bal.buildings,
          food: {
            heal: bal.food.heal,
            cooldownSec: bal.food.cooldownSec,
            maxCarry: bal.food.maxCarry,
            price: bal.food.price,
          },
          hats: { items: bal.hats.items, lootboxPrice: bal.hats.lootboxPrice, dupGold: bal.hats.dupGold },
          prestige: bal.prestige,
          economy: { sellFrac: bal.economy.sellFrac },
          maxBuildings: bal.economy.maxBuildingsPerPlayer,
        };
        ws.send(encode(welcome));
        console.log(`[ws] ${name}${account ? ' (аккаунт)' : ''} joined server ${world.serverId} (${world.connectedPlayers().length} online)`);
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
        case 'lootbox': {
          const res = tryLootbox(world, player);
          if (!res.ok) world.sendEvent(player, { e: 'purchase', ok: false, item: 'lootbox', reason: res.reason });
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
          saveProgress(player.account, player.money, player.weapons, player.hats, player.hat, player.prestige);
        } catch (err) {
          console.error('[auth] progress save failed', err);
        }
      }
      // buildings only live while their owner is online
      if (world) {
        removePlayerBuildings(world, player);
        if (!player.dead) world.removeEntity(player);
        player.ws = null;
        world.players.delete(player.id);
        console.log(`[ws] ${player.name} left server ${world.serverId} (${world.connectedPlayers().length} online)`);
      }
      player = null;
      world = null;
    });

    ws.on('error', () => ws.close());
  });

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`[http] listening on :${port}`));
  return server;
}

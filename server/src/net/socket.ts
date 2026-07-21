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
import { tryBuyWeapon, tryEquip } from '../game/economy.js';
import { tryPlaceBuilding } from '../game/buildings.js';
import { telemetry } from '../db/telemetry.js';
import { adminRouter } from '../admin/stats.js';

const sessionIds = new WeakMap<Player, number>();

export function startServer(world: World): http.Server {
  const app = express();
  app.use('/admin', adminRouter());

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

    ws.on('message', (data) => {
      const msg = decode<ClientMsg>(data.toString());
      if (!msg || typeof msg.t !== 'string') return;

      if (!player) {
        if (msg.t !== 'join') return;
        const bal = getBalance();
        if (world.connectedPlayers().length >= bal.world.maxPlayers) {
          ws.send(encode({ t: 'reject', reason: 'Сервер заполнен' }));
          ws.close();
          return;
        }
        const name = String(msg.name ?? '').trim().slice(0, 16) || 'Безымянный';
        player = world.spawnPlayer(name, ws);
        try {
          sessionIds.set(player, telemetry.sessionStart(name));
        } catch (err) {
          console.error('[telemetry] session start failed', err);
        }
        const welcome: WelcomeMsg = {
          t: 'welcome',
          id: player.id,
          time: Date.now(),
          world: {
            size: bal.world.size,
            safeZoneRadius: bal.world.safeZoneRadius,
            viewRadius: bal.world.viewRadius,
          },
          player: { speed: bal.player.speed, radius: bal.player.radius },
          weapons: bal.weapons,
          buildings: bal.buildings,
          maxBuildings: bal.economy.maxBuildingsPerPlayer,
        };
        ws.send(encode(welcome));
        console.log(`[ws] ${name} joined (${world.connectedPlayers().length} online)`);
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
          const res = tryBuyWeapon(world, player, msg.item as never);
          world.sendEvent(player, { e: 'purchase', ok: res.ok, item: String(msg.item), reason: res.reason });
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
      if (!player.dead) world.removeEntity(player);
      player.ws = null;
      world.maybeForgetPlayer(player);
      console.log(`[ws] ${player.name} left (${world.connectedPlayers().length} online)`);
      player = null;
    });

    ws.on('error', () => ws.close());
  });

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`[http] listening on :${port}`));
  return server;
}

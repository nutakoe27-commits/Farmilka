/**
 * Headless load-test bots: join, wander, chase & attack the nearest entity,
 * occasionally buy weapons and place buildings. Also useful for generating
 * telemetry data to validate /admin/stats.
 *
 * Usage: npx tsx scripts/bots.ts --n 30 --url ws://localhost:3000/ws --minutes 5
 */
import WebSocket from 'ws';
import { decode, encode, type ServerMsg, type ClientMsg, type WelcomeMsg, type EntityState, type SnapshotMsg } from '@shared/protocol.js';
import { decodeSnapshot } from '@shared/snapshot-codec.js';

const args = process.argv.slice(2);
function arg(name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const N = Number(arg('n', '10'));
const URL = arg('url', 'ws://localhost:3000/ws');
const MINUTES = Number(arg('minutes', '2'));

let joined = 0;
let killsSeen = 0;
let snapshots = 0;
let bytes = 0;

class Bot {
  ws: WebSocket;
  id = '';
  seq = 0;
  x = 0;
  y = 0;
  money = 0;
  weapons: string[] = ['fists'];
  entities = new Map<string, EntityState>();
  welcome: WelcomeMsg | null = null;
  wanderAngle = Math.random() * Math.PI * 2;
  timer: NodeJS.Timeout | null = null;
  dead = false;

  constructor(public name: string) {
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => this.ws.send(encode({ t: 'join', name })));
    this.ws.binaryType = 'nodebuffer';
    this.ws.on('message', (d, isBinary) => {
      if (isBinary) { bytes += (d as Buffer).length; this.onSnapshot(decodeSnapshot(d as Buffer)); }
      else this.onMsg(d.toString());
    });
    this.ws.on('error', (e) => console.error(`[${name}] ws error:`, e.message));
    this.ws.on('close', () => {
      if (this.timer) clearInterval(this.timer);
    });
  }

  onMsg(data: string): void {
    bytes += data.length;
    const msg = decode<ServerMsg>(data);
    if (!msg) return;
    if (msg.t === 'welcome') {
      this.welcome = msg;
      this.id = msg.id;
      joined++;
      this.timer = setInterval(() => this.think(), 100);
    } else if (msg.t === 'event' && msg.ev.e === 'kill') {
      killsSeen++;
    }
  }

  onSnapshot(msg: SnapshotMsg): void {
    snapshots++;
    for (const st of msg.add) this.entities.set(st.id, st);
    for (const u of msg.upd) {
      const e = this.entities.get(u.id);
      if (e) {
        e.x = u.x;
        e.y = u.y;
        if (u.hp !== undefined) e.hp = u.hp;
      }
    }
    for (const id of msg.rem) this.entities.delete(id);
    this.x = msg.self.x;
    this.y = msg.self.y;
    this.money = msg.self.money;
    this.weapons = msg.self.weapons;
    this.dead = msg.self.respawnIn !== undefined;
  }

  think(): void {
    if (!this.welcome || this.dead || this.ws.readyState !== WebSocket.OPEN) return;

    // shop works from anywhere now
    if (this.weapons.length < 3) {
      for (const [id, cfg] of Object.entries(this.welcome.weapons)) {
        if (cfg.price > 0 && cfg.price <= this.money && !this.weapons.includes(id)) {
          this.ws.send(encode({ t: 'buy', item: id } as ClientMsg));
          break;
        }
      }
    }
    // occasionally place a farm
    if (this.money > 400 && Math.random() < 0.01) {
      this.ws.send(encode({ t: 'place', building: 'farm', x: Math.round(this.x + 120), y: Math.round(this.y) } as ClientMsg));
    }

    // nearest attackable entity
    let target: EntityState | null = null;
    let bestD = Infinity;
    for (const e of this.entities.values()) {
      if (e.id === this.id) continue;
      if (e.kind !== 'mob' && e.kind !== 'player' && e.kind !== 'boss') continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d < bestD) {
        bestD = d;
        target = e;
      }
    }

    let mx: number;
    let my: number;
    let aim = this.wanderAngle;
    let attack = false;
    if (target && bestD < 600) {
      aim = Math.atan2(target.y - this.y, target.x - this.x);
      mx = Math.cos(aim);
      my = Math.sin(aim);
      attack = bestD < 160;
      if (bestD < 60) {
        mx = 0;
        my = 0;
      }
    } else {
      if (Math.random() < 0.05) this.wanderAngle = Math.random() * Math.PI * 2;
      // drift away from walls
      if (this.x < 300) this.wanderAngle = 0;
      if (this.x > this.welcome.world.size - 300) this.wanderAngle = Math.PI;
      if (this.y < 300) this.wanderAngle = Math.PI / 2;
      if (this.y > this.welcome.world.size - 300) this.wanderAngle = -Math.PI / 2;
      mx = Math.cos(this.wanderAngle);
      my = Math.sin(this.wanderAngle);
    }
    this.seq++;
    this.ws.send(encode({ t: 'input', seq: this.seq, mx, my, aim, attack }));
  }
}

console.log(`Starting ${N} bots against ${URL} for ${MINUTES} min...`);
const bots: Bot[] = [];
for (let i = 0; i < N; i++) {
  setTimeout(() => bots.push(new Bot(`Bot-${i + 1}`)), i * 150);
}

const statsTimer = setInterval(() => {
  console.log(`[bots] joined=${joined}/${N} snapshots=${snapshots} kills-seen=${killsSeen} rx=${(bytes / 1024 / 1024).toFixed(1)}MB`);
}, 5000);

setTimeout(() => {
  console.log('Done. Closing bots.');
  clearInterval(statsTimer);
  for (const b of bots) b.ws.close();
  setTimeout(() => process.exit(0), 1000);
}, MINUTES * 60_000);

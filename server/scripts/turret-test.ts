// Turret behaviour test — needs a server on :3997 started with a rigged balance
// (cheap turret, high start money). Verifies: (1) a turret fires at and damages
// MOBS (not just players); (2) a player can place at most maxTurretsPerPlayer.
import WebSocket from 'ws';
import { decodeSnapshot } from '@shared/snapshot-codec.js';

const URL = 'ws://localhost:3997/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class C {
  ws: WebSocket; seq = 0; ready = false; id = ''; size = 7000;
  x = 0; y = 0; entities = new Map<string, any>(); events: any[] = [];
  constructor(name: string) {
    this.ws = new WebSocket(URL); this.ws.binaryType = 'nodebuffer';
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name })));
    this.ws.on('message', (d, isBinary) => {
      if (!isBinary) { const m = JSON.parse(d.toString()); if (m.t === 'welcome') { this.ready = true; this.id = m.id; this.size = m.world.size; } else if (m.t === 'event') this.events.push(m.ev); return; }
      const m = decodeSnapshot(d as Buffer);
      for (const s of m.add) this.entities.set(s.id, s);
      for (const u of m.upd) { const e = this.entities.get(u.id); if (e) { e.x = u.x; e.y = u.y; if (u.hp !== undefined) e.hp = u.hp; } }
      for (const id of m.rem) this.entities.delete(id);
      this.x = m.self.x; this.y = m.self.y;
    });
  }
  input(mx: number, my: number, aim = 0, attack = false) { this.seq++; this.ws.send(JSON.stringify({ t: 'input', seq: this.seq, mx, my, aim, attack })); }
  send(o: object) { this.ws.send(JSON.stringify(o)); }
  async waitReady() { const t0 = Date.now(); while (!this.ready && Date.now() - t0 < 5000) await sleep(30); }
}

async function moveTo(c: C, tx: number, ty: number, maxMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { const d = Math.hypot(tx - c.x, ty - c.y); if (d < 40) break; c.input((tx - c.x) / d, (ty - c.y) / d); await sleep(60); }
  c.input(0, 0); await sleep(100);
}

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function main() {
  const c = new C('Engineer');
  await c.waitReady();
  await sleep(400);
  await moveTo(c, c.size / 2, c.size / 2); // plains centre — slimes/wolves around

  // ---- turret fires at and damages mobs ----
  const target = [...c.entities.values()].find((e) => e.kind === 'mob');
  check('a mob is in range to shoot', !!target, `mobs=${[...c.entities.values()].filter((e) => e.kind === 'mob').length}`);
  const mobHpBefore = target?.hp ?? 0;
  c.send({ t: 'place', building: 'turret', x: Math.round(c.x + 50), y: Math.round(c.y) });
  await sleep(300);
  // sample for turret projectiles + mob damage over a few seconds
  let sawProjectile = false;
  let mobDamaged = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    for (const e of c.entities.values()) if (e.kind === 'projectile') sawProjectile = true;
    const t = target ? c.entities.get(target.id) : null;
    if (target && (!t || (t && t.hp < mobHpBefore))) mobDamaged = true; // took damage or was killed
    await sleep(120);
  }
  check('turret fires projectiles', sawProjectile);
  check('turret damages/kills a mob', mobDamaged, `mobHpBefore=${mobHpBefore}`);

  // ---- turret placement cap (max 2) ----
  c.events.length = 0;
  const spots = [[c.x - 90, c.y], [c.x, c.y + 130], [c.x + 130, c.y + 130]]; // spaced > buildingMinDist
  for (const [x, y] of spots) { c.send({ t: 'place', building: 'turret', x: Math.round(x), y: Math.round(y) }); await sleep(400); }
  const placed = c.events.filter((e) => e.e === 'placed');
  const oks = placed.filter((e) => e.ok).length;
  const rejected = placed.find((e) => !e.ok);
  check('only reaches the turret cap (<=2 total incl. the first)', oks <= 1, `extra oks=${oks} placed=${JSON.stringify(placed)}`);
  check('extra turret rejected with a limit reason', !!rejected && /[Лл]имит турел|[Tt]urret limit/.test(rejected.reason ?? ''), `reason=${rejected?.reason}`);

  c.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

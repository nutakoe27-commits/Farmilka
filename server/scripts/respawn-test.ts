// Manual-respawn test — needs a server on :3997 with a rigged balance
// (hp 5, respawnSec 2, startMoney 5000). Verifies: no auto-respawn for real
// players; early respawn rejected; buying works while dead but placing a
// building is blocked; the respawn message revives with the bought weapon kept.
import WebSocket from 'ws';
import { decodeSnapshot } from '@shared/snapshot-codec.js';

const URL = 'ws://localhost:3997/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const AGGRO = new Set(['wolf', 'scorpion', 'sand_golem', 'yeti', 'wisp', 'shade', 'treant', 'crystal_golem']);

class C {
  ws: WebSocket; seq = 0; ready = false; id = ''; size = 7000;
  x = 0; y = 0; hp = 0; money = 0; weapons: string[] = []; respawnIn: number | undefined;
  entities = new Map<string, any>(); events: any[] = [];
  constructor(name: string) {
    this.ws = new WebSocket(URL); this.ws.binaryType = 'nodebuffer';
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name })));
    this.ws.on('message', (d, isBinary) => {
      if (!isBinary) { const m = JSON.parse(d.toString()); if (m.t === 'welcome') { this.ready = true; this.id = m.id; this.size = m.world.size; } else if (m.t === 'event') this.events.push(m.ev); return; }
      const m = decodeSnapshot(d as Buffer);
      for (const s of m.add) this.entities.set(s.id, s);
      for (const u of m.upd) { const e = this.entities.get(u.id); if (e) { e.x = u.x; e.y = u.y; if (u.hp !== undefined) e.hp = u.hp; } }
      for (const id of m.rem) this.entities.delete(id);
      this.x = m.self.x; this.y = m.self.y; this.hp = m.self.hp; this.money = m.self.money; this.weapons = m.self.weapons; this.respawnIn = m.self.respawnIn;
    });
  }
  input(mx: number, my: number, aim = 0, attack = false) { this.seq++; this.ws.send(JSON.stringify({ t: 'input', seq: this.seq, mx, my, aim, attack })); }
  send(o: object) { this.ws.send(JSON.stringify(o)); }
  async waitReady() { const t0 = Date.now(); while (!this.ready && Date.now() - t0 < 5000) await sleep(30); }
  dead() { return this.respawnIn !== undefined; }
}

async function walkInto(c: C, tx: number, ty: number, ms: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && !c.dead()) { const d = Math.hypot(tx - c.x, ty - c.y) || 1; c.input((tx - c.x) / d, (ty - c.y) / d); await sleep(60); }
  c.input(0, 0);
}

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function main() {
  const b = new C('Victim');
  await b.waitReady();
  await sleep(400);

  // die: walk into an aggressive mob (hp is 5, one hit kills)
  const t0 = Date.now();
  while (!b.dead() && Date.now() - t0 < 40000) {
    let mob: any = null, bd = Infinity;
    for (const e of b.entities.values()) { if (e.kind === 'mob' && AGGRO.has(e.mobType)) { const d = Math.hypot(e.x - b.x, e.y - b.y); if (d < bd) { bd = d; mob = e; } } }
    if (mob) await walkInto(b, mob.x, mob.y, 6000);
    else await walkInto(b, b.size / 2 + (Math.random() - 0.5) * 1200, b.size / 2 + (Math.random() - 0.5) * 1200, 4000);
  }
  check('player died', b.dead(), `respawnIn=${b.respawnIn}`);

  // early respawn attempt is rejected (timer still running)
  b.send({ t: 'respawn' });
  await sleep(400);
  check('early respawn is ignored (still dead)', b.dead(), `respawnIn=${b.respawnIn}`);

  // buy a weapon while dead — should succeed
  b.events.length = 0;
  b.send({ t: 'buy', item: 'sword' });
  await sleep(400);
  check('can buy a weapon while dead', b.weapons.includes('sword'), `weapons=${b.weapons}`);

  // placing a building while dead is blocked
  b.events.length = 0;
  b.send({ t: 'place', building: 'farm', x: Math.round(b.x + 40), y: Math.round(b.y) });
  await sleep(400);
  const placed = b.events.find((e) => e.e === 'placed');
  check('placing a building while dead is blocked', !!placed && !placed.ok, `placed=${JSON.stringify(placed)}`);

  // wait past the respawn timer — must NOT auto-respawn
  await sleep(3500);
  check('does NOT auto-respawn (waits for the button)', b.dead() && (b.respawnIn ?? 1) <= 0, `respawnIn=${b.respawnIn}`);

  // now respawn on demand — revives, keeping the weapon bought while dead
  b.send({ t: 'respawn' });
  await sleep(700);
  check('respawns on request', !b.dead() && b.hp > 0, `hp=${b.hp} respawnIn=${b.respawnIn}`);
  check('keeps the weapon bought during the break', b.weapons.includes('sword'), `weapons=${b.weapons}`);

  b.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

// Balance/leveling test against a server on :3998 (fresh DB, BOTS_PER_WORLD=0).
// Verifies: (1) players spawn spread across the three starter biomes;
// (2) a fresh fists-only player can kill starter mobs and level up FROM kills
// (no gold purchase), reaching level 2 after killsPerLevel mob kills.
import WebSocket from 'ws';
import { decodeSnapshot } from '@shared/snapshot-codec.js';
import { biomeAt } from '@shared/biomes.js';

const URL = 'ws://localhost:3998/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class C {
  ws: WebSocket; seq = 0; ready = false; id = '';
  x = 0; y = 0; hp = 0; level = 1; levelKills = 0; respawnIn: number | undefined;
  size = 7000; entities = new Map<string, any>();
  constructor(name: string) {
    this.ws = new WebSocket(URL); this.ws.binaryType = 'nodebuffer';
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name })));
    this.ws.on('message', (d, isBinary) => {
      if (!isBinary) { const m = JSON.parse(d.toString()); if (m.t === 'welcome') { this.ready = true; this.id = m.id; this.size = m.world.size; } return; }
      const m = decodeSnapshot(d as Buffer);
      for (const s of m.add) this.entities.set(s.id, s);
      for (const u of m.upd) { const e = this.entities.get(u.id); if (e) { e.x = u.x; e.y = u.y; if (u.hp !== undefined) e.hp = u.hp; } }
      for (const id of m.rem) this.entities.delete(id);
      this.x = m.self.x; this.y = m.self.y; this.hp = m.self.hp; this.level = m.self.level; this.levelKills = m.self.levelKills; this.respawnIn = m.self.respawnIn;
    });
  }
  input(mx: number, my: number, aim = 0, attack = false) { this.seq++; this.ws.send(JSON.stringify({ t: 'input', seq: this.seq, mx, my, aim, attack })); }
  async waitReady() { const t0 = Date.now(); while (!this.ready && Date.now() - t0 < 5000) await sleep(30); }
  biome() { return biomeAt(this.x, this.y, this.size); }
}

async function moveTo(c: C, tx: number, ty: number, maxMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const d = Math.hypot(tx - c.x, ty - c.y);
    if (d < 40) break;
    c.input((tx - c.x) / d, (ty - c.y) / d);
    await sleep(60);
  }
  c.input(0, 0); await sleep(100);
}

function nearestMob(c: C, maxHp = 75): any {
  let best: any = null, bd = Infinity;
  for (const e of c.entities.values()) {
    if (e.kind !== 'mob') continue;
    if (e.mobType === 'sand_golem' || e.mobType === 'yeti') continue; // skip tanks for a quick test
    const d = Math.hypot(e.x - c.x, e.y - c.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Chase a mob and punch it with fists until it dies (leaves the entity set). */
async function killMob(c: C, mob: any, maxMs = 14000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (!c.entities.has(mob.id)) return true; // killed
    const e = c.entities.get(mob.id);
    const dx = e.x - c.x, dy = e.y - c.y, d = Math.hypot(dx, dy) || 1;
    const aim = Math.atan2(dy, dx);
    if (d > 48) { c.input(dx / d, dy / d, aim, true); } else { c.input(0, 0, aim, true); }
    await sleep(70);
  }
  return !c.entities.has(mob.id);
}

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function main() {
  // ---- spawn distribution across starter biomes ----
  const crowd: C[] = [];
  for (let i = 0; i < 8; i++) crowd.push(new C(`Spawn${i}`));
  await Promise.all(crowd.map((c) => c.waitReady()));
  await sleep(500);
  const biomes = crowd.map((c) => c.biome());
  const distinct = new Set(biomes);
  check('players spread across >=2 starter biomes', distinct.size >= 2, `biomes=${[...distinct].join(',')}`);
  check('spawns only in starter biomes (no mystic)', biomes.every((b) => b === 'normal' || b === 'snow' || b === 'desert'), `${biomes.join(',')}`);
  for (const c of crowd) c.ws.close();
  await sleep(300);

  // ---- kill-based leveling with fists only ----
  const a = new C('Grinder');
  await a.waitReady();
  await sleep(400);
  check('starts at level 1', a.level === 1, `level=${a.level}`);
  // walk to the middle of the plains where slimes/wolves live
  await moveTo(a, a.size / 2, a.size / 2);
  let kills = 0;
  const t0 = Date.now();
  while (a.level < 2 && Date.now() - t0 < 70000) {
    const mob = nearestMob(a);
    if (!mob) { await moveTo(a, a.size / 2 + (Math.random() - 0.5) * 800, a.size / 2 + (Math.random() - 0.5) * 800, 4000); continue; }
    const killed = await killMob(a, mob);
    if (killed) kills++;
    if (a.respawnIn !== undefined) break; // died — abort
  }
  check('fists player can kill starter mobs', kills >= 3, `kills=${kills}`);
  check('leveled up FROM kills (no purchase)', a.level >= 2, `level=${a.level} killPoints=${a.levelKills}`);
  a.ws.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

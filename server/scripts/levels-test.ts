// Player leveling system test. Needs an isolated server on :3999 with a FRESH
// DB and a rigged balance: levels {max 10, cost 100, hpPerLevel 10,
// damagePerLevel 0.03}, startMoney 20000, spawnProtectSec 0, regen 0, peaceful
// slow mobs (slime hp 300 so it survives a measured hit), a harmless stationary
// champion boss (0 damage, huge HP) spawning early, hats disabled.
// Verifies: start at level 1 / maxHp 100 / cost 100; flat 100 cost per level;
// maxHp +10 and current HP +10 per level; can't exceed max; rejected without
// gold; damage scales with level for mobs (18 -> 23) but NOT for bosses (18);
// levels reset to 1 on death.
import WebSocket from 'ws';

const URL = 'ws://localhost:3999/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class C {
  ws: WebSocket; seq = 0; x = 0; y = 0; hp = 0; maxHp = 0; money = 0; id = ''; ready = false;
  level = 0; levelCost = 0; respawnIn: number | undefined;
  entities = new Map<string, any>(); events: any[] = [];
  constructor(name: string) {
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name })));
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.ready = true; this.id = m.id; }
      else if (m.t === 'snapshot') {
        for (const s of m.add) this.entities.set(s.id, s);
        for (const u of m.upd) { const e = this.entities.get(u.id); if (e) { e.x = u.x; e.y = u.y; if (u.hp !== undefined) e.hp = u.hp; } }
        for (const id of m.rem) this.entities.delete(id);
        this.x = m.self.x; this.y = m.self.y; this.hp = m.self.hp; this.maxHp = m.self.maxHp;
        this.money = m.self.money; this.level = m.self.level; this.levelCost = m.self.levelCost;
        this.respawnIn = m.self.respawnIn;
      } else if (m.t === 'event') this.events.push(m.ev);
    });
  }
  input(mx: number, my: number, aim = 0, attack = false) { this.seq++; this.ws.send(JSON.stringify({ t: 'input', seq: this.seq, mx, my, aim, attack })); }
  send(o: object) { this.ws.send(JSON.stringify(o)); }
  async waitReady() { while (!this.ready) await sleep(50); }
  aimAt(t: { x: number; y: number }) { return Math.atan2(t.y - this.y, t.x - this.x); }
}

async function moveTo(c: C, tx: number, ty: number, maxMs = 25000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const d = Math.hypot(tx - c.x, ty - c.y);
    if (d < 15) break;
    c.input((tx - c.x) / d, (ty - c.y) / d);
    await sleep(50);
  }
  c.input(0, 0);
  await sleep(150);
}

function nearest(c: C, pred: (e: any) => boolean): any {
  let best: any = null; let bd = Infinity;
  for (const e of c.entities.values()) {
    if (!pred(e)) continue;
    const d = Math.hypot(e.x - c.x, e.y - c.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Walks to a target and lands exactly one melee hit; returns the damage-event amount. */
async function measureHit(c: C, target: any): Promise<number | null> {
  await moveTo(c, target.x - 60, target.y);
  const aim = c.aimAt(target);
  c.events.length = 0;
  c.input(0, 0, aim, true);
  await sleep(300);
  c.input(0, 0, aim, false);
  await sleep(200);
  const dmg = c.events.find((e) => e.e === 'damage' && e.target === target.id);
  return dmg ? dmg.amount : null;
}

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function main() {
  const a = new C('Leveler');
  const b = new C('Executioner');
  await Promise.all([a.waitReady(), b.waitReady()]);
  await sleep(500);

  // ---- starting state ----
  check('starts at level 1', a.level === 1, `level=${a.level}`);
  check('base maxHp 100', a.maxHp === 100, `maxHp=${a.maxHp}`);
  check('first level costs 100', a.levelCost === 100, `cost=${a.levelCost}`);

  // ---- mob damage at level 1 ----
  a.send({ t: 'buy', item: 'sword' });
  await sleep(300);
  const slime1 = nearest(a, (e) => e.kind === 'mob' && e.mobType === 'slime');
  check('found a slime', !!slime1);
  const dmgL1 = slime1 ? await measureHit(a, slime1) : null;
  check('sword deals 18 at level 1', dmgL1 === 18, `dmg=${dmgL1}`);

  // ---- buy one level: flat 100 cost, +10 maxHp, +10 current HP ----
  const moneyBefore = a.money;
  const hpBefore = a.hp;
  a.send({ t: 'buyLevel' });
  await sleep(400);
  check('level is now 2', a.level === 2, `level=${a.level}`);
  check('flat cost 100 deducted', a.money === moneyBefore - 100, `${moneyBefore} -> ${a.money}`);
  check('maxHp raised to 110', a.maxHp === 110, `maxHp=${a.maxHp}`);
  check('current HP raised by 10', a.hp === Math.min(110, hpBefore + 10), `hp=${a.hp}`);
  check('got level event', a.events.some((e) => e.e === 'level' && e.level === 2));

  // ---- buy up to max (level 10) ----
  for (let i = 0; i < 8; i++) { a.send({ t: 'buyLevel' }); await sleep(250); }
  check('reached max level 10', a.level === 10, `level=${a.level}`);
  check('maxHp 190 at level 10', a.maxHp === 190, `maxHp=${a.maxHp}`);
  check('no further cost at max', a.levelCost === 0, `cost=${a.levelCost}`);

  // ---- cannot exceed max ----
  a.events.length = 0;
  a.send({ t: 'buyLevel' });
  await sleep(300);
  check('level-up beyond max rejected', a.level === 10 && a.events.some((e) => e.e === 'purchase' && e.item === 'level' && !e.ok), `level=${a.level}`);

  // ---- mob damage scales at level 10 (18 * 1.27 = 22.86 -> 23) ----
  const slime10 = nearest(a, (e) => e.kind === 'mob' && e.mobType === 'slime' && e.hp > 30);
  const dmgL10 = slime10 ? await measureHit(a, slime10) : null;
  check('sword scales to 23 at level 10 (x1.27)', dmgL10 === 23, `dmg=${dmgL10}`);

  // ---- boss damage is NOT scaled by level (stays 18) ----
  let boss: any = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !boss) {
    boss = nearest(a, (e) => e.kind === 'boss');
    if (!boss) { await moveTo(a, 1200, 1200, 4000); }
    else break;
    await sleep(200);
  }
  check('boss present for exclusion test', !!boss);
  if (boss) {
    const dmgBoss = await measureHit(a, boss);
    check('level bonus does NOT apply to bosses (18)', dmgBoss === 18, `dmg=${dmgBoss}`);
  }

  // ---- levels reset on death ----
  a.input(0, 0);
  b.send({ t: 'buy', item: 'sword' });
  await sleep(300);
  const td = Date.now();
  while (Date.now() - td < 40000) {
    if (a.respawnIn !== undefined) break;
    const aEnt = b.entities.get(a.id) ?? { x: a.x, y: a.y };
    await moveTo(b, aEnt.x - 55, aEnt.y, 3000);
    b.input(0, 0, b.aimAt({ x: a.x, y: a.y }), true);
    await sleep(400);
    b.input(0, 0, 0, false);
    await sleep(150);
  }
  check('victim died', a.respawnIn !== undefined, `respawnIn=${a.respawnIn}`);
  // wait for respawn
  const tr = Date.now();
  while (Date.now() - tr < 12000 && a.respawnIn !== undefined) await sleep(200);
  await sleep(500);
  check('level reset to 1 on death', a.level === 1, `level=${a.level}`);
  check('maxHp reset to 100 on death', a.maxHp === 100, `maxHp=${a.maxHp}`);

  a.ws.close(); b.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

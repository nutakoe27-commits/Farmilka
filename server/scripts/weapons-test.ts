// New-weapons & new-hats ability test. Needs an isolated server on :3999 with
// a FRESH DB and a rigged balance: peaceful slow mobs, slime reward 300,
// startMoney 20000, spawnProtectSec 0, regen 0, hats.items = single common
// "test_hood" {mobRewardMult 2, respawnMult 0.5}, mobDropChance 1, dupGold.common 0.
// Verifies: daggers backstab ×2.5, venom_blade poison DoT (+kill credit),
// vampire_blade lifesteal, scythe 360° arc, triple_bow 3-projectile fan,
// ice_staff chill (self.chill + fx bit), hat mobRewardMult and respawnMult.
import WebSocket from 'ws';
import { decodeSnapshot } from '@shared/snapshot-codec.js';

const URL = 'ws://localhost:3999/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class C {
  ws: WebSocket; seq = 0; x = 0; y = 0; hp = 0; money = 0; id = ''; ready = false;
  chill = 1; respawnIn: number | undefined; hats: string[] = [];
  entities = new Map<string, any>(); events: any[] = [];
  constructor(name: string) {
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name })));
    this.ws.on('message', (d, isBinary) => {
      const m = isBinary ? decodeSnapshot(d as Buffer) : JSON.parse(d.toString());
      if (m.t === 'welcome') { this.ready = true; this.id = m.id; }
      else if (m.t === 'snapshot') {
        for (const s of m.add) this.entities.set(s.id, s);
        for (const u of m.upd) {
          const e = this.entities.get(u.id);
          if (!e) continue;
          e.x = u.x; e.y = u.y;
          if (u.hp !== undefined) e.hp = u.hp;
          if (u.fx !== undefined) e.fx = u.fx;
        }
        for (const id of m.rem) this.entities.delete(id);
        this.x = m.self.x; this.y = m.self.y; this.hp = m.self.hp; this.money = m.self.money;
        this.chill = m.self.chill; this.respawnIn = m.self.respawnIn; this.hats = m.self.hats;
      } else if (m.t === 'event') this.events.push(m.ev);
    });
  }
  input(mx: number, my: number, aim = 0, attack = false) { this.seq++; this.ws.send(JSON.stringify({ t: 'input', seq: this.seq, mx, my, aim, attack })); }
  send(o: object) { this.ws.send(JSON.stringify(o)); }
  async waitReady() { while (!this.ready) await sleep(50); }
  aimAt(t: { x: number; y: number }) { return Math.atan2(t.y - this.y, t.x - this.x); }
  /** single melee swing / shot in the given direction */
  async swing(aim: number) {
    this.input(0, 0, aim, true);
    await sleep(250);
    this.input(0, 0, aim, false);
  }
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
  await sleep(200);
}

function nearestSlime(c: C): any {
  let best: any = null; let bd = Infinity;
  for (const e of c.entities.values()) {
    if (e.kind !== 'mob' || e.mobType !== 'slime') continue;
    const d = Math.hypot(e.x - c.x, e.y - c.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Walks to the nearest slime and holds attack until it dies. Returns money delta. */
async function killSlime(c: C, maxMs = 40000): Promise<number> {
  const t0 = Date.now();
  const before = c.money;
  while (Date.now() - t0 < maxMs) {
    const s = nearestSlime(c);
    if (!s) { c.input(0.7, 0.7); await sleep(100); continue; }
    const d = Math.hypot(s.x - c.x, s.y - c.y);
    const aim = c.aimAt(s);
    if (d > 55) c.input(Math.cos(aim), Math.sin(aim), aim, false);
    else c.input(0, 0, aim, true);
    await sleep(100);
    if (!c.entities.has(s.id)) break;
  }
  c.input(0, 0);
  await sleep(500);
  return c.money - before;
}

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function rebuy(a: C, sell: string | null, buy: string) {
  if (sell) a.send({ t: 'sell', weapon: sell });
  await sleep(200);
  a.send({ t: 'buy', item: buy });
  await sleep(300);
}

async function main() {
  const a = new C('Attacker');
  const v1 = new C('VictimOne');
  const v2 = new C('VictimTwo');
  const v3 = new C('VictimThree');
  await Promise.all([a.waitReady(), v1.waitReady(), v2.waitReady(), v3.waitReady()]);
  await sleep(500);

  // ---- daggers: backstab multiplier ----
  await rebuy(a, null, 'daggers');
  v1.input(0, 0, 0, false); // face +x and hold still
  await moveTo(a, v1.x - 70, v1.y); // behind the victim
  let before = v1.hp;
  await a.swing(a.aimAt(v1));
  await sleep(400);
  const backstab = before - v1.hp;
  check('daggers backstab deals 25 (10 × 2.5)', backstab === 25, `dmg=${backstab}`);

  await moveTo(a, v1.x, v1.y - 130); // circle around, not through the victim
  await moveTo(a, v1.x + 70, v1.y); // in front of the victim
  before = v1.hp;
  await a.swing(a.aimAt(v1));
  await sleep(400);
  const front = before - v1.hp;
  check('daggers frontal hit deals 10 (no backstab)', front === 10, `dmg=${front}`);

  // ---- venom_blade: direct hit + poison DoT + fx bit ----
  await rebuy(a, 'daggers', 'venom_blade');
  v2.input(0, 0, Math.PI, false); // face away so this is NOT a backstab weapon anyway
  await moveTo(a, v2.x - 70, v2.y);
  before = v2.hp;
  await a.swing(a.aimAt(v2));
  await sleep(500);
  const direct = before - v2.hp;
  check('venom_blade direct hit deals 10', direct === 10, `dmg=${direct}`);
  const seenV2 = a.entities.get(v2.id);
  check('poison fx bit visible to others', !!seenV2 && (seenV2.fx & 1) === 1, `fx=${seenV2?.fx}`);
  await sleep(4500); // poison: 6 dps for 4s
  const total = before - v2.hp;
  check('poison ticks over time (total 28-40)', total >= 28 && total <= 40, `total=${total}`);
  const seenV2b = a.entities.get(v2.id);
  check('poison fx cleared after expiry', !!seenV2b && (seenV2b.fx & 1) === 0, `fx=${seenV2b?.fx}`);

  // ---- vampire_blade: lifesteal ----
  await rebuy(a, 'venom_blade', 'vampire_blade');
  // wound the attacker first (lifesteal only heals missing HP)
  v1.send({ t: 'buy', item: 'sword' });
  await sleep(300);
  await moveTo(v1, a.x - 70, a.y);
  await v1.swing(v1.aimAt(a));
  await sleep(400);
  check('attacker wounded by sword', a.hp <= 100 - 18, `hp=${a.hp}`);
  await moveTo(a, v2.x - 70, v2.y);
  before = a.hp;
  await a.swing(a.aimAt(v2));
  await sleep(400);
  // the 90° arc may also clip a wandering mob → each hit heals 4, so a
  // positive multiple of 4 proves the 20 × 0.2 lifesteal
  const healed = a.hp - before;
  check('vampire_blade lifesteal heals 4 per hit', healed >= 4 && healed % 4 === 0, `healed=${healed}`);

  // ---- scythe: full 360° arc (hits while facing away) ----
  await rebuy(a, 'vampire_blade', 'scythe');
  await moveTo(a, v1.x - 70, v1.y);
  before = v1.hp;
  await a.swing(a.aimAt(v1) + Math.PI); // aim directly AWAY from the victim
  await sleep(400);
  const scytheDmg = before - v1.hp;
  check('scythe hits behind the attacker (360°)', scytheDmg === 24, `dmg=${scytheDmg}`);

  // ---- triple_bow: 3 projectiles per shot ----
  await rebuy(a, 'scythe', 'triple_bow');
  // an arrow can hit a mob on the very first tick and vanish before it is
  // ever snapshotted — retry in different directions until a clean volley
  let maxProj = 0;
  for (let attempt = 0; attempt < 6 && maxProj < 3; attempt++) {
    const dir = -Math.PI / 2 + (attempt * Math.PI) / 3;
    a.input(0, 0, dir, true);
    for (let i = 0; i < 12; i++) {
      await sleep(50);
      let n = 0;
      for (const e of a.entities.values()) if (e.kind === 'projectile' && e.owner === a.id) n++;
      maxProj = Math.max(maxProj, n);
    }
    a.input(0, 0, dir, false);
    await sleep(1200); // let the volley despawn + attack cooldown reset
  }
  check('triple_bow fires 3 projectiles', maxProj === 3, `count=${maxProj}`);

  // ---- ice_staff: chill slows the victim (prediction factor + fx bit) ----
  await rebuy(a, 'triple_bow', 'ice_staff');
  await moveTo(a, v3.x - 250, v3.y);
  let minChill = 1; let sawFx2 = false;
  // a wandering mob can intercept the projectile — retry until the shot lands
  for (let attempt = 0; attempt < 6 && minChill === 1; attempt++) {
    await a.swing(a.aimAt(v3));
    for (let i = 0; i < 30; i++) {
      await sleep(50);
      minChill = Math.min(minChill, v3.chill);
      const seen = a.entities.get(v3.id);
      if (seen && (seen.fx & 2) === 2) sawFx2 = true;
    }
  }
  check('ice_staff chills victim (self.chill = 0.65)', Math.abs(minChill - 0.65) < 0.01, `chill=${minChill}`);
  check('chill fx bit visible to others', sawFx2);
  await sleep(1500);
  check('chill expires (self.chill back to 1)', v3.chill === 1, `chill=${v3.chill}`);

  // ---- hats: drop from a mob kill, mobRewardMult doubles reward ----
  await rebuy(a, 'ice_staff', 'sword');
  // slime is the only mob with a reward in the rigged balance; the swing arc
  // can still kill two at once → accept exact multiples
  const d1 = await killSlime(a);
  check('slime reward 300 without hat', d1 >= 300 && d1 % 300 === 0, `delta=${d1}`);
  const hatEv = a.events.find((e) => e.e === 'hat' && e.hat === 'test_hood' && !e.dup);
  check('hat dropped from mob kill', !!hatEv && a.hats.includes('test_hood'));
  a.send({ t: 'equipHat', hat: 'test_hood' });
  await sleep(300);
  const d2 = await killSlime(a);
  check('hat mobRewardMult doubles reward (600)', d2 >= 600 && d2 % 600 === 0, `delta=${d2}`);

  // ---- poison kill credit: DoT finishes a slime, reward still attributed ----
  await rebuy(a, 'sword', 'venom_blade');
  const s = nearestSlime(a);
  check('found a slime for the poison-kill test', !!s);
  if (s) {
    await moveTo(a, s.x - 60, s.y);
    const target = a.entities.get(s.id);
    const moneyBefore = a.money;
    if (target) {
      // exactly one poke: 10 direct + 6 dps poison kills the 30 HP slime over time
      await a.swing(a.aimAt(target));
      let died = false;
      for (let i = 0; i < 120 && !died; i++) { await sleep(50); died = !a.entities.has(s.id); }
      await sleep(500);
      check('poison DoT finishes the mob', died);
      // the swing arc may clip a second slime → each poisoned kill pays 600
      const delta = a.money - moneyBefore;
      check('poison kill still pays the (hatted) reward', delta >= 600 && delta % 600 === 0, `delta=${delta}`);
    }
  }

  // ---- hat respawnMult: death timer halved (4s → 2s) ----
  await moveTo(v1, a.x - 70, a.y);
  a.input(0, 0);
  const t0 = Date.now();
  let firstRespawnIn = 0;
  while (Date.now() - t0 < 30000) {
    if (a.respawnIn !== undefined) { firstRespawnIn = a.respawnIn; break; }
    await v1.swing(v1.aimAt(a));
    await sleep(500);
  }
  check('victim died to sword', firstRespawnIn > 0, `respawnIn=${firstRespawnIn}`);
  check('hat respawnMult halves respawn (≤2.1s)', firstRespawnIn > 0 && firstRespawnIn <= 2.1, `respawnIn=${firstRespawnIn}`);

  for (const c of [a, v1, v2, v3]) c.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

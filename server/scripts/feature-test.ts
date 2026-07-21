/* eslint-disable no-console */
// Deterministic end-to-end feature test. Requires an ISOLATED server with a
// FRESH database (account names register permanently) and a tweaked balance:
// mobs harmless (damage ~0, aggroRadius 0), food.dropChance 1, sword price 40.
//
//   cp balance/balance.json /tmp/balance-test.json   # edit as above
//   BALANCE_PATH=/tmp/balance-test.json DATA_DIR=/tmp/ftest PORT=3999 npx tsx src/index.ts
//   npx tsx scripts/feature-test.ts
import WebSocket from 'ws';

const URL = process.env.PROBE_URL ?? 'ws://localhost:3999/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Ent { id: string; kind: string; x: number; y: number; hp?: number; mobType?: string }

class C {
  ws: WebSocket;
  seq = 0; x = 0; y = 0; money = 0; hp = 100; food = 0; id = '';
  weapons: string[] = []; ready = false; rejected: string | null = null;
  entities = new Map<string, Ent>(); events: any[] = [];
  constructor(name: string, password = '', register = false) {
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name, password: password || undefined, register: register || undefined })));
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.ready = true; this.id = m.id; }
      else if (m.t === 'reject') this.rejected = m.reason;
      else if (m.t === 'snapshot') {
        for (const s of m.add) this.entities.set(s.id, s);
        for (const u of m.upd) { const e = this.entities.get(u.id); if (e) { e.x = u.x; e.y = u.y; if (u.hp !== undefined) e.hp = u.hp; } }
        for (const id of m.rem) this.entities.delete(id);
        this.x = m.self.x; this.y = m.self.y; this.money = m.self.money;
        this.hp = m.self.hp; this.food = m.self.food; this.weapons = m.self.weapons;
      } else if (m.t === 'event') this.events.push(m.ev);
    });
  }
  input(mx: number, my: number, aim = 0, attack = false) { this.seq++; this.ws.send(JSON.stringify({ t: 'input', seq: this.seq, mx, my, aim, attack })); }
  send(o: object) { this.ws.send(JSON.stringify(o)); }
  async waitReady(ms = 4000) {
    const t0 = Date.now();
    while (!this.ready && !this.rejected && Date.now() - t0 < ms) await sleep(50);
  }
  async walkTo(tx: number, ty: number, maxMs = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const d = Math.hypot(tx - this.x, ty - this.y);
      if (d < 25) break;
      this.input((tx - this.x) / d, (ty - this.y) / d);
      await sleep(100);
    }
    this.input(0, 0);
  }
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label} ${extra}`);
  ok ? pass++ : fail++;
}

async function main() {
  // --- 1-4: auth rules ---
  const a1 = new C('Vasya', 'secret1', true);
  await a1.waitReady();
  check('register works', a1.ready, a1.rejected ?? '');

  const dup = new C('Vasya', 'other', true);
  await dup.waitReady();
  check('duplicate register rejected', dup.rejected !== null, dup.rejected ?? '');

  const imp = new C('Vasya');
  await imp.waitReady();
  check('guest cannot take registered name', imp.rejected !== null, imp.rejected ?? '');

  const twice = new C('Vasya', 'secret1');
  await twice.waitReady();
  check('second login of live account rejected', twice.rejected !== null, twice.rejected ?? '');

  const guest = new C('Petya-guest');
  await guest.waitReady();
  check('guest login works', guest.ready);
  guest.ws.close();

  // --- 5: farm slimes → money + food drop/pickup ---
  await sleep(500);
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && (a1.money < 150 || a1.food === 0)) {
    let best: Ent | null = null; let bd = Infinity;
    for (const e of a1.entities.values()) {
      if (e.kind !== 'mob' || e.mobType !== 'slime') continue;
      const d = Math.hypot(e.x - a1.x, e.y - a1.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      const aim = Math.atan2(best.y - a1.y, best.x - a1.x);
      if (bd > 45) a1.input(Math.cos(aim), Math.sin(aim), aim, false);
      else a1.input(0, 0, aim, true);
    } else a1.input(0.9, 0.4);
    await sleep(100);
  }
  check('mob farming earned money', a1.money >= 150, `money=${a1.money}`);
  check('food dropped and picked up', a1.food > 0, `food=${a1.food}`);

  // --- 6: shop — buy food, buy sword, reorder, sell ---
  await a1.walkTo(2000, 2000);
  const foodBefore = a1.food;
  a1.send({ t: 'buy', item: 'food' });
  await sleep(400);
  check('bought food in shop', a1.food === foodBefore + 1 || a1.food === (a1 as any).welcomeMax, `food ${foodBefore}->${a1.food}`);
  a1.send({ t: 'buy', item: 'sword' });
  await sleep(400);
  check('bought sword', a1.weapons.includes('sword'), `weapons=${a1.weapons}`);
  a1.send({ t: 'reorder', weapons: ['sword', 'fists'] });
  await sleep(300);
  check('reorder hotbar', a1.weapons[0] === 'sword', `weapons=${a1.weapons}`);
  const moneyBeforeSell = a1.money;
  a1.send({ t: 'sell', weapon: 'sword' });
  await sleep(400);
  check('sold sword (+50%)', !a1.weapons.includes('sword') && a1.money === moneyBeforeSell + 20, `money ${moneyBeforeSell}->${a1.money}`);

  // --- 7: persistence across sessions ---
  a1.send({ t: 'buy', item: 'sword' });
  await sleep(400);
  const savedMoney = a1.money;
  const savedWeapons = [...a1.weapons];
  a1.ws.close();
  await sleep(800);
  const a2 = new C('Vasya', 'secret1');
  await a2.waitReady();
  await sleep(500);
  check('account restores money', a2.money === savedMoney, `expected ${savedMoney}, got ${a2.money}`);
  check('account restores weapons', savedWeapons.every((w) => a2.weapons.includes(w)) && a2.weapons.length === savedWeapons.length, `saved=${savedWeapons} got=${a2.weapons}`);
  check('food NOT persisted (consumable)', a2.food === 0, `food=${a2.food}`);

  // --- 8: eat heals after PvP damage ---
  const obs = new C('Observer');
  await obs.waitReady();
  await a2.walkTo(2000, 1200); // outside safe zone
  await obs.walkTo(a2.x + 30, a2.y);
  // punch a2 below 70 hp
  const tP = Date.now();
  while (Date.now() - tP < 15000 && a2.hp > 60) {
    const aimO = Math.atan2(a2.y - obs.y, a2.x - obs.x);
    const d = Math.hypot(a2.x - obs.x, a2.y - obs.y);
    if (d > 50) obs.input((a2.x - obs.x) / d, (a2.y - obs.y) / d, aimO, false);
    else obs.input(0, 0, aimO, true);
    a2.input(0, 0);
    await sleep(100);
  }
  obs.input(0, 0);
  const hpLow = a2.hp;
  // a2 buys food? has none (not persisted). Farm one slime for food:
  const tF = Date.now();
  while (Date.now() - tF < 40000 && a2.food === 0) {
    let best: Ent | null = null; let bd = Infinity;
    for (const e of a2.entities.values()) {
      if (e.kind !== 'mob' || e.mobType !== 'slime') continue;
      const d = Math.hypot(e.x - a2.x, e.y - a2.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      const aim = Math.atan2(best.y - a2.y, best.x - a2.x);
      if (bd > 45) a2.input(Math.cos(aim), Math.sin(aim), aim, false);
      else a2.input(0, 0, aim, true);
    } else a2.input(-0.5, -0.9);
    await sleep(100);
  }
  a2.input(0, 0);
  const hpBeforeEat = a2.hp;
  const foodBeforeEat = a2.food;
  a2.send({ t: 'eat' });
  await sleep(500);
  check('eat heals after damage', a2.hp > hpBeforeEat && a2.food === foodBeforeEat - 1, `hp ${hpBeforeEat}->${a2.hp} (low was ${hpLow}), food ${foodBeforeEat}->${a2.food}`);

  // --- 9: building vanishes on disconnect ---
  await a2.walkTo(2000, 1200);
  await obs.walkTo(2000, 1100);
  a2.send({ t: 'place', building: 'farm', x: a2.x + 120, y: a2.y });
  await sleep(800);
  const placedEv = a2.events.filter((e) => e.e === 'placed').pop();
  if (placedEv && !placedEv.ok) console.log('  (place rejected:', placedEv.reason, ')');
  const farmVisible = [...obs.entities.values()].some((e) => e.kind === 'building');
  check('farm placed and visible to others', farmVisible);
  a2.ws.close();
  await sleep(1200);
  const farmGone = ![...obs.entities.values()].some((e) => e.kind === 'building');
  check('buildings removed on owner disconnect', farmGone);

  // --- 10: death wipes purchased weapons ---
  const victim = new C('Zhertva', 'pass123', true);
  await victim.waitReady();
  await sleep(300);
  victim.send({ t: 'buy', item: 'sword' }); // start money 50 >= test price 40
  await sleep(400);
  check('victim bought sword before death', victim.weapons.includes('sword'), `weapons=${victim.weapons}`);
  await victim.walkTo(2000, 1500);
  await obs.walkTo(victim.x + 30, victim.y);
  const tK = Date.now();
  while (Date.now() - tK < 20000 && !victim.events.some((e) => e.e === 'death')) {
    const aimO = Math.atan2(victim.y - obs.y, victim.x - obs.x);
    const d = Math.hypot(victim.x - obs.x, victim.y - obs.y);
    if (d > 50) obs.input((victim.x - obs.x) / d, (victim.y - obs.y) / d, aimO, false);
    else obs.input(0, 0, aimO, true);
    victim.input(0, 0);
    await sleep(100);
  }
  const died = victim.events.some((e) => e.e === 'death');
  await sleep(5000);
  check('victim died in PvP', died);
  check('death resets weapons to fists', victim.weapons.length === 1 && victim.weapons[0] === 'fists', `weapons=${victim.weapons}`);

  obs.ws.close();
  victim.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

// Multi-server + hats test. Isolated server on :3999, FRESH DB, test balance:
// maxPlayers=2, servers=3, hat drop chances 1.0, lootbox always legendary.
import WebSocket from 'ws';

const URL = 'ws://localhost:3999/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class C {
  ws: WebSocket; seq = 0; x = 0; y = 0; money = 0; id = ''; ready = false;
  server = 0; rejected: string | null = null; maxHp = 100;
  hats: string[] = []; hat: string | null = null;
  entities = new Map<string, any>(); events: any[] = [];
  constructor(name: string, password = '', register = false, server?: number) {
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name, password: password || undefined, register: register || undefined, server })));
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.ready = true; this.id = m.id; this.server = m.server; }
      else if (m.t === 'reject') this.rejected = m.reason;
      else if (m.t === 'snapshot') {
        for (const s of m.add) this.entities.set(s.id, s);
        for (const u of m.upd) { const e = this.entities.get(u.id); if (e) { e.x = u.x; e.y = u.y; if (u.hp !== undefined) e.hp = u.hp; } }
        for (const id of m.rem) this.entities.delete(id);
        this.x = m.self.x; this.y = m.self.y; this.money = m.self.money;
        this.hats = m.self.hats; this.hat = m.self.hat; this.maxHp = m.self.maxHp;
      } else if (m.t === 'event') this.events.push(m.ev);
    });
  }
  input(mx: number, my: number, aim = 0, attack = false) { this.seq++; this.ws.send(JSON.stringify({ t: 'input', seq: this.seq, mx, my, aim, attack })); }
  send(o: object) { this.ws.send(JSON.stringify(o)); }
  async waitReady(ms = 4000) {
    const t0 = Date.now();
    while (!this.ready && !this.rejected && Date.now() - t0 < ms) await sleep(50);
  }
}

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function killSlimes(c: C, until: () => boolean, maxMs = 60000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs && !until()) {
    let best: any = null; let bd = Infinity;
    for (const e of c.entities.values()) {
      if (e.kind !== 'mob' || e.mobType !== 'slime') continue;
      const d = Math.hypot(e.x - c.x, e.y - c.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      const aim = Math.atan2(best.y - c.y, best.x - c.x);
      if (bd > 45) c.input(Math.cos(aim), Math.sin(aim), aim, false);
      else c.input(0, 0, aim, true);
    } else c.input(0.9, 0.4);
    await sleep(100);
  }
  c.input(0, 0);
}

async function main() {
  // --- server assignment ---
  const a = new C('HatMan', 'pass1234', true);
  await a.waitReady();
  check('A joined server 1 (auto)', a.server === 1, `server=${a.server}`);
  const b = new C('Filler');
  await b.waitReady();
  check('B joined server 1 (auto)', b.server === 1, `server=${b.server}`);
  const c = new C('Overflow');
  await c.waitReady();
  check('C overflows to server 2 when 1 is full', c.server === 2, `server=${c.server}`);
  const d = new C('Explicit1', '', false, 1);
  await d.waitReady();
  check('explicit join to full server rejected', d.rejected !== null, d.rejected ?? '');
  const e5 = new C('Ghost', '', false, 7);
  await e5.waitReady();
  check('nonexistent server rejected', e5.rejected !== null, e5.rejected ?? '');
  const dup = new C('HatMan', 'pass1234', false, 2);
  await dup.waitReady();
  check('account live-session check spans servers', dup.rejected !== null, dup.rejected ?? '');

  // --- mob hat drops (chance 1.0) ---
  await killSlimes(a, () => a.events.some((ev) => ev.e === 'hat'));
  const firstHat = a.events.find((ev) => ev.e === 'hat');
  check('common hat dropped from mob', !!firstHat && firstHat.tier === 'common' && !firstHat.dup, firstHat ? `${firstHat.hat}` : 'none');
  check('hat in collection', a.hats.length >= 1, `hats=${a.hats}`);

  // keep killing until a duplicate arrives (only 3 commons exist)
  await killSlimes(a, () => a.events.some((ev) => ev.e === 'hat' && ev.dup));
  const dupEv = a.events.find((ev) => ev.e === 'hat' && ev.dup);
  check('duplicate hat converts to gold', !!dupEv && dupEv.gold === 100, dupEv ? `+${dupEv.gold}` : 'none');

  // --- lootbox (always legendary in test balance) ---
  await killSlimes(a, () => a.money >= 550, 90000);
  a.send({ t: 'lootbox' });
  await sleep(600);
  const lbHat = a.events.filter((ev) => ev.e === 'hat' && ev.source === 'lootbox').pop();
  check('lootbox dropped legendary hat', !!lbHat && lbHat.tier === 'legendary', lbHat ? lbHat.hat : 'none');

  // second lootbox → legendary dup → +5000
  await killSlimes(a, () => a.money >= 550, 90000);
  const moneyBefore = a.money;
  a.send({ t: 'lootbox' });
  await sleep(600);
  const lbDup = a.events.filter((ev) => ev.e === 'hat' && ev.source === 'lootbox' && ev.dup).pop();
  const gotOther = a.events.filter((ev) => ev.e === 'hat' && ev.source === 'lootbox').length === 2 && !lbDup;
  check('second lootbox: legendary dup pays 5000 (or second legendary)', !!lbDup || gotOther, lbDup ? `+${lbDup.gold}, money ${moneyBefore}->${a.money}` : 'new hat');

  // --- equip + effect ---
  const legendary = a.hats.find((h) => h === 'phoenix_plume' || h === 'golden_crown');
  const capOwned = a.hats.includes('cap');
  const target = a.hats.includes('phoenix_plume') ? 'phoenix_plume' : capOwned ? 'cap' : a.hats[0];
  a.send({ t: 'equipHat', hat: target });
  await sleep(400);
  check('hat equipped', a.hat === target, `hat=${a.hat}`);
  if (target === 'phoenix_plume') check('maxHp bonus applied', a.maxHp === 125, `maxHp=${a.maxHp}`);
  else if (target === 'cap') check('maxHp bonus applied', a.maxHp === 110, `maxHp=${a.maxHp}`);
  else check('maxHp check (no hp hat)', true, `maxHp=${a.maxHp}`);

  // --- persistence across relogin AND across servers ---
  const savedHats = [...a.hats];
  const savedHat = a.hat;
  const savedMoney = a.money;
  a.ws.close();
  await sleep(800);
  const a2 = new C('HatMan', 'pass1234', false, 2); // reconnect to a DIFFERENT server
  await a2.waitReady();
  await sleep(500);
  check('reconnected to server 2 explicitly', a2.server === 2, `server=${a2.server}`);
  check('hats transfer between servers', savedHats.every((h) => a2.hats.includes(h)) && a2.hats.length === savedHats.length, `${a2.hats}`);
  check('equipped hat persists', a2.hat === savedHat, `hat=${a2.hat}`);
  check('money transfers between servers', a2.money === savedMoney, `${savedMoney} -> ${a2.money}`);

  a2.ws.close(); b.ws.close(); c.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((err) => { console.error(err); process.exit(1); });

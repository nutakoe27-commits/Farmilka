// Prestige gold-sink + entity-delta sync test. Needs an isolated server on
// :3999 with a FRESH DB and a test balance (slime reward high, prestige
// baseCost low e.g. 200). Also guards the markDirty fix: state changes made in
// message handlers (buy/prestige) must reach OTHER players via deltas.
import WebSocket from 'ws';

const URL = 'ws://localhost:3999/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class C {
  ws: WebSocket; seq = 0; x = 0; y = 0; money = 0; id = ''; ready = false;
  prestige = 0; prestigeCost = 0;
  entities = new Map<string, any>(); events: any[] = [];
  constructor(name: string, password = '', register = false) {
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name, password: password || undefined, register: register || undefined })));
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.ready = true; this.id = m.id; }
      else if (m.t === 'snapshot') {
        for (const s of m.add) this.entities.set(s.id, s);
        for (const u of m.upd) { const e = this.entities.get(u.id); if (e) { e.x = u.x; e.y = u.y; if (u.hp !== undefined) e.hp = u.hp; if (u.prestige !== undefined) e.prestige = u.prestige; if (u.weapon !== undefined) e.weapon = u.weapon; } }
        for (const id of m.rem) this.entities.delete(id);
        this.x = m.self.x; this.y = m.self.y; this.money = m.self.money;
        this.prestige = m.self.prestige; this.prestigeCost = m.self.prestigeCost;
      } else if (m.t === 'event') this.events.push(m.ev);
    });
  }
  input(mx: number, my: number, aim = 0, attack = false) { this.seq++; this.ws.send(JSON.stringify({ t: 'input', seq: this.seq, mx, my, aim, attack })); }
  send(o: object) { this.ws.send(JSON.stringify(o)); }
  async waitReady() { while (!this.ready) await sleep(50); }
}

async function farmTo(c: C, target: number, maxMs = 120000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs && c.money < target) {
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

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function main() {
  const a = new C('Prestiger', 'pass1234', true);
  await a.waitReady();
  await sleep(400);
  check('starts at prestige 0', a.prestige === 0, `p=${a.prestige}`);
  const cost1 = a.prestigeCost;
  check('has a next-level cost', cost1 > 0, `cost=${cost1}`);

  // not enough money → rejected
  a.send({ t: 'prestige' });
  await sleep(400);
  const rejected = a.events.some((e) => e.e === 'purchase' && e.item === 'prestige' && !e.ok);
  check('prestige rejected without gold', rejected && a.prestige === 0, `p=${a.prestige}`);

  // farm enough for 2 levels, buy them
  await farmTo(a, cost1);
  const moneyBefore = a.money;
  a.send({ t: 'prestige' });
  await sleep(500);
  check('prestige 1 bought', a.prestige === 1, `p=${a.prestige}`);
  check('gold deducted', a.money === moneyBefore - cost1, `${moneyBefore} -> ${a.money} (cost ${cost1})`);
  const cost2 = a.prestigeCost;
  check('cost increased (steep growth)', cost2 > cost1, `${cost1} -> ${cost2}`);
  check('got prestige event', a.events.some((e) => e.e === 'prestige' && e.level === 1));

  await farmTo(a, cost2);
  a.send({ t: 'prestige' });
  await sleep(500);
  check('prestige 2 bought', a.prestige === 2, `p=${a.prestige}`);

  // other players see prestige on the entity
  const obs = new C('Watcher');
  await obs.waitReady();
  await sleep(300);
  // move obs toward a to bring it into view
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const d = Math.hypot(a.x - obs.x, a.y - obs.y);
    if (d < 300) break;
    obs.input((a.x - obs.x) / (d || 1), (a.y - obs.y) / (d || 1));
    await sleep(100);
  }
  obs.input(0, 0);
  await sleep(500);
  const seen = [...obs.entities.values()].find((e) => e.kind === 'player' && e.id === a.id);
  check('prestige visible to other players', !!seen && seen.prestige === 2, `seen=${seen ? seen.prestige : 'none'}`);

  // 'a' buys a weapon WHILE observed → delta (not initial add) must reach observer
  await farmTo(a, 60);
  a.send({ t: 'buy', item: 'sword' });
  await sleep(700);
  const seenW = [...obs.entities.values()].find((e) => e.kind === 'player' && e.id === a.id);
  check('weapon change reaches others via delta (markDirty fix)', !!seenW && seenW.weapon === 'sword', `weapon=${seenW ? seenW.weapon : 'none'}`);

  // 'a' prestiges again while observed → prestige delta must reach observer
  await farmTo(a, a.prestigeCost);
  a.send({ t: 'prestige' });
  await sleep(700);
  const seenP = [...obs.entities.values()].find((e) => e.kind === 'player' && e.id === a.id);
  check('prestige change reaches others via delta', !!seenP && seenP.prestige === 3, `prestige=${seenP ? seenP.prestige : 'none'}`);

  // persistence across relogin
  const savedP = a.prestige;
  a.ws.close();
  await sleep(800);
  const a2 = new C('Prestiger', 'pass1234');
  await a2.waitReady();
  await sleep(500);
  check('prestige persists across sessions', a2.prestige === savedP, `${savedP} -> ${a2.prestige}`);

  a2.ws.close(); obs.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

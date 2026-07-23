// Smoke test for i18n server messages + daily reward. Needs a server on :3998
// with a FRESH DB. Verifies: (1) an EN client gets English reject/reason text;
// (2) a registered account receives a dailyReward event on first join and NOT
// again on a same-day re-login.
import WebSocket from 'ws';
import { decodeSnapshot } from '@shared/snapshot-codec.js';

const URL = 'ws://localhost:3998/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class C {
  ws: WebSocket; ready = false; rejected: string | null = null;
  events: any[] = []; money = 0; id = '';
  constructor(name: string, opts: { password?: string; register?: boolean; lang?: 'ru' | 'en' } = {}) {
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name, password: opts.password, register: opts.register, lang: opts.lang })));
    this.ws.on('message', (d, isBinary) => {
      const m = isBinary ? decodeSnapshot(d as Buffer) : JSON.parse(d.toString());
      if (m.t === 'welcome') { this.ready = true; this.id = m.id; }
      else if (m.t === 'snapshot') { this.money = m.self.money; }
      else if (m.t === 'event') this.events.push(m.ev);
      else if (m.t === 'reject') this.rejected = m.reason;
    });
  }
  send(o: object) { this.ws.send(JSON.stringify(o)); }
  async settle() { const t0 = Date.now(); while (!this.ready && !this.rejected && Date.now() - t0 < 5000) await sleep(30); }
}

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function main() {
  // ---- EN reject: register with too-short password ----
  const bad = new C('EnUser', { password: 'ab', register: true, lang: 'en' });
  await bad.settle();
  check('EN short-password reject is English', !!bad.rejected && /Password too short/.test(bad.rejected), `reason=${bad.rejected}`);
  bad.ws.close();

  // ---- EN reason: buy a level with no money (start money is low in prod balance?) ----
  const en = new C('EnPlayer', { password: 'pass1234', register: true, lang: 'en' });
  await en.settle();
  check('EN account joined', en.ready);
  await sleep(400);
  check('daily reward granted on first join', en.events.some((e) => e.e === 'dailyReward'), JSON.stringify(en.events.find((e) => e.e === 'dailyReward')));
  const daily = en.events.find((e) => e.e === 'dailyReward');
  check('daily reward is day-1 (streak 1, 100 gold)', !!daily && daily.streak === 1 && daily.gold === 100, `gold=${daily?.gold} streak=${daily?.streak}`);

  // spend money on food until broke to force an English purchase-rejection reason
  en.events.length = 0;
  for (let i = 0; i < 80; i++) { en.send({ t: 'buy', item: 'food' }); await sleep(30); }
  const rej = en.events.filter((e) => e.e === 'purchase' && !e.ok).pop();
  check('EN purchase reason is English', !!rej && /(Not enough money|Max food)/.test(rej.reason ?? ''), `reason=${rej?.reason}`);
  en.ws.close();
  await sleep(900); // let saveProgress + logout run

  // ---- same-day re-login: NO second daily reward ----
  const en2 = new C('EnPlayer', { password: 'pass1234', lang: 'en' });
  await en2.settle();
  await sleep(400);
  check('no second daily reward same day', !en2.events.some((e) => e.e === 'dailyReward'));
  en2.ws.close();

  // ---- RU client still gets Russian text ----
  const rubad = new C('RuUser', { password: 'ab', register: true, lang: 'ru' });
  await rubad.settle();
  check('RU short-password reject is Russian', !!rubad.rejected && /Пароль слишком короткий/.test(rubad.rejected), `reason=${rubad.rejected}`);
  rubad.ws.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

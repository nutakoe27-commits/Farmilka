// Verifies the Yandex Player-API join path against a server on :3998 (fresh DB,
// signature verification OFF). Checks: a yandexId join creates a registered
// account + gets the daily reward; reconnecting the same yandexId persists the
// balance and does NOT re-grant the daily.
import WebSocket from 'ws';
import { decodeSnapshot } from '@shared/snapshot-codec.js';

const URL = 'ws://localhost:3998/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class C {
  ws: WebSocket; ready = false; registered = false; money = 0; events: any[] = [];
  constructor(yandexId: string, yandexName: string) {
    this.ws = new WebSocket(URL);
    this.ws.binaryType = 'nodebuffer';
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name: yandexName, yandexId, yandexName, yandexSig: 'sig', lang: 'ru' })));
    this.ws.on('message', (d, isBinary) => {
      if (isBinary) { this.money = decodeSnapshot(d as Buffer).self.money; return; }
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.ready = true; this.registered = m.registered; }
      else if (m.t === 'event') this.events.push(m.ev);
    });
  }
  async waitReady() { const t0 = Date.now(); while (!this.ready && Date.now() - t0 < 5000) await sleep(30); }
}

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function main() {
  const ID = 'ya_test_777';
  const a = new C(ID, 'ЯндексИгрок');
  await a.waitReady();
  await sleep(500);
  check('yandex join → registered account', a.registered === true);
  const daily = a.events.find((e) => e.e === 'dailyReward');
  check('yandex account gets daily reward on first join', !!daily, JSON.stringify(daily));
  const money1 = a.money;
  check('balance includes the daily gold', money1 > 0, `money=${money1}`);
  a.ws.close();
  await sleep(900); // saveProgress on disconnect

  const b = new C(ID, 'ЯндексИгрок');
  await b.waitReady();
  await sleep(500);
  check('reconnect same yandexId is still registered', b.registered === true);
  check('balance persisted across sessions', b.money === money1, `${money1} -> ${b.money}`);
  check('no second daily reward same day', !b.events.some((e) => e.e === 'dailyReward'));
  b.ws.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

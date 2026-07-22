// Dynamic-world manager test. Needs an isolated server on :3999 with a FRESH DB,
// REAP_GRACE_MS=1500, and a rigged balance: world.servers 1 (min), maxServers 3,
// maxPlayers 2. Verifies: boot has only the min world; auto-assign packs players
// and spawns new worlds on demand; the hard cap rejects; emptied worlds above the
// minimum are reaped; a reaped server id is no longer joinable.
import WebSocket from 'ws';

const URL = 'ws://localhost:3999/ws';
const HTTP = 'http://localhost:3999';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class C {
  ws: WebSocket; ready = false; rejected: string | null = null; server = 0;
  constructor(server?: number) {
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name: 'p' + Math.floor(performance.now() % 100000), server })));
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.ready = true; this.server = m.server; }
      else if (m.t === 'reject') { this.rejected = m.reason; }
    });
  }
  async settle() { const t0 = Date.now(); while (!this.ready && !this.rejected && Date.now() - t0 < 5000) await sleep(30); }
  close() { this.ws.close(); }
}

async function servers(): Promise<{ id: number; online: number; max: number }[]> {
  const res = await fetch(`${HTTP}/servers`);
  return res.json() as Promise<{ id: number; online: number; max: number }[]>;
}

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function connect(server?: number): Promise<C> { const c = new C(server); await c.settle(); return c; }

async function main() {
  // boot: only the single min world
  let list = await servers();
  check('boots with 1 min world', list.length === 1 && list[0].id === 1, JSON.stringify(list));

  // fill world 1 (cap 2) — both pack onto server 1
  const c1 = await connect(); const c2 = await connect();
  check('c1, c2 land on server 1', c1.server === 1 && c2.server === 1, `${c1.server},${c2.server}`);

  // world 1 full → next join spawns world 2
  const c3 = await connect();
  check('c3 spawns and lands on server 2', c3.server === 2, `server=${c3.server}`);
  list = await servers();
  check('2 worlds active now', list.length === 2, JSON.stringify(list));

  // c4 packs into world 2 (has room), c5 spawns world 3
  const c4 = await connect();
  check('c4 packs into server 2', c4.server === 2, `server=${c4.server}`);
  const c5 = await connect();
  check('c5 spawns and lands on server 3', c5.server === 3, `server=${c5.server}`);
  const c6 = await connect();
  check('c6 packs into server 3', c6.server === 3, `server=${c6.server}`);
  list = await servers();
  check('3 worlds active (at maxServers)', list.length === 3, JSON.stringify(list));

  // hard cap: 6/6 players, maxServers reached → reject
  const c7 = await connect();
  check('7th player rejected at hard cap', !c7.ready && !!c7.rejected, `rejected=${c7.rejected}`);

  // empty worlds 2 and 3 → they should be reaped (min is 1)
  c3.close(); c4.close(); c5.close(); c6.close();
  await sleep(2600); // > REAP_GRACE_MS (1500) + a couple ticks
  list = await servers();
  check('emptied worlds 2 & 3 reaped, back to 1', list.length === 1 && list[0].id === 1, JSON.stringify(list));
  check('server 1 still holds c1, c2', list[0].online === 2, `online=${list[0].online}`);

  // a reaped server id is no longer joinable
  const c8 = await connect(3);
  check('joining a reaped server id is rejected', !c8.ready && /не существует/.test(c8.rejected ?? ''), `rejected=${c8.rejected}`);

  // ...but auto-assign spawns a fresh world again on demand
  const c9 = await connect();
  check('auto-assign spawns a new world after reap', c9.server === 2, `server=${c9.server}`);

  c1.close(); c2.close(); c9.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

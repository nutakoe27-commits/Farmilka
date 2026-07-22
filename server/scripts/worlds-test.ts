// Dynamic-world manager + waiting-queue test. Needs an isolated server on :3999
// with a FRESH DB, REAP_GRACE_MS=1500, and a rigged balance: world.servers 1
// (min), maxServers 3, maxPlayers 2. Verifies: boot has only the min world;
// auto-assign packs players and spawns new worlds on demand; at the hard cap
// players are QUEUED (not rejected) and admitted FIFO as slots free; queue
// positions update; explicit full-server picks are rejected; emptied worlds
// above the minimum are reaped.
import WebSocket from 'ws';
import { decodeSnapshot } from '@shared/snapshot-codec.js';

const URL = 'ws://localhost:3999/ws';
const HTTP = 'http://localhost:3999';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class C {
  ws: WebSocket; ready = false; rejected: string | null = null; server = 0; queuedPos: number | null = null;
  constructor(server?: number) {
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name: 'p' + Math.floor(performance.now() % 1e6), server })));
    this.ws.on('message', (d, isBinary) => {
      if (isBinary) return; // ignore snapshots
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.ready = true; this.server = m.server; this.queuedPos = null; }
      else if (m.t === 'reject') this.rejected = m.reason;
      else if (m.t === 'queued') this.queuedPos = m.pos;
    });
  }
  async settle() { const t0 = Date.now(); while (!this.ready && !this.rejected && this.queuedPos === null && Date.now() - t0 < 5000) await sleep(30); }
  async waitReady(ms = 6000) { const t0 = Date.now(); while (!this.ready && Date.now() - t0 < ms) await sleep(30); }
  close() { this.ws.close(); }
}

async function servers(): Promise<{ id: number; online: number; max: number }[]> {
  return (await fetch(`${HTTP}/servers`)).json() as Promise<{ id: number; online: number; max: number }[]>;
}
async function connect(server?: number): Promise<C> { const c = new C(server); await c.settle(); return c; }

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function main() {
  check('boots with 1 min world', (await servers()).length === 1);

  // pack + spawn: c1,c2→s1 ; c3,c4→s2 ; c5,c6→s3
  const c: C[] = [];
  for (let i = 0; i < 6; i++) c.push(await connect());
  check('players pack across spawned worlds', c.map((x) => x.server).join(',') === '1,1,2,2,3,3', c.map((x) => x.server).join(','));
  check('3 worlds active (at maxServers)', (await servers()).length === 3);

  // hard cap → queue, not reject
  const c7 = await connect();
  check('7th player is queued (pos 1)', !c7.ready && c7.queuedPos === 1, `ready=${c7.ready} pos=${c7.queuedPos}`);
  const c8 = await connect();
  check('8th player is queued (pos 2)', c8.queuedPos === 2, `pos=${c8.queuedPos}`);

  // free a slot → the head of the queue is admitted, the rest move up
  c[0].close(); // leaves server 1 (now has room)
  await c7.waitReady();
  check('queued player admitted when a slot frees', c7.ready && c7.server === 1, `ready=${c7.ready} server=${c7.server}`);
  await sleep(300);
  check('remaining queued player moves to pos 1', c8.queuedPos === 1, `pos=${c8.queuedPos}`);

  // explicit pick of a full server is rejected (no queue on explicit picks)
  const full = await connect(1); // server 1 now holds c2 + c7 = 2/2
  check('explicit full-server pick rejected', !!full.rejected && /заполнен/.test(full.rejected), `rejected=${full.rejected}`);
  full.close();

  // drop the last queued player, then empty the spawned worlds → they reap
  c8.close();
  await sleep(200);
  c[2].close(); c[3].close(); c[4].close(); c[5].close(); // empty servers 2 and 3
  await sleep(2600); // > REAP_GRACE_MS + a couple ticks
  const list = await servers();
  check('emptied worlds reaped back to the minimum', list.length === 1 && list[0].id === 1, JSON.stringify(list));

  c[1].close(); c7.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

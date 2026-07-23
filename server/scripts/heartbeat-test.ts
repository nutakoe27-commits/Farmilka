// Heartbeat / ghost-reaping test — needs a server on :3997 started with a small
// HEARTBEAT_MS (e.g. 800). Verifies that a socket which stops responding to pings
// (a silent mobile drop) is terminated and removed from the online count, while a
// healthy socket that keeps ponging survives.
import WebSocket from 'ws';

const WS = 'ws://localhost:3997/ws';
const HTTP = 'http://localhost:3997/servers';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function onlineTotal(): Promise<number> {
  const res = await fetch(HTTP);
  const list = (await res.json()) as { online: number }[];
  return list.reduce((s, w) => s + w.online, 0);
}

function connect(name: string): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS);
    ws.binaryType = 'nodebuffer';
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name })));
    ws.on('message', (d, isBinary) => {
      if (isBinary) return;
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') resolve(ws);
    });
  });
}

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function main() {
  const base = await onlineTotal(); // bots don't count (ws=null); should be 0 real players

  const ghost = await connect('Ghost');
  const live = await connect('Live');
  await sleep(300);
  const two = await onlineTotal();
  check('both sockets are counted online', two === base + 2, `online=${two} (base=${base})`);

  // make Ghost a zombie: pause its TCP socket so it never reads the ping / sends a pong.
  // Live keeps auto-ponging at the protocol level.
  // @ts-expect-error _socket is the underlying net.Socket
  ghost._socket.pause();

  // wait out ~3 heartbeat ticks (HEARTBEAT_MS=800 → ~2.4s to reap over two ticks)
  await sleep(3200);

  const after = await onlineTotal();
  check('the zombie socket was reaped', after === base + 1, `online=${after} (expected ${base + 1})`);
  check('the healthy socket survived', live.readyState === WebSocket.OPEN, `readyState=${live.readyState}`);

  live.close();
  try { ghost.terminate(); } catch { /* already gone */ }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

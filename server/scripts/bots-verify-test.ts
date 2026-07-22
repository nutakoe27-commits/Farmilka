// Verifies filler bots against a server on :3998 started with BOTS_PER_WORLD=5.
// Checks: a real player sees bot players; bots move; bots are excluded from the
// leaderboard total, the /servers online count, and the admin online list.
import WebSocket from 'ws';
import { decodeSnapshot } from '@shared/snapshot-codec.js';

const URL = 'ws://localhost:3998/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class C {
  ws: WebSocket; ready = false; id = ''; server = 0;
  entities = new Map<string, any>(); lb: { total: number; rank: number } | null = null;
  constructor(name: string) {
    this.ws = new WebSocket(URL);
    this.ws.binaryType = 'nodebuffer';
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name, lang: 'en' })));
    this.ws.on('message', (d, isBinary) => {
      if (isBinary) {
        const m = decodeSnapshot(d as Buffer);
        for (const s of m.add) this.entities.set(s.id, s);
        for (const u of m.upd) { const e = this.entities.get(u.id); if (e) { e.x = u.x; e.y = u.y; } }
        for (const id of m.rem) this.entities.delete(id);
        return;
      }
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { this.ready = true; this.id = m.id; this.server = m.server; }
      else if (m.t === 'leaderboard') this.lb = { total: m.total, rank: m.rank };
    });
  }
  async waitReady() { const t0 = Date.now(); while (!this.ready && Date.now() - t0 < 5000) await sleep(30); }
  otherPlayers() { return [...this.entities.values()].filter((e) => e.kind === 'player' && e.id !== this.id); }
}

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

async function main() {
  const me = new C('RealHuman');
  await me.waitReady();
  await sleep(2500); // let snapshots + bot movement accumulate

  const others = me.otherPlayers();
  check('real player sees bot players in the world', others.length >= 1, `visible bots=${others.length} (${others.slice(0, 5).map((o) => o.name).join(', ')})`);

  // track one bot's movement over time
  if (others.length) {
    const botId = others[0].id;
    const before = me.entities.get(botId);
    const bx = before.x, by = before.y;
    await sleep(2500);
    const after = me.entities.get(botId);
    const moved = after ? Math.hypot(after.x - bx, after.y - by) : 0;
    check('a bot actually moves around', moved > 20, `moved=${moved.toFixed(0)}px`);
  }

  // leaderboard total should count only the real player (bots excluded)
  await sleep(2200); // leaderboard pushes every 2s
  check('leaderboard excludes bots (total = 1 real player)', me.lb?.total === 1, `total=${me.lb?.total} rank=${me.lb?.rank}`);

  // /servers online count excludes bots (this world shows 1 online = just me)
  const servers = (await (await fetch('http://localhost:3998/servers')).json()) as { id: number; online: number }[];
  const myWorld = servers.find((s) => s.id === me.server);
  check('/servers online excludes bots (1 for my world)', myWorld?.online === 1, `online=${myWorld?.online}`);

  // admin online list excludes bots
  const admin = await (await fetch('http://localhost:3998/admin/stats?token=testtok')).text();
  const m = admin.match(/Сейчас онлайн:\s*(\d+)/);
  check('admin online list excludes bots (1 online)', m ? Number(m[1]) === 1 : false, `matched=${m?.[1]}`);

  me.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

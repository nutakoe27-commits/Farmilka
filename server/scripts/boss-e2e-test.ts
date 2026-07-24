// Boss e2e over the wire — needs a server on :3995 with all bosses rigged to
// spawnIntervalSec 4 / warnSec 1. Verifies every boss type warns and spawns
// in its home biome, and that telegraphs (incl. unique kinds) reach clients.
import WebSocket from 'ws';
import { biomeAt } from '@shared/biomes.js';

const URL = 'ws://localhost:3995/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const warned = new Set<string>();
const spawned = new Map<string, { x: number; y: number }>();
const telegraphs = new Set<string>();
let size = 7000;

const ws = new WebSocket(URL);
ws.binaryType = 'nodebuffer';
ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'BossWatcher' })));
ws.on('message', (d, isBinary) => {
  if (isBinary) return;
  const m = JSON.parse(d.toString());
  if (m.t === 'welcome') size = m.world.size;
  if (m.t !== 'event') return;
  const ev = m.ev;
  if (ev.e === 'bossWarn') warned.add(ev.bossId);
  if (ev.e === 'bossSpawned') spawned.set(ev.bossId, { x: ev.x, y: ev.y });
  if (ev.e === 'bossTelegraph') telegraphs.add(ev.kind);
});

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`);
  ok ? pass++ : fail++;
};

const HOME: Record<string, string> = {
  champion: 'normal', frost_titan: 'snow', sand_worm: 'desert',
  shadow_lord: 'mystic_west', crystal_queen: 'mystic_east',
};

async function main(): Promise<void> {
  await sleep(12_000); // interval 4s + warn 1s → all five should be up
  check('all 5 bosses announced', warned.size === 5, `warned=${[...warned].join(',')}`);
  check('all 5 bosses spawned', spawned.size === 5, `spawned=${[...spawned.keys()].join(',')}`);
  for (const [id, pos] of spawned) {
    const biome = biomeAt(pos.x, pos.y, size);
    check(`${id} spawned in its home biome`, biome === HOME[id], `at=${biome}`);
  }
  ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

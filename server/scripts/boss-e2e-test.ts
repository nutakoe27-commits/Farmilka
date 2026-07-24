// Boss rotation e2e — needs a server on :3995 with bosses rigged to
// spawnIntervalSec 3 / warnSec 1 / despawnSec 4. Verifies the rotation:
// exactly one random boss at a time, spawning in its home biome, with the
// next one scheduled only after the previous leaves.
import WebSocket from 'ws';
import { biomeAt } from '@shared/biomes.js';

const URL = 'ws://localhost:3995/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const spawns: { bossId: string; x: number; y: number }[] = [];
const alive = new Set<string>();
let maxAlive = 0;
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
  if (ev.e === 'bossSpawned') {
    spawns.push({ bossId: ev.bossId, x: ev.x, y: ev.y });
    alive.add(ev.bossId);
    maxAlive = Math.max(maxAlive, alive.size);
  }
  if (ev.e === 'bossGone' || ev.e === 'bossKilled') alive.delete(ev.bossId);
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
  await sleep(45_000); // interval 3s + life 4s → ~6 rotation cycles
  const seen = spawns.map((s) => s.bossId);
  check('several rotation cycles happened', spawns.length >= 4, `spawns=${seen.join(',')}`);
  check('only one boss alive at a time', maxAlive === 1, `maxAlive=${maxAlive}`);
  check('rotation picks varied bosses', new Set(seen).size >= 3, `distinct=${[...new Set(seen)].join(',')}`);
  let noRepeat = true;
  for (let i = 1; i < seen.length; i++) if (seen[i] === seen[i - 1]) noRepeat = false;
  check('never the same boss twice in a row', noRepeat, seen.join('→'));
  for (const s of spawns) {
    const biome = biomeAt(s.x, s.y, size);
    if (biome !== HOME[s.bossId]) { check(`${s.bossId} spawned in its home biome`, false, `at=${biome}`); break; }
  }
  check('every spawn was in the boss\'s home biome', spawns.every((s) => biomeAt(s.x, s.y, size) === HOME[s.bossId]));
  ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

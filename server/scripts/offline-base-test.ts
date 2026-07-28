// Offline-base seeding: absent players' bases become raid targets, each
// account is seeded into only one world, and the owner logging in reclaims it.
process.env.DATA_DIR = process.env.DATA_DIR
  ?? '/tmp/claude-0/-home-user-Farmilka/9e0a0f6e-42bb-5164-af32-dc77ab722252/scratchpad/offline-db';

import { loadBalance } from '../src/game/balance.js';
import { openDb, getDb } from '../src/db/db.js';
import { World } from '../src/game/world.js';
import { seedOfflineBases, releaseBase, releaseWorld } from '../src/game/offline-bases.js';
import { saveBase } from '../src/db/accounts.js';

loadBalance();
openDb();
const db = getDb();
db.prepare('DELETE FROM accounts').run();

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`);
  ok ? pass++ : fail++;
};

// two absent players, each with a saved base
const now = Date.now();
for (const [i, name] of ['Absent1', 'Absent2'].entries()) {
  db.prepare('INSERT INTO accounts (name, pass_hash, salt, money, weapons, created_ts, last_seen_ts) VALUES (?,?,?,?,?,?,?)')
    .run(name, 'x', 'y', 0, JSON.stringify(['fists']), now, now);
  saveBase(name, JSON.stringify({
    ts: now - 600_000, // ten minutes away, so silos have been filling
    buildings: [
      { t: 'vault', x: 1000 + i * 900, y: 1000, s: 0 },
      { t: 'farm', x: 1140 + i * 900, y: 1090, s: 40 },
    ],
  }));
}

const countSeeded = (w: World, account: string): number => {
  let n = 0;
  for (const b of w.buildings.values()) if (b.ownerAccount === account && !b.ownerId) n++;
  return n;
};

const w1 = new World(1);
const w2 = new World(2);

seedOfflineBases(w1, new Set());
check('absent bases are seeded as raid targets', countSeeded(w1, 'Absent1') > 0 || countSeeded(w1, 'Absent2') > 0,
  `a1=${countSeeded(w1, 'Absent1')} a2=${countSeeded(w1, 'Absent2')}`);

const seededFarm = [...w1.buildings.values()].find((b) => !b.ownerId && b.buildingType === 'farm');
check('a seeded farm arrives with loot already in its silo', !!seededFarm && seededFarm.stored > 40,
  `stored=${seededFarm?.stored}`);
check('seeded buildings have no live owner (pure raid bait)', [...w1.buildings.values()].every((b) => !b.ownerId));

seedOfflineBases(w2, new Set());
for (const acc of ['Absent1', 'Absent2']) {
  const inBoth = countSeeded(w1, acc) > 0 && countSeeded(w2, acc) > 0;
  check(`${acc} is not seeded into two worlds at once`, !inBoth, `w1=${countSeeded(w1, acc)} w2=${countSeeded(w2, acc)}`);
}

// the owner logging in takes their base back
const holder = countSeeded(w1, 'Absent1') > 0 ? w1 : w2;
releaseBase(holder, 'Absent1');
check('the owner logging in clears their seeded base', countSeeded(holder, 'Absent1') === 0);

// an online player is never seeded as an absent target
const w3 = new World(3);
releaseWorld(w1); releaseWorld(w2);
seedOfflineBases(w3, new Set(['Absent1', 'Absent2']));
check('players who are online are not seeded as targets', w3.buildings.size === 0, `n=${w3.buildings.size}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

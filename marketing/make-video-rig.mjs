// Builds the slow-motion balance the preview recorder runs against.
//
//   node marketing/make-video-rig.mjs
//
// Headless Chromium has no GPU, so the game renders at roughly 5 fps at 1080p.
// The fix is to slow the *world* down by S and speed the *video* back up by S
// at encode time: every frame the browser manages to draw then lands on a
// distinct moment, and the result plays at full speed with ~29 real fps.
//
// So: anything measured per second is divided by S, anything measured in
// seconds is multiplied by S. Generated from the live balance.json rather than
// hand-maintained, so the rig cannot drift out of date (or out of schema).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const S = Number(process.env.SLOWMO || 2.5);

const bal = JSON.parse(readFileSync(join(DIR, '..', 'balance', 'balance.json'), 'utf8'));

const slower = (v) => (typeof v === 'number' ? v / S : v);   // per-second quantities
const longer = (v) => (typeof v === 'number' ? v * S : v);   // durations

const rate = (o, ...keys) => { for (const k of keys) if (o?.[k] !== undefined) o[k] = slower(o[k]); };
const secs = (o, ...keys) => { for (const k of keys) if (o?.[k] !== undefined) o[k] = longer(o[k]); };

rate(bal.player, 'speed', 'regenPerSec');
secs(bal.player, 'regenDelaySec', 'respawnSec', 'spawnProtectSec');

for (const w of Object.values(bal.weapons)) {
  rate(w, 'attackRate', 'projSpeed');
  if (w.poison) { rate(w.poison, 'dps'); secs(w.poison, 'durationSec'); }
  if (w.chill) secs(w.chill, 'durationSec');
}

for (const m of Object.values(bal.mobs)) rate(m, 'speed', 'attackRate');

for (const b of Object.values(bal.bosses)) {
  rate(b, 'speed');
  secs(b, 'spawnIntervalSec', 'warnSec', 'despawnSec');
  for (const a of [b.slam, b.burst, b.unique]) {
    if (!a) continue;
    rate(a, 'projSpeed');
    secs(a, 'telegraphSec', 'cooldownSec', 'chillSec');
  }
}

for (const b of Object.values(bal.buildings)) {
  secs(b, 'incomeIntervalSec');
  rate(b, 'attackRate', 'projSpeed');
}

secs(bal.food, 'cooldownSec', 'despawnSec');
secs(bal.economy, 'coinDespawnSec', 'raidShieldSec');

// --- video-only staging (not a balance change, just what the camera needs) ---
bal.world.size = 3600;          // compact: the raid target is a short walk away
bal.world.servers = 1;
bal.world.maxServers = 1;
bal.player.hp = 4000;           // the take must not end in a death screen
bal.player.startMoney = 40_000; // enough to build, wall in and buy a crate on camera
bal.economy.maxBuildingsPerPlayer = 14;
bal.economy.maxWallsPerPlayer = 24;
for (const m of Object.values(bal.mobs)) { m.damage = 1; m.count = Math.max(6, m.count); }
for (const b of Object.values(bal.bosses)) {
  b.hp = Math.round(b.hp * 0.25);   // a boss that dies inside the take
  // Nothing may kill the actor mid-take: a death drops the carried gold and
  // every beat after it (the crate, the raid) silently has nothing to spend.
  b.contactDamage = 1;
  for (const a of [b.slam, b.burst, b.unique]) if (a) a.damage = 1;
  // Wall-clock, not slow-world: the boss timer runs on the server's real clock,
  // so it has to land inside the take whatever the slow-motion factor is.
  b.spawnIntervalSec = 120;
}
// the crate beat has to land every time
bal.weaponLootbox = { ...bal.weaponLootbox, legendaryChance: 1, epicChance: 0, weaponChance: 0, goldChance: 0 };

writeFileSync(join(DIR, 'video-rig-balance.json'), JSON.stringify(bal));
console.log(`wrote video-rig-balance.json (slow-motion ×${S})`);

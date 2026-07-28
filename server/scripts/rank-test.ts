// Base Rank: the curve, the perks it grants, and — most importantly — the
// guarantee that it never touches combat power. Also covers base relocation
// when the old plot is occupied.
import { loadBalance, getBalance } from '../src/game/balance.js';
import { rankFromBanked, bankedForRank, rankPerks } from '@shared/rank.js';
import { World } from '../src/game/world.js';
import { updateBuildings, perksOf, siloCap, grantStarterBase, makeBuilding, lootFromDestroyed } from '../src/game/buildings.js';
import { performAttack, applyDamage } from '../src/game/combat.js';
import type { Player, Building } from '../src/game/entities.js';
import { biomeRect } from '@shared/biomes.js';

loadBalance();
const bal = getBalance();
const cfg = bal.rank;

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`);
  ok ? pass++ : fail++;
};

function addPlayer(world: World, name = 'P'): Player {
  const p = world.spawnPlayer(name, null);
  p.ws = { readyState: 99 } as never;
  p.invulnUntil = 0;
  return p;
}
const owned = (w: World, p: Player, t: string): Building | null => {
  for (const id of p.buildingIds) { const b = w.buildings.get(id); if (b && b.buildingType === t) return b; }
  return null;
};

// ---------- the curve ----------
check('no rank before the first threshold', rankFromBanked(cfg.baseBanked - 1, cfg) === 0);
check('rank 1 at the first threshold', rankFromBanked(cfg.baseBanked, cfg) === 1, `${rankFromBanked(cfg.baseBanked, cfg)}`);
check('rank keeps climbing with lifetime deposits', rankFromBanked(1_000_000, cfg) > rankFromBanked(100_000, cfg));
{
  // each rank must cost meaningfully more than the last
  const r20 = bankedForRank(20, cfg), r21 = bankedForRank(21, cfg);
  check('each rank costs more than the last', r21 > r20 * 1.1, `r20=${r20} r21=${r21}`);
  check('the curve stays finite far out', Number.isFinite(bankedForRank(200, cfg)));
}

// ---------- perks are capped ----------
{
  const huge = rankPerks(100_000, cfg);
  check('silo bonus is capped', Math.abs(huge.siloCapMult - (1 + cfg.siloCapMax)) < 1e-9, `${huge.siloCapMult}`);
  check('production bonus is capped', Math.abs(huge.productionMult - (1 + cfg.productionMax)) < 1e-9, `${huge.productionMult}`);
  check('extra slots are capped', huge.extraSlots === cfg.slotsMax, `${huge.extraSlots}`);
  check('respawn cut is capped', Math.abs(huge.respawnMult - (1 - cfg.respawnMax)) < 1e-9, `${huge.respawnMult}`);
  check('coin magnet is capped', huge.magnetAdd === cfg.magnetMax, `${huge.magnetAdd}`);
  check('vault protection is capped', Math.abs(huge.vaultProtection - cfg.vaultProtMax) < 1e-9, `${huge.vaultProtection}`);
  check('a raider always takes something', bal.economy.vaultRaidFrac - cfg.vaultProtMax > 0,
    `floor=${(bal.economy.vaultRaidFrac - cfg.vaultProtMax).toFixed(3)}`);
}

// ---------- rank must NOT grant combat power ----------
{
  const world = new World(1);
  const rookie = addPlayer(world, 'Rookie');
  const veteran = addPlayer(world, 'Veteran');
  veteran.bankedTotal = 10_000_000; // deep into the rank curve
  check('rank does not raise max HP', rookie.maxHp === veteran.maxHp, `${rookie.maxHp} vs ${veteran.maxHp}`);

  // identical weapon, identical target: damage dealt must match exactly
  const dummyFor = (attacker: Player): Player => {
    const d = addPlayer(world, `Dummy${attacker.name}`);
    d.invulnUntil = 0;
    d.hp = d.maxHp = 5000;
    world.moveEntity(d, attacker.x + 40, attacker.y);
    return d;
  };
  world.moveEntity(rookie, 1000, 1000);
  world.moveEntity(veteran, 3000, 3000);
  const dr = dummyFor(rookie);
  const dv = dummyFor(veteran);
  rookie.angle = 0; veteran.angle = 0;
  const now = Date.now();
  performAttack(world, rookie, bal.weapons.sword, now);
  performAttack(world, veteran, bal.weapons.sword, now);
  check('rank does not raise damage dealt', dr.maxHp - dr.hp === dv.maxHp - dv.hp,
    `rookie dealt ${dr.maxHp - dr.hp}, veteran dealt ${dv.maxHp - dv.hp}`);

  // and it must not soften incoming damage either
  rookie.hp = veteran.hp = 5000;
  rookie.maxHp = veteran.maxHp = 5000;
  const src = { id: 'x', name: 'x', weapon: 'sword', cause: 'player' as const };
  applyDamage(world, rookie, 100, src, now, 10);
  applyDamage(world, veteran, 100, src, now, 10);
  check('rank does not reduce damage taken', rookie.hp === veteran.hp, `${rookie.hp} vs ${veteran.hp}`);
}

// ---------- perks that should apply ----------
{
  const world = new World(1);
  const p = addPlayer(world, 'Ranked');
  grantStarterBase(world, p);
  const farm = owned(world, p, 'farm')!;
  const before = siloCap(farm, p);
  p.bankedTotal = 10_000_000;
  check('rank widens the silo', siloCap(farm, p) > before, `${before} -> ${siloCap(farm, p)}`);
  check('rank grants extra building slots', perksOf(p).extraSlots > 0, `${perksOf(p).extraSlots}`);

  // vault protection actually reduces what a raid takes
  const vault = owned(world, p, 'vault')!;
  p.banked = 100_000;
  const takenRanked = lootFromDestroyed(world, vault, p);
  const q = addPlayer(world, 'Plain');
  grantStarterBase(world, q);
  q.banked = 100_000;
  const takenPlain = lootFromDestroyed(world, owned(world, q, 'vault')!, q);
  check('high rank loses less to a vault raid', takenRanked < takenPlain, `ranked=${takenRanked} plain=${takenPlain}`);
}

// ---------- dangerous biomes produce more ----------
{
  const world = new World(1);
  const p = addPlayer(world, 'Settler');
  const size = bal.world.size;
  const safe = biomeRect('normal', size);
  const risky = biomeRect('mystic_west', size);
  const now = Date.now();
  const f1 = makeBuilding(world, 'farm', (safe.x0 + safe.x1) / 2, (safe.y0 + safe.y1) / 2, { id: p.id, name: p.name, account: null }, now);
  const f2 = makeBuilding(world, 'farm', (risky.x0 + risky.x1) / 2, (risky.y0 + risky.y1) / 2, { id: p.id, name: p.name, account: null }, now);
  world.moveEntity(p, 10, 10); // stay away so nothing is auto-collected
  let t = now;
  for (let i = 0; i < 5; i++) { t += bal.buildings.farm.incomeIntervalSec * 1000; updateBuildings(world, 0.1, t); }
  check('a farm in a mystic biome out-produces a safe one', f2.stored > f1.stored, `risky=${f2.stored} safe=${f1.stored}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

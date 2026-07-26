// Big-update probe: unique bosses (abilities + free roam), reworked hat
// lootbox (tier-total chances + food), weapon lootbox with unique weapons and
// their abilities. Runs against real game modules with a real World — no
// network, no DB (telemetry only buffers in memory here).
import { loadBalance, getBalance } from '../src/game/balance.js';
import { World } from '../src/game/world.js';
import { spawnBoss, updateBosses } from '../src/game/boss.js';
import { spawnMob, updateMobs } from '../src/game/mobs.js';
import { performAttack, updateProjectiles, applyDamage } from '../src/game/combat.js';
import { tryBuyWeapon, trySellWeapon, tryWeaponLootbox } from '../src/game/economy.js';
import { tryLootbox } from '../src/game/hats.js';
import type { Player, MobState } from '../src/game/entities.js';
import type { WeaponId, BossId } from '@shared/types.js';

loadBalance();
const bal = getBalance();
const SIZE = bal.world.size;

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`);
  ok ? pass++ : fail++;
};

function freshWorld(): World { return new World(1); }

function addPlayer(world: World, x: number, y: number, name = 'P'): Player {
  const p = world.spawnPlayer(name, null);
  p.ws = { readyState: 99 } as never; // "connected" for AI targeting; sends are skipped
  p.invulnUntil = 0;
  p.hp = p.maxHp = 10_000; // survive boss hits during ability probes
  world.moveEntity(p, x, y);
  return p;
}

// ---------- bosses: unique abilities ----------
function bossAbilityProbe(type: BossId): void {
  const cfg = bal.bosses[type];
  const u = cfg.unique;
  const world = freshWorld();
  const bx = SIZE / 2, by = SIZE / 2;
  const p = addPlayer(world, bx + 300, by);
  const p2 = u.kind === 'spikes' ? addPlayer(world, bx - 300, by, 'P2') : null;
  let now = 1_000_000;
  const boss = spawnBoss(world, type, bx, by, now, cfg.biome);
  boss.uniqueReadyAt = 0;
  boss.attackReadyAt = Infinity; // isolate the signature ability

  const hp0 = p.hp;
  const castX = p.x, castY = p.y;
  updateBosses(world, 0.033, now); // starts the telegraph
  const telegraphed = boss.telegraph?.kind === 'unique';
  now += u.telegraphSec * 1000 + 60;
  updateBosses(world, 0.033, now); // resolves it

  switch (u.kind) {
    case 'charge': {
      const moved = Math.hypot(boss.x - bx, boss.y - by);
      check(`${type} charge: dashes and damages the lane`, telegraphed && p.hp < hp0 && moved > u.range * 0.8, `moved=${moved.toFixed(0)} dmg=${hp0 - p.hp}`);
      break;
    }
    case 'nova': {
      check(`${type} nova: AoE damage + chill`, telegraphed && p.hp < hp0 && p.chillUntil > now - 100, `dmg=${hp0 - p.hp} chillUntil>${p.chillUntil > 0}`);
      break;
    }
    case 'burrow':
    case 'blink': {
      const landed = Math.hypot(boss.x - castX, boss.y - castY) < 5;
      check(`${type} ${u.kind}: teleports onto the victim + damage`, telegraphed && landed && p.hp < hp0, `landed=${landed} dmg=${hp0 - p.hp}`);
      break;
    }
    case 'spikes': {
      check(`${type} spikes: eruptions hit both players`, telegraphed && p.hp < hp0 && p2!.hp < p2!.maxHp, `dmg1=${hp0 - p.hp} dmg2=${p2!.maxHp - p2!.hp}`);
      break;
    }
  }
}
for (const type of Object.keys(bal.bosses) as BossId[]) bossAbilityProbe(type);

// ---------- bosses: roam beyond the home biome ----------
{
  const world = freshWorld();
  // champion homes in 'normal' (middle band); the player waits in snow within
  // aggro range (1500) of the border — the old code clamped the boss to its biome
  const p = addPlayer(world, SIZE / 2, SIZE / 3 - 700);
  let now = 1_000_000;
  const boss = spawnBoss(world, 'champion', SIZE / 2, SIZE / 3 + 400, now, 'normal');
  boss.uniqueReadyAt = Infinity;
  boss.attackReadyAt = Infinity;
  for (let i = 0; i < 600 && boss.y > SIZE / 3 - 100; i++) {
    now += 100;
    updateBosses(world, 0.1, now);
  }
  check('boss chases across the biome border (roams the map)', boss.y < SIZE / 3, `bossY=${boss.y.toFixed(0)} border=${(SIZE / 3).toFixed(0)} playerY=${p.y.toFixed(0)}`);
}

// ---------- bosses: wander when nobody is around ----------
{
  const world = freshWorld();
  let now = 1_000_000;
  const boss = spawnBoss(world, 'sand_worm', SIZE / 2, SIZE * 0.8, now, 'desert');
  const x0 = boss.x, y0 = boss.y;
  for (let i = 0; i < 100; i++) {
    now += 100;
    updateBosses(world, 0.1, now);
  }
  check('boss wanders while alone', Math.hypot(boss.x - x0, boss.y - y0) > 100, `moved=${Math.hypot(boss.x - x0, boss.y - y0).toFixed(0)}`);
}

// ---------- hat lootbox: tier-total chances + food ----------
{
  const world = freshWorld();
  const p = addPlayer(world, SIZE / 2, SIZE / 2, 'Lucky');
  const lb = bal.hats.lootbox;
  const N = 40_000;
  const hits: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0, food: 0, gold: 0, nothing: 0 };
  for (let i = 0; i < N; i++) {
    p.hats = [];
    p.food = 0;
    p.money = bal.hats.lootboxPrice;
    tryLootbox(world, p);
    if (p.hats.length) hits[bal.hats.items[p.hats[0]].tier]++;
    else if (p.food > 0) hits.food++;
    else if (p.money > 0) hits.gold++;
    else hits.nothing++;
  }
  const okTier = (tier: 'common' | 'rare' | 'epic' | 'legendary'): boolean => {
    const want = lb.tierChances[tier];
    const got = hits[tier] / N;
    return Math.abs(got - want) < Math.max(0.008, want * 0.25);
  };
  check('hat lootbox: legendary ≈ 2% (total for the tier)', okTier('legendary'), `got=${(hits.legendary / N * 100).toFixed(2)}%`);
  check('hat lootbox: epic ≈ 5%', okTier('epic'), `got=${(hits.epic / N * 100).toFixed(2)}%`);
  check('hat lootbox: rare ≈ 12%', okTier('rare'), `got=${(hits.rare / N * 100).toFixed(2)}%`);
  check('hat lootbox: common ≈ 20%', okTier('common'), `got=${(hits.common / N * 100).toFixed(2)}%`);
  check('hat lootbox: food drops', Math.abs(hits.food / N - lb.foodChance) < 0.01, `got=${(hits.food / N * 100).toFixed(2)}%`);
  check('hat lootbox: some boxes are empty', hits.nothing / N > 0.1, `got=${(hits.nothing / N * 100).toFixed(2)}%`);
}

// ---------- weapon lootbox: tiers, dup conversion, guards ----------
{
  const world = freshWorld();
  const p = addPlayer(world, SIZE / 2, SIZE / 2, 'Gunner');
  const lb = bal.weaponLootbox;
  const N = 40_000;
  const hits = { legendary: 0, epic: 0, weapon: 0, gold: 0, nothing: 0 };
  for (let i = 0; i < N; i++) {
    p.weapons = ['fists'];
    p.equipped = 'fists';
    p.money = lb.price;
    tryWeaponLootbox(world, p);
    const added = p.weapons.find((w) => w !== 'fists');
    if (added) {
      const tier = bal.weapons[added].tier;
      if (tier) hits[tier]++;
      else hits.weapon++;
    } else if (p.money > 0) hits.gold++;
    else hits.nothing++;
  }
  check('weapon lootbox: legendary ≈ 2%', Math.abs(hits.legendary / N - lb.legendaryChance) < 0.006, `got=${(hits.legendary / N * 100).toFixed(2)}%`);
  check('weapon lootbox: epic ≈ 6%', Math.abs(hits.epic / N - lb.epicChance) < 0.008, `got=${(hits.epic / N * 100).toFixed(2)}%`);
  check('weapon lootbox: regular weapons ≈ 40%', Math.abs(hits.weapon / N - lb.weaponChance) < 0.015, `got=${(hits.weapon / N * 100).toFixed(2)}%`);

  // duplicate unique converts to its sell value
  p.weapons = ['fists', 'tamer_blade'];
  p.money = 0;
  const dupGold: number[] = [];
  for (let i = 0; i < 3000; i++) {
    p.money = lb.price;
    p.weapons = ['fists', 'tamer_blade', 'mirror_blade', 'hook_blade']; // full hotbar of uniques
    tryWeaponLootbox(world, p);
    if (p.money > 0 && p.money !== lb.price) dupGold.push(p.money);
  }
  const sellVals = new Set(Object.values(bal.weapons).filter((w) => w.sellPrice).map((w) => w.sellPrice));
  const sawSellConversion = dupGold.some((g) => sellVals.has(g));
  check('weapon lootbox: duplicate/full hotbar converts to sell value', sawSellConversion, `samples=${dupGold.length}`);

  // shop guards
  p.money = 100_000;
  p.weapons = ['fists'];
  const buyRes = tryBuyWeapon(world, p, 'tamer_blade');
  check('unique weapons cannot be bought in the shop', !buyRes.ok, `reason=${buyRes.reason}`);
  p.weapons = ['fists', 'reaper_scythe'];
  p.money = 0;
  const sellRes = trySellWeapon(world, p, 'reaper_scythe');
  check('unique weapons sell at their high price', sellRes.ok && p.money === bal.weapons.reaper_scythe.sellPrice, `got=${p.money} want=${bal.weapons.reaper_scythe.sellPrice}`);
}

// ---------- unique weapon abilities ----------
{
  // tamer_blade: mobs never aggro its wielder
  const world = freshWorld();
  const p = addPlayer(world, SIZE / 2, SIZE / 2, 'Tamer');
  p.weapons = ['fists', 'tamer_blade'];
  p.equipped = 'tamer_blade';
  const wolf = spawnMob(world, 'wolf');
  world.moveEntity(wolf, p.x + 100, p.y);
  wolf.homeX = wolf.x; wolf.homeY = wolf.y;
  let now = 2_000_000;
  for (let i = 0; i < 20; i++) { now += 300; updateMobs(world, 0.3, now); }
  const ignored = wolf.state !== 'chase';
  // control case: with the blade off it must aggro again. Reset the mob to a
  // clean idle at its home first — 'return' only re-scans once it gets home,
  // which would otherwise make this leg timing-dependent.
  p.equipped = 'fists';
  wolf.state = 'idle' as MobState; // keep the union type — it is compared to 'chase' below
  world.moveEntity(wolf, wolf.homeX, wolf.homeY);
  wolf.nextThinkAt = 0;
  for (let i = 0; i < 40 && wolf.state !== 'chase'; i++) { now += 300; updateMobs(world, 0.3, now); }
  check('tamer_blade: mobs ignore the wielder (but chase without it)', ignored && wolf.state === 'chase', `ignored=${ignored} then=${wolf.state}`);
}
{
  // mirror_blade: ~25% of attacks on the owner miss
  const world = freshWorld();
  const p = addPlayer(world, SIZE / 2, SIZE / 2, 'Mirror');
  const enemy = addPlayer(world, SIZE / 2 + 200, SIZE / 2, 'Enemy');
  p.weapons = ['fists', 'mirror_blade'];
  p.equipped = 'mirror_blade';
  let misses = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    p.hp = p.maxHp;
    if (!applyDamage(world, p, 1, { id: enemy.id, name: enemy.name, weapon: 'sword', cause: 'player' }, 3_000_000, 10)) misses++;
  }
  const frac = misses / N;
  check('mirror_blade: ~25% of hits on the owner miss', Math.abs(frac - (bal.weapons.mirror_blade.missChance ?? 0)) < 0.03, `got=${(frac * 100).toFixed(1)}%`);
}
{
  // reaper_scythe: executes a mob left under 25% HP
  const world = freshWorld();
  const p = addPlayer(world, SIZE / 2, SIZE / 2, 'Reaper');
  p.weapons = ['fists', 'reaper_scythe'];
  p.equipped = 'reaper_scythe';
  const slime = spawnMob(world, 'slime');
  world.moveEntity(slime, p.x + 50, p.y);
  // the hit must leave it strictly under the 25% execute threshold
  slime.hp = Math.max(1, Math.floor(slime.maxHp * 0.2)) + bal.weapons.reaper_scythe.damage;
  p.angle = 0;
  performAttack(world, p, bal.weapons.reaper_scythe, 4_000_000);
  check('reaper_scythe: executes mobs below the threshold', slime.dead, `mobHp=${slime.hp}`);
}
{
  // dragon_bow: one arrow pierces several mobs in a line
  const world = freshWorld();
  const p = addPlayer(world, SIZE / 2, SIZE / 2, 'Dragon');
  p.weapons = ['fists', 'dragon_bow'];
  p.equipped = 'dragon_bow';
  p.angle = 0;
  const mobs = [0, 1, 2].map((i) => {
    const m = spawnMob(world, 'sand_golem');
    world.moveEntity(m, p.x + 150 + i * 120, p.y);
    m.hp = m.maxHp = 10_000; // tanky so the arrow passes through alive targets
    return m;
  });
  performAttack(world, p, bal.weapons.dragon_bow, 5_000_000);
  for (let i = 0; i < 40; i++) updateProjectiles(world, 0.033, 5_000_000 + i * 33);
  const hurt = mobs.filter((m) => m.hp < m.maxHp).length;
  check('dragon_bow: the arrow pierces through multiple targets', hurt >= 2, `hurt=${hurt}/3`);
}
{
  // hook_blade: the hit yanks the victim next to the shooter
  const world = freshWorld();
  const p = addPlayer(world, SIZE / 2, SIZE / 2, 'Hooker');
  p.weapons = ['fists', 'hook_blade'];
  p.equipped = 'hook_blade';
  p.angle = 0;
  const m = spawnMob(world, 'sand_golem');
  world.moveEntity(m, p.x + 400, p.y);
  m.hp = m.maxHp = 10_000;
  performAttack(world, p, bal.weapons.hook_blade, 6_000_000);
  for (let i = 0; i < 40; i++) updateProjectiles(world, 0.033, 6_000_000 + i * 33);
  const d = Math.hypot(m.x - p.x, m.y - p.y);
  check('hook_blade: pulls the victim to the shooter', m.hp < m.maxHp && d < 120, `dist=${d.toFixed(0)} dmg=${m.maxHp - m.hp}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

import type { WeaponId, MobId, BossId, BuildingId } from './types.js';
import type { BiomeId } from './biomes.js';

export interface WeaponCfg {
  type: 'melee' | 'ranged';
  damage: number;
  range: number;
  attackRate: number;
  price: number;
  arc?: number;
  knockback?: number;
  projSpeed?: number;
  slowFactor?: number;
}

export interface MobCfg {
  biome: BiomeId;
  hp: number;
  damage: number;
  speed: number;
  reward: number;
  radius: number;
  aggroRadius: number;
  attackRange: number;
  attackRate: number;
  flees: boolean;
  count: number;
  leashRange: number;
}

export interface BossAttackSlam {
  damage: number;
  range: number;
  arc: number;
  telegraphSec: number;
  cooldownSec: number;
}

export interface BossAttackBurst {
  damage: number;
  count: number;
  projSpeed: number;
  projRange: number;
  telegraphSec: number;
  cooldownSec: number;
}

export interface BossCfg {
  name: string;
  /** 'central' = random of snow/normal/desert; otherwise a specific biome */
  biome: BiomeId | 'central';
  hp: number;
  speed: number;
  radius: number;
  contactDamage: number;
  spawnIntervalSec: number;
  warnSec: number;
  despawnSec: number;
  reward: number;
  minDamageForReward: number;
  slam: BossAttackSlam;
  burst: BossAttackBurst;
}

export interface BuildingCfg {
  price: number;
  hp: number;
  income: number;
  incomeIntervalSec: number;
  radius: number;
  damage?: number;
  range?: number;
  attackRate?: number;
  projSpeed?: number;
}

export interface Balance {
  world: {
    size: number;
    viewRadius: number;
    maxPlayers: number;
    tickRate: number;
  };
  player: {
    hp: number;
    speed: number;
    radius: number;
    regenPerSec: number;
    regenDelaySec: number;
    respawnSec: number;
    startMoney: number;
    dropMoneyFrac: number;
    spawnProtectSec: number;
  };
  weapons: Record<WeaponId, WeaponCfg>;
  mobs: Record<MobId, MobCfg>;
  bosses: Record<BossId, BossCfg>;
  buildings: Record<BuildingId, BuildingCfg>;
  food: {
    heal: number;
    cooldownSec: number;
    maxCarry: number;
    price: number;
    dropChance: number;
    pickupRadius: number;
    despawnSec: number;
  };
  economy: {
    maxBuildingsPerPlayer: number;
    buildingMinDist: number;
    raidLootFrac: number;
    sellFrac: number;
    coinDespawnSec: number;
    coinPickupRadius: number;
  };
}

const WEAPON_IDS: WeaponId[] = ['fists', 'sword', 'spear', 'hammer', 'bow', 'crossbow'];
export const MOB_IDS: MobId[] = ['slime', 'wolf', 'ice_slime', 'yeti', 'scorpion', 'sand_golem', 'shade', 'treant', 'wisp', 'crystal_golem'];
export const BOSS_IDS: BossId[] = ['champion', 'shadow_lord', 'crystal_queen'];
const BUILDING_IDS: BuildingId[] = ['farm', 'mine', 'turret'];
const BIOME_IDS = ['normal', 'snow', 'desert', 'mystic_west', 'mystic_east'];

function num(obj: Record<string, unknown>, key: string, path: string, min = 0): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) {
    throw new Error(`balance: ${path}.${key} must be a number >= ${min}, got ${JSON.stringify(v)}`);
  }
  return v;
}

function section(root: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = root[key];
  if (typeof v !== 'object' || v === null) throw new Error(`balance: missing section "${key}"`);
  return v as Record<string, unknown>;
}

/** Validates the parsed balance.json; throws with a readable message on problems. */
export function validateBalance(raw: unknown): Balance {
  if (typeof raw !== 'object' || raw === null) throw new Error('balance: root must be an object');
  const root = raw as Record<string, unknown>;

  const world = section(root, 'world');
  num(world, 'size', 'world', 500);
  num(world, 'viewRadius', 'world', 100);
  num(world, 'maxPlayers', 'world', 1);
  num(world, 'tickRate', 'world', 1);

  const player = section(root, 'player');
  for (const k of ['hp', 'speed', 'radius', 'regenPerSec', 'regenDelaySec', 'respawnSec', 'startMoney', 'dropMoneyFrac', 'spawnProtectSec']) {
    num(player, k, 'player');
  }

  const weapons = section(root, 'weapons');
  for (const id of WEAPON_IDS) {
    const w = section(weapons, id);
    if (w.type !== 'melee' && w.type !== 'ranged') throw new Error(`balance: weapons.${id}.type must be melee|ranged`);
    for (const k of ['damage', 'range', 'attackRate', 'price']) num(w, k, `weapons.${id}`);
    if (w.type === 'melee') num(w, 'arc', `weapons.${id}`, 1);
    if (w.type === 'ranged') num(w, 'projSpeed', `weapons.${id}`, 1);
  }

  const mobs = section(root, 'mobs');
  for (const id of MOB_IDS) {
    const m = section(mobs, id);
    for (const k of ['hp', 'damage', 'speed', 'reward', 'radius', 'aggroRadius', 'attackRange', 'attackRate', 'count', 'leashRange']) {
      num(m, k, `mobs.${id}`);
    }
    if (typeof m.flees !== 'boolean') throw new Error(`balance: mobs.${id}.flees must be boolean`);
    if (!BIOME_IDS.includes(String(m.biome))) throw new Error(`balance: mobs.${id}.biome must be one of ${BIOME_IDS.join('|')}`);
  }

  const bosses = section(root, 'bosses');
  for (const id of BOSS_IDS) {
    const b = section(bosses, id);
    if (typeof b.name !== 'string' || !b.name) throw new Error(`balance: bosses.${id}.name must be a string`);
    if (b.biome !== 'central' && !BIOME_IDS.includes(String(b.biome))) {
      throw new Error(`balance: bosses.${id}.biome must be 'central' or one of ${BIOME_IDS.join('|')}`);
    }
    for (const k of ['hp', 'speed', 'radius', 'contactDamage', 'spawnIntervalSec', 'warnSec', 'despawnSec', 'reward', 'minDamageForReward']) {
      num(b, k, `bosses.${id}`);
    }
    const slam = section(b, 'slam');
    for (const k of ['damage', 'range', 'arc', 'telegraphSec', 'cooldownSec']) num(slam, k, `bosses.${id}.slam`);
    const burst = section(b, 'burst');
    for (const k of ['damage', 'count', 'projSpeed', 'projRange', 'telegraphSec', 'cooldownSec']) num(burst, k, `bosses.${id}.burst`);
  }

  const buildings = section(root, 'buildings');
  for (const id of BUILDING_IDS) {
    const b = section(buildings, id);
    for (const k of ['price', 'hp', 'income', 'incomeIntervalSec', 'radius']) num(b, k, `buildings.${id}`);
  }

  const food = section(root, 'food');
  for (const k of ['heal', 'cooldownSec', 'maxCarry', 'price', 'dropChance', 'pickupRadius', 'despawnSec']) {
    num(food, k, 'food');
  }

  const economy = section(root, 'economy');
  for (const k of ['maxBuildingsPerPlayer', 'buildingMinDist', 'raidLootFrac', 'sellFrac', 'coinDespawnSec', 'coinPickupRadius']) {
    num(economy, k, 'economy');
  }

  return raw as Balance;
}

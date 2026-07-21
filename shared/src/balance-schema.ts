import type { WeaponId, MobId, BuildingId } from './types.js';

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
  zoneMin: number;
  zoneMax: number;
  leashRange: number;
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
    safeZoneRadius: number;
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
  };
  weapons: Record<WeaponId, WeaponCfg>;
  mobs: Record<MobId, MobCfg>;
  boss: {
    hp: number;
    speed: number;
    radius: number;
    contactDamage: number;
    spawnIntervalSec: number;
    warnSec: number;
    despawnSec: number;
    reward: number;
    minDamageForReward: number;
    slam: { damage: number; range: number; arc: number; telegraphSec: number; cooldownSec: number };
    burst: { damage: number; count: number; projSpeed: number; projRange: number; telegraphSec: number; cooldownSec: number };
  };
  buildings: Record<BuildingId, BuildingCfg>;
  economy: {
    maxBuildingsPerPlayer: number;
    buildingMinDist: number;
    buildingSafeZoneDist: number;
    raidLootFrac: number;
    coinDespawnSec: number;
    coinPickupRadius: number;
    ownerOfflineDespawnSec: number;
  };
}

const WEAPON_IDS: WeaponId[] = ['fists', 'sword', 'spear', 'hammer', 'bow', 'crossbow'];
const MOB_IDS: MobId[] = ['slime', 'wolf', 'golem'];
const BUILDING_IDS: BuildingId[] = ['farm', 'mine', 'turret'];

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
  num(world, 'safeZoneRadius', 'world');
  num(world, 'viewRadius', 'world', 100);
  num(world, 'maxPlayers', 'world', 1);
  num(world, 'tickRate', 'world', 1);

  const player = section(root, 'player');
  for (const k of ['hp', 'speed', 'radius', 'regenPerSec', 'regenDelaySec', 'respawnSec', 'startMoney', 'dropMoneyFrac']) {
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
    for (const k of ['hp', 'damage', 'speed', 'reward', 'radius', 'aggroRadius', 'attackRange', 'attackRate', 'count', 'zoneMin', 'zoneMax', 'leashRange']) {
      num(m, k, `mobs.${id}`);
    }
    if (typeof m.flees !== 'boolean') throw new Error(`balance: mobs.${id}.flees must be boolean`);
  }

  const boss = section(root, 'boss');
  for (const k of ['hp', 'speed', 'radius', 'contactDamage', 'spawnIntervalSec', 'warnSec', 'despawnSec', 'reward', 'minDamageForReward']) {
    num(boss, k, 'boss');
  }
  const slam = section(boss, 'slam');
  for (const k of ['damage', 'range', 'arc', 'telegraphSec', 'cooldownSec']) num(slam, k, 'boss.slam');
  const burst = section(boss, 'burst');
  for (const k of ['damage', 'count', 'projSpeed', 'projRange', 'telegraphSec', 'cooldownSec']) num(burst, k, 'boss.burst');

  const buildings = section(root, 'buildings');
  for (const id of BUILDING_IDS) {
    const b = section(buildings, id);
    for (const k of ['price', 'hp', 'income', 'incomeIntervalSec', 'radius']) num(b, k, `buildings.${id}`);
  }

  const economy = section(root, 'economy');
  for (const k of ['maxBuildingsPerPlayer', 'buildingMinDist', 'buildingSafeZoneDist', 'raidLootFrac', 'coinDespawnSec', 'coinPickupRadius', 'ownerOfflineDespawnSec']) {
    num(economy, k, 'economy');
  }

  return raw as Balance;
}

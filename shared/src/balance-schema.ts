import type { WeaponId, MobId, BossId, BuildingId } from './types.js';
import type { BiomeId } from './biomes.js';
import type { PrestigeCfg } from './prestige.js';

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
  /** melee: damage multiplier when hitting a target from behind */
  backstabMult?: number;
  /** fraction of dealt damage returned as HP to the attacker */
  lifestealFrac?: number;
  /** ranged: number of projectiles per shot (default 1) */
  projectiles?: number;
  /** ranged: total fan spread in degrees for multi-projectile shots */
  spreadDeg?: number;
  /** damage-over-time applied on hit (refreshes, does not stack) */
  poison?: { dps: number; durationSec: number };
  /** movement slow applied on hit (bosses are immune) */
  chill?: { slowFactor: number; durationSec: number };
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

export type HatTier = 'common' | 'rare' | 'epic' | 'legendary';

export interface HatCfg {
  name: string;
  tier: HatTier;
  effect: {
    speedMult?: number;
    maxHpAdd?: number;
    damageMult?: number;
    foodHealMult?: number;
    incomeMult?: number;
    regenMult?: number;
    /** extra coin pickup radius */
    coinMagnetAdd?: number;
    /** multiplier on mob food-drop chance */
    foodFindMult?: number;
    /** multiplier on mob kill rewards (PvE only) */
    mobRewardMult?: number;
    /** multiplier on respawn time (0.5 = twice as fast) */
    respawnMult?: number;
    /** fraction of the death money-drop that is kept instead */
    dropSaveFrac?: number;
    /** damage multiplier against bosses only (PvE) */
    bossDmgMult?: number;
  };
}

export interface HatsCfg {
  mobDropChance: number;
  bossDropChance: number;
  lootboxPrice: number;
  lootbox: { legendaryChance: number; epicChance: number; goldChance: number; goldMin: number; goldMax: number };
  dupGold: Record<HatTier, number>;
  items: Record<string, HatCfg>;
}

export interface Balance {
  world: {
    size: number;
    viewRadius: number;
    maxPlayers: number;
    tickRate: number;
    servers: number;
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
  hats: HatsCfg;
  prestige: PrestigeCfg;
  economy: {
    maxBuildingsPerPlayer: number;
    buildingMinDist: number;
    raidLootFrac: number;
    sellFrac: number;
    coinDespawnSec: number;
    coinPickupRadius: number;
  };
}

export const WEAPON_IDS: WeaponId[] = [
  'fists', 'sword', 'spear', 'hammer', 'bow', 'crossbow',
  'daggers', 'scythe', 'venom_blade', 'vampire_blade', 'triple_bow', 'ice_staff',
];
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
  num(world, 'servers', 'world', 1);

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
    if (w.poison !== undefined) {
      const po = section(w, 'poison');
      num(po, 'dps', `weapons.${id}.poison`);
      num(po, 'durationSec', `weapons.${id}.poison`);
    }
    if (w.chill !== undefined) {
      const ch = section(w, 'chill');
      num(ch, 'slowFactor', `weapons.${id}.chill`, 0.05);
      num(ch, 'durationSec', `weapons.${id}.chill`);
    }
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

  const hats = section(root, 'hats');
  for (const k of ['mobDropChance', 'bossDropChance', 'lootboxPrice']) num(hats, k, 'hats');
  const lootbox = section(hats, 'lootbox');
  for (const k of ['legendaryChance', 'epicChance', 'goldChance', 'goldMin', 'goldMax']) num(lootbox, k, 'hats.lootbox');
  const dupGold = section(hats, 'dupGold');
  for (const k of ['common', 'rare', 'epic', 'legendary']) num(dupGold, k, 'hats.dupGold');
  const items = section(hats, 'items');
  const HAT_TIERS = ['common', 'rare', 'epic', 'legendary'];
  for (const [id, item] of Object.entries(items)) {
    if (typeof item !== 'object' || item === null) throw new Error(`balance: hats.items.${id} must be an object`);
    const h = item as Record<string, unknown>;
    if (typeof h.name !== 'string' || !h.name) throw new Error(`balance: hats.items.${id}.name must be a string`);
    if (!HAT_TIERS.includes(String(h.tier))) throw new Error(`balance: hats.items.${id}.tier must be one of ${HAT_TIERS.join('|')}`);
    if (typeof h.effect !== 'object' || h.effect === null) throw new Error(`balance: hats.items.${id}.effect must be an object`);
    for (const [ek, ev] of Object.entries(h.effect as Record<string, unknown>)) {
      if (typeof ev !== 'number' || !Number.isFinite(ev)) throw new Error(`balance: hats.items.${id}.effect.${ek} must be a number`);
    }
  }

  const prestige = section(root, 'prestige');
  for (const k of ['baseCost', 'growth', 'maxLevel']) num(prestige, k, 'prestige', k === 'growth' ? 1.01 : 1);
  if (!Array.isArray(prestige.tiers) || prestige.tiers.length === 0) throw new Error('balance: prestige.tiers must be a non-empty array');
  for (const t of prestige.tiers as Record<string, unknown>[]) {
    num(t, 'atLevel', 'prestige.tier', 1);
    for (const k of ['name', 'color', 'aura']) {
      if (typeof t[k] !== 'string' || !t[k]) throw new Error(`balance: prestige.tier.${k} must be a string`);
    }
  }

  const economy = section(root, 'economy');
  for (const k of ['maxBuildingsPerPlayer', 'buildingMinDist', 'raidLootFrac', 'sellFrac', 'coinDespawnSec', 'coinPickupRadius']) {
    num(economy, k, 'economy');
  }

  return raw as Balance;
}

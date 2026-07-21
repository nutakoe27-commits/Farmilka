import type { EntityKind, WeaponId, MobId, BossId, BuildingId } from '@shared/types.js';
import type { WebSocket } from 'ws';

export interface BaseEntity {
  id: string;
  kind: EntityKind;
  x: number;
  y: number;
  angle: number;
  radius: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  /** grid cell index, -1 when not in grid */
  cell: number;
  /** tick number of the last position/angle change (for delta snapshots) */
  movedTick: number;
  /** tick number of the last hp/state change (for delta snapshots) */
  dirtyTick: number;
}

/** Poison/chill status shared by players and mobs. */
export interface StatusEffects {
  poisonUntil: number;
  poisonDps: number;
  poisonNextAt: number;
  poisonSrc: { id: string; name: string; weapon: string } | null;
  chillUntil: number;
  chillFactor: number;
}

export function freshStatus(): StatusEffects {
  return { poisonUntil: 0, poisonDps: 0, poisonNextAt: 0, poisonSrc: null, chillUntil: 0, chillFactor: 1 };
}

export interface PlayerInput {
  seq: number;
  mx: number;
  my: number;
  aim: number;
  attack: boolean;
}

export interface SessionStats {
  joinedAt: number;
  kills: number;
  deaths: number;
  moneyEarned: number;
}

export interface Player extends BaseEntity, StatusEffects {
  kind: 'player';
  name: string;
  ws: WebSocket | null;
  input: PlayerInput;
  money: number;
  weapons: WeaponId[];
  equipped: WeaponId;
  food: number;
  foodReadyAt: number;
  /** owned hat collection (permanent, not lost on death) */
  hats: string[];
  /** equipped hat id */
  hat: string | null;
  /** account prestige level (0 = none) */
  prestige: number;
  /** per-life character level (1..levels.max); bought with gold, reset on death */
  level: number;
  /** spawn protection: damage-immune until this time; broken by attacking */
  invulnUntil: number;
  /** account name when logged in, null for guests */
  account: string | null;
  attackReadyAt: number;
  lastDamagedAt: number;
  lastBossContactAt: number;
  respawnAt: number;
  buildingIds: Set<string>;
  known: Set<string>;
  session: SessionStats;
}

export type MobState = 'idle' | 'wander' | 'chase' | 'return' | 'flee';

export interface Mob extends BaseEntity, StatusEffects {
  kind: 'mob';
  mobType: MobId;
  state: MobState;
  homeX: number;
  homeY: number;
  targetId: string | null;
  wanderAngle: number;
  nextThinkAt: number;
  attackReadyAt: number;
  fleeUntil: number;
}

export interface Boss extends BaseEntity {
  kind: 'boss';
  bossType: BossId;
  /** biome the boss is bound to; it will not chase beyond it */
  homeBiome: string;
  targetId: string | null;
  attackReadyAt: number;
  telegraph: { kind: 'slam' | 'burst'; resolveAt: number; angle: number } | null;
  damageLedger: Map<string, number>;
  despawnAt: number;
}

export interface Projectile extends BaseEntity {
  kind: 'projectile';
  ownerId: string;
  ownerKind: 'player' | 'boss' | 'turret';
  weapon: string;
  damage: number;
  vx: number;
  vy: number;
  maxDist: number;
  traveled: number;
}

export interface Coin extends BaseEntity {
  kind: 'coin';
  value: number;
  despawnAt: number;
}

export interface Food extends BaseEntity {
  kind: 'food';
  despawnAt: number;
}

export interface Building extends BaseEntity {
  kind: 'building';
  buildingType: BuildingId;
  ownerId: string;
  ownerName: string;
  incomeAt: number;
  attackReadyAt: number;
  lastAlertAt: number;
  ownerOfflineAt: number; // 0 while owner online
}

export type Entity = Player | Mob | Boss | Projectile | Coin | Food | Building;

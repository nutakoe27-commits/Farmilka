import type { EntityKind, WeaponId, MobId, BuildingId } from '@shared/types.js';
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

export interface Player extends BaseEntity {
  kind: 'player';
  name: string;
  ws: WebSocket | null;
  input: PlayerInput;
  money: number;
  weapons: WeaponId[];
  equipped: WeaponId;
  attackReadyAt: number;
  lastDamagedAt: number;
  lastBossContactAt: number;
  respawnAt: number;
  buildingIds: Set<string>;
  known: Set<string>;
  session: SessionStats;
}

export type MobState = 'idle' | 'wander' | 'chase' | 'return' | 'flee';

export interface Mob extends BaseEntity {
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

export type Entity = Player | Mob | Boss | Projectile | Coin | Building;

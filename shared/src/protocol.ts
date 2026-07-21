import type { EntityKind, WeaponId, MobId, BuildingId, DeathCause } from './types.js';
import type { WeaponCfg, BuildingCfg } from './balance-schema.js';

// ---------- Entity state as seen by clients ----------

export interface EntityState {
  id: string;
  kind: EntityKind;
  x: number;
  y: number;
  angle: number;
  radius: number;
  hp?: number;
  maxHp?: number;
  name?: string;
  weapon?: WeaponId;
  mobType?: MobId;
  buildingType?: BuildingId;
  owner?: string; // owner player id (buildings, projectiles)
  value?: number; // coins
  dead?: boolean;
}

export interface EntityDelta {
  id: string;
  x: number;
  y: number;
  angle?: number;
  hp?: number;
  weapon?: WeaponId;
  dead?: boolean;
}

export interface SelfState {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  money: number;
  weapons: WeaponId[];
  equipped: WeaponId;
  buildings: number;
  inSafe: boolean;
  respawnIn?: number;
}

// ---------- Events ----------

export type GameEvent =
  | { e: 'kill'; killer: string; victim: string; weapon: string }
  | { e: 'damage'; target: string; amount: number; x: number; y: number }
  | { e: 'death'; dropped: number; respawnIn: number; cause: DeathCause }
  | { e: 'bossWarn'; x: number; y: number; inSec: number }
  | { e: 'bossSpawned'; x: number; y: number }
  | { e: 'bossTelegraph'; kind: 'slam' | 'burst'; x: number; y: number; angle: number; range: number; arc: number; sec: number }
  | { e: 'bossKilled'; rewards: { name: string; amount: number }[] }
  | { e: 'bossGone' }
  | { e: 'buildingAttacked'; id: string; x: number; y: number }
  | { e: 'buildingDestroyed'; id: string; byName: string; own: boolean }
  | { e: 'purchase'; ok: boolean; item: string; reason?: string }
  | { e: 'placed'; ok: boolean; reason?: string }
  | { e: 'notice'; text: string };

// ---------- Client -> Server ----------

export interface InputMsg {
  t: 'input';
  seq: number;
  mx: number; // -1..1
  my: number; // -1..1
  aim: number; // radians
  attack: boolean;
}

export type ClientMsg =
  | { t: 'join'; name: string }
  | InputMsg
  | { t: 'buy'; item: WeaponId | BuildingId }
  | { t: 'equip'; weapon: WeaponId }
  | { t: 'place'; building: BuildingId; x: number; y: number }
  | { t: 'ping'; ts: number };

// ---------- Server -> Client ----------

export interface WelcomeMsg {
  t: 'welcome';
  id: string;
  time: number;
  world: { size: number; safeZoneRadius: number; viewRadius: number };
  player: { speed: number; radius: number };
  weapons: Record<WeaponId, WeaponCfg>;
  buildings: Record<BuildingId, BuildingCfg>;
  maxBuildings: number;
}

export interface SnapshotMsg {
  t: 'snapshot';
  tick: number;
  time: number;
  lastSeq: number;
  add: EntityState[];
  upd: EntityDelta[];
  rem: string[];
  self: SelfState;
}

export type ServerMsg =
  | WelcomeMsg
  | SnapshotMsg
  | { t: 'event'; ev: GameEvent }
  | { t: 'pong'; ts: number }
  | { t: 'reject'; reason: string };

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

export function decode<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

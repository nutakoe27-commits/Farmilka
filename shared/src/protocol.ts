import type { EntityKind, WeaponId, MobId, BossId, BuildingId, DeathCause } from './types.js';
import type { WeaponCfg, BuildingCfg, HatCfg, HatTier } from './balance-schema.js';
import type { PrestigeCfg } from './prestige.js';

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
  bossType?: BossId;
  buildingType?: BuildingId;
  owner?: string; // owner player id (buildings, projectiles)
  value?: number; // coins
  dead?: boolean;
  /** spawn protection active */
  prot?: boolean;
  /** equipped hat id (players) */
  hat?: string | null;
  /** account prestige level (players) */
  prestige?: number;
}

export interface EntityDelta {
  id: string;
  x: number;
  y: number;
  angle?: number;
  hp?: number;
  weapon?: WeaponId;
  dead?: boolean;
  prot?: boolean;
  hat?: string | null;
  prestige?: number;
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
  hats: string[];
  hat: string | null;
  prestige: number;
  prestigeCost: number;
  food: number;
  /** seconds until food can be eaten again (0 = ready) */
  foodIn: number;
  /** seconds of spawn protection remaining */
  protIn: number;
  respawnIn?: number;
}

// ---------- Events ----------

export type GameEvent =
  | { e: 'kill'; killer: string; victim: string; weapon: string }
  | { e: 'damage'; target: string; amount: number; x: number; y: number }
  | { e: 'death'; dropped: number; respawnIn: number; cause: DeathCause }
  | { e: 'bossWarn'; boss: string; x: number; y: number; inSec: number }
  | { e: 'bossSpawned'; boss: string; x: number; y: number }
  | { e: 'bossTelegraph'; kind: 'slam' | 'burst'; x: number; y: number; angle: number; range: number; arc: number; sec: number }
  | { e: 'bossKilled'; boss: string; rewards: { name: string; amount: number }[] }
  | { e: 'bossGone'; boss: string }
  | { e: 'buildingAttacked'; id: string; x: number; y: number }
  | { e: 'buildingDestroyed'; id: string; byName: string; own: boolean }
  | { e: 'purchase'; ok: boolean; item: string; reason?: string }
  | { e: 'placed'; ok: boolean; reason?: string }
  | { e: 'heal'; amount: number }
  | { e: 'hat'; hat: string; name: string; tier: HatTier; source: 'mob' | 'boss' | 'lootbox'; dup: boolean; gold: number }
  | { e: 'lootbox'; result: 'hat' | 'gold' | 'nothing'; gold: number }
  | { e: 'prestige'; level: number; tier: string | null }
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
  | { t: 'join'; name: string; password?: string; register?: boolean; server?: number }
  | InputMsg
  | { t: 'buy'; item: WeaponId | BuildingId | 'food' }
  | { t: 'equip'; weapon: WeaponId }
  | { t: 'sell'; weapon: WeaponId }
  | { t: 'reorder'; weapons: WeaponId[] }
  | { t: 'eat' }
  | { t: 'lootbox' }
  | { t: 'prestige' }
  | { t: 'equipHat'; hat: string | null }
  | { t: 'place'; building: BuildingId; x: number; y: number }
  | { t: 'ping'; ts: number };

// ---------- Server -> Client ----------

export interface WelcomeMsg {
  t: 'welcome';
  id: string;
  time: number;
  registered: boolean;
  server: number;
  servers: { id: number; online: number; max: number }[];
  world: { size: number; viewRadius: number };
  player: { speed: number; radius: number };
  weapons: Record<WeaponId, WeaponCfg>;
  buildings: Record<BuildingId, BuildingCfg>;
  food: { heal: number; cooldownSec: number; maxCarry: number; price: number };
  hats: { items: Record<string, HatCfg>; lootboxPrice: number; dupGold: Record<HatTier, number> };
  prestige: PrestigeCfg;
  economy: { sellFrac: number };
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

import type { BuildingId } from '@shared/types.js';
import { BUILDING_IDS } from '@shared/balance-schema.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Player } from './entities.js';
import { makeBuilding, grantStarterBase } from './buildings.js';
import { loadBase, saveBase } from '../db/accounts.js';

/** One structure of a saved base, in absolute world coordinates. */
export interface SavedBuilding {
  t: BuildingId;
  x: number;
  y: number;
  /** unclaimed gold in the silo when the base was stored */
  s: number;
}

export interface SavedBase {
  buildings: SavedBuilding[];
  /** when the base was last written — used to accrue offline production */
  ts: number;
}

function isSavedBase(v: unknown): v is SavedBase {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as SavedBase;
  return Array.isArray(b.buildings) && typeof b.ts === 'number';
}

/** Snapshot of the player's standing structures, for the account record. */
export function captureBase(world: World, p: Player): SavedBase {
  const buildings: SavedBuilding[] = [];
  for (const id of p.buildingIds) {
    const b = world.buildings.get(id);
    if (!b || b.dead) continue;
    buildings.push({ t: b.buildingType, x: Math.round(b.x), y: Math.round(b.y), s: Math.round(b.stored) });
  }
  return { buildings, ts: Date.now() };
}

/** Persists the player's base so it is still there next time they log in. */
export function storeBase(world: World, p: Player): void {
  if (!p.account) return;
  try {
    saveBase(p.account, JSON.stringify(captureBase(world, p)));
  } catch (err) {
    console.error('[base] save failed', err);
  }
}

/**
 * Silos keep filling while the owner is away, so a player who has been gone a
 * while comes back to a full farm — or to the wreckage of one. Capped per
 * building so an absence of days is not a jackpot.
 */
export function accrueOffline(type: BuildingId, stored: number, awayMs: number): number {
  const cfg = getBalance().buildings[type];
  const cap = cfg.storeCap ?? 0;
  if (cap <= 0 || cfg.income <= 0 || cfg.incomeIntervalSec <= 0) return 0;
  const ticks = Math.floor(awayMs / (cfg.incomeIntervalSec * 1000));
  return Math.max(0, Math.min(cap, stored + ticks * cfg.income));
}

/**
 * Rebuilds the player's saved base into this world. Falls back to the free
 * starter base when there is nothing stored (new player, or a base that was
 * fully razed). Returns true when a stored base was restored.
 */
export function restoreBase(world: World, p: Player): boolean {
  if (!p.account) {
    grantStarterBase(world, p);
    return false;
  }
  let saved: SavedBase | null = null;
  try {
    const raw = loadBase(p.account);
    const parsed = raw ? JSON.parse(raw) : null;
    if (isSavedBase(parsed)) saved = parsed;
  } catch {
    saved = null;
  }
  if (!saved || !saved.buildings.length) {
    grantStarterBase(world, p);
    return false;
  }

  const bal = getBalance();
  const size = bal.world.size;
  const now = Date.now();
  const awayMs = Math.max(0, now - saved.ts);

  // Log the player back in at their own base rather than a random spawn — the
  // base is home, and waking up on the far side of the map makes it useless.
  const anchor = saved.buildings.find((b) => b.t === 'vault') ?? saved.buildings[0];
  if (anchor) {
    world.moveEntity(p, Math.max(60, Math.min(size - 60, anchor.x)), Math.max(60, Math.min(size - 60, anchor.y + 110)));
  }

  let placed = 0;
  for (const sb of saved.buildings) {
    if (!BUILDING_IDS.includes(sb.t)) continue;
    const cfg = bal.buildings[sb.t];
    const x = Math.max(cfg.radius, Math.min(size - cfg.radius, sb.x));
    const y = Math.max(cfg.radius, Math.min(size - cfg.radius, sb.y));
    // someone else may have built here while we were away — skip that slot
    let blocked = false;
    for (const e of world.grid.queryCircle(x, y, bal.economy.buildingMinDist)) {
      if (e.kind === 'building') { blocked = true; break; }
    }
    if (blocked) continue;
    const stored = accrueOffline(sb.t, Math.max(0, sb.s), awayMs);
    const b = makeBuilding(world, sb.t, x, y, { id: p.id, name: p.name, account: p.account }, now, stored);
    p.buildingIds.add(b.id);
    placed++;
  }
  // every slot was taken (or the save was junk) — give them a home anyway
  if (placed === 0) {
    grantStarterBase(world, p);
    return false;
  }
  // a razed base with no vault left gets one back, so banking still works
  let hasVault = false;
  for (const id of p.buildingIds) {
    if (world.buildings.get(id)?.buildingType === 'vault') { hasVault = true; break; }
  }
  if (!hasVault) {
    const cfg = bal.buildings.vault;
    const vx = Math.max(cfg.radius, Math.min(size - cfg.radius, p.x));
    const vy = Math.max(cfg.radius, Math.min(size - cfg.radius, p.y - 120));
    const b = makeBuilding(world, 'vault', vx, vy, { id: p.id, name: p.name, account: p.account }, now);
    p.buildingIds.add(b.id);
  }
  return true;
}

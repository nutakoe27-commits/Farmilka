import { getBalance } from './balance.js';
import type { World } from './world.js';
import { makeBuilding } from './buildings.js';
import { listRaidableBases } from '../db/accounts.js';
import { accrueOffline, type SavedBase } from './base.js';

/**
 * Absent players' bases, seeded into live worlds so there is always something
 * worth raiding — the whole point of the loop falls apart if the only targets
 * are the handful of people online right now.
 *
 * Rules that keep this fair:
 *  - an account's base is seeded into at most one world at a time, so two
 *    raiders in different worlds can't loot the same vault twice;
 *  - the owner's own login takes priority: when they join, their seeded base is
 *    cleared first and rebuilt as theirs (see releaseBase);
 *  - silos are pre-filled from the time the owner has been away, capped, so a
 *    long absence is a fat target but not an infinite one.
 */
const claimed = new Map<string, number>(); // account -> serverId holding its base

/** How many absent bases a single world seeds. */
const PER_WORLD = Number(process.env.OFFLINE_BASES_PER_WORLD) || 6;

/** Frees an account's base claim so its owner can rebuild it themselves. */
export function releaseBase(world: World, account: string): void {
  if (claimed.get(account) !== world.serverId) {
    claimed.delete(account);
    return;
  }
  claimed.delete(account);
  for (const b of [...world.buildings.values()]) {
    if (b.ownerAccount === account && !b.ownerId) world.removeEntity(b);
  }
}

/** Drops every claim held by a world that is being torn down. */
export function releaseWorld(world: World): void {
  for (const [account, serverId] of [...claimed]) {
    if (serverId === world.serverId) claimed.delete(account);
  }
}

function parseBase(raw: string | null): SavedBase | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SavedBase;
    return Array.isArray(v?.buildings) && v.buildings.length ? v : null;
  } catch {
    return null;
  }
}

/**
 * Tops a world up to PER_WORLD absent bases. Cheap enough to call on a slow
 * timer: it only touches the DB when the world is actually short of targets.
 */
export function seedOfflineBases(world: World, onlineAccounts: Set<string>): void {
  let present = 0;
  const here = new Set<string>();
  for (const b of world.buildings.values()) {
    if (!b.ownerId && b.ownerAccount) here.add(b.ownerAccount);
  }
  present = here.size;
  if (present >= PER_WORLD) return;

  let rows: { name: string; base: string | null }[];
  try {
    rows = listRaidableBases(PER_WORLD * 4);
  } catch {
    return;
  }

  const bal = getBalance();
  const size = bal.world.size;
  const now = Date.now();
  for (const row of rows) {
    if (present >= PER_WORLD) break;
    if (onlineAccounts.has(row.name)) continue; // they are playing — raid them for real
    if (claimed.has(row.name)) continue; // already seeded somewhere
    const saved = parseBase(row.base);
    if (!saved) continue;
    // their farms kept producing while they were gone — that stock is the prize
    const awayMs = Math.max(0, now - saved.ts);

    let placed = 0;
    for (const sb of saved.buildings) {
      const cfg = bal.buildings[sb.t];
      if (!cfg) continue;
      const x = Math.max(cfg.radius, Math.min(size - cfg.radius, sb.x));
      const y = Math.max(cfg.radius, Math.min(size - cfg.radius, sb.y));
      let blocked = false;
      for (const e of world.grid.queryCircle(x, y, bal.economy.buildingMinDist)) {
        if (e.kind === 'building') { blocked = true; break; }
      }
      if (blocked) continue;
      // ownerId is empty: nobody in this world owns it, so it is pure raid bait
      const stored = accrueOffline(sb.t, Math.max(0, sb.s), awayMs);
      makeBuilding(world, sb.t, x, y, { id: '', name: row.name, account: row.name }, now, stored);
      placed++;
    }
    if (placed > 0) {
      claimed.set(row.name, world.serverId);
      present++;
    }
  }
}

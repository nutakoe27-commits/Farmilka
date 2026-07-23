import { levelForKills } from '@shared/levels.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Player } from './entities.js';
import { recomputeMaxHp } from './hats.js';

/** Kill-points a victim is worth toward the killer's level. */
export function killPoints(kind: 'player' | 'mob' | 'boss'): number {
  return kind === 'boss' ? 3 : kind === 'player' ? 2 : 1;
}

/**
 * Credits a player with kill-points and levels them up when a threshold is
 * crossed. Levels raise max HP and outgoing damage (the damage bonus does not
 * apply against bosses — see combat). Levels are per-life and reset on death.
 */
export function awardKillPoints(world: World, p: Player, points: number): void {
  const cfg = getBalance().levels;
  if (p.dead || points <= 0) return;
  p.levelKills += points;
  const newLevel = levelForKills(p.levelKills, cfg);
  if (newLevel <= p.level) { world.markDirty(p); return; } // progress bar moved, no level gained
  const gained = newLevel - p.level;
  p.level = newLevel;
  p.hp += cfg.hpPerLevel * gained; // the freshly gained HP is immediately available
  recomputeMaxHp(world, p); // raises maxHp (folds in level + hat), clamps hp
  world.markDirty(p);
  world.sendEvent(p, { e: 'level', level: p.level, max: cfg.max });
}

import { nextLevelCost } from '@shared/levels.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Player } from './entities.js';
import { recomputeMaxHp } from './hats.js';
import { telemetry } from '../db/telemetry.js';
import { tr } from './i18n.js';

/** Gold cost for the player's NEXT level (0 = maxed out). */
export function playerLevelCost(p: Player): number {
  return nextLevelCost(p.level, getBalance().levels);
}

/**
 * Buys one character level. Flat cost, no progression. Raises max HP and
 * outgoing damage (damage bonus does not apply against bosses — see combat).
 * Levels are per-life and reset on death.
 */
export function tryBuyLevel(world: World, p: Player): { ok: boolean; reason?: string } {
  const cfg = getBalance().levels;
  if (p.dead) return { ok: false, reason: tr(p.lang, 'dead') };
  if (p.level >= cfg.max) return { ok: false, reason: tr(p.lang, 'levelMax') };
  if (p.money < cfg.cost) return { ok: false, reason: tr(p.lang, 'needGold', { n: cfg.cost }) };
  p.money -= cfg.cost;
  p.level++;
  p.hp += cfg.hpPerLevel; // the freshly gained HP is immediately available
  recomputeMaxHp(world, p); // raises maxHp (folds in level + hat), clamps hp
  world.markDirty(p);
  telemetry.purchase(p.name, 'level', cfg.cost);
  world.sendEvent(p, { e: 'level', level: p.level, max: cfg.max });
  return { ok: true };
}

import { prestigeCost, prestigeTier } from '@shared/prestige.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Player } from './entities.js';
import { telemetry } from '../db/telemetry.js';
import { tr } from './i18n.js';

/** Cost for the player's NEXT prestige level (0 = maxed out). */
export function nextPrestigeCost(p: Player): number {
  const cfg = getBalance().prestige;
  if (p.prestige >= cfg.maxLevel) return 0;
  return prestigeCost(p.prestige, cfg);
}

/**
 * Buys one prestige level. Purely a gold sink → cosmetic status; no stat effect.
 */
export function tryPrestige(world: World, p: Player): { ok: boolean; reason?: string } {
  const cfg = getBalance().prestige;
  if (p.prestige >= cfg.maxLevel) return { ok: false, reason: tr(p.lang, 'prestigeMax') };
  const cost = prestigeCost(p.prestige, cfg);
  if (p.money < cost) return { ok: false, reason: tr(p.lang, 'needGold', { n: cost }) };
  p.money -= cost;
  p.prestige++;
  world.markDirty(p);
  telemetry.purchase(p.name, 'prestige', cost);
  const tier = prestigeTier(p.prestige, cfg);
  world.sendEvent(p, { e: 'prestige', level: p.prestige, tier: tier ? tier.name : null });
  return { ok: true };
}

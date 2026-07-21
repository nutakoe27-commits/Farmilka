export interface LevelsCfg {
  /** highest reachable level (level 1 is the starting level) */
  max: number;
  /** flat gold cost of each level-up (no scaling) */
  cost: number;
  /** flat max-HP added per level above 1 */
  hpPerLevel: number;
  /** damage multiplier added per level above 1 (0.03 = +3% each) */
  damagePerLevel: number;
}

/** Bonus max HP granted by the player's current level (level 1 = 0). */
export function levelHpBonus(level: number, cfg: LevelsCfg): number {
  return (Math.max(1, level) - 1) * cfg.hpPerLevel;
}

/** Outgoing-damage multiplier from the player's current level (level 1 = 1). */
export function levelDamageMult(level: number, cfg: LevelsCfg): number {
  return 1 + (Math.max(1, level) - 1) * cfg.damagePerLevel;
}

/** Cost to advance FROM `level` to `level + 1` (0 = already maxed). Flat, no progression. */
export function nextLevelCost(level: number, cfg: LevelsCfg): number {
  return level >= cfg.max ? 0 : cfg.cost;
}

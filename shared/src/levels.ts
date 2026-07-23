export interface LevelsCfg {
  /** highest reachable level (level 1 is the starting level) */
  max: number;
  /** kill-points needed to advance one level (mob = 1, player = 2, boss = 3) */
  killsPerLevel: number;
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

/** Level reached for a given number of accumulated kill-points (per life). */
export function levelForKills(kills: number, cfg: LevelsCfg): number {
  const kpl = Math.max(1, cfg.killsPerLevel);
  return Math.min(cfg.max, 1 + Math.floor(Math.max(0, kills) / kpl));
}

/** Kill-points still needed to reach the next level (0 = already maxed). */
export function killsToNext(kills: number, cfg: LevelsCfg): number {
  const kpl = Math.max(1, cfg.killsPerLevel);
  if (levelForKills(kills, cfg) >= cfg.max) return 0;
  return kpl - (Math.max(0, kills) % kpl);
}

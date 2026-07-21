export interface PrestigeTier {
  atLevel: number;
  name: string;
  color: string; // name colour
  aura: string; // aura/glow colour
}

export interface PrestigeCfg {
  baseCost: number;
  growth: number;
  maxLevel: number;
  tiers: PrestigeTier[];
}

/** Cost of advancing FROM `level` to `level + 1`. */
export function prestigeCost(level: number, cfg: PrestigeCfg): number {
  return Math.round(cfg.baseCost * Math.pow(cfg.growth, level));
}

/** The highest tier whose threshold the player has reached (null below tier 1). */
export function prestigeTier(level: number, cfg: PrestigeCfg): PrestigeTier | null {
  let best: PrestigeTier | null = null;
  for (const t of cfg.tiers) {
    if (level >= t.atLevel && (!best || t.atLevel > best.atLevel)) best = t;
  }
  return best;
}

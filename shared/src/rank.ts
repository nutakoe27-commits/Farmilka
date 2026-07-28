/**
 * Base Rank — the long-haul progression track.
 *
 * It is earned by banking gold (lifetime deposits into your vault), so it
 * rewards exactly the loop the game is built around: haul loot home. It is
 * effectively unlimited because the requirement compounds, but every perk it
 * grants is capped and **economic only**.
 *
 * Hard rule: rank never touches HP, damage, speed, range or attack rate. Two
 * players who meet in a fight have identical combat stats no matter their
 * ranks — the veteran's edge is that they rebuild faster, hold more and lose
 * less to raiders.
 */
export interface RankCfg {
  /** lifetime banked gold needed for rank 1 */
  baseBanked: number;
  /** each rank costs this much more than the last */
  growth: number;
  siloCapPerRank: number;
  siloCapMax: number;
  productionPerRank: number;
  productionMax: number;
  /** one extra building slot every N ranks */
  ranksPerSlot: number;
  slotsMax: number;
  respawnPerRank: number;
  respawnMax: number;
  magnetPerRank: number;
  magnetMax: number;
  /** how much of the raider's vault cut is shaved off per rank */
  vaultProtPerRank: number;
  vaultProtMax: number;
}

export interface RankPerks {
  /** multiplier on every silo's capacity */
  siloCapMult: number;
  /** multiplier on production speed */
  productionMult: number;
  /** extra building slots */
  extraSlots: number;
  /** multiplier on respawn time (lower is better) */
  respawnMult: number;
  /** extra coin pickup radius */
  magnetAdd: number;
  /** absolute reduction of the vault raid fraction */
  vaultProtection: number;
}

/** Rank from lifetime banked gold. Compounding, so it never truly caps out. */
export function rankFromBanked(bankedTotal: number, cfg: RankCfg): number {
  if (bankedTotal < cfg.baseBanked || cfg.growth <= 1) return 0;
  return Math.floor(Math.log(bankedTotal / cfg.baseBanked) / Math.log(cfg.growth)) + 1;
}

/** Lifetime banked gold needed for the next rank — for the progress readout. */
export function bankedForRank(rank: number, cfg: RankCfg): number {
  if (rank <= 0) return cfg.baseBanked;
  return Math.round(cfg.baseBanked * Math.pow(cfg.growth, rank - 1));
}

/** Every perk a rank grants, each clamped to its own ceiling. */
export function rankPerks(rank: number, cfg: RankCfg): RankPerks {
  const r = Math.max(0, rank);
  return {
    siloCapMult: 1 + Math.min(cfg.siloCapMax, r * cfg.siloCapPerRank),
    productionMult: 1 + Math.min(cfg.productionMax, r * cfg.productionPerRank),
    extraSlots: Math.min(cfg.slotsMax, Math.floor(r / cfg.ranksPerSlot)),
    respawnMult: 1 - Math.min(cfg.respawnMax, r * cfg.respawnPerRank),
    magnetAdd: Math.min(cfg.magnetMax, r * cfg.magnetPerRank),
    vaultProtection: Math.min(cfg.vaultProtMax, r * cfg.vaultProtPerRank),
  };
}

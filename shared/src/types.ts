export type EntityKind = 'player' | 'mob' | 'boss' | 'projectile' | 'coin' | 'building' | 'food';

export type WeaponId =
  | 'fists' | 'sword' | 'spear' | 'hammer' | 'bow' | 'crossbow'
  | 'daggers' | 'scythe' | 'venom_blade' | 'vampire_blade' | 'triple_bow' | 'ice_staff'
  // unique lootbox-only weapons (lost on death, sellable)
  | 'hook_blade' | 'mirror_blade' | 'storm_hammer'
  | 'tamer_blade' | 'reaper_scythe' | 'dragon_bow';
export type MobId =
  | 'slime' | 'wolf'                 // normal
  | 'ice_slime' | 'yeti'             // snow
  | 'scorpion' | 'sand_golem'        // desert
  | 'shade' | 'treant'               // mystic west
  | 'wisp' | 'crystal_golem';        // mystic east
export type BossId = 'champion' | 'frost_titan' | 'sand_worm' | 'shadow_lord' | 'crystal_queen';
export type BuildingId = 'farm' | 'mine' | 'turret';

export type IncomeSource = 'mob' | 'boss' | 'building' | 'loot' | 'raid';
export type DeathCause = 'player' | 'mob' | 'boss' | 'turret';

export interface Vec2 {
  x: number;
  y: number;
}

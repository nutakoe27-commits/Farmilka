export type EntityKind = 'player' | 'mob' | 'boss' | 'projectile' | 'coin' | 'building';

export type WeaponId = 'fists' | 'sword' | 'spear' | 'hammer' | 'bow' | 'crossbow';
export type MobId = 'slime' | 'wolf' | 'golem';
export type BuildingId = 'farm' | 'mine' | 'turret';

export type IncomeSource = 'mob' | 'boss' | 'building' | 'loot' | 'raid';
export type DeathCause = 'player' | 'mob' | 'boss' | 'turret';

export interface Vec2 {
  x: number;
  y: number;
}

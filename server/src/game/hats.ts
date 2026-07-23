import type { HatTier } from '@shared/balance-schema.js';
import { levelHpBonus } from '@shared/levels.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Player } from './entities.js';
import { telemetry } from '../db/telemetry.js';
import { tr } from './i18n.js';

export interface HatEffects {
  speedMult: number;
  maxHpAdd: number;
  damageMult: number;
  foodHealMult: number;
  incomeMult: number;
  regenMult: number;
  coinMagnetAdd: number;
  foodFindMult: number;
  mobRewardMult: number;
  respawnMult: number;
  dropSaveFrac: number;
  bossDmgMult: number;
}

const NO_EFFECTS: HatEffects = {
  speedMult: 1, maxHpAdd: 0, damageMult: 1, foodHealMult: 1, incomeMult: 1, regenMult: 1,
  coinMagnetAdd: 0, foodFindMult: 1, mobRewardMult: 1, respawnMult: 1, dropSaveFrac: 0, bossDmgMult: 1,
};

export function hatEffects(hatId: string | null): HatEffects {
  if (!hatId) return NO_EFFECTS;
  const cfg = getBalance().hats.items[hatId];
  if (!cfg) return NO_EFFECTS;
  return {
    speedMult: cfg.effect.speedMult ?? 1,
    maxHpAdd: cfg.effect.maxHpAdd ?? 0,
    damageMult: cfg.effect.damageMult ?? 1,
    foodHealMult: cfg.effect.foodHealMult ?? 1,
    incomeMult: cfg.effect.incomeMult ?? 1,
    regenMult: cfg.effect.regenMult ?? 1,
    coinMagnetAdd: cfg.effect.coinMagnetAdd ?? 0,
    foodFindMult: cfg.effect.foodFindMult ?? 1,
    mobRewardMult: cfg.effect.mobRewardMult ?? 1,
    respawnMult: cfg.effect.respawnMult ?? 1,
    dropSaveFrac: cfg.effect.dropSaveFrac ?? 0,
    bossDmgMult: cfg.effect.bossDmgMult ?? 1,
  };
}

export function randomHatOfTier(tier: HatTier): string | null {
  const ids = Object.entries(getBalance().hats.items)
    .filter(([, cfg]) => cfg.tier === tier)
    .map(([id]) => id);
  if (!ids.length) return null;
  return ids[Math.floor(Math.random() * ids.length)];
}

/** Recomputes max HP from base + level bonus + equipped-hat bonus. */
export function recomputeMaxHp(world: World, p: Player): void {
  const bal = getBalance();
  const newMax = bal.player.hp + levelHpBonus(p.level, bal.levels) + hatEffects(p.hat).maxHpAdd;
  if (newMax !== p.maxHp) {
    p.maxHp = newMax;
    p.hp = Math.min(p.hp, p.maxHp);
    world.markDirty(p);
  }
}

/**
 * Gives a hat to the player. Duplicates convert to gold based on the tier.
 */
export function grantHat(world: World, p: Player, hatId: string, source: 'mob' | 'boss' | 'lootbox'): void {
  const bal = getBalance();
  const cfg = bal.hats.items[hatId];
  if (!cfg) return;
  const dup = p.hats.includes(hatId);
  if (dup) {
    const gold = bal.hats.dupGold[cfg.tier];
    p.money += gold;
    p.session.moneyEarned += gold;
    telemetry.income(p.name, 'loot', gold);
    world.sendEvent(p, { e: 'hat', hat: hatId, name: cfg.name, tier: cfg.tier, source, dup: true, gold });
  } else {
    p.hats.push(hatId);
    world.sendEvent(p, { e: 'hat', hat: hatId, name: cfg.name, tier: cfg.tier, source, dup: false, gold: 0 });
  }
  telemetry.purchase(p.name, `hat:${hatId}${dup ? ':dup' : ''}`, 0);
}

export function tryEquipHat(world: World, p: Player, hatId: string | null): void {
  if (hatId !== null && !p.hats.includes(hatId)) return;
  if (p.hat === hatId) return;
  p.hat = hatId;
  recomputeMaxHp(world, p);
  world.markDirty(p);
}

export function tryLootbox(world: World, p: Player): { ok: boolean; reason?: string } {
  const bal = getBalance();
  if (p.money < bal.hats.lootboxPrice) return { ok: false, reason: tr(p.lang, 'noMoney') };
  p.money -= bal.hats.lootboxPrice;
  telemetry.purchase(p.name, 'lootbox', bal.hats.lootboxPrice);

  const roll = Math.random();
  const lb = bal.hats.lootbox;
  if (roll < lb.legendaryChance) {
    const hat = randomHatOfTier('legendary');
    if (hat) grantHat(world, p, hat, 'lootbox');
  } else if (roll < lb.legendaryChance + lb.epicChance) {
    const hat = randomHatOfTier('epic');
    if (hat) grantHat(world, p, hat, 'lootbox');
  } else if (roll < lb.legendaryChance + lb.epicChance + lb.goldChance) {
    const gold = Math.round(lb.goldMin + Math.random() * (lb.goldMax - lb.goldMin));
    p.money += gold;
    p.session.moneyEarned += gold;
    telemetry.income(p.name, 'loot', gold);
    world.sendEvent(p, { e: 'lootbox', result: 'gold', gold });
  } else {
    world.sendEvent(p, { e: 'lootbox', result: 'nothing', gold: 0 });
  }
  return { ok: true };
}

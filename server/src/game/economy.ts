import { dist } from '@shared/math.js';
import type { WeaponId, BuildingId } from '@shared/types.js';
import { WEAPON_IDS } from '@shared/balance-schema.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Player } from './entities.js';
import { telemetry } from '../db/telemetry.js';
import { hatEffects } from './hats.js';
import { perksOf } from './buildings.js';
import { tr } from './i18n.js';

export function tryBuyWeapon(world: World, p: Player, item: WeaponId): { ok: boolean; reason?: string } {
  const bal = getBalance();
  if (!WEAPON_IDS.includes(item)) return { ok: false, reason: tr(p.lang, 'unknownItem') };
  // unique weapons never sell in the shop — weapon lootbox only
  if (bal.weapons[item].tier) return { ok: false, reason: tr(p.lang, 'uniqueNoBuy') };
  // buying is allowed while dead (stock up during the respawn break)
  if (p.weapons.includes(item)) return { ok: false, reason: tr(p.lang, 'owned') };
  if (p.weapons.length >= 4) return { ok: false, reason: tr(p.lang, 'hotbarFull') };
  const cfg = bal.weapons[item];
  if (p.money < cfg.price) return { ok: false, reason: tr(p.lang, 'noMoney') };
  p.money -= cfg.price;
  p.weapons.push(item);
  p.equipped = item;
  world.markDirty(p);
  if (!p.bot) telemetry.purchase(p.name, item, cfg.price);
  return { ok: true };
}

export function tryBuyFood(world: World, p: Player): { ok: boolean; reason?: string } {
  const bal = getBalance();
  if (p.food >= bal.food.maxCarry) return { ok: false, reason: tr(p.lang, 'maxFood', { n: bal.food.maxCarry }) };
  if (p.money < bal.food.price) return { ok: false, reason: tr(p.lang, 'noMoney') };
  p.money -= bal.food.price;
  p.food++;
  if (!p.bot) telemetry.purchase(p.name, 'food', bal.food.price);
  return { ok: true };
}

export function trySellWeapon(world: World, p: Player, weapon: WeaponId): { ok: boolean; reason?: string } {
  const bal = getBalance();
  if (weapon === 'fists') return { ok: false, reason: tr(p.lang, 'fistsNoSell') };
  const idx = p.weapons.indexOf(weapon);
  if (idx < 0) return { ok: false, reason: tr(p.lang, 'noWeapon') };
  const cfg = bal.weapons[weapon];
  // unique weapons carry their own (higher) sell price
  const refund = cfg.sellPrice ?? Math.floor(cfg.price * bal.economy.sellFrac);
  p.weapons.splice(idx, 1);
  if (p.equipped === weapon) p.equipped = 'fists';
  p.money += refund;
  world.markDirty(p);
  if (!p.bot) telemetry.purchase(p.name, `sell:${weapon}`, -refund);
  return { ok: true };
}

function grantWeaponLoot(world: World, p: Player, id: WeaponId, tier: 'epic' | 'legendary' | undefined): void {
  const bal = getBalance();
  const cfg = bal.weapons[id];
  const sellValue = cfg.sellPrice ?? Math.floor(cfg.price * bal.economy.sellFrac);
  // duplicate or full hotbar: convert to the weapon's sell value
  if (p.weapons.includes(id) || p.weapons.length >= 4) {
    p.money += sellValue;
    p.session.moneyEarned += sellValue;
    if (!p.bot) telemetry.income(p.name, 'loot', sellValue);
    world.sendEvent(p, { e: 'weaponLoot', result: 'gold', weapon: id, tier, gold: sellValue });
    return;
  }
  p.weapons.push(id);
  p.equipped = id;
  world.markDirty(p);
  if (!p.bot) telemetry.purchase(p.name, `wloot:${id}`, 0);
  world.sendEvent(p, { e: 'weaponLoot', result: tier ? 'unique' : 'weapon', weapon: id, tier, gold: 0 });
}

function randomWeaponOfTier(tier: 'epic' | 'legendary' | null): WeaponId | null {
  const bal = getBalance();
  const ids = WEAPON_IDS.filter((id) => {
    const cfg = bal.weapons[id];
    return tier ? cfg.tier === tier : !cfg.tier && cfg.price > 0;
  });
  if (!ids.length) return null;
  return ids[Math.floor(Math.random() * ids.length)];
}

/**
 * Weapon lootbox: unique epic/legendary weapons (tier chance = the total,
 * split across that tier's uniques), a random shop weapon, gold, or nothing.
 */
export function tryWeaponLootbox(world: World, p: Player): { ok: boolean; reason?: string } {
  const bal = getBalance();
  const lb = bal.weaponLootbox;
  if (p.money < lb.price) return { ok: false, reason: tr(p.lang, 'noMoney') };
  p.money -= lb.price;
  if (!p.bot) telemetry.purchase(p.name, 'weaponLootbox', lb.price);

  let roll = Math.random();
  if (roll < lb.legendaryChance) {
    const id = randomWeaponOfTier('legendary');
    if (id) grantWeaponLoot(world, p, id, 'legendary');
    return { ok: true };
  }
  roll -= lb.legendaryChance;
  if (roll < lb.epicChance) {
    const id = randomWeaponOfTier('epic');
    if (id) grantWeaponLoot(world, p, id, 'epic');
    return { ok: true };
  }
  roll -= lb.epicChance;
  if (roll < lb.weaponChance) {
    const id = randomWeaponOfTier(null);
    if (id) grantWeaponLoot(world, p, id, undefined);
    return { ok: true };
  }
  roll -= lb.weaponChance;
  if (roll < lb.goldChance) {
    const gold = Math.round(lb.goldMin + Math.random() * (lb.goldMax - lb.goldMin));
    p.money += gold;
    p.session.moneyEarned += gold;
    if (!p.bot) telemetry.income(p.name, 'loot', gold);
    world.sendEvent(p, { e: 'weaponLoot', result: 'gold', gold });
    return { ok: true };
  }
  world.sendEvent(p, { e: 'weaponLoot', result: 'nothing', gold: 0 });
  return { ok: true };
}

/** Reorders the hotbar; the new order must be a permutation of currently owned weapons. */
export function tryReorder(world: World, p: Player, order: WeaponId[]): void {
  if (!Array.isArray(order) || order.length !== p.weapons.length) return;
  const owned = [...p.weapons].sort();
  const proposed = [...order].sort();
  for (let i = 0; i < owned.length; i++) {
    if (owned[i] !== proposed[i]) return;
  }
  p.weapons = [...order];
}

export function tryEat(world: World, p: Player, now: number): void {
  const bal = getBalance();
  if (p.dead || p.food <= 0 || now < p.foodReadyAt || p.hp >= p.maxHp) return;
  p.food--;
  p.foodReadyAt = now + bal.food.cooldownSec * 1000;
  const healed = Math.min(bal.food.heal * hatEffects(p.hat).foodHealMult, p.maxHp - p.hp);
  p.hp += healed;
  world.markDirty(p);
  if (!p.bot) telemetry.heal(p.name, healed);
  world.sendEvent(p, { e: 'heal', amount: Math.round(healed) });
}

export function tryEquip(world: World, p: Player, weapon: WeaponId): void {
  if (p.weapons.includes(weapon) && p.equipped !== weapon) {
    p.equipped = weapon;
    world.markDirty(p);
  }
}

/** Coin/food despawn + pickup by nearby players. */
export function updateCoins(world: World, now: number): void {
  const bal = getBalance();
  for (const coin of [...world.coins.values()]) {
    if (now >= coin.despawnAt) world.removeEntity(coin);
  }
  for (const food of [...world.foods.values()]) {
    if (now >= food.despawnAt) world.removeEntity(food);
  }
  for (const p of world.players.values()) {
    if (p.dead || (!p.ws && !p.bot)) continue;
    const magnet = hatEffects(p.hat).coinMagnetAdd + perksOf(p).magnetAdd;
    const pickupR = Math.max(bal.economy.coinPickupRadius + magnet, bal.food.pickupRadius);
    const near = world.grid.queryCircle(p.x, p.y, pickupR + 20);
    for (const e of near) {
      if (e.dead) continue;
      if (e.kind === 'coin') {
        if (dist(p.x, p.y, e.x, e.y) > bal.economy.coinPickupRadius + magnet + p.radius) continue;
        world.removeEntity(e);
        e.dead = true;
        p.money += e.value;
        p.session.moneyEarned += e.value;
        if (!p.bot) telemetry.income(p.name, 'loot', e.value);
      } else if (e.kind === 'food') {
        if (p.food >= bal.food.maxCarry) continue;
        if (dist(p.x, p.y, e.x, e.y) > bal.food.pickupRadius + p.radius) continue;
        world.removeEntity(e);
        e.dead = true;
        p.food++;
      }
    }
  }
}

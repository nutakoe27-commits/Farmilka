import { dist } from '@shared/math.js';
import type { WeaponId, BuildingId } from '@shared/types.js';
import { WEAPON_IDS } from '@shared/balance-schema.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Player } from './entities.js';
import { telemetry } from '../db/telemetry.js';
import { hatEffects } from './hats.js';

export function tryBuyWeapon(world: World, p: Player, item: WeaponId): { ok: boolean; reason?: string } {
  const bal = getBalance();
  if (!WEAPON_IDS.includes(item)) return { ok: false, reason: 'Неизвестный предмет' };
  if (p.dead) return { ok: false, reason: 'Вы мертвы' };
  if (p.weapons.includes(item)) return { ok: false, reason: 'Уже куплено' };
  if (p.weapons.length >= 4) return { ok: false, reason: 'Хотбар заполнен (кулаки + 3 оружия)' };
  const cfg = bal.weapons[item];
  if (p.money < cfg.price) return { ok: false, reason: 'Недостаточно денег' };
  p.money -= cfg.price;
  p.weapons.push(item);
  p.equipped = item;
  world.markDirty(p);
  telemetry.purchase(p.name, item, cfg.price);
  return { ok: true };
}

export function tryBuyFood(world: World, p: Player): { ok: boolean; reason?: string } {
  const bal = getBalance();
  if (p.dead) return { ok: false, reason: 'Вы мертвы' };
  if (p.food >= bal.food.maxCarry) return { ok: false, reason: `Максимум еды: ${bal.food.maxCarry}` };
  if (p.money < bal.food.price) return { ok: false, reason: 'Недостаточно денег' };
  p.money -= bal.food.price;
  p.food++;
  telemetry.purchase(p.name, 'food', bal.food.price);
  return { ok: true };
}

export function trySellWeapon(world: World, p: Player, weapon: WeaponId): { ok: boolean; reason?: string } {
  const bal = getBalance();
  if (p.dead) return { ok: false, reason: 'Вы мертвы' };
  if (weapon === 'fists') return { ok: false, reason: 'Кулаки не продаются' };
  const idx = p.weapons.indexOf(weapon);
  if (idx < 0) return { ok: false, reason: 'У вас нет этого оружия' };
  const refund = Math.floor(bal.weapons[weapon].price * bal.economy.sellFrac);
  p.weapons.splice(idx, 1);
  if (p.equipped === weapon) p.equipped = 'fists';
  p.money += refund;
  world.markDirty(p);
  telemetry.purchase(p.name, `sell:${weapon}`, -refund);
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
  telemetry.heal(p.name, healed);
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
    if (p.dead || !p.ws) continue;
    const magnet = hatEffects(p.hat).coinMagnetAdd;
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
        telemetry.income(p.name, 'loot', e.value);
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

import { dist } from '@shared/math.js';
import type { WeaponId, BuildingId } from '@shared/types.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Player } from './entities.js';
import { telemetry } from '../db/telemetry.js';

const WEAPON_IDS: WeaponId[] = ['fists', 'sword', 'spear', 'hammer', 'bow', 'crossbow'];

export function tryBuyWeapon(world: World, p: Player, item: WeaponId): { ok: boolean; reason?: string } {
  const bal = getBalance();
  if (!WEAPON_IDS.includes(item)) return { ok: false, reason: 'Неизвестный предмет' };
  if (p.dead) return { ok: false, reason: 'Вы мертвы' };
  if (!world.inSafeZone(p.x, p.y)) return { ok: false, reason: 'Покупки только в безопасной зоне' };
  if (p.weapons.includes(item)) return { ok: false, reason: 'Уже куплено' };
  if (p.weapons.length >= 4) return { ok: false, reason: 'Хотбар заполнен (кулаки + 3 оружия)' };
  const cfg = bal.weapons[item];
  if (p.money < cfg.price) return { ok: false, reason: 'Недостаточно денег' };
  p.money -= cfg.price;
  p.weapons.push(item);
  p.equipped = item;
  p.dirtyTick = world.tickNo;
  telemetry.purchase(p.name, item, cfg.price);
  return { ok: true };
}

export function tryEquip(world: World, p: Player, weapon: WeaponId): void {
  if (p.weapons.includes(weapon) && p.equipped !== weapon) {
    p.equipped = weapon;
    p.dirtyTick = world.tickNo;
  }
}

/** Coin despawn + pickup by nearby players. */
export function updateCoins(world: World, now: number): void {
  const bal = getBalance();
  for (const coin of [...world.coins.values()]) {
    if (now >= coin.despawnAt) {
      world.removeEntity(coin);
      continue;
    }
  }
  for (const p of world.players.values()) {
    if (p.dead || !p.ws) continue;
    const near = world.grid.queryCircle(p.x, p.y, bal.economy.coinPickupRadius + 20);
    for (const e of near) {
      if (e.kind !== 'coin' || e.dead) continue;
      if (dist(p.x, p.y, e.x, e.y) > bal.economy.coinPickupRadius + p.radius) continue;
      e.dead = true;
      world.removeEntity(e);
      p.money += e.value;
      p.session.moneyEarned += e.value;
      telemetry.income(p.name, 'loot', e.value);
    }
  }
}

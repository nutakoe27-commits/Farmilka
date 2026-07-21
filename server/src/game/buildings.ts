import { dist } from '@shared/math.js';
import type { BuildingId } from '@shared/types.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Building, Player } from './entities.js';
import { telemetry } from '../db/telemetry.js';

const BUILDING_IDS: BuildingId[] = ['farm', 'mine', 'turret'];
const PLACE_RANGE = 300;

export function tryPlaceBuilding(world: World, p: Player, type: BuildingId, x: number, y: number): { ok: boolean; reason?: string } {
  const bal = getBalance();
  if (!BUILDING_IDS.includes(type)) return { ok: false, reason: 'Неизвестная постройка' };
  if (p.dead) return { ok: false, reason: 'Вы мертвы' };
  const cfg = bal.buildings[type];
  if (p.money < cfg.price) return { ok: false, reason: 'Недостаточно денег' };
  if (p.buildingIds.size >= bal.economy.maxBuildingsPerPlayer) {
    return { ok: false, reason: `Лимит построек: ${bal.economy.maxBuildingsPerPlayer}` };
  }
  const size = bal.world.size;
  if (x < cfg.radius || y < cfg.radius || x > size - cfg.radius || y > size - cfg.radius) {
    return { ok: false, reason: 'За границей мира' };
  }
  if (dist(p.x, p.y, x, y) > PLACE_RANGE) return { ok: false, reason: 'Слишком далеко от вас' };
  const c = world.center;
  if (dist(x, y, c, c) < bal.world.safeZoneRadius + bal.economy.buildingSafeZoneDist) {
    return { ok: false, reason: 'Слишком близко к безопасной зоне' };
  }
  for (const b of world.grid.queryCircle(x, y, bal.economy.buildingMinDist + 50)) {
    if (b.kind === 'building' && dist(x, y, b.x, b.y) < bal.economy.buildingMinDist) {
      return { ok: false, reason: 'Слишком близко к другой постройке' };
    }
  }

  p.money -= cfg.price;
  const now = Date.now();
  const building: Building = {
    id: world.id('bd'),
    kind: 'building',
    buildingType: type,
    x,
    y,
    angle: 0,
    radius: cfg.radius,
    hp: cfg.hp,
    maxHp: cfg.hp,
    dead: false,
    cell: -1,
    movedTick: world.tickNo,
    dirtyTick: world.tickNo,
    ownerId: p.id,
    ownerName: p.name,
    incomeAt: now + cfg.incomeIntervalSec * 1000,
    attackReadyAt: 0,
    lastAlertAt: 0,
    ownerOfflineAt: 0,
  };
  world.addEntity(building);
  p.buildingIds.add(building.id);
  telemetry.purchase(p.name, type, cfg.price);
  return { ok: true };
}

export function updateBuildings(world: World, dt: number, now: number): void {
  const bal = getBalance();
  for (const b of [...world.buildings.values()]) {
    const cfg = bal.buildings[b.buildingType];
    const owner = world.players.get(b.ownerId);
    const online = !!(owner && owner.ws);

    // despawn long-abandoned buildings
    if (!online) {
      if (b.ownerOfflineAt === 0) b.ownerOfflineAt = now;
      if (now - b.ownerOfflineAt > bal.economy.ownerOfflineDespawnSec * 1000) {
        world.removeEntity(b);
        if (owner) {
          owner.buildingIds.delete(b.id);
          world.maybeForgetPlayer(owner);
        }
        continue;
      }
    } else {
      b.ownerOfflineAt = 0;
    }

    // passive income (owner must be online)
    if (cfg.income > 0 && online && now >= b.incomeAt) {
      b.incomeAt = now + cfg.incomeIntervalSec * 1000;
      owner!.money += cfg.income;
      owner!.session.moneyEarned += cfg.income;
      telemetry.income(owner!.name, 'building', cfg.income);
    }

    // turret AI
    if (cfg.damage && cfg.range && cfg.attackRate && now >= b.attackReadyAt) {
      let best: Player | null = null;
      let bestD = Infinity;
      for (const e of world.grid.queryCircle(b.x, b.y, cfg.range)) {
        if (e.kind !== 'player' || e.dead || e.id === b.ownerId || world.inSafeZone(e.x, e.y)) continue;
        const d = dist(b.x, b.y, e.x, e.y);
        if (d < bestD) {
          best = e;
          bestD = d;
        }
      }
      if (best) {
        b.attackReadyAt = now + 1000 / cfg.attackRate;
        const ang = Math.atan2(best.y - b.y, best.x - b.x);
        b.angle = ang;
        b.movedTick = world.tickNo;
        world.spawnProjectile(b.ownerId, 'turret', 'turret', b.x + Math.cos(ang) * (b.radius + 10), b.y + Math.sin(ang) * (b.radius + 10), ang, cfg.projSpeed ?? 700, cfg.damage, cfg.range + 100);
      }
    }
  }
}

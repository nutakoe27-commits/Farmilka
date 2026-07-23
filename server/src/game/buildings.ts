import { dist } from '@shared/math.js';
import type { BuildingId } from '@shared/types.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Building, Player, Entity } from './entities.js';
import { telemetry } from '../db/telemetry.js';
import { hatEffects } from './hats.js';
import { tr } from './i18n.js';

const BUILDING_IDS: BuildingId[] = ['farm', 'mine', 'turret'];
const PLACE_RANGE = 300;

export function tryPlaceBuilding(world: World, p: Player, type: BuildingId, x: number, y: number): { ok: boolean; reason?: string } {
  const bal = getBalance();
  if (!BUILDING_IDS.includes(type)) return { ok: false, reason: tr(p.lang, 'unknownBuilding') };
  if (p.dead) return { ok: false, reason: tr(p.lang, 'dead') };
  const cfg = bal.buildings[type];
  if (p.money < cfg.price) return { ok: false, reason: tr(p.lang, 'noMoney') };
  if (p.buildingIds.size >= bal.economy.maxBuildingsPerPlayer) {
    return { ok: false, reason: tr(p.lang, 'buildLimit', { n: bal.economy.maxBuildingsPerPlayer }) };
  }
  if (type === 'turret') {
    let turrets = 0;
    for (const id of p.buildingIds) { const bd = world.buildings.get(id); if (bd && bd.buildingType === 'turret') turrets++; }
    if (turrets >= bal.economy.maxTurretsPerPlayer) {
      return { ok: false, reason: tr(p.lang, 'turretLimit', { n: bal.economy.maxTurretsPerPlayer }) };
    }
  }
  const size = bal.world.size;
  if (x < cfg.radius || y < cfg.radius || x > size - cfg.radius || y > size - cfg.radius) {
    return { ok: false, reason: tr(p.lang, 'outOfWorld') };
  }
  if (dist(p.x, p.y, x, y) > PLACE_RANGE) return { ok: false, reason: tr(p.lang, 'tooFar') };
  for (const b of world.grid.queryCircle(x, y, bal.economy.buildingMinDist + 50)) {
    if (b.kind === 'building' && dist(x, y, b.x, b.y) < bal.economy.buildingMinDist) {
      return { ok: false, reason: tr(p.lang, 'tooClose') };
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
  if (!p.bot) telemetry.purchase(p.name, type, cfg.price);
  return { ok: true };
}

/** Removes every building the player owns — called when they disconnect. */
export function removePlayerBuildings(world: World, p: Player): void {
  for (const id of [...p.buildingIds]) {
    const b = world.buildings.get(id);
    if (b) world.removeEntity(b);
  }
  p.buildingIds.clear();
}

export function updateBuildings(world: World, dt: number, now: number): void {
  const bal = getBalance();
  for (const b of [...world.buildings.values()]) {
    const cfg = bal.buildings[b.buildingType];
    const owner = world.players.get(b.ownerId);
    const online = !!(owner && owner.ws);

    // passive income (owner must be online)
    if (cfg.income > 0 && online && now >= b.incomeAt) {
      b.incomeAt = now + cfg.incomeIntervalSec * 1000;
      const income = Math.round(cfg.income * hatEffects(owner!.hat).incomeMult);
      owner!.money += income;
      owner!.session.moneyEarned += income;
      if (!owner!.bot) telemetry.income(owner!.name, 'building', income);
    }

    // turret AI — fires at the nearest hostile: players, mobs and bosses alike
    if (cfg.damage && cfg.range && cfg.attackRate && now >= b.attackReadyAt) {
      let best: Entity | null = null;
      let bestD = Infinity;
      for (const e of world.grid.queryCircle(b.x, b.y, cfg.range)) {
        if (e.dead || e.id === b.ownerId) continue;
        if (e.kind !== 'player' && e.kind !== 'mob' && e.kind !== 'boss') continue;
        if (e.kind === 'player' && (e as Player).invulnUntil > now) continue; // don't waste shots on protected spawns
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

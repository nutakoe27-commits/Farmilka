import { dist } from '@shared/math.js';
import type { BuildingId } from '@shared/types.js';
import { BUILDING_IDS } from '@shared/balance-schema.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Building, Player, Entity } from './entities.js';
import { telemetry } from '../db/telemetry.js';
import { hatEffects } from './hats.js';
import { tr } from './i18n.js';

const PLACE_RANGE = 300;
/** How close the owner must be to scoop a silo / bank at the vault. */
const COLLECT_RANGE = 70;

/** The vault is granted with the starter base and cannot be bought again. */
const FREE_BUILDINGS: BuildingId[] = ['vault'];

export function makeBuilding(
  world: World,
  type: BuildingId,
  x: number,
  y: number,
  owner: { id: string; name: string; account: string | null },
  now: number,
  stored = 0,
): Building {
  const cfg = getBalance().buildings[type];
  const b: Building = {
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
    ownerId: owner.id,
    ownerName: owner.name,
    ownerAccount: owner.account,
    incomeAt: now + cfg.incomeIntervalSec * 1000,
    stored,
    attackReadyAt: 0,
    lastAlertAt: 0,
    ownerOfflineAt: 0,
  };
  world.addEntity(b);
  return b;
}

export function tryPlaceBuilding(world: World, p: Player, type: BuildingId, x: number, y: number): { ok: boolean; reason?: string } {
  const bal = getBalance();
  if (!BUILDING_IDS.includes(type)) return { ok: false, reason: tr(p.lang, 'unknownBuilding') };
  if (FREE_BUILDINGS.includes(type)) return { ok: false, reason: tr(p.lang, 'vaultOnlyOne') };
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
  world.markDirty(p);
  const b = makeBuilding(world, type, x, y, { id: p.id, name: p.name, account: p.account }, Date.now());
  p.buildingIds.add(b.id);
  if (!p.bot) telemetry.purchase(p.name, type, cfg.price);
  return { ok: true };
}

/**
 * Grants the free starter base — a vault plus one farm — so a new player has
 * something to defend within seconds of spawning instead of an empty field.
 */
export function grantStarterBase(world: World, p: Player): void {
  const bal = getBalance();
  const size = bal.world.size;
  const now = Date.now();
  const spots: { type: BuildingId; dx: number; dy: number }[] = [
    { type: 'vault', dx: 0, dy: -120 },
    { type: 'farm', dx: 130, dy: 40 },
  ];
  for (const spot of spots) {
    const cfg = bal.buildings[spot.type];
    const x = Math.max(cfg.radius, Math.min(size - cfg.radius, p.x + spot.dx));
    const y = Math.max(cfg.radius, Math.min(size - cfg.radius, p.y + spot.dy));
    // don't stack on top of someone else's base
    let blocked = false;
    for (const e of world.grid.queryCircle(x, y, bal.economy.buildingMinDist)) {
      if (e.kind === 'building') { blocked = true; break; }
    }
    if (blocked) continue;
    const b = makeBuilding(world, spot.type, x, y, { id: p.id, name: p.name, account: p.account }, now);
    p.buildingIds.add(b.id);
  }
}

/** The player's own vault in this world, if it still stands. */
export function findVault(world: World, p: Player): Building | null {
  for (const id of p.buildingIds) {
    const b = world.buildings.get(id);
    if (b && b.buildingType === 'vault') return b;
  }
  return null;
}

/** Moves all carried gold into the vault. Returns the amount banked. */
export function depositAll(world: World, p: Player): number {
  const amount = Math.floor(p.money);
  if (amount <= 0) return 0;
  p.money -= amount;
  p.banked += amount;
  world.markDirty(p);
  world.sendEvent(p, { e: 'bank', action: 'deposit', amount, banked: p.banked });
  return amount;
}

/** Takes everything back out of the vault; only allowed next to it. */
export function tryWithdraw(world: World, p: Player): { ok: boolean; reason?: string } {
  if (p.banked <= 0) return { ok: false, reason: tr(p.lang, 'vaultEmpty') };
  const vault = findVault(world, p);
  if (!vault || dist(p.x, p.y, vault.x, vault.y) > vault.radius + COLLECT_RANGE) {
    return { ok: false, reason: tr(p.lang, 'notAtVault') };
  }
  const amount = Math.floor(p.banked);
  p.banked -= amount;
  p.money += amount;
  world.markDirty(p);
  world.sendEvent(p, { e: 'bank', action: 'withdraw', amount, banked: p.banked });
  return { ok: true };
}

/** Removes every building the player owns — used when a base is abandoned. */
export function removePlayerBuildings(world: World, p: Player): void {
  for (const id of [...p.buildingIds]) {
    const b = world.buildings.get(id);
    if (b) world.removeEntity(b);
  }
  p.buildingIds.clear();
}

/**
 * Drops what a destroyed building was holding. Producers spill their silo,
 * the vault spills a slice of the owner's banked gold, and every structure
 * leaves some scrap. Returns the total dropped, for the raid notification.
 */
export function lootFromDestroyed(world: World, b: Building, owner: Player | undefined): number {
  const bal = getBalance();
  const cfg = bal.buildings[b.buildingType];
  let loot = Math.floor(cfg.price * bal.economy.raidLootFrac);
  loot += Math.floor(b.stored);
  b.stored = 0;
  if (b.buildingType === 'vault' && owner) {
    const taken = Math.floor(owner.banked * bal.economy.vaultRaidFrac);
    if (taken > 0) {
      owner.banked -= taken;
      loot += taken;
      world.markDirty(owner);
    }
  }
  return loot;
}

export function updateBuildings(world: World, dt: number, now: number): void {
  const bal = getBalance();
  for (const b of [...world.buildings.values()]) {
    const cfg = bal.buildings[b.buildingType];
    const owner = world.players.get(b.ownerId);

    // Producers fill their own silo whether or not the owner is online — that
    // stock is exactly what a raider comes for, and what the owner rushes back
    // to collect.
    if (cfg.income > 0 && now >= b.incomeAt) {
      b.incomeAt = now + cfg.incomeIntervalSec * 1000;
      const cap = cfg.storeCap ?? 0;
      if (b.stored < cap) {
        const mult = owner ? hatEffects(owner.hat).incomeMult : 1;
        b.stored = Math.min(cap, b.stored + cfg.income * mult);
        b.dirtyTick = world.tickNo;
      }
    }

    // owner nearby: scoop the silo, or bank everything at the vault
    if (owner && !owner.dead && (owner.ws || owner.bot) && dist(owner.x, owner.y, b.x, b.y) <= b.radius + COLLECT_RANGE) {
      if (b.stored >= 1) {
        const take = Math.floor(b.stored);
        b.stored -= take;
        b.dirtyTick = world.tickNo;
        owner.money += take;
        owner.session.moneyEarned += take;
        world.markDirty(owner);
        if (!owner.bot) telemetry.income(owner.name, 'building', take);
        world.sendEvent(owner, { e: 'collect', amount: take, x: b.x, y: b.y });
      }
      if (b.buildingType === 'vault' && owner.money > 0) depositAll(world, owner);
    }

    // turret AI — keeps firing even while the owner is away; it is the base's guard
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

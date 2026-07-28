import { dist } from '@shared/math.js';
import type { BuildingId } from '@shared/types.js';
import { BUILDING_IDS } from '@shared/balance-schema.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Building, Player, Entity } from './entities.js';
import { telemetry } from '../db/telemetry.js';
import { hatEffects } from './hats.js';
import { tr } from './i18n.js';
import { biomeAt } from '@shared/biomes.js';
import { rankFromBanked, rankPerks } from '@shared/rank.js';
import type { Solid } from '@shared/collision.js';

/** Base Rank perks for a player (rank 0 for guests, who have no account). */
export function perksOf(p: Player | undefined) {
  const cfg = getBalance().rank;
  return rankPerks(p ? rankFromBanked(p.bankedTotal, cfg) : 0, cfg);
}

/** Farms out in the mystic biomes produce more — that is what pulls bases there. */
function biomeBonus(x: number, y: number): number {
  const b = biomeAt(x, y, getBalance().world.size);
  return b === 'mystic_west' || b === 'mystic_east' ? getBalance().economy.dangerBiomeMult : 1;
}

/** Silo capacity for a building, widened by its owner's rank. */
export function siloCap(b: Building, owner: Player | undefined): number {
  const cap = getBalance().buildings[b.buildingType].storeCap ?? 0;
  return cap * perksOf(owner).siloCapMult;
}

const PLACE_RANGE = 300;
/** How close the owner must be to scoop a silo / bank at the vault. */
const COLLECT_RANGE = 70;

/** The vault is granted with the starter base and cannot be bought again. */
const FREE_BUILDINGS: BuildingId[] = ['vault'];

/**
 * Required centre-to-centre distance between two buildings.
 *
 * Walls only work as walls if they can be laid shoulder-to-shoulder, so a
 * player's own wall may sit right against another of their structures — just
 * not overlapping it. Everything else (and anything next to a *stranger's*
 * building) keeps the wide spacing, which also stops anyone from bricking up
 * someone else's base from the outside.
 */
export function minSpacing(a: BuildingId, b: BuildingId, sameOwner: boolean): number {
  const bal = getBalance();
  if (sameOwner && (a === 'wall' || b === 'wall')) {
    return bal.buildings[a].radius + bal.buildings[b].radius;
  }
  return bal.economy.buildingMinDist;
}

/** Widest spacing any pair can demand — the query radius for placement checks. */
function maxSpacing(): number {
  const bal = getBalance();
  let r = bal.economy.buildingMinDist;
  for (const id of BUILDING_IDS) r = Math.max(r, bal.buildings[id].radius * 2);
  return r;
}

/**
 * Who a structure belongs to, for spacing purposes. Seeded absent bases have
 * no live owner entity, so they fall back to the account name — otherwise
 * every unowned base in the world would count as one big estate.
 */
export function ownerKey(b: Building): string {
  return b.ownerId || (b.ownerAccount ? `acc:${b.ownerAccount}` : '');
}

/**
 * Is there room for a `type` building at (x, y)? `owner` is the placer's owner
 * key; `ignoreOwn` skips their existing structures entirely — used when a
 * saved base is rebuilt, so its own tightly-packed walls don't block each other.
 */
export function canPlaceAt(world: World, type: BuildingId, x: number, y: number, owner: string, ignoreOwn = false): boolean {
  for (const e of world.grid.queryCircle(x, y, maxSpacing())) {
    if (e.kind !== 'building') continue;
    const b = e as Building;
    const same = ownerKey(b) === owner;
    if (same && ignoreOwn) continue;
    if (dist(x, y, b.x, b.y) < minSpacing(type, b.buildingType, same)) return false;
  }
  return true;
}

/** Walls are fortification, not economy — they run on their own budget. */
export function countBuildings(world: World, p: Player): { walls: number; other: number; turrets: number } {
  let walls = 0, other = 0, turrets = 0;
  for (const id of p.buildingIds) {
    const b = world.buildings.get(id);
    if (!b) continue;
    if (b.buildingType === 'wall') walls++;
    else other++;
    if (b.buildingType === 'turret') turrets++;
  }
  return { walls, other, turrets };
}

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
  const owned = countBuildings(world, p);
  if (type === 'wall') {
    if (owned.walls >= bal.economy.maxWallsPerPlayer) {
      return { ok: false, reason: tr(p.lang, 'wallLimit', { n: bal.economy.maxWallsPerPlayer }) };
    }
  } else {
    const slots = bal.economy.maxBuildingsPerPlayer + perksOf(p).extraSlots;
    if (owned.other >= slots) return { ok: false, reason: tr(p.lang, 'buildLimit', { n: slots }) };
  }
  if (type === 'turret' && owned.turrets >= bal.economy.maxTurretsPerPlayer) {
    return { ok: false, reason: tr(p.lang, 'turretLimit', { n: bal.economy.maxTurretsPerPlayer }) };
  }
  const size = bal.world.size;
  if (x < cfg.radius || y < cfg.radius || x > size - cfg.radius || y > size - cfg.radius) {
    return { ok: false, reason: tr(p.lang, 'outOfWorld') };
  }
  if (dist(p.x, p.y, x, y) > PLACE_RANGE) return { ok: false, reason: tr(p.lang, 'tooFar') };
  if (!canPlaceAt(world, type, x, y, p.id)) return { ok: false, reason: tr(p.lang, 'tooClose') };
  // buildings are solid now, so dropping one on someone would be a free trap
  for (const e of world.grid.queryCircle(x, y, cfg.radius + 60)) {
    if (e.kind !== 'player' || e.id === p.id || e.dead) continue;
    if (dist(x, y, e.x, e.y) < cfg.radius + e.radius + 6) return { ok: false, reason: tr(p.lang, 'blockedByPlayer') };
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
    if (!canPlaceAt(world, spot.type, x, y, p.id)) continue;
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
  // Base Rank counts gold *earned*, not gold moved. A deposit first repays
  // whatever the player pulled back out, so withdraw/re-bank round-trips at
  // the vault add nothing to the lifetime score.
  const repay = Math.min(amount, p.withdrawCredit);
  p.withdrawCredit -= repay;
  p.bankedTotal += amount - repay;
  if (!p.bot) telemetry.bank(p.name, 'deposit', amount, amount - repay);
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
  p.withdrawCredit += amount; // re-banking this gold must not re-score Base Rank
  p.bankPaused = true; // hold off auto-banking until they leave the vault
  if (!p.bot) telemetry.bank(p.name, 'withdraw', amount);
  world.markDirty(p);
  world.sendEvent(p, { e: 'bank', action: 'withdraw', amount, banked: p.banked });
  return { ok: true };
}

/**
 * Buildings that block a mover of radius `r` heading for (x, y).
 *
 * Every structure is solid — that is what makes a wall a wall, and what turns
 * a base into something you have to break into rather than stroll through.
 * `ignoreOwnerId` lets a player walk through their *own* base, so nobody can
 * brick themselves in and defenders keep the run of their own yard.
 */
export function solidsNear(world: World, x: number, y: number, r: number, ignoreOwnerId?: string): Solid[] {
  const out: Solid[] = [];
  const reach = r + maxBuildingRadius();
  for (const e of world.grid.queryCircle(x, y, reach)) {
    if (e.kind !== 'building') continue;
    const b = e as Building;
    if (ignoreOwnerId !== undefined && b.ownerId === ignoreOwnerId) continue;
    out.push(b);
  }
  return out;
}

let radiusCache: { key: object; value: number } | null = null;
/** Largest building half-size, cached per balance reload. */
function maxBuildingRadius(): number {
  const bal = getBalance();
  if (radiusCache?.key === bal) return radiusCache.value;
  let r = 0;
  for (const id of BUILDING_IDS) r = Math.max(r, bal.buildings[id].radius);
  radiusCache = { key: bal, value: r };
  return r;
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
    // high rank shaves the raider's cut, but never to zero
    const frac = Math.max(0.01, bal.economy.vaultRaidFrac - perksOf(owner).vaultProtection);
    const taken = Math.floor(owner.banked * frac);
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
      const cap = siloCap(b, owner);
      if (b.stored < cap) {
        const perks = perksOf(owner);
        const mult = (owner ? hatEffects(owner.hat).incomeMult : 1) * perks.productionMult * biomeBonus(b.x, b.y);
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
    }

    // Vault banking is edge-triggered: it fires when the owner arrives, not on
    // every tick they stand there. Otherwise "take it all" would be undone
    // immediately, since withdrawing requires standing next to the vault.
    if (b.buildingType === 'vault' && owner && (owner.ws || owner.bot)) {
      const inRange = !owner.dead && dist(owner.x, owner.y, b.x, b.y) <= b.radius + COLLECT_RANGE;
      if (inRange && owner.dockedVaultId !== b.id) {
        owner.dockedVaultId = b.id;
        if (!owner.bankPaused && owner.money > 0) depositAll(world, owner);
      } else if (!inRange && owner.dockedVaultId === b.id) {
        owner.dockedVaultId = null;
        owner.bankPaused = false; // walked away — the next arrival banks again
      }
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

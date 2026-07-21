import { angleDiff, dist } from '@shared/math.js';
import type { WeaponCfg } from '@shared/balance-schema.js';
import type { DeathCause } from '@shared/types.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Entity, Player, Mob, Building } from './entities.js';
import { telemetry } from '../db/telemetry.js';
import { onBossDamaged, onBossKilled } from './boss.js';

export interface DamageSource {
  /** entity id of the attacker (player/boss/turret-owner) */
  id: string;
  name: string;
  weapon: string;
  cause: DeathCause;
}

const ATTACKABLE = new Set(['player', 'mob', 'boss', 'building']);

export function performAttack(world: World, p: Player, w: WeaponCfg, now: number): void {
  if (w.type === 'ranged') {
    const speed = w.projSpeed ?? 600;
    const sx = p.x + Math.cos(p.angle) * (p.radius + 10);
    const sy = p.y + Math.sin(p.angle) * (p.radius + 10);
    world.spawnProjectile(p.id, 'player', p.equipped, sx, sy, p.angle, speed, w.damage, w.range);
    return;
  }
  // melee: arc in front of the player
  const arcRad = ((w.arc ?? 90) * Math.PI) / 180;
  const targets = world.grid.queryCircle(p.x, p.y, w.range + 70);
  for (const t of targets) {
    if (t === p || t.dead || !ATTACKABLE.has(t.kind)) continue;
    const d = dist(p.x, p.y, t.x, t.y);
    if (d > w.range + t.radius) continue;
    const ang = Math.atan2(t.y - p.y, t.x - p.x);
    if (Math.abs(angleDiff(ang, p.angle)) > arcRad / 2) continue;
    const src: DamageSource = { id: p.id, name: p.name, weapon: p.equipped, cause: 'player' };
    const hit = applyDamage(world, t, w.damage, src, now, d);
    // Knockback only a still-living target — a dead one has already been removed
    // from the world, and moveEntity would re-insert it into the grid as a 0-HP ghost.
    if (hit && !t.dead && w.knockback && t.kind !== 'building' && t.kind !== 'boss') {
      world.moveEntity(t, t.x + Math.cos(ang) * w.knockback, t.y + Math.sin(ang) * w.knockback);
    }
  }
}

/**
 * Applies damage with all attribution/telemetry/death handling.
 * Returns false when the hit was blocked (safe zone rules, own building).
 */
export function applyDamage(
  world: World,
  target: Entity,
  amount: number,
  src: DamageSource,
  now: number,
  distance: number,
): boolean {
  if (target.dead) return false;
  const pvp = src.cause === 'player' || src.cause === 'turret';
  if (target.kind === 'player' && pvp) {
    // the safe zone always protects the victim
    if (world.inSafeZone(target.x, target.y)) return false;
    if (src.id === target.id) return false;
    // a player attacking from inside the safe zone deals no damage — but this must
    // NOT gate turrets: a turret is autonomous, its owner's position is irrelevant
    // (owners commonly stand at their safe-zone base while the turret defends).
    if (src.cause === 'player') {
      const attacker = world.players.get(src.id);
      if (attacker && world.inSafeZone(attacker.x, attacker.y)) return false;
    }
  }
  if (target.kind === 'building') {
    if (src.cause !== 'player' && src.cause !== 'turret') return false;
    if (target.ownerId === src.id) return false; // cannot damage own buildings
  }
  if (target.kind === 'mob' && src.cause !== 'player') return false;

  target.hp -= amount;
  target.dirtyTick = world.tickNo;

  if (target.kind === 'player') {
    target.lastDamagedAt = now;
  } else if (target.kind === 'mob') {
    reactMobToDamage(world, target, src, now);
  } else if (target.kind === 'boss') {
    onBossDamaged(target, src, amount);
  } else if (target.kind === 'building') {
    alertBuildingOwner(world, target, now);
  }

  telemetry.damage(src.name, src.weapon, amount, target.kind);
  world.sendNear(target.x, target.y, { e: 'damage', target: target.id, amount: Math.round(amount), x: target.x, y: target.y });

  if (target.hp <= 0) {
    handleDeath(world, target, src, now, distance);
  }
  return true;
}

function reactMobToDamage(world: World, mob: Mob, src: DamageSource, now: number): void {
  const cfg = getBalance().mobs[mob.mobType];
  if (cfg.flees) {
    mob.state = 'flee';
    mob.fleeUntil = now + 2500;
    const attacker = world.entities.get(src.id);
    if (attacker) mob.wanderAngle = Math.atan2(mob.y - attacker.y, mob.x - attacker.x);
    else mob.wanderAngle = Math.random() * Math.PI * 2;
  } else if (src.cause === 'player' && mob.state !== 'chase') {
    mob.state = 'chase';
    mob.targetId = src.id;
  }
}

function alertBuildingOwner(world: World, b: Building, now: number): void {
  if (now - b.lastAlertAt < 3000) return;
  b.lastAlertAt = now;
  const owner = world.players.get(b.ownerId);
  if (owner) world.sendEvent(owner, { e: 'buildingAttacked', id: b.id, x: b.x, y: b.y });
}

function handleDeath(world: World, target: Entity, src: DamageSource, now: number, distance: number): void {
  const bal = getBalance();
  const killerPlayer = src.cause === 'player' || src.cause === 'turret' ? world.players.get(src.id) : undefined;

  switch (target.kind) {
    case 'player': {
      const dropped = Math.floor(target.money * bal.player.dropMoneyFrac);
      target.money -= dropped;
      world.spawnCoinPiles(target.x, target.y, dropped);
      target.dead = true;
      target.respawnAt = now + bal.player.respawnSec * 1000;
      target.session.deaths++;
      world.removeEntity(target);
      telemetry.death(target.name, src.cause, src.weapon, target.equipped, dropped);
      world.sendEvent(target, { e: 'death', dropped, respawnIn: bal.player.respawnSec, cause: src.cause });
      world.broadcast({ e: 'kill', killer: src.name, victim: target.name, weapon: src.weapon });
      if (killerPlayer) killerPlayer.session.kills++;
      telemetry.kill(src.name, target.name, src.weapon, distance, 'player');
      break;
    }
    case 'mob': {
      const cfg = bal.mobs[target.mobType];
      target.dead = true;
      world.removeEntity(target);
      world.mobRespawnQueue.push({ mobType: target.mobType, at: now + 10_000 });
      if (killerPlayer && !killerPlayer.dead) {
        killerPlayer.money += cfg.reward;
        killerPlayer.session.moneyEarned += cfg.reward;
        telemetry.income(killerPlayer.name, 'mob', cfg.reward);
      }
      telemetry.kill(src.name, target.mobType, src.weapon, distance, 'mob');
      break;
    }
    case 'boss': {
      target.dead = true;
      onBossKilled(world, target, src, now);
      telemetry.kill(src.name, 'boss', src.weapon, distance, 'boss');
      break;
    }
    case 'building': {
      target.dead = true;
      world.removeEntity(target);
      const owner = world.players.get(target.ownerId);
      if (owner) {
        owner.buildingIds.delete(target.id);
        world.sendEvent(owner, { e: 'buildingDestroyed', id: target.id, byName: src.name, own: true });
        world.maybeForgetPlayer(owner);
      }
      const cfg = bal.buildings[target.buildingType];
      const loot = Math.floor(cfg.price * bal.economy.raidLootFrac);
      world.spawnCoinPiles(target.x, target.y, loot);
      if (killerPlayer) {
        world.sendEvent(killerPlayer, { e: 'buildingDestroyed', id: target.id, byName: src.name, own: false });
        telemetry.income(killerPlayer.name, 'raid', loot);
      }
      telemetry.kill(src.name, target.buildingType, src.weapon, distance, 'building');
      break;
    }
  }
}

export function updateProjectiles(world: World, dt: number, now: number): void {
  const bal = getBalance();
  for (const proj of [...world.projectiles.values()]) {
    const step = Math.hypot(proj.vx, proj.vy) * dt;
    world.moveEntity(proj, proj.x + proj.vx * dt, proj.y + proj.vy * dt);
    proj.traveled += step;

    // hit scan around the current position
    const candidates = world.grid.queryCircle(proj.x, proj.y, proj.radius + 70);
    let hit = false;
    for (const t of candidates) {
      if (t.dead || t.id === proj.ownerId || !ATTACKABLE.has(t.kind)) continue;
      if (proj.ownerKind === 'boss' && t.kind !== 'player') continue;
      if (proj.ownerKind === 'turret' && t.kind !== 'player') continue;
      if (t.kind === 'building' && (t as Building).ownerId === proj.ownerId) continue;
      const d = dist(proj.x, proj.y, t.x, t.y);
      if (d > proj.radius + t.radius) continue;
      const cause: DeathCause = proj.ownerKind === 'boss' ? 'boss' : proj.ownerKind === 'turret' ? 'turret' : 'player';
      const ownerName =
        proj.ownerKind === 'boss' ? 'Boss' : world.players.get(proj.ownerId)?.name ?? proj.weapon;
      const src: DamageSource = { id: proj.ownerId, name: ownerName, weapon: proj.weapon, cause };
      if (applyDamage(world, t, proj.damage, src, now, proj.traveled)) {
        hit = true;
        break;
      }
    }

    const size = bal.world.size;
    const outOfWorld = proj.x <= proj.radius || proj.y <= proj.radius || proj.x >= size - proj.radius || proj.y >= size - proj.radius;
    if (hit || proj.traveled >= proj.maxDist || outOfWorld) {
      world.removeEntity(proj);
    }
  }
}

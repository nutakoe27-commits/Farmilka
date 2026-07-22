import { angleDiff, dist } from '@shared/math.js';
import type { WeaponCfg } from '@shared/balance-schema.js';
import type { DeathCause } from '@shared/types.js';
import { levelDamageMult } from '@shared/levels.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Entity, Player, Mob, Building } from './entities.js';
import { telemetry } from '../db/telemetry.js';
import { onBossDamaged, onBossKilled } from './boss.js';
import { grantHat, hatEffects, randomHatOfTier } from './hats.js';

export interface DamageSource {
  /** entity id of the attacker (player/boss/turret-owner) */
  id: string;
  name: string;
  weapon: string;
  cause: DeathCause;
}

const ATTACKABLE = new Set(['player', 'mob', 'boss', 'building']);

export function performAttack(world: World, p: Player, w: WeaponCfg, now: number): void {
  // attacking breaks your own spawn protection
  if (p.invulnUntil > now) {
    p.invulnUntil = 0;
    p.dirtyTick = world.tickNo;
  }
  const dmgMult = hatEffects(p.hat).damageMult;
  if (w.type === 'ranged') {
    const speed = w.projSpeed ?? 600;
    const sx = p.x + Math.cos(p.angle) * (p.radius + 10);
    const sy = p.y + Math.sin(p.angle) * (p.radius + 10);
    const count = Math.max(1, Math.floor(w.projectiles ?? 1));
    const spread = ((w.spreadDeg ?? 0) * Math.PI) / 180;
    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? (i / (count - 1) - 0.5) * spread : 0;
      world.spawnProjectile(p.id, 'player', p.equipped, sx, sy, p.angle + offset, speed, w.damage * dmgMult, w.range);
    }
    return;
  }
  // melee: arc in front of the player — broadcast a swing so it's clear where you hit
  world.sendNear(p.x, p.y, { e: 'swing', id: p.id, x: p.x, y: p.y, angle: p.angle, weapon: p.equipped });
  const arcRad = ((w.arc ?? 90) * Math.PI) / 180;
  const targets = world.grid.queryCircle(p.x, p.y, w.range + 70);
  for (const t of targets) {
    if (t === p || t.dead || !ATTACKABLE.has(t.kind)) continue;
    const d = dist(p.x, p.y, t.x, t.y);
    if (d > w.range + t.radius) continue;
    const ang = Math.atan2(t.y - p.y, t.x - p.x);
    if (Math.abs(angleDiff(ang, p.angle)) > arcRad / 2) continue;
    let dmg = w.damage * dmgMult;
    // backstab: the hit direction roughly matches the victim's own facing
    if (w.backstabMult && (t.kind === 'player' || t.kind === 'mob') && Math.abs(angleDiff(ang, t.angle)) < Math.PI * 0.42) {
      dmg *= w.backstabMult;
    }
    const src: DamageSource = { id: p.id, name: p.name, weapon: p.equipped, cause: 'player' };
    const hit = applyDamage(world, t, dmg, src, now, d);
    if (hit) applyWeaponOnHit(world, p, t, w, dmg, now);
    // Knockback only a still-living target — a dead one has already been removed
    // from the world, and moveEntity would re-insert it into the grid as a 0-HP ghost.
    if (hit && !t.dead && w.knockback && t.kind !== 'building' && t.kind !== 'boss') {
      world.moveEntity(t, t.x + Math.cos(ang) * w.knockback, t.y + Math.sin(ang) * w.knockback);
    }
  }
}

/**
 * Weapon side-effects that trigger on a successful hit: poison DoT, chill slow
 * and lifesteal. Bosses are immune to chill; buildings take none of these.
 */
export function applyWeaponOnHit(world: World, attacker: Player | null, target: Entity, w: WeaponCfg, dealt: number, now: number): void {
  if (attacker && w.lifestealFrac && !attacker.dead && attacker.hp < attacker.maxHp) {
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + dealt * w.lifestealFrac);
    world.markDirty(attacker);
  }
  if (target.dead) return;
  if (target.kind === 'player' || target.kind === 'mob') {
    if (w.poison && attacker) {
      target.poisonUntil = now + w.poison.durationSec * 1000;
      target.poisonDps = Math.max(target.poisonDps, w.poison.dps);
      if (target.poisonNextAt < now) target.poisonNextAt = now + 1000;
      target.poisonSrc = { id: attacker.id, name: attacker.name, weapon: attacker.equipped };
      world.markDirty(target);
    }
    if (w.chill) {
      target.chillUntil = now + w.chill.durationSec * 1000;
      target.chillFactor = w.chill.slowFactor;
      world.markDirty(target);
    }
  }
}

/** Ticks poison (1 hit/sec) and expires statuses; shared by players and mobs. */
export function tickStatus(world: World, e: Player | Mob, now: number): void {
  if (e.poisonUntil !== 0) {
    if (now >= e.poisonNextAt && e.poisonSrc) {
      e.poisonNextAt = now + 1000;
      applyDamage(world, e, e.poisonDps, { ...e.poisonSrc, cause: 'player' }, now, 0);
    }
    if (now >= e.poisonUntil) {
      e.poisonUntil = 0;
      e.poisonDps = 0;
      e.poisonSrc = null;
      world.markDirty(e);
    }
  }
  if (e.chillUntil !== 0 && now >= e.chillUntil) {
    e.chillUntil = 0;
    e.chillFactor = 1;
    world.markDirty(e);
  }
}

/** Movement slow multiplier from an active chill. */
export function chillSpeedFactor(e: Player | Mob, now: number): number {
  return e.chillUntil > now ? e.chillFactor : 1;
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
  if (target.kind === 'player') {
    if (src.id === target.id) return false;
    // spawn protection: fresh spawns are immune until the timer runs out
    // (their own first attack drops it — see performAttack)
    if (target.invulnUntil > now) return false;
  }
  if (target.kind === 'building') {
    if (src.cause !== 'player' && src.cause !== 'turret') return false;
    if (target.ownerId === src.id) return false; // cannot damage own buildings
  }
  if (target.kind === 'mob' && src.cause !== 'player') return false;

  // player-dealt damage scales with the attacker's level for PvP and normal
  // PvE — but NOT against bosses, which stay a group fight regardless of level.
  // Bosses instead take the boss-only hat bonus (also PvP-safe).
  if (src.cause === 'player') {
    const attacker = world.players.get(src.id);
    if (attacker) {
      if (target.kind === 'boss') amount *= hatEffects(attacker.hat).bossDmgMult;
      else amount *= levelDamageMult(attacker.level, getBalance().levels);
    }
  }

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

  // filler bots are excluded from all telemetry (as attacker or victim)
  const attackerBot = !!world.players.get(src.id)?.bot;
  const targetBot = target.kind === 'player' && (target as Player).bot;
  if (!attackerBot && !targetBot) telemetry.damage(src.name, src.weapon, amount, target.kind);
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
  const killerBot = !!killerPlayer?.bot; // filler bots never generate telemetry

  switch (target.kind) {
    case 'player': {
      const victimFx = hatEffects(target.hat);
      const dropped = Math.floor(target.money * bal.player.dropMoneyFrac * (1 - victimFx.dropSaveFrac));
      target.money -= dropped;
      world.spawnCoinPiles(target.x, target.y, dropped);
      // death is harsh: purchased weapons and carried food are lost too
      const equippedAtDeath = target.equipped;
      target.weapons = ['fists'];
      target.equipped = 'fists';
      target.food = 0;
      target.dead = true;
      target.respawnAt = now + bal.player.respawnSec * 1000 * victimFx.respawnMult;
      target.session.deaths++;
      world.removeEntity(target);
      if (!target.bot) telemetry.death(target.name, src.cause, src.weapon, equippedAtDeath, dropped);
      world.sendEvent(target, {
        e: 'death',
        dropped,
        respawnIn: bal.player.respawnSec * victimFx.respawnMult,
        cause: src.cause,
        kills: target.killsThisLife,
        survivedSec: Math.max(0, (now - target.lifeStartAt) / 1000),
        level: target.level,
      });
      world.broadcast({ e: 'kill', killer: src.name, victim: target.name, weapon: src.weapon });
      if (killerPlayer) { killerPlayer.session.kills++; killerPlayer.killsThisLife++; }
      if (!killerBot && !target.bot) telemetry.kill(src.name, target.name, src.weapon, distance, 'player');
      break;
    }
    case 'mob': {
      const cfg = bal.mobs[target.mobType];
      target.dead = true;
      world.removeEntity(target);
      world.mobRespawnQueue.push({ mobType: target.mobType, at: now + 10_000 });
      const killerFx = killerPlayer ? hatEffects(killerPlayer.hat) : null;
      if (killerPlayer && !killerPlayer.dead && killerFx) {
        const reward = Math.round(cfg.reward * killerFx.mobRewardMult);
        killerPlayer.money += reward;
        killerPlayer.session.moneyEarned += reward;
        if (!killerBot) telemetry.income(killerPlayer.name, 'mob', reward);
      }
      if (Math.random() < bal.food.dropChance * (killerFx ? killerFx.foodFindMult : 1)) {
        world.spawnFood(target.x, target.y);
      }
      // common hats drop from mobs with a small chance
      if (killerPlayer && !killerPlayer.dead && Math.random() < bal.hats.mobDropChance) {
        const hat = randomHatOfTier('common');
        if (hat) grantHat(world, killerPlayer, hat, 'mob');
      }
      if (!killerBot) telemetry.kill(src.name, target.mobType, src.weapon, distance, 'mob');
      break;
    }
    case 'boss': {
      target.dead = true;
      onBossKilled(world, target, src, now);
      if (!killerBot) telemetry.kill(src.name, 'boss', src.weapon, distance, 'boss');
      break;
    }
    case 'building': {
      target.dead = true;
      world.removeEntity(target);
      const owner = world.players.get(target.ownerId);
      if (owner) {
        owner.buildingIds.delete(target.id);
        world.sendEvent(owner, { e: 'buildingDestroyed', id: target.id, byName: src.name, own: true });
      }
      const cfg = bal.buildings[target.buildingType];
      const loot = Math.floor(cfg.price * bal.economy.raidLootFrac);
      world.spawnCoinPiles(target.x, target.y, loot);
      if (killerPlayer) {
        world.sendEvent(killerPlayer, { e: 'buildingDestroyed', id: target.id, byName: src.name, own: false });
        if (!killerBot) telemetry.income(killerPlayer.name, 'raid', loot);
      }
      if (!killerBot) telemetry.kill(src.name, target.buildingType, src.weapon, distance, 'building');
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
        if (proj.ownerKind === 'player') {
          const wcfg = (getBalance().weapons as Record<string, WeaponCfg | undefined>)[proj.weapon];
          if (wcfg) {
            const owner = world.players.get(proj.ownerId) ?? null;
            applyWeaponOnHit(world, owner, t, wcfg, proj.damage, now);
          }
        }
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

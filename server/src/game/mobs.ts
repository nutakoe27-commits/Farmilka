import { clamp, dist } from '@shared/math.js';
import type { MobId } from '@shared/types.js';
import { MOB_IDS } from '@shared/balance-schema.js';
import { biomeRect, randomPointInBiome } from '@shared/biomes.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import { freshStatus } from './entities.js';
import type { Mob, Player } from './entities.js';
import { applyDamage, tickStatus, chillSpeedFactor } from './combat.js';

export function spawnMob(world: World, mobType: MobId): Mob {
  const bal = getBalance();
  const cfg = bal.mobs[mobType];
  const pos = randomPointInBiome(cfg.biome, bal.world.size, 120);
  const mob: Mob = {
    id: world.id('m'),
    kind: 'mob',
    mobType,
    x: pos.x,
    y: pos.y,
    angle: Math.random() * Math.PI * 2,
    radius: cfg.radius,
    hp: cfg.hp,
    maxHp: cfg.hp,
    dead: false,
    cell: -1,
    movedTick: world.tickNo,
    dirtyTick: world.tickNo,
    state: 'idle',
    homeX: pos.x,
    homeY: pos.y,
    targetId: null,
    wanderAngle: Math.random() * Math.PI * 2,
    nextThinkAt: 0,
    attackReadyAt: 0,
    fleeUntil: 0,
    ...freshStatus(),
  };
  world.addEntity(mob);
  return mob;
}

export function populateMobs(world: World): void {
  const bal = getBalance();
  for (const id of MOB_IDS) {
    for (let i = 0; i < bal.mobs[id].count; i++) spawnMob(world, id);
  }
}

function validTarget(world: World, id: string | null): Player | null {
  if (!id) return null;
  const p = world.players.get(id);
  if (!p || p.dead || !p.ws) return null;
  return p;
}

export function updateMobs(world: World, dt: number, now: number): void {
  const bal = getBalance();

  // respawns
  while (world.mobRespawnQueue.length && world.mobRespawnQueue[0].at <= now) {
    const item = world.mobRespawnQueue.shift()!;
    spawnMob(world, item.mobType);
  }

  for (const mob of [...world.mobs.values()]) {
    const cfg = bal.mobs[mob.mobType];

    tickStatus(world, mob, now);
    if (mob.dead) continue; // poison kill

    // slow "think" pass: state transitions & aggro scans
    if (now >= mob.nextThinkAt) {
      mob.nextThinkAt = now + 250;
      think(world, mob, now);
    }

    // continuous movement per state
    let vx = 0;
    let vy = 0;
    switch (mob.state) {
      case 'wander': {
        vx = Math.cos(mob.wanderAngle) * cfg.speed * 0.4;
        vy = Math.sin(mob.wanderAngle) * cfg.speed * 0.4;
        break;
      }
      case 'flee': {
        vx = Math.cos(mob.wanderAngle) * cfg.speed * 1.4;
        vy = Math.sin(mob.wanderAngle) * cfg.speed * 1.4;
        break;
      }
      case 'chase': {
        const target = validTarget(world, mob.targetId);
        if (target) {
          const d = dist(mob.x, mob.y, target.x, target.y);
          const reach = cfg.attackRange + mob.radius + target.radius;
          if (d > reach * 0.9) {
            vx = ((target.x - mob.x) / d) * cfg.speed;
            vy = ((target.y - mob.y) / d) * cfg.speed;
          }
          if (d <= reach && now >= mob.attackReadyAt) {
            mob.attackReadyAt = now + 1000 / cfg.attackRate;
            applyDamage(world, target, cfg.damage, { id: mob.id, name: mob.mobType, weapon: mob.mobType, cause: 'mob' }, now, d);
          }
          mob.angle = Math.atan2(target.y - mob.y, target.x - mob.x);
        }
        break;
      }
      case 'return': {
        const d = dist(mob.x, mob.y, mob.homeX, mob.homeY);
        if (d > 5) {
          vx = ((mob.homeX - mob.x) / d) * cfg.speed;
          vy = ((mob.homeY - mob.y) / d) * cfg.speed;
        }
        break;
      }
    }

    if (vx !== 0 || vy !== 0) {
      const chill = chillSpeedFactor(mob, now);
      vx *= chill;
      vy *= chill;
      // mobs stay inside their home biome — keeps biome identity crisp
      const rect = biomeRect(cfg.biome, bal.world.size);
      const nx = clamp(mob.x + vx * dt, rect.x0 + mob.radius, rect.x1 - mob.radius);
      const ny = clamp(mob.y + vy * dt, rect.y0 + mob.radius, rect.y1 - mob.radius);
      mob.angle = Math.atan2(vy, vx);
      world.moveEntity(mob, nx, ny);
    }
  }
}

function think(world: World, mob: Mob, now: number): void {
  const cfg = getBalance().mobs[mob.mobType];

  switch (mob.state) {
    case 'idle': {
      if (cfg.aggroRadius > 0 && tryAggro(world, mob)) break;
      if (Math.random() < 0.3) {
        mob.state = 'wander';
        mob.wanderAngle = Math.random() * Math.PI * 2;
      }
      break;
    }
    case 'wander': {
      if (cfg.aggroRadius > 0 && tryAggro(world, mob)) break;
      if (dist(mob.x, mob.y, mob.homeX, mob.homeY) > cfg.leashRange * 0.6) {
        mob.state = 'return';
      } else if (Math.random() < 0.25) {
        mob.state = 'idle';
      }
      break;
    }
    case 'chase': {
      const target = validTarget(world, mob.targetId);
      if (!target || dist(mob.x, mob.y, mob.homeX, mob.homeY) > cfg.leashRange) {
        mob.targetId = null;
        mob.state = 'return';
      }
      break;
    }
    case 'return': {
      if (dist(mob.x, mob.y, mob.homeX, mob.homeY) < 40) mob.state = 'idle';
      break;
    }
    case 'flee': {
      if (now >= mob.fleeUntil) mob.state = 'wander';
      break;
    }
  }
}

function tryAggro(world: World, mob: Mob): boolean {
  const cfg = getBalance().mobs[mob.mobType];
  const near = world.grid.queryCircle(mob.x, mob.y, cfg.aggroRadius);
  let best: Player | null = null;
  let bestD = Infinity;
  for (const e of near) {
    if (e.kind !== 'player' || e.dead || !e.ws) continue;
    const d = dist(mob.x, mob.y, e.x, e.y);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  if (best) {
    mob.targetId = best.id;
    mob.state = 'chase';
    return true;
  }
  return false;
}

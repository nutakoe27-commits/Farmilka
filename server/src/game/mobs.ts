import { dist } from '@shared/math.js';
import type { MobId } from '@shared/types.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Mob, Player } from './entities.js';
import { applyDamage } from './combat.js';

const MOB_IDS: MobId[] = ['slime', 'wolf', 'golem'];

/** Random position inside the mob's difficulty ring, outside the safe zone. */
function ringPos(world: World, zoneMin: number, zoneMax: number): { x: number; y: number } {
  const bal = getBalance();
  const half = bal.world.size / 2;
  const c = world.center;
  const minR = Math.max(zoneMin * half, bal.world.safeZoneRadius + 150);
  const maxR = Math.max(minR + 50, zoneMax * half);
  const a = Math.random() * Math.PI * 2;
  const r = minR + Math.random() * (maxR - minR);
  return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
}

export function spawnMob(world: World, mobType: MobId): Mob {
  const cfg = getBalance().mobs[mobType];
  const pos = ringPos(world, cfg.zoneMin, cfg.zoneMax);
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
  if (!p || p.dead || !p.ws || world.inSafeZone(p.x, p.y)) return null;
  return p;
}

export function updateMobs(world: World, dt: number, now: number): void {
  const bal = getBalance();

  // respawns
  while (world.mobRespawnQueue.length && world.mobRespawnQueue[0].at <= now) {
    const item = world.mobRespawnQueue.shift()!;
    spawnMob(world, item.mobType);
  }

  for (const mob of world.mobs.values()) {
    const cfg = bal.mobs[mob.mobType];

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
      const nx = mob.x + vx * dt;
      const ny = mob.y + vy * dt;
      // mobs never enter the safe zone
      const c = world.center;
      if (dist(nx, ny, c, c) > bal.world.safeZoneRadius + 60) {
        mob.angle = Math.atan2(vy, vx);
        world.moveEntity(mob, nx, ny);
      } else {
        mob.state = 'return';
      }
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
    if (e.kind !== 'player' || e.dead || !e.ws || world.inSafeZone(e.x, e.y)) continue;
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

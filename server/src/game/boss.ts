import { angleDiff, dist } from '@shared/math.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Boss, Player } from './entities.js';
import { applyDamage, type DamageSource } from './combat.js';
import { telemetry } from '../db/telemetry.js';

function scheduleNext(world: World, now: number): void {
  world.bossNextSpawnAt = now + getBalance().boss.spawnIntervalSec * 1000;
  world.bossWarned = false;
}

export function updateBossTimer(world: World, now: number): void {
  if (world.boss) return;
  const bal = getBalance();
  // live balance tuning: a shortened spawn interval takes effect immediately
  const maxAt = now + bal.boss.spawnIntervalSec * 1000;
  if (world.bossNextSpawnAt > maxAt) world.bossNextSpawnAt = maxAt;
  if (!world.bossWarned && now >= world.bossNextSpawnAt - bal.boss.warnSec * 1000) {
    const half = bal.world.size / 2;
    const c = world.center;
    const a = Math.random() * Math.PI * 2;
    const r = half * (0.6 + Math.random() * 0.3);
    world.bossSpawnPos = { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
    world.bossWarned = true;
    world.broadcast({ e: 'bossWarn', x: world.bossSpawnPos.x, y: world.bossSpawnPos.y, inSec: bal.boss.warnSec });
  }
  if (now >= world.bossNextSpawnAt) {
    spawnBoss(world, world.bossSpawnPos.x, world.bossSpawnPos.y, now);
  }
}

export function spawnBoss(world: World, x: number, y: number, now: number): Boss {
  const bal = getBalance();
  const boss: Boss = {
    id: world.id('boss'),
    kind: 'boss',
    x,
    y,
    angle: 0,
    radius: bal.boss.radius,
    hp: bal.boss.hp,
    maxHp: bal.boss.hp,
    dead: false,
    cell: -1,
    movedTick: world.tickNo,
    dirtyTick: world.tickNo,
    targetId: null,
    attackReadyAt: now + 2000,
    telegraph: null,
    damageLedger: new Map(),
    despawnAt: now + bal.boss.despawnSec * 1000,
  };
  world.addEntity(boss);
  world.broadcast({ e: 'bossSpawned', x, y });
  return boss;
}

export function onBossDamaged(boss: Boss, src: DamageSource, amount: number): void {
  if (src.cause !== 'player') return;
  boss.damageLedger.set(src.name, (boss.damageLedger.get(src.name) ?? 0) + amount);
}

export function onBossKilled(world: World, boss: Boss, src: DamageSource, now: number): void {
  const bal = getBalance();
  world.removeEntity(boss);

  const eligible: { name: string; dmg: number }[] = [];
  let totalDmg = 0;
  for (const [name, dmg] of boss.damageLedger) {
    if (dmg >= bal.boss.minDamageForReward) {
      eligible.push({ name, dmg });
      totalDmg += dmg;
    }
  }

  const rewards: { name: string; amount: number }[] = [];
  for (const { name, dmg } of eligible) {
    const amount = Math.round((bal.boss.reward * dmg) / totalDmg);
    rewards.push({ name, amount });
    for (const p of world.players.values()) {
      if (p.name === name && p.ws) {
        p.money += amount;
        p.session.moneyEarned += amount;
        telemetry.income(p.name, 'boss', amount);
        break;
      }
    }
  }
  world.broadcast({ e: 'bossKilled', rewards });
  scheduleNext(world, now);
}

function pickTarget(world: World, boss: Boss): Player | null {
  let best: Player | null = null;
  let bestD = Infinity;
  for (const p of world.players.values()) {
    if (p.dead || !p.ws || world.inSafeZone(p.x, p.y)) continue;
    const d = dist(boss.x, boss.y, p.x, p.y);
    if (d < bestD && d < 1500) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export function updateBoss(world: World, dt: number, now: number): void {
  const boss = world.boss;
  if (!boss) return;
  const bal = getBalance();

  if (now >= boss.despawnAt) {
    world.removeEntity(boss);
    world.broadcast({ e: 'bossGone' });
    scheduleNext(world, now);
    return;
  }

  // resolving a telegraphed attack; boss stands still while winding up
  if (boss.telegraph) {
    if (now < boss.telegraph.resolveAt) return;
    const tg = boss.telegraph;
    boss.telegraph = null;
    if (tg.kind === 'slam') {
      const cfg = bal.boss.slam;
      const arcRad = (cfg.arc * Math.PI) / 180;
      const targets = world.grid.queryCircle(boss.x, boss.y, cfg.range + 40);
      for (const t of targets) {
        if (t.kind !== 'player' || t.dead) continue;
        const d = dist(boss.x, boss.y, t.x, t.y);
        if (d > cfg.range + t.radius) continue;
        const ang = Math.atan2(t.y - boss.y, t.x - boss.x);
        if (Math.abs(angleDiff(ang, tg.angle)) > arcRad / 2) continue;
        applyDamage(world, t, cfg.damage, { id: boss.id, name: 'Boss', weapon: 'boss-slam', cause: 'boss' }, now, d);
      }
    } else {
      const cfg = bal.boss.burst;
      for (let i = 0; i < cfg.count; i++) {
        const a = (i / cfg.count) * Math.PI * 2;
        world.spawnProjectile(boss.id, 'boss', 'boss-burst', boss.x + Math.cos(a) * (boss.radius + 12), boss.y + Math.sin(a) * (boss.radius + 12), a, cfg.projSpeed, cfg.damage, cfg.projRange);
      }
    }
    return;
  }

  const target = pickTarget(world, boss);
  if (!target) return;

  const d = dist(boss.x, boss.y, target.x, target.y);
  boss.angle = Math.atan2(target.y - boss.y, target.x - boss.x);
  boss.movedTick = world.tickNo;

  if (d > bal.boss.slam.range * 0.6) {
    world.moveEntity(boss, boss.x + Math.cos(boss.angle) * bal.boss.speed * dt, boss.y + Math.sin(boss.angle) * bal.boss.speed * dt);
  }

  // contact damage with a per-player 1s cooldown
  if (d < boss.radius + target.radius + 5 && now - target.lastBossContactAt > 1000) {
    target.lastBossContactAt = now;
    applyDamage(world, target, bal.boss.contactDamage, { id: boss.id, name: 'Boss', weapon: 'boss-contact', cause: 'boss' }, now, d);
  }

  if (now >= boss.attackReadyAt) {
    if (d <= bal.boss.slam.range * 0.9) {
      const cfg = bal.boss.slam;
      boss.telegraph = { kind: 'slam', resolveAt: now + cfg.telegraphSec * 1000, angle: boss.angle };
      boss.attackReadyAt = now + cfg.cooldownSec * 1000;
      world.sendNear(boss.x, boss.y, {
        e: 'bossTelegraph', kind: 'slam', x: boss.x, y: boss.y, angle: boss.angle, range: cfg.range, arc: cfg.arc, sec: cfg.telegraphSec,
      });
    } else if (d <= 700) {
      const cfg = bal.boss.burst;
      boss.telegraph = { kind: 'burst', resolveAt: now + cfg.telegraphSec * 1000, angle: 0 };
      boss.attackReadyAt = now + cfg.cooldownSec * 1000;
      world.sendNear(boss.x, boss.y, {
        e: 'bossTelegraph', kind: 'burst', x: boss.x, y: boss.y, angle: 0, range: cfg.projRange, arc: 360, sec: cfg.telegraphSec,
      });
    }
  }
}

import { angleDiff, clamp, dist } from '@shared/math.js';
import type { BossId } from '@shared/types.js';
import type { BiomeId } from '@shared/biomes.js';
import { biomeRect, randomPointInBiome } from '@shared/biomes.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Boss, Player } from './entities.js';
import { applyDamage, type DamageSource } from './combat.js';
import { telemetry } from '../db/telemetry.js';
import { grantHat, randomHatOfTier } from './hats.js';

const CENTRAL: BiomeId[] = ['snow', 'normal', 'desert'];

function scheduleNext(world: World, bossType: BossId, now: number): void {
  const cfg = getBalance().bosses[bossType];
  world.bossTimers.set(bossType, { nextSpawnAt: now + cfg.spawnIntervalSec * 1000, warned: false, pos: { x: 0, y: 0 } });
}

function liveBossOfType(world: World, bossType: BossId): Boss | null {
  for (const b of world.bosses.values()) {
    if (b.bossType === bossType) return b;
  }
  return null;
}

export function updateBossTimers(world: World, now: number): void {
  const bal = getBalance();
  for (const [bossType, cfg] of Object.entries(bal.bosses) as [BossId, (typeof bal.bosses)[BossId]][]) {
    if (liveBossOfType(world, bossType)) continue;
    let timer = world.bossTimers.get(bossType);
    if (!timer) {
      timer = { nextSpawnAt: now + cfg.spawnIntervalSec * 1000, warned: false, pos: { x: 0, y: 0 } };
      world.bossTimers.set(bossType, timer);
    }
    // live balance tuning: a shortened spawn interval takes effect immediately
    const maxAt = now + cfg.spawnIntervalSec * 1000;
    if (timer.nextSpawnAt > maxAt) timer.nextSpawnAt = maxAt;

    if (!timer.warned && now >= timer.nextSpawnAt - cfg.warnSec * 1000) {
      const biome: BiomeId = cfg.biome === 'central' ? CENTRAL[Math.floor(Math.random() * CENTRAL.length)] : cfg.biome;
      timer.pos = randomPointInBiome(biome, bal.world.size, 250);
      (timer as { biome?: BiomeId }).biome = biome;
      timer.warned = true;
      world.broadcast({ e: 'bossWarn', boss: cfg.name, bossId: bossType, x: timer.pos.x, y: timer.pos.y, inSec: cfg.warnSec });
    }
    if (now >= timer.nextSpawnAt) {
      spawnBoss(world, bossType, timer.pos.x, timer.pos.y, now, (timer as { biome?: BiomeId }).biome ?? 'normal');
    }
  }
}

export function spawnBoss(world: World, bossType: BossId, x: number, y: number, now: number, homeBiome: BiomeId = 'normal'): Boss {
  const cfg = getBalance().bosses[bossType];
  const boss: Boss = {
    id: world.id('boss'),
    kind: 'boss',
    bossType,
    homeBiome,
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
    targetId: null,
    attackReadyAt: now + 2000,
    telegraph: null,
    damageLedger: new Map(),
    despawnAt: now + cfg.despawnSec * 1000,
  };
  world.addEntity(boss);
  world.broadcast({ e: 'bossSpawned', boss: cfg.name, bossId: bossType, x, y });
  return boss;
}

export function onBossDamaged(boss: Boss, src: DamageSource, amount: number): void {
  if (src.cause !== 'player') return;
  boss.damageLedger.set(src.name, (boss.damageLedger.get(src.name) ?? 0) + amount);
}

export function onBossKilled(world: World, boss: Boss, src: DamageSource, now: number): void {
  const cfg = getBalance().bosses[boss.bossType];
  world.removeEntity(boss);

  const eligible: { name: string; dmg: number }[] = [];
  let totalDmg = 0;
  for (const [name, dmg] of boss.damageLedger) {
    if (dmg >= cfg.minDamageForReward) {
      eligible.push({ name, dmg });
      totalDmg += dmg;
    }
  }

  const bal = getBalance();
  const rewards: { name: string; amount: number }[] = [];
  for (const { name, dmg } of eligible) {
    const amount = Math.round((cfg.reward * dmg) / totalDmg);
    rewards.push({ name, amount });
    for (const p of world.players.values()) {
      if (p.name === name && (p.ws || p.bot)) {
        p.money += amount;
        p.session.moneyEarned += amount;
        if (!p.bot) telemetry.income(p.name, 'boss', amount);
        // rare hats drop from bosses for everyone who earned a reward
        if (Math.random() < bal.hats.bossDropChance) {
          const hat = randomHatOfTier('rare');
          if (hat) grantHat(world, p, hat, 'boss');
        }
        break;
      }
    }
  }
  world.broadcast({ e: 'bossKilled', boss: cfg.name, bossId: boss.bossType, rewards });
  scheduleNext(world, boss.bossType, now);
}

function pickTarget(world: World, boss: Boss): Player | null {
  let best: Player | null = null;
  let bestD = Infinity;
  for (const p of world.players.values()) {
    if (p.dead || !p.ws) continue;
    const d = dist(boss.x, boss.y, p.x, p.y);
    if (d < bestD && d < 1500) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export function updateBosses(world: World, dt: number, now: number): void {
  for (const boss of [...world.bosses.values()]) {
    updateBoss(world, boss, dt, now);
  }
}

function updateBoss(world: World, boss: Boss, dt: number, now: number): void {
  const cfg = getBalance().bosses[boss.bossType];

  if (now >= boss.despawnAt) {
    world.removeEntity(boss);
    world.broadcast({ e: 'bossGone', boss: cfg.name, bossId: boss.bossType });
    scheduleNext(world, boss.bossType, now);
    return;
  }

  // resolving a telegraphed attack; boss stands still while winding up
  if (boss.telegraph) {
    if (now < boss.telegraph.resolveAt) return;
    const tg = boss.telegraph;
    boss.telegraph = null;
    if (tg.kind === 'slam') {
      const atk = cfg.slam;
      const arcRad = (atk.arc * Math.PI) / 180;
      const targets = world.grid.queryCircle(boss.x, boss.y, atk.range + 40);
      for (const t of targets) {
        if (t.kind !== 'player' || t.dead) continue;
        const d = dist(boss.x, boss.y, t.x, t.y);
        if (d > atk.range + t.radius) continue;
        const ang = Math.atan2(t.y - boss.y, t.x - boss.x);
        if (Math.abs(angleDiff(ang, tg.angle)) > arcRad / 2) continue;
        applyDamage(world, t, atk.damage, { id: boss.id, name: cfg.name, weapon: 'boss-slam', cause: 'boss' }, now, d);
      }
    } else {
      const atk = cfg.burst;
      for (let i = 0; i < atk.count; i++) {
        const a = (i / atk.count) * Math.PI * 2;
        world.spawnProjectile(boss.id, 'boss', 'boss-burst', boss.x + Math.cos(a) * (boss.radius + 12), boss.y + Math.sin(a) * (boss.radius + 12), a, atk.projSpeed, atk.damage, atk.projRange);
      }
    }
    return;
  }

  const target = pickTarget(world, boss);
  if (!target) return;

  const d = dist(boss.x, boss.y, target.x, target.y);
  boss.angle = Math.atan2(target.y - boss.y, target.x - boss.x);
  boss.movedTick = world.tickNo;

  if (d > cfg.slam.range * 0.6) {
    // bosses never leave their home biome while chasing
    const rect = biomeRect(boss.homeBiome as never, getBalance().world.size);
    const nx = clamp(boss.x + Math.cos(boss.angle) * cfg.speed * dt, rect.x0 + boss.radius, rect.x1 - boss.radius);
    const ny = clamp(boss.y + Math.sin(boss.angle) * cfg.speed * dt, rect.y0 + boss.radius, rect.y1 - boss.radius);
    world.moveEntity(boss, nx, ny);
  }

  // contact damage with a per-player 1s cooldown
  if (d < boss.radius + target.radius + 5 && now - target.lastBossContactAt > 1000) {
    target.lastBossContactAt = now;
    applyDamage(world, target, cfg.contactDamage, { id: boss.id, name: cfg.name, weapon: 'boss-contact', cause: 'boss' }, now, d);
  }

  if (now >= boss.attackReadyAt) {
    if (d <= cfg.slam.range * 0.9) {
      const atk = cfg.slam;
      boss.telegraph = { kind: 'slam', resolveAt: now + atk.telegraphSec * 1000, angle: boss.angle };
      boss.attackReadyAt = now + atk.cooldownSec * 1000;
      world.sendNear(boss.x, boss.y, {
        e: 'bossTelegraph', kind: 'slam', x: boss.x, y: boss.y, angle: boss.angle, range: atk.range, arc: atk.arc, sec: atk.telegraphSec,
      });
    } else if (d <= 700) {
      const atk = cfg.burst;
      boss.telegraph = { kind: 'burst', resolveAt: now + atk.telegraphSec * 1000, angle: 0 };
      boss.attackReadyAt = now + atk.cooldownSec * 1000;
      world.sendNear(boss.x, boss.y, {
        e: 'bossTelegraph', kind: 'burst', x: boss.x, y: boss.y, angle: 0, range: atk.projRange, arc: 360, sec: atk.telegraphSec,
      });
    }
  }
}

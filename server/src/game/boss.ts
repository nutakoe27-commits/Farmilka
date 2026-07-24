import { angleDiff, clamp, dist } from '@shared/math.js';
import type { BossId } from '@shared/types.js';
import type { BiomeId } from '@shared/biomes.js';
import { randomPointInBiome } from '@shared/biomes.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import type { Boss, Player } from './entities.js';
import { applyDamage, type DamageSource } from './combat.js';
import { telemetry } from '../db/telemetry.js';
import { grantHat, randomHatOfTier } from './hats.js';

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
      timer.pos = randomPointInBiome(cfg.biome, bal.world.size, 250);
      timer.warned = true;
      world.broadcast({ e: 'bossWarn', boss: cfg.name, bossId: bossType, x: timer.pos.x, y: timer.pos.y, inSec: cfg.warnSec });
    }
    if (now >= timer.nextSpawnAt) {
      spawnBoss(world, bossType, timer.pos.x, timer.pos.y, now, cfg.biome);
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
    uniqueReadyAt: now + 6000,
    telegraph: null,
    wanderAngle: Math.random() * Math.PI * 2,
    nextWanderAt: 0,
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

/** Players inside `range` of (x, y) take `damage` from the boss. */
function damageCircle(world: World, boss: Boss, x: number, y: number, range: number, damage: number, now: number, weapon: string): Player[] {
  const cfg = getBalance().bosses[boss.bossType];
  const hitList: Player[] = [];
  const targets = world.grid.queryCircle(x, y, range + 60);
  for (const t of targets) {
    if (t.kind !== 'player' || t.dead) continue;
    const d = dist(x, y, t.x, t.y);
    if (d > range + t.radius) continue;
    if (applyDamage(world, t, damage, { id: boss.id, name: cfg.name, weapon, cause: 'boss' }, now, d)) hitList.push(t);
  }
  return hitList;
}

/** Fires the boss's signature ability: telegraph now, impact after telegraphSec. */
function startUnique(world: World, boss: Boss, target: Player, now: number): void {
  const cfg = getBalance().bosses[boss.bossType];
  const u = cfg.unique;
  const resolveAt = now + u.telegraphSec * 1000;
  const tg = (x: number, y: number, angle: number, range: number, arc: number): void => {
    world.sendNear(boss.x, boss.y, { e: 'bossTelegraph', kind: u.kind, x, y, angle, range, arc, sec: u.telegraphSec });
  };

  switch (u.kind) {
    case 'charge': {
      // dash lane from the boss toward the target's current position
      const angle = Math.atan2(target.y - boss.y, target.x - boss.x);
      const size = getBalance().world.size;
      const ex = clamp(boss.x + Math.cos(angle) * u.range, boss.radius, size - boss.radius);
      const ey = clamp(boss.y + Math.sin(angle) * u.range, boss.radius, size - boss.radius);
      boss.telegraph = { kind: 'unique', resolveAt, angle, points: [{ x: ex, y: ey }] };
      // a narrow long cone reads as a lane on the client
      tg(boss.x, boss.y, angle, u.range, 18);
      break;
    }
    case 'nova': {
      boss.telegraph = { kind: 'unique', resolveAt, angle: 0 };
      tg(boss.x, boss.y, 0, u.range, 360);
      break;
    }
    case 'burrow':
    case 'blink': {
      // strike lands where the victim stood at cast time — they can dodge out
      boss.telegraph = { kind: 'unique', resolveAt, angle: 0, points: [{ x: target.x, y: target.y }] };
      tg(target.x, target.y, 0, u.range, 360);
      break;
    }
    case 'spikes': {
      // eruption under every nearby player (closest first, up to count)
      const count = Math.max(1, Math.floor(u.count ?? 3));
      const candidates: { p: Player; d: number }[] = [];
      for (const p of world.players.values()) {
        if (p.dead || (!p.ws && !p.bot)) continue;
        const d = dist(boss.x, boss.y, p.x, p.y);
        if (d < 1100) candidates.push({ p, d });
      }
      candidates.sort((a, b) => a.d - b.d);
      const points = candidates.slice(0, count).map(({ p }) => ({ x: p.x, y: p.y }));
      if (!points.length) return;
      boss.telegraph = { kind: 'unique', resolveAt, angle: 0, points };
      for (const pt of points) tg(pt.x, pt.y, 0, u.range, 360);
      break;
    }
  }
  boss.uniqueReadyAt = now + u.cooldownSec * 1000;
  // hold regular attacks briefly so abilities don't overlap mid-telegraph
  boss.attackReadyAt = Math.max(boss.attackReadyAt, resolveAt + 800);
}

/** Impact of the signature ability once its telegraph runs out. */
function resolveUnique(world: World, boss: Boss, now: number): void {
  const cfg = getBalance().bosses[boss.bossType];
  const u = cfg.unique;
  const tg = boss.telegraph!;
  boss.telegraph = null;

  switch (u.kind) {
    case 'charge': {
      const end = tg.points![0];
      const width = u.width ?? 90;
      // damage every player near the dash segment, then land at the endpoint
      const midX = (boss.x + end.x) / 2;
      const midY = (boss.y + end.y) / 2;
      const half = dist(boss.x, boss.y, end.x, end.y) / 2;
      const candidates = world.grid.queryCircle(midX, midY, half + width + 80);
      const dx = end.x - boss.x;
      const dy = end.y - boss.y;
      const len2 = dx * dx + dy * dy || 1;
      for (const t of candidates) {
        if (t.kind !== 'player' || t.dead) continue;
        const proj = clamp(((t.x - boss.x) * dx + (t.y - boss.y) * dy) / len2, 0, 1);
        const cx = boss.x + dx * proj;
        const cy = boss.y + dy * proj;
        const d = dist(cx, cy, t.x, t.y);
        if (d > width + t.radius) continue;
        applyDamage(world, t, u.damage, { id: boss.id, name: cfg.name, weapon: 'boss-charge', cause: 'boss' }, now, d);
      }
      world.moveEntity(boss, end.x, end.y);
      break;
    }
    case 'nova': {
      const hit = damageCircle(world, boss, boss.x, boss.y, u.range, u.damage, now, 'boss-nova');
      const chillUntil = now + (u.chillSec ?? 2.5) * 1000;
      for (const p of hit) {
        if (p.dead) continue;
        p.chillUntil = chillUntil;
        p.chillFactor = u.chillFactor ?? 0.5;
        world.markDirty(p);
      }
      break;
    }
    case 'burrow':
    case 'blink': {
      const pt = tg.points![0];
      world.moveEntity(boss, pt.x, pt.y);
      damageCircle(world, boss, pt.x, pt.y, u.range, u.damage, now, `boss-${u.kind}`);
      break;
    }
    case 'spikes': {
      for (const pt of tg.points!) {
        damageCircle(world, boss, pt.x, pt.y, u.range, u.damage, now, 'boss-spikes');
      }
      break;
    }
  }
}

function updateBoss(world: World, boss: Boss, dt: number, now: number): void {
  const cfg = getBalance().bosses[boss.bossType];
  const size = getBalance().world.size;

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
    if (tg.kind === 'unique') {
      resolveUnique(world, boss, now);
      return;
    }
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
  if (!target) {
    // nobody around: roam the map slowly — bosses are free to leave their biome
    if (now >= boss.nextWanderAt) {
      boss.nextWanderAt = now + 2500 + Math.random() * 3000;
      boss.wanderAngle = Math.random() * Math.PI * 2;
    }
    const nx = clamp(boss.x + Math.cos(boss.wanderAngle) * cfg.speed * 0.45 * dt, boss.radius, size - boss.radius);
    const ny = clamp(boss.y + Math.sin(boss.wanderAngle) * cfg.speed * 0.45 * dt, boss.radius, size - boss.radius);
    boss.angle = boss.wanderAngle;
    world.moveEntity(boss, nx, ny);
    return;
  }

  const d = dist(boss.x, boss.y, target.x, target.y);
  boss.angle = Math.atan2(target.y - boss.y, target.x - boss.x);
  boss.movedTick = world.tickNo;

  if (d > cfg.slam.range * 0.6) {
    // chases across the whole map (clamped to world bounds only)
    const nx = clamp(boss.x + Math.cos(boss.angle) * cfg.speed * dt, boss.radius, size - boss.radius);
    const ny = clamp(boss.y + Math.sin(boss.angle) * cfg.speed * dt, boss.radius, size - boss.radius);
    world.moveEntity(boss, nx, ny);
  }

  // contact damage with a per-player 1s cooldown
  if (d < boss.radius + target.radius + 5 && now - target.lastBossContactAt > 1000) {
    target.lastBossContactAt = now;
    applyDamage(world, target, cfg.contactDamage, { id: boss.id, name: cfg.name, weapon: 'boss-contact', cause: 'boss' }, now, d);
  }

  // signature ability first (own cooldown), then the regular slam/burst kit
  if (now >= boss.uniqueReadyAt && d <= 900) {
    startUnique(world, boss, target, now);
    return;
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

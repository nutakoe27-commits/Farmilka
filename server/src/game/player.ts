import { clamp } from '@shared/math.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import { performAttack } from './combat.js';

export function updatePlayers(world: World, dt: number, now: number): void {
  const bal = getBalance();
  for (const p of world.players.values()) {
    if (p.dead) {
      if (p.respawnAt && now >= p.respawnAt && p.ws) world.respawnPlayer(p);
      continue;
    }
    if (!p.ws) continue;

    // movement from held input, server-clamped
    let mx = clamp(p.input.mx, -1, 1);
    let my = clamp(p.input.my, -1, 1);
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const w = bal.weapons[p.equipped];
    let speed = bal.player.speed;
    if (w.type === 'ranged' && p.input.attack && w.slowFactor) speed *= w.slowFactor;
    if (mx !== 0 || my !== 0) {
      world.moveEntity(p, p.x + mx * speed * dt, p.y + my * speed * dt);
    }
    if (p.angle !== p.input.aim) {
      p.angle = p.input.aim;
      p.movedTick = world.tickNo;
    }

    if (p.input.attack && now >= p.attackReadyAt) {
      p.attackReadyAt = now + 1000 / w.attackRate;
      performAttack(world, p, w, now);
    }

    // out-of-combat regen
    if (p.hp < p.maxHp && now - p.lastDamagedAt > bal.player.regenDelaySec * 1000) {
      p.hp = Math.min(p.maxHp, p.hp + bal.player.regenPerSec * dt);
      p.dirtyTick = world.tickNo;
    }
  }
}

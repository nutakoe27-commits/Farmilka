import { clamp } from '@shared/math.js';
import { getBalance } from './balance.js';
import type { World } from './world.js';
import { performAttack, tickStatus, chillSpeedFactor } from './combat.js';
import { hatEffects } from './hats.js';

export function updatePlayers(world: World, dt: number, now: number): void {
  const bal = getBalance();
  for (const p of world.players.values()) {
    if (p.dead) {
      // bots auto-respawn once the timer is up; real players respawn on demand
      // (via the 'respawn' message) so they can shop during the death break
      if (p.bot && p.respawnAt && now >= p.respawnAt) world.respawnPlayer(p);
      continue;
    }
    if (!p.ws && !p.bot) continue;

    // movement from held input, server-clamped
    let mx = clamp(p.input.mx, -1, 1);
    let my = clamp(p.input.my, -1, 1);
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    tickStatus(world, p, now);
    if (p.dead) continue; // poison may have just killed them

    const w = bal.weapons[p.equipped];
    const hat = hatEffects(p.hat);
    let speed = bal.player.speed * hat.speedMult * chillSpeedFactor(p, now);
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

    // spawn protection expiry must dirty the entity so others see the ring drop
    if (p.invulnUntil !== 0 && p.invulnUntil <= now) {
      p.invulnUntil = 0;
      p.dirtyTick = world.tickNo;
    }

    // out-of-combat regen
    if (p.hp < p.maxHp && now - p.lastDamagedAt > bal.player.regenDelaySec * 1000) {
      p.hp = Math.min(p.maxHp, p.hp + bal.player.regenPerSec * hat.regenMult * dt);
      p.dirtyTick = world.tickNo;
    }
  }
}

import { getBalance } from './balance.js';
import type { World } from './world.js';
import { buildSnapshot } from '../net/snapshot.js';

export function startLoop(world: World): void {
  const tickMs = 1000 / getBalance().world.tickRate;
  const dt = tickMs / 1000;
  let nextAt = Date.now() + tickMs;
  let slowTicks = 0;

  const tick = (): void => {
    const start = Date.now();
    try {
      world.tick(start, dt);
      for (const p of world.connectedPlayers()) {
        world.send(p, buildSnapshot(world, p));
      }
    } catch (err) {
      console.error('[loop] tick error', err);
    }
    const dur = Date.now() - start;
    if (dur > 40) {
      slowTicks++;
      if (slowTicks % 20 === 1) console.warn(`[loop] slow tick: ${dur}ms (${world.players.size} players, ${world.entities.size} entities)`);
    }
    nextAt += tickMs;
    const delay = nextAt - Date.now();
    if (delay < -1000) nextAt = Date.now() + tickMs; // fell far behind; resync
    setTimeout(tick, Math.max(0, delay));
  };
  setTimeout(tick, tickMs);
  console.log(`[loop] running at ${getBalance().world.tickRate} TPS`);
}

import { getBalance } from './balance.js';
import type { World } from './world.js';
import { buildSnapshot } from '../net/snapshot.js';

export function startLoop(worlds: World[]): void {
  const tickMs = 1000 / getBalance().world.tickRate;
  const dt = tickMs / 1000;
  let nextAt = Date.now() + tickMs;
  let slowTicks = 0;

  const tick = (): void => {
    const start = Date.now();
    for (const world of worlds) {
      try {
        world.tick(start, dt);
        for (const p of world.connectedPlayers()) {
          world.send(p, buildSnapshot(world, p));
        }
      } catch (err) {
        console.error(`[loop] tick error (server ${world.serverId})`, err);
      }
    }
    const dur = Date.now() - start;
    if (dur > 40) {
      slowTicks++;
      if (slowTicks % 20 === 1) {
        const stats = worlds.map((w) => `s${w.serverId}:${w.connectedPlayers().length}p/${w.entities.size}e`).join(' ');
        console.warn(`[loop] slow tick: ${dur}ms (${stats})`);
      }
    }
    nextAt += tickMs;
    const delay = nextAt - Date.now();
    if (delay < -1000) nextAt = Date.now() + tickMs; // fell far behind; resync
    setTimeout(tick, Math.max(0, delay));
  };
  setTimeout(tick, tickMs);
  console.log(`[loop] ${worlds.length} world(s) at ${getBalance().world.tickRate} TPS`);
}

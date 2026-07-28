import { getBalance } from './balance.js';
import { encodeSnapshot } from '@shared/snapshot-codec.js';
import type { WorldManager } from './world-manager.js';
import { buildSnapshot } from '../net/snapshot.js';

export function startLoop(worlds: WorldManager): void {
  const tickMs = 1000 / getBalance().world.tickRate;
  const dt = tickMs / 1000;
  let nextAt = Date.now() + tickMs;
  let slowTicks = 0;
  let lastSample = Date.now();

  const tick = (): void => {
    const start = Date.now();
    const active = worlds.active();
    for (const world of active) {
      try {
        const t0 = Date.now();
        world.tick(start, dt);
        let bytes = 0;
        for (const p of world.connectedPlayers()) {
          const buf = encodeSnapshot(buildSnapshot(world, p)); // binary — the bandwidth hog
          p.ws?.send(buf);
          bytes += buf.length;
        }
        world.tickMs = world.tickMs * 0.9 + (Date.now() - t0) * 0.1;
        world.bytesOut += bytes;
      } catch (err) {
        console.error(`[loop] tick error (server ${world.serverId})`, err);
      }
    }
    worlds.reap(start); // tear down worlds that have sat empty
    worlds.seedBases(start); // keep absent players' bases available to raid

    // once per second, turn byte accumulators into a rate
    if (start - lastSample >= 1000) {
      const secs = (start - lastSample) / 1000;
      for (const world of active) {
        world.bytesRate = world.bytesOut / secs;
        world.bytesOut = 0;
      }
      lastSample = start;
    }
    const dur = Date.now() - start;
    if (dur > 40) {
      slowTicks++;
      if (slowTicks % 20 === 1) {
        const stats = active.map((w) => `s${w.serverId}:${w.connectedPlayers().length}p/${w.entities.size}e`).join(' ');
        console.warn(`[loop] slow tick: ${dur}ms (${stats})`);
      }
    }
    nextAt += tickMs;
    const delay = nextAt - Date.now();
    if (delay < -1000) nextAt = Date.now() + tickMs; // fell far behind; resync
    setTimeout(tick, Math.max(0, delay));
  };
  setTimeout(tick, tickMs);
  console.log(`[loop] dynamic worlds at ${getBalance().world.tickRate} TPS`);
}

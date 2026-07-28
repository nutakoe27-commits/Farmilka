import { loadBalance, watchBalance, getBalance } from './game/balance.js';
import { openDb } from './db/db.js';
import { startTelemetryFlusher, telemetry } from './db/telemetry.js';
import { pruneStaleBases } from './db/accounts.js';
import { WorldManager } from './game/world-manager.js';
import { startLoop } from './game/loop.js';
import { startServer } from './net/socket.js';

loadBalance();
watchBalance();
openDb();
telemetry.closeDanglingSessions(); // heal sessions orphaned by a previous crash/restart
startTelemetryFlusher();

// Bases of long-absent players are cleared so the raid pool stays fresh and the
// account table does not accumulate dead layouts forever.
const BASE_TTL_DAYS = Number(process.env.BASE_TTL_DAYS) || 14;
const pruneBases = (): void => {
  try {
    const n = pruneStaleBases(BASE_TTL_DAYS * 86_400_000);
    if (n > 0) console.log(`[base] pruned ${n} bases idle for ${BASE_TTL_DAYS}+ days`);
  } catch (err) {
    console.error('[base] prune failed', err);
  }
};
pruneBases();
setInterval(pruneBases, 6 * 3600 * 1000).unref();

// close open sessions cleanly on shutdown so playtime stays accurate
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    try { telemetry.closeOpenSessions(Date.now()); } catch { /* best effort */ }
    process.exit(0);
  });
}

// worlds grow/shrink with demand between servers..maxServers (see WorldManager)
const worlds = new WorldManager();
startServer(worlds);
startLoop(worlds);

const bal = getBalance();
console.log(`[farmclash] up: ${bal.world.servers}..${bal.world.maxServers} worlds × ${bal.world.maxPlayers} players (dynamic)`);

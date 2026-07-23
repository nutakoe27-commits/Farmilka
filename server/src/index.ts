import { loadBalance, watchBalance, getBalance } from './game/balance.js';
import { openDb } from './db/db.js';
import { startTelemetryFlusher, telemetry } from './db/telemetry.js';
import { WorldManager } from './game/world-manager.js';
import { startLoop } from './game/loop.js';
import { startServer } from './net/socket.js';

loadBalance();
watchBalance();
openDb();
telemetry.closeDanglingSessions(); // heal sessions orphaned by a previous crash/restart
startTelemetryFlusher();

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

import { loadBalance, watchBalance, getBalance } from './game/balance.js';
import { openDb } from './db/db.js';
import { startTelemetryFlusher } from './db/telemetry.js';
import { World } from './game/world.js';
import { startLoop } from './game/loop.js';
import { startServer } from './net/socket.js';

loadBalance();
watchBalance();
openDb();
startTelemetryFlusher();

// number of worlds is fixed at boot (changing it in balance.json needs a restart)
const count = Math.max(1, Math.floor(getBalance().world.servers));
const worlds = Array.from({ length: count }, (_, i) => new World(i + 1));
startServer(worlds);
startLoop(worlds);

console.log(`[farmilka] up with ${count} game server(s)`);

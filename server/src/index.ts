import { loadBalance, watchBalance } from './game/balance.js';
import { openDb } from './db/db.js';
import { startTelemetryFlusher } from './db/telemetry.js';
import { World } from './game/world.js';
import { startLoop } from './game/loop.js';
import { startServer } from './net/socket.js';

loadBalance();
watchBalance();
openDb();
startTelemetryFlusher();

const world = new World();
startServer(world);
startLoop(world);

console.log('[farmilka] server up');

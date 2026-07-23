// Verifies the session-orphan fix: closeDanglingSessions (startup heal) and
// closeOpenSessions (graceful shutdown) both leave no left_ts IS NULL rows.
import { openDb, getDb } from '../src/db/db.js';
import { telemetry } from '../src/db/telemetry.js';

process.env.DATA_DIR = '/tmp/claude-0/-home-user-Farmilka/9e0a0f6e-42bb-5164-af32-dc77ab722252/scratchpad/session-heal';
openDb();
const db = getDb();
db.prepare('DELETE FROM sessions').run();

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

// simulate two orphaned sessions from a previous crash (left_ts NULL)
const s1 = telemetry.sessionStart('Ghost1');
const s2 = telemetry.sessionStart('Ghost2');
const open = () => (db.prepare('SELECT COUNT(*) c FROM sessions WHERE left_ts IS NULL').get() as { c: number }).c;
check('two sessions start open', open() === 2, `open=${open()}`);

// startup heal closes them at joined_ts (0-length, not "still running to now")
telemetry.closeDanglingSessions();
check('startup heal closes dangling sessions', open() === 0, `open=${open()}`);
const r1 = db.prepare('SELECT joined_ts, left_ts FROM sessions WHERE id = ?').get(s1) as { joined_ts: number; left_ts: number };
check('healed session has left_ts == joined_ts (0 length)', r1.left_ts === r1.joined_ts, `d=${r1.left_ts - r1.joined_ts}`);

// a live session then a graceful shutdown close
const s3 = telemetry.sessionStart('Live');
check('new live session is open', open() === 1);
const now = Date.now();
telemetry.closeOpenSessions(now);
check('graceful shutdown closes open sessions', open() === 0, `open=${open()}`);
const r3 = db.prepare('SELECT left_ts FROM sessions WHERE id = ?').get(s3) as { left_ts: number };
check('live session closed at shutdown ts', r3.left_ts === now, `left_ts=${r3.left_ts}`);
void s2;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

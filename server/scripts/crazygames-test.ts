// CrazyGames integration probe: user-token verification (trust + strict mode)
// and the account mapping it drives. The wire test needs a server on :3994.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`);
  ok ? pass++ : fail++;
};

const b64url = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Builds a JWT; signs it when a private key is given, else a junk signature. */
function makeToken(payload: object, key?: crypto.KeyObject): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const body = `${b64url(header)}.${b64url(payload)}`;
  if (!key) return `${body}.notarealsignature`;
  const sig = crypto.sign('sha256', Buffer.from(body), key).toString('base64url');
  return `${body}.${sig}`;
}

// A fixed key pair keeps the child processes and the parent in agreement.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIV_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 3600;

const SELF = fileURLToPath(import.meta.url);

/**
 * The auth module reads its env once at import time, so each mode has to run in
 * its own process. The parent re-invokes this file with a mode argument and
 * just relays the child's PASS/FAIL lines.
 */
function runChild(mode: 'trust' | 'strict'): void {
  const env: NodeJS.ProcessEnv = { ...process.env, CG_TEST_PRIV: PRIV_PEM };
  if (mode === 'strict') {
    env.CRAZYGAMES_PUBLIC_KEY = PUB_PEM;
    env.CRAZYGAMES_VERIFY_TOKEN = '1';
  } else {
    delete env.CRAZYGAMES_PUBLIC_KEY;
    delete env.CRAZYGAMES_VERIFY_TOKEN;
  }
  const out = execFileSync('npx', ['tsx', SELF, mode], { env, encoding: 'utf8' });
  process.stdout.write(out);
  for (const line of out.split('\n')) {
    if (line.startsWith('PASS:')) pass++;
    else if (line.startsWith('FAIL:')) fail++;
  }
}

/** Child entry point: runs one mode's assertions against a freshly imported module. */
async function child(mode: 'trust' | 'strict'): Promise<void> {
  const { verifyCrazyGamesToken } = await import('../src/game/crazygames-auth.js');
  const priv = crypto.createPrivateKey(process.env.CG_TEST_PRIV!);
  if (mode === 'trust') {
    const ok = verifyCrazyGamesToken(makeToken({ userId: 'cg-42', username: 'Alice', exp: future }));
    check('trust mode: decodes userId + username', ok?.userId === 'cg-42' && ok?.username === 'Alice', JSON.stringify(ok));
    check('trust mode: rejects a malformed token', verifyCrazyGamesToken('not.a.jwt') === null);
    check('trust mode: rejects an empty token', verifyCrazyGamesToken(undefined) === null);
    check('trust mode: still rejects an expired token', verifyCrazyGamesToken(makeToken({ userId: 'x', exp: past })) === null);
    check('trust mode: rejects a token with no user id', verifyCrazyGamesToken(makeToken({ username: 'NoId', exp: future })) === null);
  } else {
    const signed = makeToken({ userId: 'cg-7', username: 'Bob', exp: future }, priv);
    const good = verifyCrazyGamesToken(signed);
    check('strict mode: accepts a correctly signed token', good?.userId === 'cg-7', JSON.stringify(good));
    check('strict mode: rejects a forged signature', verifyCrazyGamesToken(makeToken({ userId: 'cg-evil', exp: future })) === null);
    // tampering with the payload must invalidate the signature
    const parts = signed.split('.');
    const tampered = `${parts[0]}.${b64url({ userId: 'cg-admin', exp: future })}.${parts[2]}`;
    check('strict mode: rejects a tampered payload', verifyCrazyGamesToken(tampered) === null);
    check('strict mode: rejects an expired but validly signed token',
      verifyCrazyGamesToken(makeToken({ userId: 'cg-7', exp: past }, priv)) === null);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

async function main(): Promise<void> {
  runChild('trust');
  runChild('strict');

  // ---- over the wire: the token logs us into a persistent account ----
  {
    const token = makeToken({ userId: 'cg-wire-1', username: 'WireUser', exp: future });
    const join = (): Promise<{ registered: boolean; name: string; server: number }> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket('ws://localhost:3994/ws');
        ws.binaryType = 'nodebuffer';
        const t = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 8000);
        ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'Ignored', cgToken: token })));
        ws.on('message', (d, isBinary) => {
          if (isBinary) return;
          const m = JSON.parse(d.toString());
          if (m.t === 'reject') { clearTimeout(t); ws.close(); reject(new Error(m.reason)); }
          if (m.t !== 'welcome') return;
          clearTimeout(t);
          // hold the socket briefly so the server records the session, then leave
          setTimeout(() => ws.close(), 150);
          resolve({ registered: m.registered, name: 'WireUser', server: m.server });
        });
        ws.on('error', (e) => { clearTimeout(t); reject(e); });
      });

    const first = await join();
    check('wire: cgToken logs in as a registered account', first.registered === true, `server=${first.server}`);
    await new Promise((r) => setTimeout(r, 600)); // let the single-session guard clear
    const second = await join();
    check('wire: the same token returns to the same account', second.registered === true);

    // a junk token must be refused outright
    let refused = false;
    try {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket('ws://localhost:3994/ws');
        const t = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 8000);
        ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'Bad', cgToken: 'garbage' })));
        ws.on('message', (d, isBinary) => {
          if (isBinary) return;
          const m = JSON.parse(d.toString());
          if (m.t === 'reject') { refused = true; clearTimeout(t); ws.close(); resolve(null); }
          if (m.t === 'welcome') { clearTimeout(t); ws.close(); resolve(null); }
        });
        ws.on('error', (e) => { clearTimeout(t); reject(e); });
      });
    } catch { /* treated below */ }
    check('wire: a malformed token is rejected', refused);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
const arg = process.argv[2];
const entry = arg === 'trust' || arg === 'strict' ? child(arg) : main();
entry.catch((e) => { console.error(e); process.exit(1); });

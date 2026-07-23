import crypto from 'node:crypto';

// Verifies the signed player id that the Yandex Games Player API hands the
// client (player.getSignature()). The client forwards { yandexId, yandexSig };
// we recompute the HMAC with the game's secret and compare.
//
// Two knobs, so this is safe both before and after the game is registered:
//   YANDEX_GAME_SECRET  — the secret from the Yandex developer console.
//   YANDEX_VERIFY_SIG=1 — turn on STRICT verification (reject bad signatures).
//
// Default (no secret, or flag off) is TRUST mode: accept the id as-is. That is
// correct for pre-launch / URL-draft testing, where no real player ids are at
// stake. Flip YANDEX_VERIFY_SIG=1 (with the secret set) only after confirming
// the exact signing scheme against the live docs for the registered game.
const SECRET = process.env.YANDEX_GAME_SECRET ?? '';
const STRICT = process.env.YANDEX_VERIFY_SIG === '1';

let warned = false;

export function verifyYandexSignature(yandexId: string, signature: string | undefined): boolean {
  if (!yandexId) return false;
  if (!STRICT || !SECRET) {
    if (!warned && !SECRET) {
      warned = true;
      console.warn('[yandex] signature verification is OFF (set YANDEX_GAME_SECRET + YANDEX_VERIFY_SIG=1 to enforce)');
    }
    return true;
  }
  if (!signature) return false;
  // Documented scheme: base64url( HMAC_SHA256( uid, secret ) ). Confirm against
  // the console/docs for the registered game before relying on STRICT mode.
  const expected = crypto.createHmac('sha256', SECRET).update(yandexId).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

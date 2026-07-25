import crypto from 'node:crypto';

// Verifies the CrazyGames user token that the client gets from
// SDK.user.getUserToken(). It is a JWT whose payload carries the player's
// userId (plus username / profilePictureUrl); CrazyGames signs it and hands
// developers a public key in the developer portal to verify it server-side.
//
// Two knobs, mirroring the Yandex adapter, so this is safe both before and
// after the game is registered:
//   CRAZYGAMES_PUBLIC_KEY  — the PEM public key from the developer portal
//                            (literal newlines or \n escapes both work).
//   CRAZYGAMES_VERIFY_TOKEN=1 — turn on STRICT verification (reject bad tokens).
//
// Default (no key, or flag off) is TRUST mode: decode the payload without
// checking the signature. That is correct for pre-launch testing where no real
// accounts are at stake. Turn STRICT on once the key is configured.

const RAW_KEY = process.env.CRAZYGAMES_PUBLIC_KEY ?? '';
const PUBLIC_KEY = RAW_KEY.includes('\\n') ? RAW_KEY.replace(/\\n/g, '\n') : RAW_KEY;
const STRICT = process.env.CRAZYGAMES_VERIFY_TOKEN === '1';

let warned = false;

export interface CrazyGamesUser {
  userId: string;
  username: string;
}

function b64urlToBuffer(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** RS256/ES256 signature check against the portal's public key. */
function signatureValid(header: Record<string, unknown>, signedPart: string, signature: string): boolean {
  if (!PUBLIC_KEY) return false;
  const alg = String(header.alg ?? '');
  const algo = alg === 'RS256' || alg === 'ES256' ? 'sha256' : alg === 'RS512' || alg === 'ES512' ? 'sha512' : null;
  if (!algo) return false;
  try {
    const verifier = crypto.createVerify(algo);
    verifier.update(signedPart);
    verifier.end();
    const dsaEncoding = alg.startsWith('ES') ? ('ieee-p1363' as const) : undefined;
    return verifier.verify(
      dsaEncoding ? { key: PUBLIC_KEY, dsaEncoding } : PUBLIC_KEY,
      b64urlToBuffer(signature),
    );
  } catch {
    return false;
  }
}

/**
 * Decodes (and in STRICT mode verifies) the token. Returns null when the token
 * is malformed, expired, or fails verification.
 */
export function verifyCrazyGamesToken(token: string | undefined): CrazyGamesUser | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlToBuffer(parts[0]).toString('utf8'));
    payload = JSON.parse(b64urlToBuffer(parts[1]).toString('utf8'));
  } catch {
    return null;
  }

  // expiry is enforced whenever the token carries one, in both modes
  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  if (exp !== null && Date.now() / 1000 > exp) return null;

  if (STRICT && PUBLIC_KEY) {
    if (!signatureValid(header, `${parts[0]}.${parts[1]}`, parts[2])) return null;
  } else if (!warned) {
    warned = true;
    console.warn('[crazygames] token verification is OFF (set CRAZYGAMES_PUBLIC_KEY + CRAZYGAMES_VERIFY_TOKEN=1 to enforce)');
  }

  // CrazyGames documents the claim as userId; accept the usual JWT aliases too
  const userId = String(payload.userId ?? payload.user_id ?? payload.sub ?? '');
  if (!userId) return null;
  const username = String(payload.username ?? payload.name ?? '').slice(0, 16);
  return { userId, username };
}

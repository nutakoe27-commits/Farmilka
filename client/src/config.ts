// Where the game server lives. On our own domain (or local dev) the client and
// server share an origin, so we use relative/same-host URLs. When the client is
// hosted somewhere else — e.g. the Yandex Games archive runs on Yandex's CDN —
// it must reach the authoritative server on our VPS by absolute address.
//
// Override at build time with VITE_SERVER_ORIGIN (e.g. https://farmclash.online).

const SELF_HOSTS = ['farmclash.online', 'www.farmclash.online', 'localhost', '127.0.0.1'];
const ENV = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
const OVERRIDE = (ENV.VITE_SERVER_ORIGIN || '').trim();
const DEFAULT_ORIGIN = 'https://farmclash.online';

/**
 * Which portal this build targets, set at build time with VITE_PLATFORM
 * ('yandex' | 'crazygames'). Empty = the standalone site. Only the matching
 * SDK is ever loaded, so each archive stays clean of the other portal's code.
 */
export type PlatformId = '' | 'yandex' | 'crazygames';
const RAW_PLATFORM = (ENV.VITE_PLATFORM || '').trim().toLowerCase();
export const PLATFORM: PlatformId =
  RAW_PLATFORM === 'crazygames' ? 'crazygames' : RAW_PLATFORM === 'yandex' ? 'yandex' : '';

const onSelf = SELF_HOSTS.includes(location.hostname);
const useRelative = onSelf && !OVERRIDE;

/** True on our own domain / local dev — i.e. NOT hosted on a third-party platform like Yandex. */
export const IS_SELF_HOST = onSelf;

/** HTTP base for API calls: '' means same-origin (relative). */
export const API_ORIGIN = useRelative ? '' : (OVERRIDE || DEFAULT_ORIGIN).replace(/\/$/, '');

/** Full WebSocket URL for the game server. */
export const WS_URL = (() => {
  if (useRelative) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }
  return `${(OVERRIDE || DEFAULT_ORIGIN).replace(/\/$/, '').replace(/^http/, 'ws')}/ws`;
})();

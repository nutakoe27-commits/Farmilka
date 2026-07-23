// Where the game server lives. On our own domain (or local dev) the client and
// server share an origin, so we use relative/same-host URLs. When the client is
// hosted somewhere else — e.g. the Yandex Games archive runs on Yandex's CDN —
// it must reach the authoritative server on our VPS by absolute address.
//
// Override at build time with VITE_SERVER_ORIGIN (e.g. https://farmclash.online).

const SELF_HOSTS = ['farmclash.online', 'www.farmclash.online', 'localhost', '127.0.0.1'];
const OVERRIDE = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_ORIGIN || '').trim();
const DEFAULT_ORIGIN = 'https://farmclash.online';

const onSelf = SELF_HOSTS.includes(location.hostname);
const useRelative = onSelf && !OVERRIDE;

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

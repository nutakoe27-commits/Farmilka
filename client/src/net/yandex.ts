// Yandex Games SDK adapter. Everything here is optional and guarded: on the
// standalone site (farmclash.online) the SDK never loads and every call is a
// no-op, so nothing changes. Inside the Yandex platform (the game runs in an
// iframe) we load the SDK, authenticate via the Player API, mark gameplay for
// their metrics/ads, and expose ad helpers.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { IS_SELF_HOST } from '../config.js';
import { setLangLive, hasManualLang } from '../ui/i18n.js';
import { audio } from '../game/audio.js';

interface State {
  available: boolean;
  sdk: any | null;
  id: string;
  name: string;
  sig: string;
  lang: 'ru' | 'en' | null;
}

const state: State = { available: false, sdk: null, id: '', name: '', sig: '', lang: null };

function loadScript(src: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('sdk load failed'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('sdk load timeout')), timeoutMs);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

async function readPlayer(): Promise<void> {
  if (!state.sdk) return;
  try {
    const player = await state.sdk.getPlayer({ scopes: false }); // no personal-data consent prompt
    state.id = player.getUniqueID?.() ?? '';
    state.name = String(player.getName?.() ?? '').slice(0, 16);
    try {
      const sig = await player.getSignature?.();
      state.sig = typeof sig === 'string' ? sig : '';
    } catch { /* signature unavailable */ }
  } catch { /* not authenticated */ }
}

/**
 * Loads + initialises the Yandex SDK. Detection is by host, not by iframe:
 * on our own domain / local dev we skip entirely; anywhere else (the Yandex
 * archive runs on Yandex's origin) we load the platform loader and init. If
 * that doesn't yield a working SDK we silently fall back to standalone.
 * Safe to await anywhere.
 */
export async function initYandex(): Promise<void> {
  if (IS_SELF_HOST) return; // farmclash.online / localhost — never a Yandex host
  // Archive-hosted games load the SDK from /sdk.js (served at the game origin);
  // fall back to the absolute loader just in case.
  try { await loadScript('/sdk.js'); } catch { /* try fallback */ }
  if (!(window as any).YaGames) {
    try { await loadScript('https://yandex.ru/games/sdk/v2'); } catch { /* not on Yandex */ }
  }
  const YaGames = (window as any).YaGames;
  if (!YaGames) return; // not actually running on the Yandex platform
  try {
    state.sdk = await withTimeout(YaGames.init(), 8000);
    state.available = true;
    try {
      const l = state.sdk.environment?.i18n?.lang;
      state.lang = l === 'ru' ? 'ru' : 'en';
      // follow the platform language unless the player picked one manually (rule 2.14)
      if (!hasManualLang()) setLangLive(state.lang);
    } catch { /* no environment */ }
    await readPlayer();
  } catch {
    state.available = false;
  }
}

/** Opens the Yandex login dialog (needs a user gesture), then re-reads the player. Returns true if we got an id. */
export async function promptYandexAuth(): Promise<boolean> {
  if (!state.sdk) return false;
  try { await state.sdk.auth.openAuthDialog(); } catch { /* user dismissed */ }
  await readPlayer();
  return !!state.id;
}

export const yandex = {
  get available(): boolean { return state.available; },
  get lang(): 'ru' | 'en' | null { return state.lang; },
  /** Signed identity for the join message, or null when not authenticated. */
  identity(): { id: string; name: string; sig: string } | null {
    return state.id ? { id: state.id, name: state.name, sig: state.sig } : null;
  },
};

// ---- lifecycle / metrics markers (required by the platform for correct ads) ----
export function gameReady(): void { try { state.sdk?.features?.LoadingAPI?.ready?.(); } catch { /* no-op */ } }
export function gameplayStart(): void { try { state.sdk?.features?.GameplayAPI?.start?.(); } catch { /* no-op */ } }
export function gameplayStop(): void { try { state.sdk?.features?.GameplayAPI?.stop?.(); } catch { /* no-op */ } }

/** Fullscreen ad — call only at natural breaks (death/menu). Mutes game audio while it plays (rule 4.7). */
export function showInterstitial(): void {
  if (!state.sdk) return;
  try {
    state.sdk.adv.showFullscreenAdv({ callbacks: {
      onOpen: () => audio.duckForAd(true),
      onClose: () => audio.duckForAd(false),
      onError: () => audio.duckForAd(false),
    } });
  } catch { /* no-op */ }
}

/** Rewarded ad — grants `onReward` on a counted view; mutes game audio while it plays (rule 4.7). */
export function showRewarded(onReward: () => void): void {
  if (!state.sdk) { return; }
  try {
    state.sdk.adv.showRewardedVideo({ callbacks: {
      onOpen: () => audio.duckForAd(true),
      onRewarded: () => onReward(),
      onClose: () => audio.duckForAd(false),
      onError: () => audio.duckForAd(false),
    } });
  } catch { /* no-op */ }
}

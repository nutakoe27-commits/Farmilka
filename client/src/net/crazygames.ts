// CrazyGames SDK adapter (HTML5 v3). Mirrors net/yandex.ts: every call is
// optional and guarded, so on the standalone site the SDK never loads and all
// of this is a no-op. On the CrazyGames platform we init the SDK, mark
// gameplay for their metrics/ads, drive the Join/Invite room UI (required for
// the Multiplayer landing page), and authenticate via the user token.
//
// The SDK surface is feature-detected rather than assumed: CrazyGames ships
// new methods over time and their docs are not machine-readable from here, so
// anything missing degrades silently instead of throwing.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { audio } from '../game/audio.js';

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

interface State {
  available: boolean;
  sdk: any | null;
  /** signed user token forwarded to our server for account login */
  token: string;
  name: string;
  /** room (= world/server id) currently advertised through the invite button */
  roomId: number | null;
  inviteShown: boolean;
}

const state: State = { available: false, sdk: null, token: '', name: '', roomId: null, inviteShown: false };

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

/** Reads the signed user token + display name, when the player is logged in to CrazyGames. */
async function readUser(): Promise<void> {
  const user = state.sdk?.user;
  if (!user) return;
  try {
    const available = typeof user.isUserAccountAvailable === 'function'
      ? await user.isUserAccountAvailable()
      : user.isUserAccountAvailable;
    if (available === false) return;
  } catch { /* treat as available and let the calls below decide */ }
  try {
    const u = await withTimeout(Promise.resolve(user.getUser()), 5000);
    state.name = String(u?.username ?? '').slice(0, 16);
  } catch { /* not logged in */ }
  try {
    const token = await withTimeout(Promise.resolve(user.getUserToken()), 5000);
    state.token = typeof token === 'string' ? token : '';
  } catch { /* no token — stays a guest */ }
}

/**
 * Loads + initialises the CrazyGames SDK. Only called for the CrazyGames
 * build; if the SDK doesn't load or init fails we silently fall back to the
 * ordinary standalone behaviour. Safe to await anywhere.
 */
export async function initCrazyGames(): Promise<void> {
  try { await loadScript(SDK_URL); } catch { return; }
  const sdk = (window as any).CrazyGames?.SDK;
  if (!sdk) return;
  try {
    // v3 requires an explicit init before any other call
    if (typeof sdk.init === 'function') await withTimeout(Promise.resolve(sdk.init()), 8000);
    state.sdk = sdk;
    state.available = true;
    await readUser();
    // keep the token fresh if the player logs in/out while the tab is open
    try { sdk.user?.addAuthListener?.(() => { void readUser(); }); } catch { /* optional */ }
  } catch {
    state.available = false;
    state.sdk = null;
  }
}

/** Opens the CrazyGames login prompt (needs a user gesture); re-reads the user after. */
export async function promptCrazyGamesAuth(): Promise<boolean> {
  const user = state.sdk?.user;
  if (!user?.showAuthPrompt) return false;
  try { await user.showAuthPrompt(); } catch { /* dismissed */ }
  await readUser();
  return !!state.token;
}

export const crazygames = {
  get available(): boolean { return state.available; },
  /** Signed identity for the join message, or null when playing as a guest. */
  identity(): { token: string; name: string } | null {
    return state.token ? { token: state.token, name: state.name } : null;
  },
  /**
   * True when the platform launched us straight into a multiplayer session
   * (the player clicked an invite / "play with friends").
   */
  get instantMultiplayer(): boolean {
    try {
      const v = state.sdk?.game?.isInstantMultiplayer;
      return typeof v === 'function' ? !!v.call(state.sdk.game) : !!v;
    } catch { return false; }
  },
  /** A parameter carried by the invite link the player followed, or null. */
  inviteParam(key: string): string | null {
    try {
      const v = state.sdk?.game?.getInviteLinkParameter?.(key);
      return typeof v === 'string' && v ? v : null;
    } catch { return null; }
  },
  /** The world the inviting friend is playing in, when we arrived through an invite. */
  invitedRoom(): number | null {
    const raw = this.inviteParam('roomId');
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  },
};

// ---- room / invite UI (required for the CrazyGames Multiplayer page) ----

/**
 * Advertises the world the player is in so friends can join from the
 * CrazyGames UI. Called on entering a world; re-called when the world changes.
 */
export function showInvite(roomId: number): void {
  const game = state.sdk?.game;
  if (!game || state.roomId === roomId) return;
  state.roomId = roomId;
  try {
    // the room is open: our worlds accept joiners until the player cap
    game.showInviteButton?.({ roomId: String(roomId) });
    state.inviteShown = true;
  } catch { /* no-op */ }
  // some SDK versions expose an explicit room update alongside the button
  try { game.updateRoom?.({ roomId: String(roomId), isOpen: true }); } catch { /* optional */ }
}

/** Hides the invite button when the player is no longer in a world. */
export function hideInvite(): void {
  const game = state.sdk?.game;
  state.roomId = null;
  if (!game || !state.inviteShown) return;
  state.inviteShown = false;
  try { game.hideInviteButton?.(); } catch { /* no-op */ }
}

// ---- lifecycle / metrics markers ----

export function cgGameplayStart(): void { try { state.sdk?.game?.gameplayStart?.(); } catch { /* no-op */ } }
export function cgGameplayStop(): void { try { state.sdk?.game?.gameplayStop?.(); } catch { /* no-op */ } }
/** Celebration hook — the site reacts (confetti) on real achievements. */
export function cgHappytime(): void { try { state.sdk?.game?.happytime?.(); } catch { /* no-op */ } }

/** Wraps a callback so that only the first of several SDK callbacks gets through. */
function once(fn: () => void): () => void {
  let done = false;
  return () => { if (!done) { done = true; fn(); } };
}

/**
 * Midgame ad — only at natural breaks (death). Game audio is muted while it
 * plays, and `onDone` fires exactly once when the screen is ours again so the
 * caller can un-pause the game.
 */
export function cgMidgameAd(onDone: () => void = () => {}): void {
  const finish = once(() => { audio.duckForAd(false); onDone(); });
  const ad = state.sdk?.ad;
  if (!ad?.requestAd) { finish(); return; }
  try {
    ad.requestAd('midgame', {
      adStarted: () => audio.duckForAd(true),
      adFinished: () => finish(),
      adError: () => finish(),
    });
  } catch { finish(); }
}

/** Rewarded ad — grants `onReward` only on a completed view. */
export function cgRewardedAd(onReward: () => void, onDone: () => void = () => {}): void {
  const finish = once(() => { audio.duckForAd(false); onDone(); });
  const ad = state.sdk?.ad;
  if (!ad?.requestAd) { finish(); return; }
  try {
    ad.requestAd('rewarded', {
      adStarted: () => audio.duckForAd(true),
      adFinished: () => { onReward(); finish(); },
      adError: () => finish(),
    });
  } catch { finish(); }
}

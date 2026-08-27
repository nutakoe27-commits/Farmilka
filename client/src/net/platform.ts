// One facade over the portal SDKs (Yandex Games / CrazyGames) so the game code
// never branches on which platform it is running on. Exactly one SDK is fetched
// and initialised, chosen at build time by VITE_PLATFORM (see config.ts); on the
// standalone site none is loaded and every call here is a no-op.

import { PLATFORM, IS_SELF_HOST } from '../config.js';
import {
  initYandex, yandex, promptYandexAuth,
  gameReady as yaGameReady, gameplayStart as yaStart, gameplayStop as yaStop,
  showInterstitial as yaInterstitial, showRewarded as yaRewarded,
} from './yandex.js';
import {
  initCrazyGames, crazygames, promptCrazyGamesAuth,
  cgGameplayStart, cgGameplayStop, cgHappytime, cgMidgameAd, cgRewardedAd,
  showInvite, hideInvite,
} from './crazygames.js';

/**
 * Builds without an explicit VITE_PLATFORM keep the historical behaviour:
 * anything that isn't our own host is treated as the Yandex archive.
 */
const isCrazyGames = PLATFORM === 'crazygames';
const isYandex = PLATFORM === 'yandex' || (PLATFORM === '' && !IS_SELF_HOST);

/** Identity to attach to the join message, or null when playing as a guest. */
export interface PlatformIdentity {
  name: string;
  /** Yandex Games: signed player id */
  yandexId?: string;
  yandexSig?: string;
  /** CrazyGames: signed user token */
  cgToken?: string;
}

export async function initPlatform(): Promise<void> {
  if (isCrazyGames) return initCrazyGames();
  if (isYandex) return initYandex();
}

/** True once a portal SDK is live — i.e. we really are running on that platform. */
export function onPlatform(): boolean {
  return isCrazyGames ? crazygames.available : yandex.available;
}

/**
 * True for an archive built *for* a portal, whether or not its SDK answered.
 *
 * The rules that forbid off-site links apply to the build, not to the SDK
 * handshake: if init is slow or fails, the links must still be gone. Anything
 * that only makes sense once the SDK really is live (ads, invites, accounts)
 * keeps using onPlatform().
 */
export function isPortalBuild(): boolean {
  return isCrazyGames || PLATFORM === 'yandex';
}

/** CSS hook used to hide external links, which no portal allows. */
export function platformBodyClass(): string {
  return isCrazyGames ? 'on-crazygames' : 'on-yandex';
}

export function identity(): PlatformIdentity | null {
  if (isCrazyGames) {
    const id = crazygames.identity();
    return id ? { name: id.name, cgToken: id.token } : null;
  }
  const id = yandex.identity();
  return id ? { name: id.name, yandexId: id.id, yandexSig: id.sig } : null;
}

/** Opens the platform's login dialog (requires a user gesture). */
export async function promptAuth(): Promise<boolean> {
  return isCrazyGames ? promptCrazyGamesAuth() : promptYandexAuth();
}

/**
 * True when the platform wants us to skip the menu and drop straight into a
 * session — CrazyGames "instant multiplayer" / a followed invite link.
 */
export function wantsInstantPlay(): boolean {
  return isCrazyGames && (crazygames.instantMultiplayer || crazygames.invitedRoom() !== null);
}

/** The world a friend invited us to, when we arrived through an invite link. */
export function invitedRoom(): number | null {
  return isCrazyGames ? crazygames.invitedRoom() : null;
}

// ---- lifecycle markers ----

export function gameReady(): void {
  if (isYandex) yaGameReady();
}

export function gameplayStart(): void {
  if (isCrazyGames) cgGameplayStart();
  else if (isYandex) yaStart();
}

export function gameplayStop(): void {
  if (isCrazyGames) cgGameplayStop();
  else if (isYandex) yaStop();
}

/** Celebration hook (CrazyGames confetti) — real achievements only. */
export function happytime(): void {
  if (isCrazyGames) cgHappytime();
}

// ---- ads ----

/**
 * Ad screen-time, published to the game so it can stop the world.
 *
 * Yandex 4.7 requires the gameplay to be paused for the whole time an ad owns
 * the screen — including the "реклама через N" warning the SDK shows before the
 * spot itself. The warning arrives before any callback we can hook, so the
 * pause starts the moment we *request* the ad and lifts only when the SDK tells
 * us the screen is ours again.
 */
type AdListener = (active: boolean) => void;
const adListeners: AdListener[] = [];
let adOn = false;
let adWatchdog: ReturnType<typeof setTimeout> | null = null;

/** Register a pause/resume handler; fires with true when an ad takes the screen. */
export function onAdVisibility(fn: AdListener): void {
  adListeners.push(fn);
}

/** True while an ad (or its warning) is on screen — the game must not run. */
export function adActive(): boolean {
  return adOn;
}

function setAdActive(active: boolean): void {
  if (adOn === active) return;
  adOn = active;
  for (const fn of adListeners) {
    try { fn(active); } catch { /* a broken listener must not strand the pause */ }
  }
}

/**
 * Opens the ad window: pauses the game and hands back the one callback that
 * closes it again. Whatever the caller was going to do next — resume, respawn —
 * hangs off `onDone`, so it can only happen once the screen is ours.
 */
function beginAd(onDone: () => void): () => void {
  setAdActive(true);
  let fired = false;
  const finish = (): void => {
    if (fired) return;
    fired = true;
    if (adWatchdog !== null) {
      clearTimeout(adWatchdog);
      adWatchdog = null;
    }
    setAdActive(false);
    onDone();
  };
  // An SDK that never calls back must not freeze the game for good — nor strand
  // a player on the death screen waiting for a respawn that hangs off this.
  adWatchdog = setTimeout(finish, 60_000);
  return finish;
}

/**
 * Fullscreen/midgame ad, and then `onDone`.
 *
 * Yandex 4.4 wants the spot to follow a *non-game* action at a logical pause and
 * to start within 0.33 s of it, with play resuming only once the player closes
 * it. So this is called straight from the button handler, and whatever restarts
 * play is passed in as `onDone` rather than run alongside the ad. Off-platform
 * there is no ad, and `onDone` runs immediately.
 */
export function showInterstitial(onDone: () => void = () => {}): void {
  if (!onPlatform()) { onDone(); return; } // standalone site: no ads
  const done = beginAd(onDone);
  if (isCrazyGames) cgMidgameAd(done);
  else yaInterstitial(done);
}

export function showRewarded(onReward: () => void, onDone: () => void = () => {}): void {
  if (!onPlatform()) { onDone(); return; }
  const done = beginAd(onDone);
  if (isCrazyGames) cgRewardedAd(onReward, done);
  else yaRewarded(onReward, done);
}

// ---- multiplayer rooms (CrazyGames Join/Invite) ----

/** Advertise the world the player is in so friends can join from the portal UI. */
export function enterRoom(serverId: number): void {
  if (isCrazyGames) showInvite(serverId);
}

/** Player left the world (death screen back to menu, disconnect). */
export function leaveRoom(): void {
  if (isCrazyGames) hideInvite();
}

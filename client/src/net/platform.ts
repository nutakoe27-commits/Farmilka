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

/** Fullscreen/midgame ad at a natural break (death screen). */
export function showInterstitial(): void {
  if (isCrazyGames) cgMidgameAd();
  else if (isYandex) yaInterstitial();
}

export function showRewarded(onReward: () => void): void {
  if (isCrazyGames) cgRewardedAd(onReward);
  else if (isYandex) yaRewarded(onReward);
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

// Fullscreen toggle, with the vendor-prefixed fallbacks still needed on Safari.
//
// It deliberately never touches `screen.orientation`. The phone layout is
// portrait-first and stays that way, but locking the orientation would take
// away the player's choice to turn the device — rotating is allowed, just not
// forced.

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const doc = (): FsDocument => document as FsDocument;
const root = (): FsElement => document.documentElement as FsElement;

/** False on iPhone Safari, which only ever fullscreens a <video>. */
export function fullscreenSupported(): boolean {
  const el = root();
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

export function isFullscreen(): boolean {
  return !!(document.fullscreenElement ?? doc().webkitFullscreenElement);
}

/**
 * Enters or leaves fullscreen. Returns false when the browser refused — most
 * often because we are inside a portal iframe that was embedded without
 * `allow="fullscreen"`, which is nothing the game can fix at runtime.
 */
export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (isFullscreen()) {
      const d = doc();
      await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
    } else {
      const el = root();
      await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.());
    }
    return true;
  } catch {
    return false;
  }
}

export function onFullscreenChange(cb: () => void): void {
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb);
}

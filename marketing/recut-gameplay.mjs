// Re-cuts the last take without filming it again.
//
//   VID_DROP=crate node marketing/recut-gameplay.mjs
//
// A take costs several minutes of software rasterising, so a beat that did not
// come off, or a window that wants to be longer, should not cost another one.
// The frames and their capture stamps are still in VID_TMP from the recording,
// and that is everything the cut needs.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cutAndEncode } from './video-cut.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.VID_TMP || '/tmp/farmclash-gameplay';
const SLOWMO = Number(process.env.SLOWMO || 14);
const FPS = Number(process.env.VID_FPS || 60);
const LANG = process.env.VID_LANG || 'ru';
const NAME = process.env.VID_OUT || `farmclash-gameplay-${LANG}.mp4`;
const DROP = new Set((process.env.VID_DROP || '').split(',').filter(Boolean));

const take = JSON.parse(readFileSync(`${OUT}/beats.json`, 'utf8'));

/**
 * Takes filmed before the stamps were persisted only recorded a frame count.
 * The frames themselves are still there though, and each was written the moment
 * it arrived — so the file times stand in for the swap stamps, to within the
 * write. Good enough to cut on, and it saves refilming a take to fix a cut.
 */
function framesFromDisk() {
  return readdirSync(pathJoin(OUT, 'frames')).sort()
    .map((file) => ({ file, t: statSync(pathJoin(OUT, 'frames', file)).mtimeMs / 1000 }));
}

const frames = Array.isArray(take.frames) ? take.frames : framesFromDisk();
if (!Array.isArray(take.frames)) console.log('no stamps in beats.json — recovering them from the frame file times');
console.log(`re-cutting ${frames.length} frames, beats: ${take.beats.map((b) => b.n).join(', ')}`);
if (DROP.size) console.log(`dropping: ${[...DROP].join(', ')}`);

cutAndEncode({
  frames, beats: take.beats,
  out: OUT, dir: DIR, name: NAME, slowmo: SLOWMO, fps: FPS, drop: DROP,
});

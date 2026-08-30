// Re-cuts the last take without filming it again.
//
//   VID_DROP=crate node marketing/recut-gameplay.mjs
//
// A take costs several minutes of software rasterising, so a beat that did not
// come off, or a window that wants to be longer, should not cost another one.
// The frames and their capture stamps are still in VID_TMP from the recording,
// and that is everything the cut needs.

import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
if (!Array.isArray(take.frames)) {
  throw new Error(`${OUT}/beats.json has no frame stamps — it predates the re-cut support, so re-record`);
}
console.log(`re-cutting ${take.frames.length} frames, beats: ${take.beats.map((b) => b.n).join(', ')}`);
if (DROP.size) console.log(`dropping: ${[...DROP].join(', ')}`);

cutAndEncode({
  frames: take.frames, beats: take.beats,
  out: OUT, dir: DIR, name: NAME, slowmo: SLOWMO, fps: FPS, drop: DROP,
});

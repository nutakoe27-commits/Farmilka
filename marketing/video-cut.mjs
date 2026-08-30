// Turns a captured take into the finished master.
//
// Kept apart from the recorder on purpose: the frames and the beat stamps are
// written to disk during the take, so a cut can be reconsidered — a window
// widened, a beat that did not come off dropped — without filming again. That
// matters here, where a take costs several minutes of a software rasteriser.

import { spawnSync } from 'node:child_process';
import { writeFileSync, statSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import ffmpeg from 'ffmpeg-static';

/**
 * The windows that carry the pitch, in story order. Each is capped so no beat
 * drags, and named by the beat it ends on so it can be dropped by name.
 */
export function windows(beats, { slowmo, drop = new Set() }) {
  const at = (n) => beats.find((b) => b.n === n)?.t ?? null;
  const win = [];
  /** Keep the last `maxFinal` seconds of finished video from the [from, to] span. */
  const push = (name, from, to, maxFinal) => {
    if (drop.has(name) || from == null || to == null || to <= from) return;
    win.push([Math.max(from, to - maxFinal * slowmo), to, name]);
  };
  push('combat', at('start'), at('combat'), 5);      // a fight, straight away
  push('built', at('combat'), at('built'), 5);       // walling the base in
  push('banked', at('built'), at('banked'), 1.5);    // the vault and Base Rank
  push('crate', at('banked'), at('crate'), 2);       // a unique weapon out of the crate
  push('breached', at('at-wall'), at('breached'), 4);// smashing into someone's base
  push('looted', at('breached'), at('looted'), 1.5); // scooping the spill
  push('boss', at('boss'), at('end'), 5);            // the boss
  return win;
}

/**
 * One concat list holding only the frames inside the windows, each carrying its
 * own measured duration divided by `slowmo`. ffmpeg resamples that to a constant
 * frame rate, so the real timing of the capture survives the speed-up and a
 * hiccup lands at the right moment instead of smearing the motion around it.
 */
export function cutAndEncode({ frames, beats, out, dir, name, slowmo, fps, drop = new Set() }) {
  const win = windows(beats, { slowmo, drop });
  if (!win.length) throw new Error('no beats recorded — nothing to cut');

  const lines = ['ffconcat version 1.0'];
  let kept = 0;
  for (const [a, b] of win) {
    const idx = [];
    for (let i = 0; i < frames.length; i++) if (frames[i].t >= a && frames[i].t <= b) idx.push(i);
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j];
      // gap to the next captured frame, or a nominal step for the last one
      const raw = j + 1 < idx.length ? frames[idx[j + 1]].t - frames[i].t : 1 / 12;
      lines.push(`file 'frames/${frames[i].file}'`);
      lines.push(`duration ${Math.max(0.001, Math.min(raw, 0.5) / slowmo).toFixed(6)}`);
      kept++;
    }
  }
  lines.push(`file 'frames/${frames[frames.length - 1].file}'`); // concat needs a trailing file
  writeFileSync(`${out}/list.txt`, lines.join('\n'));

  const finalSec = win.reduce((a, [x, y]) => a + (y - x) / slowmo, 0);
  console.log(`cut: ${win.map((w) => w[2]).join(' + ')}`);
  console.log(`     ${kept} frames, ${finalSec.toFixed(1)}s final ` +
    `(${(kept / finalSec).toFixed(0)} distinct fps into a ${fps} fps master)`);

  const file = pathJoin(dir, name);
  const r = spawnSync(ffmpeg, [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${out}/list.txt`,
    '-vf', `scale=1920:1080:flags=lanczos,fps=${fps}`,
    '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '21',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
    '-movflags', '+faststart', file,
  ], { cwd: out, stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) throw new Error('ffmpeg failed');
  console.log('wrote', file, `${(statSync(file).size / 1e6).toFixed(1)} MB`);
  return file;
}

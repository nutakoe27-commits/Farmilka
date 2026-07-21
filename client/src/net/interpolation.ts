import { lerp, lerpAngle } from '@shared/math.js';
import type { Remote } from './connection.js';

export interface Sampled {
  x: number;
  y: number;
  angle: number;
}

/** Samples entity position at server-time `t` from its snapshot buffer. */
export function sample(r: Remote, t: number, out: Sampled): void {
  const buf = r.buf;
  if (buf.length === 0) {
    out.x = r.state.x;
    out.y = r.state.y;
    out.angle = r.state.angle;
    return;
  }
  if (t <= buf[0].t) {
    out.x = buf[0].x;
    out.y = buf[0].y;
    out.angle = buf[0].angle;
    return;
  }
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i].t <= t) {
      const a = buf[i];
      const b = buf[i + 1];
      if (!b) {
        out.x = a.x;
        out.y = a.y;
        out.angle = a.angle;
        return;
      }
      const k = (t - a.t) / Math.max(1, b.t - a.t);
      out.x = lerp(a.x, b.x, k);
      out.y = lerp(a.y, b.y, k);
      out.angle = lerpAngle(a.angle, b.angle, k);
      return;
    }
  }
  const last = buf[buf.length - 1];
  out.x = last.x;
  out.y = last.y;
  out.angle = last.angle;
}

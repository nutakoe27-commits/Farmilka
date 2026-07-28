import { clamp } from './math.js';

/**
 * A solid obstacle. Buildings are drawn as squares (see the client's building
 * body: a rounded rect of half-size `radius`), so they collide as squares too —
 * a circle hitbox would let players clip the visible corners.
 */
export interface Solid {
  x: number;
  y: number;
  /** half-size of the square, matching the rendered body */
  radius: number;
}

/** Is the point strictly inside this square? */
function within(x: number, y: number, s: Solid): boolean {
  return x > s.x - s.radius && x < s.x + s.radius && y > s.y - s.radius && y < s.y + s.radius;
}

/**
 * Ejects a circle of radius `r` centred at (x, y) out of one square solid.
 * Returns null when it is already clear. `all` is the full obstacle set, used
 * only to pick a sane exit when the centre is buried inside the square.
 */
function pushOut(x: number, y: number, r: number, s: Solid, all: Solid[]): { x: number; y: number } | null {
  // closest point on the square to the circle centre
  const cx = clamp(x, s.x - s.radius, s.x + s.radius);
  const cy = clamp(y, s.y - s.radius, s.y + s.radius);
  const dx = x - cx;
  const dy = y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    const push = r - d;
    return { x: x + (dx / d) * push, y: y + (dy / d) * push };
  }
  // Centre is buried inside the square — a wall was raised on top of us, or we
  // were dragged in. Leave through the nearest face that isn't the inside of
  // another solid, so a body in a wall *line* escapes sideways instead of
  // ping-ponging between neighbours.
  const exits = [
    { d: x - (s.x - s.radius), p: { x: s.x - s.radius - r, y } },
    { d: s.x + s.radius - x, p: { x: s.x + s.radius + r, y } },
    { d: y - (s.y - s.radius), p: { x, y: s.y - s.radius - r } },
    { d: s.y + s.radius - y, p: { x, y: s.y + s.radius + r } },
  ].sort((a, b) => a.d - b.d);
  for (const e of exits) {
    if (!all.some((o) => o !== s && within(e.p.x, e.p.y, o))) return e.p;
  }
  return exits[0].p;
}

/**
 * Slides a circle out of every solid it overlaps. Called with the *desired*
 * position: walking into a wall resolves to a push along its normal, which
 * leaves the tangential part of the movement intact — so you slide along a
 * wall line instead of sticking to it.
 *
 * Both the server and the client's prediction run this on the same inputs, so
 * a blocked step is blocked identically on both sides (no rubber-banding).
 */
export function resolveSolids(x: number, y: number, r: number, solids: Solid[]): { x: number; y: number } {
  if (solids.length === 0) return { x, y };
  // A few passes so an inside corner (two walls at once) settles instead of
  // bouncing between them.
  for (let pass = 0; pass < 3; pass++) {
    let touched = false;
    for (const s of solids) {
      const out = pushOut(x, y, r, s, solids);
      if (out) {
        x = out.x;
        y = out.y;
        touched = true;
      }
    }
    if (!touched) break;
  }
  return { x, y };
}

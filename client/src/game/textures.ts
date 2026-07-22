import { Texture } from 'pixi.js';

/** Builds a soft radial-gradient texture (white, so it can be tinted). */
function radial(size: number, midStop = 0): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  if (midStop > 0) g.addColorStop(midStop, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(c);
}

/** Soft halo used for additive glow behind entities and for hit flashes. */
export const GLOW = radial(128, 0.35);
/** Tight spark used for particle bursts and projectile trails. */
export const SPARK = radial(48, 0.2);

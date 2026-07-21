/**
 * World layout — single source of truth for server and client.
 *
 *  ┌────────┬──────────────────┬────────┐
 *  │        │      snow        │        │
 *  │ mystic ├──────────────────┤ mystic │
 *  │  west  │      normal      │  east  │
 *  │        ├──────────────────┤        │
 *  │        │      desert      │        │
 *  └────────┴──────────────────┴────────┘
 */
export type BiomeId = 'normal' | 'snow' | 'desert' | 'mystic_west' | 'mystic_east';

/** Width of each mystic side strip as a fraction of world size. */
export const MYSTIC_FRAC = 0.2;

export const BIOME_NAMES: Record<BiomeId, string> = {
  normal: 'Равнина',
  snow: 'Снега',
  desert: 'Пустыня',
  mystic_west: 'Тёмный лес',
  mystic_east: 'Кристальные пустоши',
};

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function biomeAt(x: number, y: number, size: number): BiomeId {
  const strip = size * MYSTIC_FRAC;
  if (x < strip) return 'mystic_west';
  if (x > size - strip) return 'mystic_east';
  if (y < size / 3) return 'snow';
  if (y > (size * 2) / 3) return 'desert';
  return 'normal';
}

export function biomeRect(b: BiomeId, size: number): Rect {
  const strip = size * MYSTIC_FRAC;
  switch (b) {
    case 'mystic_west': return { x0: 0, y0: 0, x1: strip, y1: size };
    case 'mystic_east': return { x0: size - strip, y0: 0, x1: size, y1: size };
    case 'snow': return { x0: strip, y0: 0, x1: size - strip, y1: size / 3 };
    case 'desert': return { x0: strip, y0: (size * 2) / 3, x1: size - strip, y1: size };
    case 'normal': return { x0: strip, y0: size / 3, x1: size - strip, y1: (size * 2) / 3 };
  }
}

/** Random point inside a biome, keeping `margin` away from its edges. */
export function randomPointInBiome(b: BiomeId, size: number, margin: number, rand: () => number = Math.random): { x: number; y: number } {
  const r = biomeRect(b, size);
  return {
    x: r.x0 + margin + rand() * Math.max(1, r.x1 - r.x0 - margin * 2),
    y: r.y0 + margin + rand() * Math.max(1, r.y1 - r.y0 - margin * 2),
  };
}

import { Graphics } from 'pixi.js';

// Each mob drawn top-down, facing +x (right), so the body's rotation orients it
// toward its target. Distinct silhouette + palette per type.
const OL = 0x0d0f14;

function eyes(g: Graphics, r: number, fx = 0.32, spread = 0.34, sz = 0.15, color = OL): void {
  g.circle(r * fx, -r * spread, r * sz).fill(color);
  g.circle(r * fx, r * spread, r * sz).fill(color);
}

const DRAW: Record<string, (g: Graphics, r: number) => void> = {
  // --- normal biome ---
  slime(g, r) {
    g.moveTo(-r, r * 0.55);
    g.quadraticCurveTo(-r * 1.05, -r * 0.9, 0, -r);
    g.quadraticCurveTo(r * 1.05, -r * 0.9, r, r * 0.55);
    g.lineTo(r, r * 0.6);
    g.quadraticCurveTo(0, r * 0.95, -r, r * 0.6);
    g.closePath().fill(0x5fd068).stroke({ width: 2, color: OL });
    g.ellipse(-r * 0.2, -r * 0.35, r * 0.4, r * 0.22).fill({ color: 0xffffff, alpha: 0.35 });
    eyes(g, r);
    g.circle(r * 0.37, -r * 0.34, r * 0.05).fill(0xffffff);
  },
  wolf(g, r) {
    g.poly([-r * 0.95, r * 0.5, -r * 1.15, 0, -r * 0.7, -r * 0.15]).fill(0x7a828f).stroke({ width: 1.5, color: OL }); // tail
    g.ellipse(-r * 0.15, 0, r * 0.85, r * 0.62).fill(0x9aa5b8).stroke({ width: 2, color: OL }); // body
    g.poly([-r * 0.2, -r * 0.55, r * 0.15, -r * 0.85, r * 0.25, -r * 0.45]).fill(0x9aa5b8).stroke({ width: 1.5, color: OL }); // ear
    g.poly([-r * 0.2, r * 0.55, r * 0.15, r * 0.85, r * 0.25, r * 0.45]).fill(0x9aa5b8).stroke({ width: 1.5, color: OL }); // ear
    g.poly([r * 0.5, -r * 0.3, r * 1.15, 0, r * 0.5, r * 0.3]).fill(0xb3bcc9).stroke({ width: 2, color: OL }); // snout
    g.poly([r * 1.15, -r * 0.06, r * 1.3, 0, r * 1.15, r * 0.06]).fill(0xf0f0f0); // fang tip
    eyes(g, r, 0.45, 0.24, 0.12, 0xffd76e);
  },
  // --- snow biome ---
  ice_slime(g, r) {
    g.poly([-r, r * 0.5, -r * 0.8, -r * 0.5, -r * 0.35, -r * 0.1, 0, -r, r * 0.35, -r * 0.1, r * 0.8, -r * 0.5, r, r * 0.5])
      .fill(0x9fd8ff).stroke({ width: 2, color: 0x3a6a9a });
    g.poly([-r * 0.15, -r * 0.2, 0, -r * 0.75, r * 0.15, -r * 0.2]).fill({ color: 0xffffff, alpha: 0.6 }); // shard glint
    eyes(g, r, 0.28, 0.32, 0.14, 0x2a4a6a);
  },
  yeti(g, r) {
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; g.circle(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92, r * 0.2).fill(0xdfeefc); } // fur
    g.circle(0, 0, r * 0.82).fill(0xeef6ff).stroke({ width: 2, color: 0x9fb8cc });
    g.ellipse(r * 0.55, -r * 0.55, r * 0.34, r * 0.24).fill(0xeef6ff).stroke({ width: 1.5, color: 0x9fb8cc }); // arm
    g.ellipse(r * 0.55, r * 0.55, r * 0.34, r * 0.24).fill(0xeef6ff).stroke({ width: 1.5, color: 0x9fb8cc }); // arm
    g.moveTo(r * 0.1, -r * 0.42).lineTo(r * 0.5, -r * 0.28).moveTo(r * 0.1, r * 0.42).lineTo(r * 0.5, r * 0.28).stroke({ width: 3, color: 0x8aa0b4 }); // brow
    eyes(g, r, 0.4, 0.3, 0.13, 0x2a4a6a);
    g.circle(r * 0.62, 0, r * 0.1).fill(0x8aa0b4); // mouth
  },
  // --- desert biome ---
  scorpion(g, r) {
    // tail arcing over the back with a stinger
    g.moveTo(-r * 0.6, 0).quadraticCurveTo(-r * 1.3, -r * 0.5, -r * 0.7, -r * 0.95).stroke({ width: r * 0.18, color: 0xc08a3a });
    g.poly([-r * 0.7, -r * 1.15, -r * 0.5, -r * 0.85, -r * 0.9, -r * 0.85]).fill(0x8a5a1a); // stinger
    for (const sy of [-1, 1]) { g.moveTo(0, sy * r * 0.4).lineTo(r * 0.4, sy * r * 0.9).moveTo(r * 0.1, sy * r * 0.4).lineTo(r * 0.55, sy * r * 0.8).stroke({ width: 2, color: 0xb8823a }); } // legs
    g.ellipse(-r * 0.1, 0, r * 0.72, r * 0.5).fill(0xd8a24a).stroke({ width: 2, color: OL }); // body
    // pincers reaching forward
    for (const sy of [-1, 1]) {
      g.moveTo(r * 0.5, sy * r * 0.2).lineTo(r * 1.0, sy * r * 0.45).stroke({ width: 3, color: 0xb8823a });
      g.poly([r * 1.0, sy * r * 0.3, r * 1.35, sy * r * 0.45, r * 1.0, sy * r * 0.6]).fill(0xd8a24a).stroke({ width: 1.5, color: OL });
    }
    eyes(g, r, 0.25, 0.2, 0.1, 0x2a1a0a);
  },
  sand_golem(g, r) {
    g.poly([r, 0, r * 0.5, -r * 0.9, -r * 0.55, -r, -r, -r * 0.35, -r * 0.75, r * 0.7, r * 0.2, r]).fill(0xc4954f).stroke({ width: 2.5, color: 0x7a5a2a });
    g.moveTo(-r * 0.2, -r * 0.7).lineTo(r * 0.1, r * 0.2).lineTo(-r * 0.4, r * 0.7).stroke({ width: 2, color: 0x8a6636, alpha: 0.7 }); // crack
    eyes(g, r, 0.35, 0.28, 0.13, 0xffd76e);
  },
  // --- mystic west ---
  shade(g, r) {
    g.moveTo(r, 0);
    g.quadraticCurveTo(r * 0.3, -r, -r * 0.4, -r * 0.7);
    g.quadraticCurveTo(-r * 1.1, -r * 0.2, -r * 0.9, r * 0.3);
    g.quadraticCurveTo(-r * 0.7, r * 0.5, -r * 0.5, r * 0.2);
    g.quadraticCurveTo(-r * 0.2, r * 0.6, 0, r * 0.25);
    g.quadraticCurveTo(r * 0.3, r * 0.7, r, 0);
    g.closePath().fill({ color: 0x6a5590, alpha: 0.92 }).stroke({ width: 1.5, color: 0x33244a });
    eyes(g, r, 0.35, 0.24, 0.14, 0xff7bff);
  },
  treant(g, r) {
    for (const [dx, dy, rr] of [[-0.5, -0.55, 0.5], [-0.65, 0.35, 0.45], [-0.1, 0.6, 0.42], [0.3, -0.5, 0.4]] as [number, number, number][]) {
      g.circle(r * dx, r * dy, r * rr).fill(0x3a6b35);
    }
    g.roundRect(-r * 0.35, -r * 0.7, r * 0.85, r * 1.4, r * 0.28).fill(0x6b4a2a).stroke({ width: 2, color: OL }); // trunk
    g.moveTo(r * 0.1, -r * 0.3).lineTo(r * 0.7, -r * 0.6).moveTo(r * 0.1, r * 0.3).lineTo(r * 0.7, r * 0.55).stroke({ width: 3, color: 0x5a3f24 }); // branch arms
    eyes(g, r, 0.2, 0.28, 0.12, 0xffe08a);
  },
  // --- mystic east ---
  wisp(g, r) {
    for (let i = 0; i < 5; i++) { g.circle(-r * (0.4 + i * 0.28), Math.sin(i) * r * 0.2, r * (0.34 - i * 0.05)).fill({ color: 0x6ee8e0, alpha: 0.28 - i * 0.05 }); } // trailing wisps
    g.circle(0, 0, r * 0.7).fill({ color: 0x6ee8e0, alpha: 0.85 });
    g.circle(r * 0.08, -r * 0.08, r * 0.42).fill({ color: 0xd8fffb, alpha: 0.95 }); // hot core
    eyes(g, r, 0.18, 0.26, 0.1, 0x0a3b38);
  },
  crystal_golem(g, r) {
    for (const [dx, dy, s, col] of [[-0.6, -0.4, 0.55, 0x5fb8d0], [0.5, -0.55, 0.5, 0x9fe0f0], [0.15, 0.5, 0.6, 0x7fd4e8], [-0.5, 0.45, 0.45, 0x6fc8e0]] as [number, number, number, number][]) {
      const s2 = r * s;
      g.poly([r * dx, r * dy - s2, r * dx + s2 * 0.7, r * dy, r * dx, r * dy + s2, r * dx - s2 * 0.7, r * dy]).fill(col).stroke({ width: 1.5, color: 0x2a6a80 });
    }
    g.poly([0, -r * 0.5, r * 0.4, 0, 0, r * 0.5, -r * 0.4, 0]).fill({ color: 0xeafaff, alpha: 0.9 }); // bright core
    eyes(g, r, 0.14, 0.22, 0.1, 0x1a4a5a);
  },
};

/** Draws the given mob type into `g` (top-down, facing +x). */
export function drawMob(g: Graphics, mobType: string, r: number): void {
  (DRAW[mobType] ?? DRAW.slime)(g, r);
}

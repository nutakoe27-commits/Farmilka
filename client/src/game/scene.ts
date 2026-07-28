import { Application, Container, Graphics, Text } from 'pixi.js';
import { lerp } from '@shared/math.js';
import { biomeRect, BIOME_NAMES, type BiomeId } from '@shared/biomes.js';
import { biomeLabel } from '../ui/i18n.js';

export const BIOME_COLORS: Record<BiomeId, number> = {
  normal: 0x131c14,
  snow: 0x1b2433,
  desert: 0x282012,
  mystic_west: 0x1e1229,
  mystic_east: 0x0f2528,
};

const BIOME_ACCENTS: Record<BiomeId, number> = {
  normal: 0x2c4a2e,
  snow: 0xa8c8e8,
  desert: 0xc8a050,
  mystic_west: 0x9b4fc4,
  mystic_east: 0x4fd8c8,
};

export class Scene {
  app: Application;
  world = new Container();
  layers = {
    ground: new Container(),
    buildings: new Container(),
    coins: new Container(),
    mobs: new Container(),
    players: new Container(),
    projectiles: new Container(),
    telegraphs: new Container(),
    effects: new Container(),
  };

  camX = 0;
  camY = 0;
  zoom = 1;
  shake = 0;
  /** Zooms the view out (>1 = see more world). Bumped on touch devices where the
   *  small, tall screen otherwise shows too little around the player. */
  viewScale = 1;

  /** Everyone sees the same world area regardless of screen size (fair play). */
  static readonly VIEW_W = 1600;
  static readonly VIEW_H = 900;
  /** ceiling for viewScale on a wide screen — see update() */
  static readonly LANDSCAPE_VIEW_SCALE = 1.15;

  constructor(app: Application) {
    this.app = app;
    app.stage.addChild(this.world);
    for (const layer of Object.values(this.layers)) this.world.addChild(layer);
  }

  drawGround(size: number): void {
    const g = new Graphics();
    const biomes: BiomeId[] = ['mystic_west', 'mystic_east', 'snow', 'normal', 'desert'];

    // biome fills
    for (const b of biomes) {
      const r = biomeRect(b, size);
      g.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0).fill(BIOME_COLORS[b]);
    }

    // subtle grid
    for (let i = 0; i <= size; i += 200) {
      g.moveTo(i, 0).lineTo(i, size);
      g.moveTo(0, i).lineTo(size, i);
    }
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.03 });

    // scattered biome decorations
    for (const b of biomes) {
      const r = biomeRect(b, size);
      const accent = BIOME_ACCENTS[b];
      const n = Math.floor(((r.x1 - r.x0) * (r.y1 - r.y0)) / 60000);
      for (let i = 0; i < n; i++) {
        const x = r.x0 + Math.random() * (r.x1 - r.x0);
        const y = r.y0 + Math.random() * (r.y1 - r.y0);
        if (b === 'mystic_east') {
          g.poly([x, y - 7, x + 5, y, x, y + 7, x - 5, y]).fill({ color: accent, alpha: 0.22 });
        } else if (b === 'snow') {
          g.circle(x, y, 2 + Math.random() * 2).fill({ color: accent, alpha: 0.25 });
        } else if (b === 'desert') {
          g.ellipse(x, y, 8 + Math.random() * 8, 2).fill({ color: accent, alpha: 0.15 });
        } else if (b === 'mystic_west') {
          g.circle(x, y, 3 + Math.random() * 3).fill({ color: accent, alpha: 0.14 });
        } else {
          g.circle(x, y, 2 + Math.random() * 2).fill({ color: accent, alpha: 0.25 });
        }
      }
    }

    // biome borders
    const strip = biomeRect('mystic_west', size).x1;
    g.moveTo(strip, 0).lineTo(strip, size);
    g.moveTo(size - strip, 0).lineTo(size - strip, size);
    g.moveTo(strip, size / 3).lineTo(size - strip, size / 3);
    g.moveTo(strip, (size * 2) / 3).lineTo(size - strip, (size * 2) / 3);
    g.stroke({ width: 3, color: 0xffffff, alpha: 0.08 });

    // world border
    g.rect(0, 0, size, size).stroke({ width: 6, color: 0xd4544a, alpha: 0.7 });
    this.layers.ground.addChild(g);

    // biome name labels
    for (const b of biomes) {
      const r = biomeRect(b, size);
      const label = new Text({
        text: biomeLabel(b, BIOME_NAMES[b]),
        style: { fontFamily: 'system-ui', fontSize: 64, fontWeight: '800', fill: BIOME_ACCENTS[b] },
      });
      label.alpha = 0.13;
      label.anchor.set(0.5);
      label.position.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
      if (b === 'mystic_west' || b === 'mystic_east') label.rotation = -Math.PI / 2;
      this.layers.ground.addChild(label);
    }
  }

  /** Camera follow with lerp + fixed fair-play zoom + shake. */
  update(targetX: number, targetY: number, dt: number): void {
    this.camX = lerp(this.camX, targetX, Math.min(1, dt * 7));
    this.camY = lerp(this.camY, targetY, Math.min(1, dt * 7));
    this.shake = Math.max(0, this.shake - dt * 30);

    const w = this.app.renderer.width;
    const h = this.app.renderer.height;
    // Cover-fit the design viewport; viewScale widens it (touch devices see
    // more). The phone bonus only applies while the device is upright: turned
    // sideways it is already wide, and keeping the full bonus would show a
    // rotated phone roughly twice the world a desktop player gets.
    const vs = w > h ? Math.min(this.viewScale, Scene.LANDSCAPE_VIEW_SCALE) : this.viewScale;
    this.zoom = Math.max(w / (Scene.VIEW_W * vs), h / (Scene.VIEW_H * vs));

    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    this.world.scale.set(this.zoom);
    this.world.position.set(w / 2 - (this.camX + sx) * this.zoom, h / 2 - (this.camY + sy) * this.zoom);
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.world.position.x) / this.zoom,
      y: (sy - this.world.position.y) / this.zoom,
    };
  }
}

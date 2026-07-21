import { Application, Container, Graphics } from 'pixi.js';
import { clamp, lerp } from '@shared/math.js';

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
  targetZoom = 1;
  shake = 0;

  constructor(app: Application) {
    this.app = app;
    app.stage.addChild(this.world);
    for (const layer of Object.values(this.layers)) this.world.addChild(layer);
  }

  drawGround(size: number, safeR: number): void {
    const g = new Graphics();
    // world background
    g.rect(0, 0, size, size).fill(0x11141c);
    // subtle grid
    for (let i = 0; i <= size; i += 200) {
      g.moveTo(i, 0).lineTo(i, size);
      g.moveTo(0, i).lineTo(size, i);
    }
    g.stroke({ width: 1, color: 0x1c202c, alpha: 0.8 });
    // difficulty rings hint
    const c = size / 2;
    g.circle(c, c, size * 0.35).stroke({ width: 2, color: 0x28304a, alpha: 0.5 });
    g.circle(c, c, size * 0.2).stroke({ width: 2, color: 0x28304a, alpha: 0.5 });
    // safe zone
    g.circle(c, c, safeR).fill({ color: 0x2ea043, alpha: 0.08 });
    g.circle(c, c, safeR).stroke({ width: 3, color: 0x2ea043, alpha: 0.55 });
    // border
    g.rect(0, 0, size, size).stroke({ width: 6, color: 0xd4544a, alpha: 0.7 });
    this.layers.ground.addChild(g);
  }

  /** Camera follow with lerp + zoom + shake, applied to the world container. */
  update(targetX: number, targetY: number, dt: number): void {
    this.camX = lerp(this.camX, targetX, Math.min(1, dt * 7));
    this.camY = lerp(this.camY, targetY, Math.min(1, dt * 7));
    this.zoom = lerp(this.zoom, this.targetZoom, Math.min(1, dt * 8));
    this.shake = Math.max(0, this.shake - dt * 30);

    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    const w = this.app.renderer.width;
    const h = this.app.renderer.height;
    this.world.scale.set(this.zoom);
    this.world.position.set(w / 2 - (this.camX + sx) * this.zoom, h / 2 - (this.camY + sy) * this.zoom);
  }

  addZoom(delta: number): void {
    this.targetZoom = clamp(this.targetZoom * (delta > 0 ? 0.9 : 1.1), 0.55, 1.6);
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.world.position.x) / this.zoom,
      y: (sy - this.world.position.y) / this.zoom,
    };
  }
}

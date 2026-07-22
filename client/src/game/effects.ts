import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { SPARK } from './textures.js';

interface Particle {
  g: Container;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  grav: number;
  size: number;
}

interface FloatText {
  t: Text;
  vy: number;
  life: number;
  maxLife: number;
}

interface Ring {
  g: Graphics;
  life: number;
  maxLife: number;
  from: number;
  to: number;
}

interface Swing {
  g: Graphics;
  life: number;
  maxLife: number;
  spin: number;
}

interface Telegraph {
  g: Graphics;
  until: number;
}

export class Effects {
  private parts: Particle[] = [];
  private texts: FloatText[] = [];
  private rings: Ring[] = [];
  private swings: Swing[] = [];
  private telegraphs: Telegraph[] = [];

  constructor(private layer: Container, private telegraphLayer: Container) {}

  private spark(x: number, y: number, color: number, size: number, vx: number, vy: number, life: number, grav: number): void {
    const s = new Sprite(SPARK);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = color;
    s.width = s.height = size;
    s.position.set(x, y);
    this.layer.addChild(s);
    this.parts.push({ g: s, vx, vy, life, maxLife: life, grav, size });
  }

  /** Radial spark burst (hits, deaths, pickups). */
  burst(x: number, y: number, color: number, n = 10, speed = 160): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.9);
      this.spark(x, y, color, 6 + Math.random() * 8, Math.cos(a) * v, Math.sin(a) * v, 0.5 + Math.random() * 0.2, 30);
    }
  }

  /** Faint fading dot dropped behind a projectile each frame. */
  trail(x: number, y: number, color: number): void {
    this.spark(x, y, color, 9, 0, 0, 0.26, 0);
  }

  /** Expanding ring pulse. */
  ring(x: number, y: number, color: number, from = 10, to = 70, life = 0.5): void {
    const g = new Graphics();
    g.circle(0, 0, 1).stroke({ width: 4, color, alpha: 0.9 });
    g.position.set(x, y);
    this.layer.addChild(g);
    this.rings.push({ g, life, maxLife: life, from, to });
  }

  /** Celebratory pop for levelling up. */
  levelBurst(x: number, y: number): void {
    this.ring(x, y, 0xffd76e, 20, 90, 0.55);
    this.burst(x, y, 0xffe08a, 16, 210);
  }

  /**
   * Melee attack arc: a crescent showing where you hit — a directional slash,
   * or a full ring for 360° weapons. Built once and animated by transform only
   * (no per-frame geometry rebuild).
   */
  swing(x: number, y: number, angle: number, range: number, arcDeg: number, color: number): void {
    const arc = Math.min(Math.PI * 2, (arcDeg * Math.PI) / 180);
    const r0 = range * 0.34;
    const r1 = range;
    const a0 = -arc / 2;
    const a1 = arc / 2;
    const g = new Graphics();
    g.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
    g.arc(0, 0, r1, a0, a1);
    g.arc(0, 0, r0, a1, a0, true);
    g.closePath();
    g.fill({ color, alpha: 0.4 });
    g.position.set(x, y);
    g.rotation = angle;
    g.blendMode = 'add';
    this.layer.addChild(g);
    this.swings.push({ g, life: 0.18, maxLife: 0.18, spin: arc > Math.PI * 1.5 ? 7 : 3 });
  }

  damageNumber(x: number, y: number, amount: number, color = 0xffe08a): void {
    const t = new Text({
      text: `-${amount}`,
      style: { fontFamily: 'system-ui', fontSize: 15, fontWeight: '800', fill: color, stroke: { color: 0x000000, width: 4 } },
    });
    t.anchor.set(0.5);
    t.position.set(x + (Math.random() - 0.5) * 20, y - 20);
    this.layer.addChild(t);
    this.texts.push({ t, vy: -55, life: 0.9, maxLife: 0.9 });
  }

  incomeNumber(x: number, y: number, amount: number): void {
    const t = new Text({
      text: `+${amount}`,
      style: { fontFamily: 'system-ui', fontSize: 14, fontWeight: '800', fill: 0x7ee787, stroke: { color: 0x000000, width: 4 } },
    });
    t.anchor.set(0.5);
    t.position.set(x, y - 20);
    this.layer.addChild(t);
    this.texts.push({ t, vy: -45, life: 0.9, maxLife: 0.9 });
  }

  /** Red warning zone for boss attacks: sector (arc<360) or ring. */
  telegraph(x: number, y: number, angle: number, range: number, arcDeg: number, sec: number): void {
    const g = new Graphics();
    if (arcDeg >= 360) {
      g.circle(0, 0, range).fill({ color: 0xff3b30, alpha: 0.18 });
      g.circle(0, 0, range).stroke({ width: 3, color: 0xff3b30, alpha: 0.6 });
    } else {
      const a = (arcDeg * Math.PI) / 180;
      g.moveTo(0, 0).arc(0, 0, range, angle - a / 2, angle + a / 2).lineTo(0, 0).fill({ color: 0xff3b30, alpha: 0.22 });
      g.moveTo(0, 0).arc(0, 0, range, angle - a / 2, angle + a / 2).lineTo(0, 0).stroke({ width: 3, color: 0xff3b30, alpha: 0.6 });
    }
    g.position.set(x, y);
    this.telegraphLayer.addChild(g);
    this.telegraphs.push({ g, until: performance.now() + sec * 1000 });
  }

  update(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.g.destroy();
        this.parts.splice(i, 1);
        continue;
      }
      p.vy += p.grav * dt;
      p.g.position.x += p.vx * dt;
      p.g.position.y += p.vy * dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
      const f = p.life / p.maxLife;
      p.g.alpha = f;
      const sz = p.size * (0.4 + 0.6 * f);
      (p.g as Sprite).width = (p.g as Sprite).height = sz;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        r.g.destroy();
        this.rings.splice(i, 1);
        continue;
      }
      const f = 1 - r.life / r.maxLife;
      r.g.scale.set(r.from + (r.to - r.from) * f);
      r.g.alpha = 1 - f;
    }
    for (let i = this.swings.length - 1; i >= 0; i--) {
      const s = this.swings[i];
      s.life -= dt;
      if (s.life <= 0) {
        s.g.destroy();
        this.swings.splice(i, 1);
        continue;
      }
      const p = 1 - s.life / s.maxLife; // 0 -> 1
      s.g.alpha = 1 - p;
      s.g.scale.set(0.72 + 0.28 * p);
      s.g.rotation += s.spin * dt; // subtle sweep, no geometry rebuild
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const ft = this.texts[i];
      ft.life -= dt;
      if (ft.life <= 0) {
        ft.t.destroy();
        this.texts.splice(i, 1);
        continue;
      }
      ft.t.position.y += ft.vy * dt;
      ft.t.alpha = Math.min(1, ft.life * 2);
      const age = ft.maxLife - ft.life;
      ft.t.scale.set(age < 0.12 ? 1 + (0.12 - age) * 3 : 1); // quick pop-in
    }
    const now = performance.now();
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const tg = this.telegraphs[i];
      const left = tg.until - now;
      if (left <= 0) {
        tg.g.destroy();
        this.telegraphs.splice(i, 1);
        continue;
      }
      tg.g.alpha = 0.5 + 0.5 * Math.sin(now / 80);
    }
  }
}

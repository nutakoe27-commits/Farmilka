import { Container, Graphics, Text } from 'pixi.js';

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface FloatText {
  t: Text;
  vy: number;
  life: number;
}

interface Telegraph {
  g: Graphics;
  until: number;
}

export class Effects {
  private parts: Particle[] = [];
  private texts: FloatText[] = [];
  private telegraphs: Telegraph[] = [];

  constructor(private layer: Container, private telegraphLayer: Container) {}

  burst(x: number, y: number, color: number, n = 10, speed = 160): void {
    for (let i = 0; i < n; i++) {
      const g = new Graphics();
      const r = 2 + Math.random() * 3;
      g.circle(0, 0, r).fill(color);
      g.position.set(x, y);
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.layer.addChild(g);
      this.parts.push({ g, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, maxLife: 0.5 });
    }
  }

  damageNumber(x: number, y: number, amount: number, color = 0xffe08a): void {
    const t = new Text({
      text: `-${amount}`,
      style: { fontFamily: 'system-ui', fontSize: 15, fontWeight: '800', fill: color, stroke: { color: 0x000000, width: 4 } },
    });
    t.anchor.set(0.5);
    t.position.set(x + (Math.random() - 0.5) * 20, y - 20);
    this.layer.addChild(t);
    this.texts.push({ t, vy: -55, life: 0.9 });
  }

  incomeNumber(x: number, y: number, amount: number): void {
    const t = new Text({
      text: `+${amount}`,
      style: { fontFamily: 'system-ui', fontSize: 14, fontWeight: '800', fill: 0x7ee787, stroke: { color: 0x000000, width: 4 } },
    });
    t.anchor.set(0.5);
    t.position.set(x, y - 20);
    this.layer.addChild(t);
    this.texts.push({ t, vy: -45, life: 0.9 });
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
      p.g.position.x += p.vx * dt;
      p.g.position.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.g.alpha = p.life / p.maxLife;
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

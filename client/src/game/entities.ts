import { Container, Graphics, Text } from 'pixi.js';
import type { EntityState } from '@shared/protocol.js';

export const WEAPON_ICONS: Record<string, string> = {
  fists: '👊', sword: '🗡️', spear: '🔱', hammer: '🔨', bow: '🏹', crossbow: '🎯',
};
export const BUILDING_ICONS: Record<string, string> = { farm: '🌾', mine: '⛏️', turret: '🗼' };

/** Visual style per mob type: base shape + palette. Mystic mobs get a glow. */
const MOB_STYLE: Record<string, { color: number; shape: 'blob' | 'beast' | 'golem' | 'ghost' | 'tree'; glow?: number }> = {
  slime: { color: 0x5fd068, shape: 'blob' },
  wolf: { color: 0x9aa5b8, shape: 'beast' },
  ice_slime: { color: 0x9fd8ff, shape: 'blob' },
  yeti: { color: 0xd8e8f0, shape: 'golem' },
  scorpion: { color: 0xd8a24a, shape: 'beast' },
  sand_golem: { color: 0xc4954f, shape: 'golem' },
  shade: { color: 0x6a5590, shape: 'ghost', glow: 0x9b4fc4 },
  treant: { color: 0x3a6b35, shape: 'tree', glow: 0x9b4fc4 },
  wisp: { color: 0x6ee8e0, shape: 'ghost', glow: 0x4fd8c8 },
  crystal_golem: { color: 0x7fd4e8, shape: 'golem', glow: 0x4fd8c8 },
};

const BOSS_STYLE: Record<string, { body: number; glow: number; ring: number; label: string }> = {
  champion: { body: 0x7a2f9e, glow: 0xb565d8, ring: 0x9b4fc4, label: '💀 ЧЕМПИОН' },
  shadow_lord: { body: 0x241436, glow: 0x8a2be2, ring: 0x5a2a8a, label: '👁 ВЛАДЫКА ТЕНЕЙ' },
  crystal_queen: { body: 0x1a6a70, glow: 0x6ee8e0, ring: 0x4fd8c8, label: '💎 КРИСТАЛЬНАЯ КОРОЛЕВА' },
};

const BUILDING_COLORS: Record<string, number> = { farm: 0x3f8f4a, mine: 0x5b6478, turret: 0x8a5fb0 };

function playerColor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return hslToHex(hue, 65, 55);
}

function hslToHex(h: number, s: number, l: number): number {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}

export class EntityView {
  root = new Container();
  body = new Graphics();
  top = new Container(); // non-rotating: label + hp bar
  hpBar = new Graphics();
  protRing: Graphics | null = null;
  weaponText: Text | null = null;
  lastHp = -1;
  lastWeapon = '';
  color = 0xffffff;
  spawnTime = performance.now();

  constructor(public state: EntityState, isSelf: boolean) {
    this.root.addChild(this.body);
    this.root.addChild(this.top);
    this.color = state.kind === 'player' ? playerColor(state.id) : 0xffffff;
    this.build(isSelf);
  }

  private build(isSelf: boolean): void {
    const s = this.state;
    const g = this.body;
    const r = s.radius;
    switch (s.kind) {
      case 'player': {
        g.circle(0, 0, r + 7).fill({ color: this.color, alpha: 0.18 }); // glow
        g.circle(0, 0, r).fill(this.color);
        g.circle(0, 0, r).stroke({ width: 3, color: isSelf ? 0xffffff : 0x0d0f14, alpha: 0.9 });
        g.circle(r * 0.45, 0, r * 0.22).fill(0x0d0f14); // "eye" showing facing
        g.moveTo(r * 0.75, 0).lineTo(r + 12, 0).stroke({ width: 4, color: 0xffffff, alpha: 0.5 }); // aim tick
        const name = new Text({
          text: s.name ?? '',
          style: { fontFamily: 'system-ui', fontSize: 13, fill: isSelf ? 0x7ee787 : 0xe8e8ef, stroke: { color: 0x000000, width: 3 } },
        });
        name.anchor.set(0.5);
        name.position.set(0, -r - 24);
        this.top.addChild(name);
        this.weaponText = new Text({ text: WEAPON_ICONS[s.weapon ?? 'fists'] ?? '', style: { fontSize: 13 } });
        this.weaponText.anchor.set(0.5);
        this.weaponText.position.set(0, r + 14);
        this.top.addChild(this.weaponText);
        this.protRing = new Graphics();
        this.protRing.circle(0, 0, r + 12).stroke({ width: 3, color: 0xffffff, alpha: 0.8 });
        this.protRing.visible = false;
        this.top.addChild(this.protRing);
        break;
      }
      case 'mob': {
        const style = MOB_STYLE[s.mobType ?? 'slime'] ?? { color: 0xcccccc, shape: 'blob' as const };
        const c = style.color;
        if (style.glow) {
          g.circle(0, 0, r + 8).fill({ color: style.glow, alpha: 0.18 });
        }
        switch (style.shape) {
          case 'golem': {
            const pts: number[] = [];
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2;
              pts.push(Math.cos(a) * r, Math.sin(a) * r);
            }
            g.poly(pts).fill(c).stroke({ width: 2, color: 0x0d0f14 });
            g.circle(-r * 0.25, -r * 0.15, r * 0.12).fill(0x0d0f14);
            g.circle(r * 0.25, -r * 0.15, r * 0.12).fill(0x0d0f14);
            break;
          }
          case 'beast': {
            g.poly([r, 0, -r * 0.8, r * 0.7, -r * 0.4, 0, -r * 0.8, -r * 0.7]).fill(c).stroke({ width: 2, color: 0x0d0f14 });
            break;
          }
          case 'ghost': {
            g.circle(0, 0, r + 5).fill({ color: c, alpha: 0.2 });
            g.circle(0, 0, r).fill({ color: c, alpha: 0.75 });
            g.circle(-r * 0.3, -r * 0.15, r * 0.16).fill(0x0d0f14);
            g.circle(r * 0.3, -r * 0.15, r * 0.16).fill(0x0d0f14);
            break;
          }
          case 'tree': {
            g.roundRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7, r * 0.35).fill(c).stroke({ width: 3, color: 0x0d0f14 });
            g.circle(-r * 0.3, -r * 0.2, r * 0.14).fill(0xffe08a);
            g.circle(r * 0.3, -r * 0.2, r * 0.14).fill(0xffe08a);
            g.moveTo(-r * 0.6, r * 0.45).lineTo(r * 0.6, r * 0.45).stroke({ width: 3, color: 0x0d0f14 });
            break;
          }
          default: {
            g.circle(0, 0, r + 4).fill({ color: c, alpha: 0.25 });
            g.circle(0, 0, r).fill(c).stroke({ width: 2, color: 0x0d0f14 });
            g.circle(-r * 0.3, -r * 0.2, r * 0.15).fill(0x0d0f14);
            g.circle(r * 0.3, -r * 0.2, r * 0.15).fill(0x0d0f14);
          }
        }
        break;
      }
      case 'boss': {
        const bs = BOSS_STYLE[s.bossType ?? 'champion'] ?? BOSS_STYLE.champion;
        g.circle(0, 0, r + 16).fill({ color: bs.glow, alpha: 0.15 });
        g.circle(0, 0, r + 8).fill({ color: bs.glow, alpha: 0.25 });
        g.circle(0, 0, r).fill(bs.body).stroke({ width: 4, color: bs.glow, alpha: 0.8 });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.poly([
            Math.cos(a) * r, Math.sin(a) * r,
            Math.cos(a + 0.18) * (r + 14), Math.sin(a + 0.18) * (r + 14),
            Math.cos(a + 0.36) * r, Math.sin(a + 0.36) * r,
          ]).fill(bs.ring);
        }
        g.circle(r * 0.35, 0, r * 0.14).fill(0xffe08a);
        const name = new Text({ text: bs.label, style: { fontFamily: 'system-ui', fontSize: 16, fontWeight: '800', fill: 0xf0c8ff, stroke: { color: 0x000000, width: 4 } } });
        name.anchor.set(0.5);
        name.position.set(0, -r - 30);
        this.top.addChild(name);
        break;
      }
      case 'coin': {
        g.circle(0, 0, s.radius).fill(0xffd76e).stroke({ width: 2, color: 0xb8860b });
        g.circle(-3, -3, s.radius * 0.3).fill({ color: 0xffffff, alpha: 0.7 });
        break;
      }
      case 'food': {
        g.circle(0, 0, s.radius + 4).fill({ color: 0xff9d5c, alpha: 0.18 });
        const icon = new Text({ text: '🍖', style: { fontSize: 20 } });
        icon.anchor.set(0.5);
        this.top.addChild(icon);
        break;
      }
      case 'projectile': {
        const isBoss = s.name === 'boss-burst';
        const c = isBoss ? 0xff7b72 : 0xffe08a;
        g.ellipse(0, 0, 12, 4).fill(c);
        g.ellipse(-6, 0, 10, 3).fill({ color: c, alpha: 0.4 });
        break;
      }
      case 'building': {
        const c = BUILDING_COLORS[s.buildingType ?? 'farm'] ?? 0x888888;
        g.roundRect(-r, -r, r * 2, r * 2, 8).fill(c).stroke({ width: 3, color: 0x0d0f14 });
        g.roundRect(-r + 6, -r + 6, r * 2 - 12, r * 2 - 12, 6).stroke({ width: 2, color: 0xffffff, alpha: 0.2 });
        if (s.buildingType === 'turret') {
          g.circle(0, 0, r * 0.4).fill(0x30363d).stroke({ width: 2, color: 0xcfd4e4 });
          g.rect(0, -4, r + 10, 8).fill(0x30363d);
        }
        const icon = new Text({ text: BUILDING_ICONS[s.buildingType ?? ''] ?? '', style: { fontSize: 22 } });
        icon.anchor.set(0.5);
        this.top.addChild(icon);
        const owner = new Text({
          text: s.name ?? '',
          style: { fontFamily: 'system-ui', fontSize: 11, fill: 0xbfc4d4, stroke: { color: 0x000000, width: 3 } },
        });
        owner.anchor.set(0.5);
        owner.position.set(0, -r - 16);
        this.top.addChild(owner);
        break;
      }
    }
    this.top.addChild(this.hpBar);
  }

  /** Per-frame update: rotation, hp bar, small idle animations, fade-in. */
  update(x: number, y: number, angle: number, now: number): void {
    this.root.position.set(x, y);
    const s = this.state;
    if (s.kind === 'player' || s.kind === 'projectile' || s.kind === 'mob' || s.kind === 'boss') {
      this.body.rotation = angle;
    }
    // fade in
    const age = now - this.spawnTime;
    this.root.alpha = Math.min(1, age / 200);

    if (s.kind === 'mob' && s.mobType === 'slime') {
      const w = 1 + Math.sin(now / 180) * 0.06;
      this.body.scale.set(w, 2 - w);
    } else if (s.kind === 'boss') {
      const w = 1 + Math.sin(now / 300) * 0.04;
      this.body.scale.set(w);
    } else if (s.kind === 'coin') {
      this.body.scale.set(1 + Math.sin(now / 250 + x) * 0.12);
    } else if (s.kind === 'food') {
      this.top.scale.set(1 + Math.sin(now / 300 + y) * 0.1);
    }

    if (this.weaponText && s.weapon !== this.lastWeapon) {
      this.lastWeapon = s.weapon ?? '';
      this.weaponText.text = WEAPON_ICONS[this.lastWeapon] ?? '';
    }

    if (this.protRing) {
      this.protRing.visible = !!s.prot;
      if (s.prot) this.protRing.alpha = 0.5 + 0.5 * Math.sin(now / 120);
    }

    if (s.hp !== undefined && s.maxHp !== undefined && s.hp !== this.lastHp) {
      this.lastHp = s.hp;
      const frac = Math.max(0, s.hp / s.maxHp);
      const w = s.kind === 'boss' ? 120 : s.radius * 2.2;
      this.hpBar.clear();
      if (frac < 1 || s.kind === 'boss') {
        const y0 = -s.radius - (s.kind === 'boss' ? 18 : 14);
        this.hpBar.roundRect(-w / 2, y0, w, 6, 3).fill({ color: 0x000000, alpha: 0.6 });
        const color = frac > 0.5 ? 0x2ea043 : frac > 0.25 ? 0xd4a72c : 0xd4544a;
        this.hpBar.roundRect(-w / 2, y0, w * frac, 6, 3).fill(color);
      }
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

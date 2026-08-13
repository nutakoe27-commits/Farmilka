import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { EntityState } from '@shared/protocol.js';
import { GLOW } from './textures.js';
import { drawMob } from './mob-art.js';
import { prestigeTier, type PrestigeCfg } from '@shared/prestige.js';
import { bossLabel } from '../ui/i18n.js';

let PRESTIGE_CFG: PrestigeCfg | null = null;
export function setPrestigeCfg(cfg: PrestigeCfg): void {
  PRESTIGE_CFG = cfg;
}
function hexColor(css: string): number {
  return parseInt(css.replace('#', ''), 16);
}

export const WEAPON_ICONS: Record<string, string> = {
  fists: '👊', sword: '🗡️', spear: '🔱', hammer: '🔨', bow: '🏹', crossbow: '🎯',
  daggers: '🔪', scythe: '🌪️', venom_blade: '🐍', vampire_blade: '🩸', triple_bow: '🪃', ice_staff: '❄️',
  hook_blade: '⛓️', mirror_blade: '🪞', storm_hammer: '⚡', tamer_blade: '🐺', reaper_scythe: '💀', dragon_bow: '🐉',
};
export const BUILDING_ICONS: Record<string, string> = { farm: '🌾', mine: '⛏️', turret: '🗼', vault: '🏦', wall: '🧱' };

export const HAT_EMOJI: Record<string, string> = {
  straw_hat: '👒', cap: '🧢', miner_helmet: '⛑️', champion_crown: '👑', shadow_hood: '🎩',
  crystal_circlet: '💠', dragon_helm: '🐲', wizard_hat: '🧙', golden_crown: '👑', phoenix_plume: '🪶',
  bandana: '🧣', chef_hat: '🍳', hunter_hood: '🐺', skull_mask: '💀', titan_guard: '🛡️', slayer_crown: '⚜️',
};
export const TIER_COLORS: Record<string, string> = { common: '#9aa5b8', rare: '#4d9fff', epic: '#b565d8', legendary: '#ffd76e' };

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

const BOSS_STYLE: Record<string, { body: number; glow: number; ring: number; icon: string }> = {
  champion: { body: 0x7a2f9e, glow: 0xb565d8, ring: 0x9b4fc4, icon: '💀' },
  frost_titan: { body: 0x2a5a8a, glow: 0x9fd8ff, ring: 0x5aa8e0, icon: '🧊' },
  sand_worm: { body: 0x8a6a2a, glow: 0xe8c878, ring: 0xc49a4a, icon: '🐛' },
  shadow_lord: { body: 0x241436, glow: 0x8a2be2, ring: 0x5a2a8a, icon: '👁' },
  crystal_queen: { body: 0x1a6a70, glow: 0x6ee8e0, ring: 0x4fd8c8, icon: '💎' },
};

const BUILDING_COLORS: Record<string, number> = { farm: 0x3f8f4a, mine: 0x5b6478, turret: 0x8a5fb0, vault: 0xc9a227, wall: 0x4a5060 };

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
  statusRing: Graphics | null = null;
  glow: Sprite | null = null;
  hitFx: Sprite | null = null;
  glowAlpha = 0;
  flashStart = -1e9;
  lastFx = 0;
  weaponText: Text | null = null;
  siloBar: Graphics | null = null;
  lastStore = -1;
  hatText: Text | null = null;
  nameText: Text | null = null;
  aura: Graphics | null = null;
  isSelf = false;
  lastHp = -1;
  lastMaxHp = -1;
  lastWeapon = '';
  lastHat: string | null = 'no';
  lastPrestige = -1;
  color = 0xffffff;
  spawnTime = performance.now();

  constructor(public state: EntityState, isSelf: boolean) {
    this.isSelf = isSelf;
    // aura sits behind everything (prestige glow)
    this.aura = new Graphics();
    this.root.addChild(this.aura);
    this.root.addChild(this.body);
    this.root.addChild(this.top);
    this.color = state.kind === 'player' ? playerColor(state.id) : 0xffffff;
    this.build(isSelf);
    if (state.kind === 'player' || state.kind === 'mob') {
      this.statusRing = new Graphics();
      this.top.addChild(this.statusRing);
    }
    this.addGlow(state);
  }

  /** Additive neon halo behind the body + a white hit-flash sprite over it. */
  private addGlow(s: EntityState): void {
    const spec: Record<string, { color: number; scale: number; alpha: number } | undefined> = {
      player: { color: this.color, scale: 3.7, alpha: 0.62 },
      mob: { color: MOB_STYLE[s.mobType ?? 'slime']?.glow ?? MOB_STYLE[s.mobType ?? 'slime']?.color ?? 0x88ccff, scale: 3.3, alpha: 0.56 },
      boss: { color: BOSS_STYLE[s.bossType ?? 'champion']?.glow ?? 0xb565d8, scale: 3.0, alpha: 0.75 },
      coin: { color: 0xffd76e, scale: 3.6, alpha: 0.72 },
      food: { color: 0xff9d5c, scale: 3.2, alpha: 0.5 },
      projectile: { color: s.name === 'boss-burst' ? 0xff7b72 : 0xffe08a, scale: 4.5, alpha: 0.75 },
      building: { color: BUILDING_COLORS[s.buildingType ?? 'farm'] ?? 0x8a5fb0, scale: 2.2, alpha: 0.28 },
    };
    const cfg = spec[s.kind];
    if (cfg) {
      const glow = new Sprite(GLOW);
      glow.anchor.set(0.5);
      glow.blendMode = 'add';
      glow.tint = cfg.color;
      glow.alpha = cfg.alpha;
      glow.width = glow.height = s.radius * cfg.scale;
      this.glowAlpha = cfg.alpha;
      this.glow = glow;
      this.root.addChildAt(glow, 0); // behind aura/body
    }
    if (s.kind === 'player' || s.kind === 'mob' || s.kind === 'boss' || s.kind === 'building') {
      const hit = new Sprite(GLOW);
      hit.anchor.set(0.5);
      hit.blendMode = 'add';
      hit.tint = 0xffffff;
      hit.visible = false;
      hit.width = hit.height = s.radius * 2.8;
      this.hitFx = hit;
      this.top.addChild(hit);
    }
  }

  /** Trigger a white flash + scale-punch (call on taking damage). */
  flash(): void {
    this.flashStart = performance.now();
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
        this.nameText = name;
        this.weaponText = new Text({ text: WEAPON_ICONS[s.weapon ?? 'fists'] ?? '', style: { fontSize: 13 } });
        this.weaponText.anchor.set(0.5);
        this.weaponText.position.set(0, r + 14);
        this.top.addChild(this.weaponText);
        this.protRing = new Graphics();
        this.protRing.circle(0, 0, r + 12).stroke({ width: 3, color: 0xffffff, alpha: 0.8 });
        this.protRing.visible = false;
        this.top.addChild(this.protRing);
        this.hatText = new Text({ text: '', style: { fontSize: 18 } });
        this.hatText.anchor.set(0.5);
        this.hatText.position.set(0, -r - 44);
        this.top.addChild(this.hatText);
        break;
      }
      case 'mob': {
        drawMob(g, s.mobType ?? 'slime', r);
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
        const label = `${bs.icon} ${bossLabel(s.bossType ?? 'champion')}`;
        const name = new Text({ text: label, style: { fontFamily: 'system-ui', fontSize: 16, fontWeight: '800', fill: 0xf0c8ff, stroke: { color: 0x000000, width: 4 } } });
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
        if (s.buildingType === 'vault') {
          // the vault reads as the prize of the base: gold trim + a coin slot
          g.roundRect(-r + 3, -r + 3, r * 2 - 6, r * 2 - 6, 7).stroke({ width: 3, color: 0xffd76e, alpha: 0.9 });
          g.rect(-10, -r + 10, 20, 5).fill(0x2a2410);
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
    if (s.kind === 'building' && (s.buildingType === 'farm' || s.buildingType === 'mine')) {
      this.siloBar = new Graphics();
      this.top.addChild(this.siloBar);
    }
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

    // gentle glow pulse
    if (this.glow) this.glow.alpha = this.glowAlpha * (0.82 + 0.18 * Math.sin(now / 480 + x * 0.01));

    // hit flash: white pop + scale punch, decays over ~240ms
    const flash = Math.max(0, 1 - (now - this.flashStart) / 240);
    if (this.hitFx) {
      if (flash > 0) { this.hitFx.visible = true; this.hitFx.alpha = flash * 0.85; }
      else if (this.hitFx.visible) this.hitFx.visible = false;
    }
    this.root.scale.set(flash > 0 ? 1 + flash * 0.13 : 1);

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

    // silo fill: how much loot is sitting in this building right now
    if (this.siloBar && (s.store ?? 0) !== this.lastStore) {
      this.lastStore = s.store ?? 0;
      const frac = this.lastStore / 255;
      const w = s.radius * 1.8;
      this.siloBar.clear();
      if (frac > 0.01) {
        const y = s.radius + 8;
        this.siloBar.roundRect(-w / 2, y, w, 6, 3).fill({ color: 0x000000, alpha: 0.55 });
        this.siloBar.roundRect(-w / 2, y, w * frac, 6, 3).fill(frac > 0.75 ? 0xffd76e : 0xe0a63a);
      }
    }

    if (this.hatText && (s.hat ?? null) !== this.lastHat) {
      this.lastHat = s.hat ?? null;
      this.hatText.text = this.lastHat ? HAT_EMOJI[this.lastHat] ?? '🎩' : '';
    }

    // poison (green) / chill (cyan) status rings
    if (this.statusRing && (s.fx ?? 0) !== this.lastFx) {
      this.lastFx = s.fx ?? 0;
      this.statusRing.clear();
      if (this.lastFx & 1) this.statusRing.circle(0, 0, s.radius + 4).stroke({ width: 3, color: 0x5fd068, alpha: 0.85 });
      if (this.lastFx & 2) this.statusRing.circle(0, 0, s.radius + 8).stroke({ width: 3, color: 0x6ee8ff, alpha: 0.85 });
    }

    // prestige: name colour, badge prefix, and a pulsing aura ring
    if (s.kind === 'player' && (s.prestige ?? 0) !== this.lastPrestige) {
      this.lastPrestige = s.prestige ?? 0;
      const tier = PRESTIGE_CFG ? prestigeTier(this.lastPrestige, PRESTIGE_CFG) : null;
      if (this.nameText) {
        const badge = this.lastPrestige > 0 ? `✦${this.lastPrestige} ` : '';
        this.nameText.text = `${badge}${s.name ?? ''}`;
        this.nameText.style.fill = tier ? hexColor(tier.color) : this.isSelf ? 0x7ee787 : 0xe8e8ef;
      }
      if (this.aura) {
        this.aura.clear();
        if (tier) {
          const c = hexColor(tier.aura);
          this.aura.circle(0, 0, s.radius + 16).fill({ color: c, alpha: 0.14 });
          this.aura.circle(0, 0, s.radius + 9).stroke({ width: 3, color: c, alpha: 0.55 });
        }
      }
    }
    if (this.aura && this.lastPrestige > 0) {
      this.aura.alpha = 0.7 + 0.3 * Math.sin(now / 260);
    }

    if (s.hp !== undefined && s.maxHp !== undefined && (s.hp !== this.lastHp || s.maxHp !== this.lastMaxHp)) {
      this.lastHp = s.hp;
      this.lastMaxHp = s.maxHp;
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

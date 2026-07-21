import type { SelfState, WelcomeMsg } from '@shared/protocol.js';
import type { WeaponId, BuildingId } from '@shared/types.js';
import { WEAPON_ICONS, BUILDING_ICONS } from '../game/entities.js';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const WEAPON_NOTES: Record<string, string> = {
  sword: 'база', spear: 'длинный укол', hammer: 'медленный, AoE + отброс', bow: 'дальний бой', crossbow: 'снайпер',
};
const BUILDING_NOTES: Record<string, string> = {
  farm: 'пассивный доход', mine: 'больше дохода', turret: 'стреляет по врагам',
};

export class Shop {
  visible = false;
  placing: BuildingId | null = null;

  onBuy: (item: WeaponId) => void = () => {};
  onStartPlace: (b: BuildingId) => void = () => {};

  constructor(private welcome: WelcomeMsg) {
    $('shop-close').onclick = () => this.hide();
    this.buildItems();
  }

  private buildItems(): void {
    const wg = $('shop-weapons');
    wg.innerHTML = '';
    const weapons = Object.entries(this.welcome.weapons)
      .filter(([id]) => id !== 'fists')
      .sort((a, b) => a[1].price - b[1].price);
    for (const [id, cfg] of weapons) {
      const el = document.createElement('div');
      el.className = 'shop-item';
      el.dataset.item = id;
      const stats = cfg.type === 'melee'
        ? `урон ${cfg.damage} · дальн. ${cfg.range} · ${cfg.attackRate}/с`
        : `урон ${cfg.damage} · дальн. ${cfg.range} · ${cfg.attackRate}/с · снаряд`;
      el.innerHTML = `<div><div class="nm">${WEAPON_ICONS[id] ?? ''} ${id}</div><div class="st">${stats}<br>${WEAPON_NOTES[id] ?? ''}</div></div><button>💰 ${cfg.price}</button>`;
      el.querySelector('button')!.onclick = () => this.onBuy(id as WeaponId);
      wg.appendChild(el);
    }

    const bg = $('shop-buildings');
    bg.innerHTML = '';
    for (const [id, cfg] of Object.entries(this.welcome.buildings)) {
      const el = document.createElement('div');
      el.className = 'shop-item';
      el.dataset.item = id;
      const stats = cfg.income > 0
        ? `+${cfg.income} монет / ${cfg.incomeIntervalSec}с · HP ${cfg.hp}`
        : `урон ${cfg.damage}/выстрел · дальн. ${cfg.range} · HP ${cfg.hp}`;
      el.innerHTML = `<div><div class="nm">${BUILDING_ICONS[id] ?? ''} ${id}</div><div class="st">${stats}<br>${BUILDING_NOTES[id] ?? ''}</div></div><button>💰 ${cfg.price}</button>`;
      el.querySelector('button')!.onclick = () => {
        this.hide();
        this.onStartPlace(id as BuildingId);
      };
      bg.appendChild(el);
    }
  }

  refresh(self: SelfState): void {
    if (!this.visible) return;
    for (const el of document.querySelectorAll<HTMLElement>('#shop-weapons .shop-item')) {
      const id = el.dataset.item as WeaponId;
      const cfg = this.welcome.weapons[id];
      const btn = el.querySelector('button')!;
      const owned = self.weapons.includes(id);
      el.classList.toggle('owned', owned);
      if (owned) {
        btn.textContent = 'Куплено';
        btn.disabled = true;
      } else {
        btn.textContent = `💰 ${cfg.price}`;
        btn.disabled = !self.inSafe || self.money < cfg.price;
      }
    }
    for (const el of document.querySelectorAll<HTMLElement>('#shop-buildings .shop-item')) {
      const id = el.dataset.item as BuildingId;
      const cfg = this.welcome.buildings[id];
      const btn = el.querySelector('button')!;
      btn.disabled = self.money < cfg.price || self.buildings >= this.welcome.maxBuildings;
    }
    $('build-count').textContent = `(${self.buildings}/${this.welcome.maxBuildings})`;
  }

  message(text: string): void {
    $('shop-msg').textContent = text;
    setTimeout(() => {
      if ($('shop-msg').textContent === text) $('shop-msg').textContent = '';
    }, 4000);
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    this.visible = true;
    $('shop').classList.remove('hidden');
  }

  hide(): void {
    this.visible = false;
    $('shop').classList.add('hidden');
  }

  setPlacing(b: BuildingId | null): void {
    this.placing = b;
    $('place-hint').classList.toggle('hidden', b === null);
  }
}

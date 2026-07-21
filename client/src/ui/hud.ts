import type { SelfState } from '@shared/protocol.js';
import type { WeaponId } from '@shared/types.js';
import { WEAPON_ICONS } from '../game/entities.js';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

export class Hud {
  private lastMoney = -1;
  private lastLevel = -1;
  private maxLevel = 10;
  private foodCooldownSec = 2;
  killFeedEnabled = true;
  onEquip: (w: WeaponId) => void = () => {};
  onEat: () => void = () => {};
  onReorder: (weapons: WeaponId[]) => void = () => {};

  private dragFrom: number | null = null;

  constructor() {
    $('food-slot').onclick = () => this.onEat();
  }

  setFoodCooldown(sec: number): void {
    this.foodCooldownSec = sec;
  }

  setMaxLevel(max: number): void {
    this.maxLevel = max;
  }

  show(): void {
    $('hud').classList.remove('hidden');
  }

  hide(): void {
    $('hud').classList.add('hidden');
  }

  update(self: SelfState): void {
    const hpFrac = Math.max(0, self.hp / self.maxHp);
    ($('hp-bar') as HTMLElement).style.width = `${hpFrac * 100}%`;
    $('hp-text').textContent = `${self.hp} / ${self.maxHp}`;
    if (self.level !== this.lastLevel) {
      this.lastLevel = self.level;
      $('level-badge').innerHTML = `⭐ Ур. ${self.level}<span class="mx">/${this.maxLevel}</span>`;
    }
    if (self.money !== this.lastMoney) {
      this.lastMoney = self.money;
      $('money').textContent = `💰 ${self.money}`;
    }
    if (self.protIn > 0) {
      $('zone-label').textContent = `🛡 Защита после возрождения: ${Math.ceil(self.protIn)}с`;
      $('zone-label').classList.remove('hidden');
    } else {
      $('zone-label').classList.add('hidden');
    }
    this.renderHotbar(self);

    // food slot: count + radial-ish cooldown wipe
    const cnt = $('food-slot').querySelector('.cnt') as HTMLElement;
    cnt.textContent = String(self.food);
    const cd = $('food-cd') as HTMLElement;
    const frac = this.foodCooldownSec > 0 ? Math.min(1, self.foodIn / this.foodCooldownSec) : 0;
    cd.style.transform = `scaleY(${frac})`;
    ($('food-slot') as HTMLElement).style.opacity = self.food > 0 ? '1' : '0.45';
  }

  private renderHotbar(self: SelfState): void {
    const bar = $('hotbar');
    const want = self.weapons.map((w) => `${w}${w === self.equipped ? '*' : ''}`).join('|');
    if (bar.dataset.state === want) return;
    bar.dataset.state = want;
    bar.innerHTML = '';
    self.weapons.forEach((w, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot' + (w === self.equipped ? ' active' : '');
      slot.innerHTML = `<span class="key">${i + 1}</span><span class="icon">${WEAPON_ICONS[w] ?? ''}</span><span>${w}</span>`;
      slot.style.pointerEvents = 'auto';
      slot.draggable = true;
      slot.onclick = () => this.onEquip(w);
      slot.ondragstart = (e) => {
        this.dragFrom = i;
        e.dataTransfer?.setData('text/plain', String(i));
      };
      slot.ondragover = (e) => {
        e.preventDefault();
        slot.classList.add('dragover');
      };
      slot.ondragleave = () => slot.classList.remove('dragover');
      slot.ondrop = (e) => {
        e.preventDefault();
        slot.classList.remove('dragover');
        const from = this.dragFrom;
        this.dragFrom = null;
        if (from === null || from === i) return;
        const order = [...self.weapons];
        const [moved] = order.splice(from, 1);
        order.splice(i, 0, moved);
        this.onReorder(order);
      };
      bar.appendChild(slot);
    });
  }

  killFeed(html: string, ms = 6000): void {
    if (!this.killFeedEnabled) return;
    const el = document.createElement('div');
    el.className = 'kf';
    el.innerHTML = html;
    const feed = $('killfeed');
    feed.prepend(el);
    while (feed.children.length > 6) feed.lastChild?.remove();
    setTimeout(() => el.remove(), ms);
  }

  /** Important notices bypass the kill-feed setting. */
  notice(html: string, ms = 6000): void {
    const was = this.killFeedEnabled;
    this.killFeedEnabled = true;
    this.killFeed(html, ms);
    this.killFeedEnabled = was;
  }

  bossBanner(text: string | null): void {
    const b = $('boss-banner');
    if (text === null) {
      b.classList.add('hidden');
    } else {
      b.textContent = text;
      b.classList.remove('hidden');
    }
  }

  showDeath(dropped: number, cause: string): void {
    const causeText: Record<string, string> = {
      player: 'Убит игроком', mob: 'Убит мобом', boss: 'Убит боссом', turret: 'Расстрелян турелью',
    };
    $('death-info').textContent = `${causeText[cause] ?? 'Погиб'}. Потеряно монет: ${dropped}`;
    $('death-screen').classList.remove('hidden');
  }

  updateDeath(respawnIn: number | undefined): void {
    if (respawnIn === undefined) {
      $('death-screen').classList.add('hidden');
    } else {
      $('respawn-count').textContent = Math.ceil(respawnIn).toString();
    }
  }
}

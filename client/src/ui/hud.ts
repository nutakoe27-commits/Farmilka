import type { SelfState } from '@shared/protocol.js';
import type { WeaponId } from '@shared/types.js';
import { WEAPON_ICONS } from '../game/entities.js';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

export class Hud {
  private lastMoney = -1;
  onEquip: (w: WeaponId) => void = () => {};

  show(): void {
    $('hud').classList.remove('hidden');
  }

  update(self: SelfState): void {
    const hpFrac = Math.max(0, self.hp / self.maxHp);
    ($('hp-bar') as HTMLElement).style.width = `${hpFrac * 100}%`;
    $('hp-text').textContent = `${self.hp} / ${self.maxHp}`;
    if (self.money !== this.lastMoney) {
      this.lastMoney = self.money;
      $('money').textContent = `💰 ${self.money}`;
    }
    $('zone-label').classList.toggle('hidden', !self.inSafe);
    this.renderHotbar(self);
  }

  private renderHotbar(self: SelfState): void {
    const bar = $('hotbar');
    const want = self.weapons.map((w, i) => `${w}${w === self.equipped ? '*' : ''}${i}`).join('|');
    if (bar.dataset.state === want) return;
    bar.dataset.state = want;
    bar.innerHTML = '';
    self.weapons.forEach((w, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot' + (w === self.equipped ? ' active' : '');
      slot.innerHTML = `<span class="key">${i + 1}</span><span class="icon">${WEAPON_ICONS[w] ?? ''}</span><span>${w}</span>`;
      slot.style.pointerEvents = 'auto';
      slot.onclick = () => this.onEquip(w);
      bar.appendChild(slot);
    });
  }

  killFeed(html: string, ms = 6000): void {
    const el = document.createElement('div');
    el.className = 'kf';
    el.innerHTML = html;
    const feed = $('killfeed');
    feed.prepend(el);
    while (feed.children.length > 6) feed.lastChild?.remove();
    setTimeout(() => el.remove(), ms);
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

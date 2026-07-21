import type { SelfState, WelcomeMsg } from '@shared/protocol.js';
import type { WeaponId, BuildingId } from '@shared/types.js';
import { WEAPON_ICONS, BUILDING_ICONS, HAT_EMOJI, TIER_NAMES, TIER_COLORS } from '../game/entities.js';
import { prestigeTier } from '@shared/prestige.js';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const WEAPON_NOTES: Record<string, string> = {
  sword: 'база', spear: 'длинный укол', hammer: 'медленный, AoE + отброс', bow: 'дальний бой', crossbow: 'снайпер',
};
const BUILDING_NOTES: Record<string, string> = {
  farm: 'пассивный доход', mine: 'больше дохода', turret: 'стреляет по врагам',
};

function describeEffect(effect: Record<string, number | undefined>): string {
  const parts: string[] = [];
  if (effect.speedMult) parts.push(`+${Math.round((effect.speedMult - 1) * 100)}% скорость`);
  if (effect.maxHpAdd) parts.push(`+${effect.maxHpAdd} HP`);
  if (effect.damageMult) parts.push(`+${Math.round((effect.damageMult - 1) * 100)}% урон`);
  if (effect.foodHealMult) parts.push(`+${Math.round((effect.foodHealMult - 1) * 100)}% лечение едой`);
  if (effect.incomeMult) parts.push(`+${Math.round((effect.incomeMult - 1) * 100)}% доход построек`);
  if (effect.regenMult) parts.push(`×${effect.regenMult} реген`);
  return parts.join(' · ') || 'без эффекта';
}

export class Shop {
  visible = false;
  placing: BuildingId | null = null;

  onBuy: (item: WeaponId | 'food') => void = () => {};
  onSell: (item: WeaponId) => void = () => {};
  onStartPlace: (b: BuildingId) => void = () => {};
  onLootbox: () => void = () => {};
  onEquipHat: (hat: string | null) => void = () => {};
  onPrestige: () => void = () => {};

  constructor(private welcome: WelcomeMsg) {
    $('shop-close').onclick = () => this.hide();
    ($('prestige-btn') as HTMLButtonElement).onclick = () => this.onPrestige();
    this.buildItems();
  }

  private buildItems(): void {
    // food
    const fg = $('shop-food');
    fg.innerHTML = '';
    const f = this.welcome.food;
    const fel = document.createElement('div');
    fel.className = 'shop-item';
    fel.dataset.item = 'food';
    fel.innerHTML = `<div><div class="nm">🍖 Еда</div><div class="st">+${f.heal} HP · перезарядка ${f.cooldownSec}с · макс. ${f.maxCarry} шт<br>жми Q вовремя — и выживешь в PvP</div></div><div class="btns"><button>💰 ${f.price}</button></div>`;
    fel.querySelector('button')!.onclick = () => this.onBuy('food');
    fg.appendChild(fel);

    // weapons
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
      el.innerHTML = `<div><div class="nm">${WEAPON_ICONS[id] ?? ''} ${id}</div><div class="st">${stats}<br>${WEAPON_NOTES[id] ?? ''}</div></div><div class="btns"><button class="buy">💰 ${cfg.price}</button><button class="sell hidden">Продать</button></div>`;
      (el.querySelector('.buy') as HTMLButtonElement).onclick = () => this.onBuy(id as WeaponId);
      (el.querySelector('.sell') as HTMLButtonElement).onclick = () => this.onSell(id as WeaponId);
      wg.appendChild(el);
    }

    // buildings
    const bg = $('shop-buildings');
    bg.innerHTML = '';
    for (const [id, cfg] of Object.entries(this.welcome.buildings)) {
      const el = document.createElement('div');
      el.className = 'shop-item';
      el.dataset.item = id;
      const stats = cfg.income > 0
        ? `+${cfg.income} монет / ${cfg.incomeIntervalSec}с · HP ${cfg.hp}`
        : `урон ${cfg.damage}/выстрел · дальн. ${cfg.range} · HP ${cfg.hp}`;
      el.innerHTML = `<div><div class="nm">${BUILDING_ICONS[id] ?? ''} ${id}</div><div class="st">${stats}<br>${BUILDING_NOTES[id] ?? ''}<br>исчезает при выходе из игры</div></div><div class="btns"><button>💰 ${cfg.price}</button></div>`;
      el.querySelector('button')!.onclick = () => {
        this.hide();
        this.onStartPlace(id as BuildingId);
      };
      bg.appendChild(el);
    }

    // lootbox
    const lb = $('shop-lootbox');
    lb.innerHTML = '';
    const lbe = document.createElement('div');
    lbe.className = 'shop-item';
    lbe.innerHTML = `<div><div class="nm">🎁 Лутбокс</div><div class="st">Шанс на эпическую или легендарную шляпу,<br>золото — или ничего. Дубликат = бонусное золото.</div></div><div class="btns"><button id="lootbox-btn">💰 ${this.welcome.hats.lootboxPrice}</button></div>`;
    (lbe.querySelector('#lootbox-btn') as HTMLButtonElement).onclick = () => this.onLootbox();
    lb.appendChild(lbe);

    // hat collection
    const hg = $('shop-hats');
    hg.innerHTML = '';
    const sourceText: Record<string, string> = {
      common: 'падает с мобов', rare: 'падает с боссов', epic: 'только из лутбокса', legendary: 'только из лутбокса',
    };
    const tierOrder = ['common', 'rare', 'epic', 'legendary'];
    const hats = Object.entries(this.welcome.hats.items)
      .sort((a, b) => tierOrder.indexOf(a[1].tier) - tierOrder.indexOf(b[1].tier));
    for (const [id, cfg] of hats) {
      const el = document.createElement('div');
      el.className = 'shop-item';
      el.dataset.hat = id;
      const fx = describeEffect(cfg.effect);
      el.innerHTML = `<div><div class="nm">${HAT_EMOJI[id] ?? '🎩'} ${cfg.name} <span class="tier-badge" style="background:${TIER_COLORS[cfg.tier]};color:#0d0f14">${TIER_NAMES[cfg.tier]}</span></div><div class="st">${fx}<br>${sourceText[cfg.tier]}</div></div><div class="btns"><button class="hat-btn"></button></div>`;
      (el.querySelector('.hat-btn') as HTMLButtonElement).onclick = () => {
        const btn = el.querySelector('.hat-btn') as HTMLButtonElement;
        this.onEquipHat(btn.dataset.equipped === '1' ? null : id);
      };
      hg.appendChild(el);
    }
  }

  refresh(self: SelfState): void {
    if (!this.visible) return;
    const sellFrac = this.welcome.economy.sellFrac;

    const foodBtn = $('shop-food').querySelector('button') as HTMLButtonElement;
    foodBtn.disabled = self.money < this.welcome.food.price || self.food >= this.welcome.food.maxCarry;
    foodBtn.textContent = self.food >= this.welcome.food.maxCarry ? 'Максимум' : `💰 ${this.welcome.food.price}`;

    for (const el of document.querySelectorAll<HTMLElement>('#shop-weapons .shop-item')) {
      const id = el.dataset.item as WeaponId;
      const cfg = this.welcome.weapons[id];
      const buy = el.querySelector('.buy') as HTMLButtonElement;
      const sell = el.querySelector('.sell') as HTMLButtonElement;
      const owned = self.weapons.includes(id);
      el.classList.toggle('owned', owned);
      if (owned) {
        buy.textContent = 'Куплено';
        buy.disabled = true;
        sell.classList.remove('hidden');
        sell.textContent = `Продать +${Math.floor(cfg.price * sellFrac)}`;
        sell.disabled = false;
      } else {
        buy.textContent = `💰 ${cfg.price}`;
        buy.disabled = self.money < cfg.price || self.weapons.length >= 4;
        sell.classList.add('hidden');
      }
    }
    for (const el of document.querySelectorAll<HTMLElement>('#shop-buildings .shop-item')) {
      const id = el.dataset.item as BuildingId;
      const cfg = this.welcome.buildings[id];
      const btn = el.querySelector('button') as HTMLButtonElement;
      btn.disabled = self.money < cfg.price || self.buildings >= this.welcome.maxBuildings;
    }
    $('build-count').textContent = `(${self.buildings}/${this.welcome.maxBuildings})`;

    // prestige
    const pcfg = this.welcome.prestige;
    const tier = prestigeTier(self.prestige, pcfg);
    $('prestige-level').textContent = String(self.prestige);
    const tierBadge = $('prestige-tier');
    if (tier) {
      tierBadge.textContent = tier.name;
      tierBadge.style.background = tier.color;
      tierBadge.style.color = '#0d0f14';
      tierBadge.style.display = '';
    } else {
      tierBadge.style.display = 'none';
    }
    const pBtn = $('prestige-btn') as HTMLButtonElement;
    if (self.prestigeCost <= 0) {
      pBtn.textContent = 'Максимум';
      pBtn.disabled = true;
    } else {
      pBtn.textContent = `💰 ${self.prestigeCost}`;
      pBtn.disabled = self.money < self.prestigeCost;
    }

    // hats
    ($('lootbox-btn') as HTMLButtonElement).disabled = self.money < this.welcome.hats.lootboxPrice;
    $('hat-count').textContent = `(собрано ${self.hats.length}/${Object.keys(this.welcome.hats.items).length})`;
    for (const el of document.querySelectorAll<HTMLElement>('#shop-hats .shop-item')) {
      const id = el.dataset.hat!;
      const btn = el.querySelector('.hat-btn') as HTMLButtonElement;
      const owned = self.hats.includes(id);
      const equipped = self.hat === id;
      el.style.opacity = owned ? '1' : '0.55';
      btn.dataset.equipped = equipped ? '1' : '0';
      if (!owned) {
        btn.textContent = 'Нет';
        btn.disabled = true;
      } else {
        btn.disabled = false;
        btn.textContent = equipped ? 'Снять' : 'Надеть';
        btn.style.background = equipped ? '#238636' : '#1f6feb';
      }
    }
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

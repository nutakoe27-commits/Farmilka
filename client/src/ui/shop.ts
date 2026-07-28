import type { SelfState, WelcomeMsg } from '@shared/protocol.js';
import type { WeaponId, BuildingId } from '@shared/types.js';
import { WEAPON_ICONS, BUILDING_ICONS, HAT_EMOJI, TIER_NAMES, TIER_COLORS } from '../game/entities.js';
import { prestigeTier } from '@shared/prestige.js';
import { killsToNext } from '@shared/levels.js';
import { t, hatName, weaponName } from './i18n.js';
import { rankFromBanked, bankedForRank, rankPerks } from '@shared/rank.js';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const pct = (mult: number): number => Math.round((mult - 1) * 100);

function describeEffect(effect: Record<string, number | undefined>): string {
  const parts: string[] = [];
  if (effect.speedMult) parts.push(t('fx.speed', { n: pct(effect.speedMult) }));
  if (effect.maxHpAdd) parts.push(t('fx.hp', { n: effect.maxHpAdd }));
  if (effect.damageMult) parts.push(t('fx.damage', { n: pct(effect.damageMult) }));
  if (effect.foodHealMult) parts.push(t('fx.foodHeal', { n: pct(effect.foodHealMult) }));
  if (effect.incomeMult) parts.push(t('fx.income', { n: pct(effect.incomeMult) }));
  if (effect.regenMult) parts.push(t('fx.regen', { n: effect.regenMult }));
  if (effect.coinMagnetAdd) parts.push(t('fx.magnet', { n: effect.coinMagnetAdd }));
  if (effect.foodFindMult) parts.push(t('fx.foodFind', { n: pct(effect.foodFindMult) }));
  if (effect.mobRewardMult) parts.push(t('fx.mobReward', { n: pct(effect.mobRewardMult) }));
  if (effect.respawnMult) parts.push(t('fx.respawn', { n: effect.respawnMult }));
  if (effect.dropSaveFrac) parts.push(t('fx.dropSave', { n: Math.round(effect.dropSaveFrac * 100) }));
  if (effect.bossDmgMult) parts.push(t('fx.bossDmg', { n: pct(effect.bossDmgMult) }));
  return parts.join(' · ') || t('fx.none');
}

export class Shop {
  visible = false;
  placing: BuildingId | null = null;

  onBuy: (item: WeaponId | 'food') => void = () => {};
  onSell: (item: WeaponId) => void = () => {};
  onStartPlace: (b: BuildingId) => void = () => {};
  onLootbox: () => void = () => {};
  onWeaponLootbox: () => void = () => {};
  onWithdraw: () => void = () => {};
  onEquipHat: (hat: string | null) => void = () => {};
  onPrestige: () => void = () => {};

  constructor(private welcome: WelcomeMsg) {
    $('shop-close').onclick = () => this.hide();
    ($('prestige-btn') as HTMLButtonElement).onclick = () => this.onPrestige();
    $('level-max').textContent = `/${this.welcome.levels.max}`;
    for (const tab of document.querySelectorAll<HTMLElement>('.shop-tab')) {
      tab.onclick = () => this.showTab(tab.dataset.tab!);
    }
    this.buildItems();
  }

  /** Switches the visible category tab; the header (level-up, close) stays put. */
  private showTab(name: string): void {
    for (const t of document.querySelectorAll<HTMLElement>('.shop-tab')) {
      t.classList.toggle('active', t.dataset.tab === name);
    }
    for (const p of document.querySelectorAll<HTMLElement>('.shop-panel')) {
      p.classList.toggle('hidden', p.dataset.panel !== name);
    }
    $('shop-body').scrollTop = 0;
  }

  private buildItems(): void {
    // food
    const fg = $('shop-food');
    fg.innerHTML = '';
    const f = this.welcome.food;
    const fel = document.createElement('div');
    fel.className = 'shop-item';
    fel.dataset.item = 'food';
    fel.innerHTML = `<div><div class="nm">${t('shop.foodName')}</div><div class="st">${t('shop.foodStat', { heal: f.heal, cd: f.cooldownSec, max: f.maxCarry })}</div></div><div class="btns"><button>💰 ${f.price}</button></div>`;
    fel.querySelector('button')!.onclick = () => this.onBuy('food');
    fg.appendChild(fel);

    // weapons: shop weapons first (by price), then unique lootbox-only ones
    const wg = $('shop-weapons');
    wg.innerHTML = '';
    const weapons = Object.entries(this.welcome.weapons)
      .filter(([id, cfg]) => id !== 'fists' && !cfg.tier)
      .sort((a, b) => a[1].price - b[1].price);
    for (const [id, cfg] of weapons) {
      const el = document.createElement('div');
      el.className = 'shop-item';
      el.dataset.item = id;
      const stats = cfg.type === 'melee'
        ? t('shop.dmg', { dmg: cfg.damage, range: cfg.range, rate: cfg.attackRate })
        : t('shop.dmgRanged', { dmg: cfg.damage, range: cfg.range, rate: cfg.attackRate });
      el.innerHTML = `<div><div class="nm">${WEAPON_ICONS[id] ?? ''} ${weaponName(id)}</div><div class="st">${stats}<br>${t('note.' + id)}</div></div><div class="btns"><button class="buy">💰 ${cfg.price}</button><button class="sell hidden">${t('shop.sell')}</button></div>`;
      (el.querySelector('.buy') as HTMLButtonElement).onclick = () => this.onBuy(id as WeaponId);
      (el.querySelector('.sell') as HTMLButtonElement).onclick = () => this.onSell(id as WeaponId);
      wg.appendChild(el);
    }
    const uniques = Object.entries(this.welcome.weapons)
      .filter(([, cfg]) => !!cfg.tier)
      .sort((a, b) => (a[1].tier === b[1].tier ? 0 : a[1].tier === 'epic' ? -1 : 1));
    for (const [id, cfg] of uniques) {
      const el = document.createElement('div');
      el.className = 'shop-item unique-weapon';
      el.dataset.item = id;
      const stats = cfg.type === 'melee'
        ? t('shop.dmg', { dmg: cfg.damage, range: cfg.range, rate: cfg.attackRate })
        : t('shop.dmgRanged', { dmg: cfg.damage, range: cfg.range, rate: cfg.attackRate });
      const tierBadge = `<span class="tier-badge" style="background:${TIER_COLORS[cfg.tier!]};color:#0d0f14">${TIER_NAMES[cfg.tier!]}</span>`;
      el.innerHTML = `<div><div class="nm">${WEAPON_ICONS[id] ?? ''} ${weaponName(id)} ${tierBadge}</div><div class="st">${stats}<br><b style="color:${TIER_COLORS[cfg.tier!]}">${t('note.' + id)}</b><br>${t('shop.uniqueSrc')}</div></div><div class="btns"><button class="sell hidden">${t('shop.sell')}</button></div>`;
      (el.querySelector('.sell') as HTMLButtonElement).onclick = () => this.onSell(id as WeaponId);
      wg.appendChild(el);
    }

    // buildings — the bank row sits on top: this is where a run's gold is made safe
    const bg = $('shop-buildings');
    bg.innerHTML = '';
    const bank = document.createElement('div');
    bank.className = 'shop-item';
    bank.id = 'shop-bank';
    bank.innerHTML = `<div><div class="nm">🏦 <span id="bank-total"></span></div><div class="st">${t('shop.bankHint')}</div></div><div class="btns"><button id="withdraw-btn">${t('shop.withdraw')}</button></div>`;
    (bank.querySelector('#withdraw-btn') as HTMLButtonElement).onclick = () => this.onWithdraw();
    bg.appendChild(bank);
    const rankRow = document.createElement('div');
    rankRow.className = 'shop-item';
    rankRow.id = 'shop-rank';
    rankRow.innerHTML = `<div><div class="nm">★ <span id="rank-title"></span></div><div class="st" id="rank-perks"></div></div><div class="btns"></div>`;
    bg.appendChild(rankRow);
    for (const [id, cfg] of Object.entries(this.welcome.buildings)) {
      if (id === 'vault') continue; // comes free with the base
      const el = document.createElement('div');
      el.className = 'shop-item';
      el.dataset.item = id;
      // walls neither earn nor shoot — the turret stat line would read "dmg 0 · range 0"
      const stats = cfg.income > 0
        ? t('shop.income', { n: cfg.income, sec: cfg.incomeIntervalSec, hp: cfg.hp })
        : cfg.damage
          ? t('shop.turretStat', { dmg: cfg.damage, range: cfg.range ?? 0, hp: cfg.hp })
          : t('shop.wallStat', { hp: cfg.hp });
      el.innerHTML = `<div><div class="nm">${BUILDING_ICONS[id] ?? ''} ${id}</div><div class="st">${stats}<br>${t('note.' + id)}<br>${t('shop.buildingVanish')}</div></div><div class="btns"><button>💰 ${cfg.price}</button></div>`;
      el.querySelector('button')!.onclick = () => {
        this.hide();
        this.onStartPlace(id as BuildingId);
      };
      bg.appendChild(el);
    }

    // lootboxes: hat lootbox + weapon crate
    const lb = $('shop-lootbox');
    lb.innerHTML = '';
    const lbe = document.createElement('div');
    lbe.className = 'shop-item';
    lbe.innerHTML = `<div><div class="nm">${t('shop.lootbox')}</div><div class="st">${t('shop.lootboxDesc')}</div></div><div class="btns"><button id="lootbox-btn">💰 ${this.welcome.hats.lootboxPrice}</button></div>`;
    (lbe.querySelector('#lootbox-btn') as HTMLButtonElement).onclick = () => this.onLootbox();
    lb.appendChild(lbe);
    const wle = document.createElement('div');
    wle.className = 'shop-item';
    wle.innerHTML = `<div><div class="nm">${t('shop.weaponLootbox')}</div><div class="st">${t('shop.weaponLootboxDesc')}</div></div><div class="btns"><button id="weapon-lootbox-btn">💰 ${this.welcome.weaponLootboxPrice}</button></div>`;
    (wle.querySelector('#weapon-lootbox-btn') as HTMLButtonElement).onclick = () => this.onWeaponLootbox();
    lb.appendChild(wle);

    // hat collection
    const hg = $('shop-hats');
    hg.innerHTML = '';
    const sourceText: Record<string, string> = {
      common: t('src.common'), rare: t('src.rare'), epic: t('src.epic'), legendary: t('src.legendary'),
    };
    const tierOrder = ['common', 'rare', 'epic', 'legendary'];
    const hats = Object.entries(this.welcome.hats.items)
      .sort((a, b) => tierOrder.indexOf(a[1].tier) - tierOrder.indexOf(b[1].tier));
    for (const [id, cfg] of hats) {
      const el = document.createElement('div');
      el.className = 'shop-item';
      el.dataset.hat = id;
      const fx = describeEffect(cfg.effect);
      el.innerHTML = `<div><div class="nm">${HAT_EMOJI[id] ?? '🎩'} ${hatName(id, cfg.name)} <span class="tier-badge" style="background:${TIER_COLORS[cfg.tier]};color:#0d0f14">${TIER_NAMES[cfg.tier]}</span></div><div class="st">${fx}<br>${sourceText[cfg.tier]}</div></div><div class="btns"><button class="hat-btn"></button></div>`;
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
    foodBtn.textContent = self.food >= this.welcome.food.maxCarry ? t('shop.max') : `💰 ${this.welcome.food.price}`;

    for (const el of document.querySelectorAll<HTMLElement>('#shop-weapons .shop-item')) {
      const id = el.dataset.item as WeaponId;
      const cfg = this.welcome.weapons[id];
      const buy = el.querySelector('.buy') as HTMLButtonElement | null;
      const sell = el.querySelector('.sell') as HTMLButtonElement;
      const owned = self.weapons.includes(id);
      const sellValue = cfg.sellPrice ?? Math.floor(cfg.price * sellFrac);
      el.classList.toggle('owned', owned);
      if (cfg.tier) {
        // unique: lootbox-only — dim until owned, then sell-only
        el.style.opacity = owned ? '1' : '0.55';
        sell.classList.toggle('hidden', !owned);
        if (owned) {
          sell.textContent = t('shop.sellFor', { n: sellValue });
          sell.disabled = false;
        }
        continue;
      }
      if (owned) {
        buy!.textContent = t('shop.bought');
        buy!.disabled = true;
        sell.classList.remove('hidden');
        sell.textContent = t('shop.sellFor', { n: sellValue });
        sell.disabled = false;
      } else {
        buy!.textContent = `💰 ${cfg.price}`;
        buy!.disabled = self.money < cfg.price || self.weapons.length >= 4;
        sell.classList.add('hidden');
      }
    }
    for (const el of document.querySelectorAll<HTMLElement>('#shop-buildings .shop-item')) {
      const id = el.dataset.item as BuildingId | undefined;
      if (!id) continue; // the bank row is not a purchasable building
      const cfg = this.welcome.buildings[id];
      const btn = el.querySelector('button') as HTMLButtonElement;
      // walls run on their own budget, so a full farm plot still lets you fortify
      const atLimit = id === 'wall'
        ? self.walls >= this.welcome.maxWalls
        : self.buildings >= this.welcome.maxBuildings;
      btn.disabled = self.money < cfg.price || atLimit;
    }
    $('build-count').textContent = t('shop.buildCount', { n: self.buildings, max: this.welcome.maxBuildings })
      + ' ' + t('shop.wallCount', { n: self.walls, max: this.welcome.maxWalls });
    $('bank-total').textContent = t('shop.bankRow', { n: self.banked });
    ($('withdraw-btn') as HTMLButtonElement).disabled = self.banked <= 0;

    // Base Rank: earned by banking, and it only ever buys economy perks
    const rcfg = this.welcome.rank;
    const rank = rankFromBanked(self.bankedTotal, rcfg);
    const need = bankedForRank(rank + 1, rcfg);
    const perks = rankPerks(rank, rcfg);
    $('rank-title').textContent = t('shop.rankTitle', { n: rank, need: Math.max(0, need - self.bankedTotal) });
    $('rank-perks').innerHTML = t('shop.rankPerks', {
      silo: Math.round((perks.siloCapMult - 1) * 100),
      prod: Math.round((perks.productionMult - 1) * 100),
      slots: perks.extraSlots,
      respawn: Math.round((1 - perks.respawnMult) * 100),
      magnet: Math.round(perks.magnetAdd),
      prot: Math.round(perks.vaultProtection * 100),
    });

    // level — earned from kills; show progress to the next level
    $('level-cur').textContent = String(self.level);
    const toNext = killsToNext(self.levelKills, this.welcome.levels);
    $('level-prog').textContent = self.level >= this.welcome.levels.max ? t('shop.max') : t('shop.levelProg', { n: toNext });

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
      pBtn.textContent = t('shop.max');
      pBtn.disabled = true;
    } else {
      pBtn.textContent = `💰 ${self.prestigeCost}`;
      pBtn.disabled = self.money < self.prestigeCost;
    }

    // hats
    ($('lootbox-btn') as HTMLButtonElement).disabled = self.money < this.welcome.hats.lootboxPrice;
    ($('weapon-lootbox-btn') as HTMLButtonElement).disabled = self.money < this.welcome.weaponLootboxPrice;
    $('hat-count').textContent = t('shop.hatCount', { n: self.hats.length, total: Object.keys(this.welcome.hats.items).length });
    for (const el of document.querySelectorAll<HTMLElement>('#shop-hats .shop-item')) {
      const id = el.dataset.hat!;
      const btn = el.querySelector('.hat-btn') as HTMLButtonElement;
      const owned = self.hats.includes(id);
      const equipped = self.hat === id;
      el.style.opacity = owned ? '1' : '0.55';
      btn.dataset.equipped = equipped ? '1' : '0';
      if (!owned) {
        btn.textContent = t('shop.none');
        btn.disabled = true;
      } else {
        btn.disabled = false;
        btn.textContent = equipped ? t('shop.unequip') : t('shop.equip');
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

import { Application, Container, Graphics, Sprite } from 'pixi.js';
import { SPARK } from './game/textures.js';
import { clamp } from '@shared/math.js';
import type { WeaponId } from '@shared/types.js';
import type { WelcomeMsg } from '@shared/protocol.js';
import { Connection } from './net/connection.js';
import { sample, type Sampled } from './net/interpolation.js';
import { Scene } from './game/scene.js';
import { EntityView, WEAPON_ICONS, setPrestigeCfg } from './game/entities.js';
import { prestigeTier } from '@shared/prestige.js';
import { Effects } from './game/effects.js';
import { InputManager } from './game/input.js';
import { MobileControls, isTouchDevice } from './game/mobile.js';
import { Hud } from './ui/hud.js';
import { Shop } from './ui/shop.js';
import { Minimap } from './ui/minimap.js';
import { Leaderboard } from './ui/leaderboard.js';
import { Settings } from './ui/settings.js';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

// ---------- name/login screen ----------

const nameInput = $('name-input') as HTMLInputElement;
const passInput = $('pass-input') as HTMLInputElement;
nameInput.value = localStorage.getItem('farmclash-name') ?? '';
nameInput.focus();

let inGame = false;

function tryStart(register: boolean): void {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }
  const password = passInput.value;
  if (register && !password) {
    showError('Для аккаунта нужен пароль (мин. 4 символа)');
    return;
  }
  localStorage.setItem('farmclash-name', name);
  $('conn-error').textContent = '';
  $('name-screen').classList.add('hidden');
  const serverPref = Number(localStorage.getItem('farmclash-server')) || undefined;
  startGame(name, password, register, serverPref).catch((err) => {
    console.error(err);
    showError('Не удалось запустить игру');
  });
}

$('play-btn').onclick = () => tryStart(false);
$('register-btn').onclick = () => tryStart(true);
passInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryStart(false);
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryStart(false);
});

function showError(text: string): void {
  $('name-screen').classList.remove('hidden');
  $('conn-error').textContent = text;
}

// ---------- game ----------

async function startGame(name: string, password: string, register: boolean, server?: number): Promise<void> {
  const conn = new Connection(name, password, register, server);
  conn.onClose = (reason) => {
    if (inGame) {
      // hard reload keeps state clean after a real session
      sessionStorage.setItem('farmclash-msg', reason);
      location.reload();
      return;
    }
    $('queue-screen').classList.add('hidden');
    $('hud').classList.add('hidden');
    showError(reason);
  };
  conn.onQueued = (pos) => {
    $('queue-screen').classList.remove('hidden');
    $('queue-pos').textContent = String(pos);
  };
  conn.onWelcome = (w) => {
    inGame = true;
    $('queue-screen').classList.add('hidden');
    initGame(conn, w).catch((err) => {
      console.error(err);
      showError('Ошибка инициализации графики');
    });
  };
}

const savedMsg = sessionStorage.getItem('farmclash-msg');
if (savedMsg) {
  sessionStorage.removeItem('farmclash-msg');
  $('conn-error').textContent = savedMsg;
}

async function initGame(conn: Connection, welcome: WelcomeMsg): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x0a0c11, antialias: true });
  $('app').appendChild(app.canvas);

  const scene = new Scene(app);
  scene.viewScale = isTouchDevice() ? 1.6 : 1; // phones get a wider view of the world
  scene.drawGround(welcome.world.size);
  setPrestigeCfg(welcome.prestige);
  const effects = new Effects(scene.layers.effects, scene.layers.telegraphs);

  // ambient drifting motes (screen-space atmosphere)
  const motes = new Container();
  motes.eventMode = 'none';
  app.stage.addChild(motes);
  const moteList: { s: Sprite; vx: number; vy: number }[] = [];
  for (let i = 0; i < 40; i++) {
    const s = new Sprite(SPARK);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = 0x9ecbff;
    s.alpha = 0.06 + Math.random() * 0.1;
    s.width = s.height = 3 + Math.random() * 6;
    s.position.set(Math.random() * app.screen.width, Math.random() * app.screen.height);
    motes.addChild(s);
    moteList.push({ s, vx: (Math.random() - 0.5) * 8, vy: -5 - Math.random() * 9 });
  }
  const updateMotes = (dt: number): void => {
    const w = app.screen.width, h = app.screen.height;
    for (const m of moteList) {
      m.s.position.x += m.vx * dt;
      m.s.position.y += m.vy * dt;
      if (m.s.position.y < -10) { m.s.position.y = h + 10; m.s.position.x = Math.random() * w; }
      if (m.s.position.x < -10) m.s.position.x = w + 10;
      else if (m.s.position.x > w + 10) m.s.position.x = -10;
    }
  };
  let frame = 0;
  const settings = new Settings();
  settings.currentServer = welcome.server;
  const hud = new Hud();
  hud.setFoodCooldown(welcome.food.cooldownSec);
  hud.setMaxLevel(welcome.levels.max);
  hud.killFeedEnabled = settings.values.killFeed;
  const shop = new Shop(welcome);
  const minimap = new Minimap(welcome.world.size);
  const leaderboard = new Leaderboard(welcome.prestige);
  const input = new InputManager();
  const mobile = isTouchDevice() ? new MobileControls() : null;
  hud.show();
  runOnboarding(!!mobile);

  const views = new Map<string, EntityView>();
  const tmp: Sampled = { x: 0, y: 0, angle: 0 };

  let predX = welcome.world.size / 2;
  let predY = welcome.world.size / 2;
  let dispX = predX;
  let dispY = predY;
  let aim = 0;
  let seq = 0;
  let selfDead = false;
  let bossWarnUntil = 0;
  let bossWarnName = '';

  let ghost: Graphics | null = null;

  const layerFor = (kind: string) => {
    switch (kind) {
      case 'player': return scene.layers.players;
      case 'mob': return scene.layers.mobs;
      case 'boss': return scene.layers.players;
      case 'projectile': return scene.layers.projectiles;
      case 'coin': return scene.layers.coins;
      case 'food': return scene.layers.coins;
      case 'building': return scene.layers.buildings;
      default: return scene.layers.effects;
    }
  };

  /** Nearest attackable target within range — mobile auto-aim. */
  function autoAimAngle(): number | null {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const r of conn.entities.values()) {
      const st = r.state;
      if (st.id === welcome.id) continue;
      if (st.kind !== 'mob' && st.kind !== 'player' && st.kind !== 'boss' && st.kind !== 'building') continue;
      if (st.kind === 'building' && st.owner === welcome.id) continue;
      const d = Math.hypot(st.x - dispX, st.y - dispY);
      // prefer non-buildings: bias building distance up
      const weighted = st.kind === 'building' ? d * 1.6 : d;
      if (weighted < bestD && d < 800) {
        bestD = weighted;
        best = st;
      }
    }
    if (!best) return null;
    return Math.atan2(best.y - dispY, best.x - dispX);
  }

  /** Kill-feed prestige badge for a player found by name among visible entities. */
  function prestigeBadge(name: string): string {
    let prestige = 0;
    if (conn.self && welcome.id && name === (views.get(welcome.id)?.state.name ?? '')) prestige = conn.self.prestige;
    for (const r of conn.entities.values()) {
      if (r.state.kind === 'player' && r.state.name === name) { prestige = Math.max(prestige, r.state.prestige ?? 0); }
    }
    if (prestige <= 0) return '';
    const tier = prestigeTier(prestige, welcome.prestige);
    const color = tier ? tier.color : '#d88bff';
    return `<span style="color:${color};font-weight:700">✦${prestige}</span> `;
  }

  function moveSpeed(attack: boolean): number {
    let speed = welcome.player.speed;
    const hat = conn.self?.hat;
    if (hat) speed *= welcome.hats.items[hat]?.effect.speedMult ?? 1;
    speed *= conn.self?.chill ?? 1; // chilled by an ice weapon
    const w = welcome.weapons[(conn.self?.equipped ?? 'fists') as WeaponId];
    if (w && w.type === 'ranged' && attack && w.slowFactor) speed *= w.slowFactor;
    return speed;
  }

  function applyMove(x: number, y: number, mx: number, my: number, dt: number, attack: boolean): { x: number; y: number } {
    const speed = moveSpeed(attack);
    const r = welcome.player.radius;
    return {
      x: clamp(x + mx * speed * dt, r, welcome.world.size - r),
      y: clamp(y + my * speed * dt, r, welcome.world.size - r),
    };
  }

  // ---------- server events ----------

  conn.onSnapshot = () => {
    const self = conn.self!;
    let px = self.x;
    let py = self.y;
    for (const inp of conn.pending) {
      const res = applyMove(px, py, inp.mx, inp.my, inp.dt, inp.attack);
      px = res.x;
      py = res.y;
    }
    predX = px;
    predY = py;

    hud.update(self);
    shop.refresh(self);
    mobile?.setFoodCount(self.food);
    mobile?.setWeapon(WEAPON_ICONS[self.equipped] ?? '👊', self.equipped);
    if (selfDead) {
      hud.updateDeath(self.respawnIn);
      if (self.respawnIn === undefined && self.hp > 0) {
        selfDead = false;
        hud.updateDeath(undefined);
      }
    }
  };

  conn.onRemove = (id, state) => {
    const view = views.get(id);
    if (view) {
      if (state.kind === 'player' || state.kind === 'mob' || state.kind === 'boss') {
        effects.burst(view.root.position.x, view.root.position.y, view.color, state.kind === 'boss' ? 40 : 14, state.kind === 'boss' ? 320 : 180);
      } else if (state.kind === 'coin' || state.kind === 'food') {
        effects.burst(view.root.position.x, view.root.position.y, state.kind === 'coin' ? 0xffd76e : 0xff9d5c, 6, 90);
      } else if (state.kind === 'building') {
        effects.burst(view.root.position.x, view.root.position.y, 0x9aa5b8, 24, 220);
      }
      view.destroy();
      views.delete(id);
    }
  };

  conn.onEvent = (ev) => {
    switch (ev.e) {
      case 'kill': {
        const badge = prestigeBadge(ev.killer);
        hud.killFeed(`${badge}<b>${escapeHtml(ev.killer)}</b> ⚔ ${escapeHtml(ev.victim)} <span style="color:#6a7085">(${ev.weapon})</span>`);
        break;
      }
      case 'damage': {
        if (settings.values.damageNumbers) effects.damageNumber(ev.x, ev.y, ev.amount);
        views.get(ev.target)?.flash();
        if (ev.target === conn.welcome!.id && settings.values.shake) scene.shake = 7;
        break;
      }
      case 'heal':
        effects.incomeNumber(dispX, dispY, ev.amount);
        break;
      case 'hat': {
        if (ev.dup) {
          hud.notice(`🎩 Дубликат «${escapeHtml(ev.name)}» → <b style="color:#ffd76e">+${ev.gold} золота</b>`);
        } else {
          hud.bossBanner(`🎩 Новая шляпа: ${ev.name}!`);
          setTimeout(() => hud.bossBanner(null), 5000);
          hud.notice(`🎩 Выпала шляпа: <b>${escapeHtml(ev.name)}</b> — надень её в магазине (B)`);
        }
        break;
      }
      case 'lootbox': {
        if (ev.result === 'gold') hud.notice(`🎁 Лутбокс: <b style="color:#ffd76e">+${ev.gold} золота!</b>`);
        else if (ev.result === 'nothing') hud.notice('🎁 Лутбокс: пусто… не повезло');
        break;
      }
      case 'prestige': {
        hud.bossBanner(`✦ Престиж ${ev.level}${ev.tier ? ` — ${ev.tier}!` : '!'}`);
        setTimeout(() => hud.bossBanner(null), 5000);
        break;
      }
      case 'level': {
        effects.levelBurst(dispX, dispY);
        const maxed = ev.level >= ev.max;
        hud.notice(maxed
          ? `⭐ <b style="color:#7ee787">Максимальный уровень ${ev.level}!</b> Ты силён в PvE — но босса в одиночку не одолеть.`
          : `⭐ Уровень <b style="color:#7ee787">${ev.level}</b> — больше HP и урона`);
        break;
      }
      case 'death':
        selfDead = true;
        hud.showDeath(ev);
        break;
      case 'bossWarn':
        bossWarnUntil = performance.now() + ev.inSec * 1000;
        bossWarnName = ev.boss;
        minimap.ping(ev.x, ev.y, ev.inSec * 1000);
        break;
      case 'bossSpawned':
        bossWarnUntil = 0;
        hud.bossBanner(`💀 ${ev.boss} появился! Убей его ради награды!`);
        minimap.ping(ev.x, ev.y, 60_000);
        setTimeout(() => hud.bossBanner(null), 6000);
        break;
      case 'bossTelegraph':
        effects.telegraph(ev.x, ev.y, ev.angle, ev.range, ev.arc, ev.sec);
        break;
      case 'bossKilled': {
        const top = ev.rewards.slice(0, 3).map((r) => `${escapeHtml(r.name)}: +${r.amount}`).join(' · ');
        hud.bossBanner(`💀 ${ev.boss} повержен! ${top}`);
        setTimeout(() => hud.bossBanner(null), 8000);
        break;
      }
      case 'bossGone':
        hud.bossBanner(`${ev.boss} исчез…`);
        setTimeout(() => hud.bossBanner(null), 4000);
        break;
      case 'buildingAttacked':
        hud.notice('⚠ <b style="color:#ffd76e">Вашу постройку атакуют!</b>');
        minimap.ping(ev.x, ev.y, 5000);
        break;
      case 'buildingDestroyed':
        hud.notice(ev.own ? `💥 Вашу постройку разрушил <b>${escapeHtml(ev.byName)}</b>` : '💥 Вы разрушили постройку — заберите лут!');
        break;
      case 'purchase':
        if (!ev.ok && ev.reason) shop.message(ev.reason);
        break;
      case 'placed':
        if (!ev.ok && ev.reason) hud.notice(`🚫 ${escapeHtml(ev.reason)}`);
        break;
      case 'notice':
        hud.notice(escapeHtml(ev.text));
        break;
    }
  };

  // ---------- input wiring ----------

  input.onToggleShop = () => shop.toggle();
  input.onEat = () => conn.send({ t: 'eat' });
  input.onHotbar = (i) => {
    const self = conn.self;
    if (self && self.weapons[i]) conn.send({ t: 'equip', weapon: self.weapons[i] });
  };
  hud.onEquip = (w) => conn.send({ t: 'equip', weapon: w });
  hud.onEat = () => conn.send({ t: 'eat' });
  hud.onReorder = (weapons) => conn.send({ t: 'reorder', weapons });
  shop.onBuy = (item) => conn.send({ t: 'buy', item });
  shop.onSell = (item) => conn.send({ t: 'sell', weapon: item });
  shop.onLootbox = () => conn.send({ t: 'lootbox' });
  shop.onEquipHat = (hat) => conn.send({ t: 'equipHat', hat });
  shop.onPrestige = () => conn.send({ t: 'prestige' });
  shop.onBuyLevel = () => conn.send({ t: 'buyLevel' });
  conn.onLeaderboard = (top, rank, total) => leaderboard.update(top, rank, total);
  settings.onExit = () => conn.ws.close();
  if (mobile) {
    mobile.onEat = () => conn.send({ t: 'eat' });
    mobile.onShop = () => shop.toggle();
    mobile.onWeapon = () => {
      const self = conn.self;
      if (!self || self.weapons.length < 2) return;
      const idx = self.weapons.indexOf(self.equipped);
      const next = self.weapons[(idx + 1) % self.weapons.length];
      conn.send({ t: 'equip', weapon: next });
    };
  }

  shop.onStartPlace = (b) => {
    shop.setPlacing(b);
    if (ghost) ghost.destroy();
    ghost = new Graphics();
    const r = welcome.buildings[b].radius;
    ghost.roundRect(-r, -r, r * 2, r * 2, 8).fill({ color: 0x2ea043, alpha: 0.35 }).stroke({ width: 2, color: 0x7ee787 });
    scene.layers.effects.addChild(ghost);
  };
  input.onCancel = () => {
    shop.setPlacing(null);
    shop.hide();
    settings.hide();
    if (ghost) {
      ghost.destroy();
      ghost = null;
    }
  };
  input.onWorldClick = (sx, sy) => {
    if (!shop.placing) return false;
    const pos = scene.screenToWorld(sx, sy);
    conn.send({ t: 'place', building: shop.placing, x: Math.round(pos.x), y: Math.round(pos.y) });
    shop.setPlacing(null);
    if (ghost) {
      ghost.destroy();
      ghost = null;
    }
    return true;
  };
  // placement by tap on mobile
  window.addEventListener('touchstart', (e) => {
    if (!shop.placing) return;
    const t = e.touches[0];
    if (t && !(e.target as HTMLElement).closest('.panel,.joy-zone,#mob-buttons')) {
      input.onWorldClick(t.clientX, t.clientY);
    }
  });

  // input send loop: 20 Hz, mirrors server tick rate
  setInterval(() => {
    if (!conn.self || selfDead) return;
    let { mx, my } = input.moveVector();
    let attack = input.attackHeld;
    if (mobile) {
      const ts = mobile.state();
      if (ts.moveX !== 0 || ts.moveY !== 0) {
        mx = ts.moveX;
        my = ts.moveY;
      }
      if (ts.firing) {
        const auto = ts.manualAim ?? autoAimAngle();
        if (auto !== null) aim = auto;
        else if (mx !== 0 || my !== 0) aim = Math.atan2(my, mx);
        attack = true;
      }
    }
    seq++;
    conn.send({ t: 'input', seq, mx, my, aim, attack });
    conn.pending.push({ seq, mx, my, dt: 0.05, attack });
    if (conn.pending.length > 60) conn.pending.shift();
    const res = applyMove(predX, predY, mx, my, 0.05, attack);
    predX = res.x;
    predY = res.y;
  }, 50);

  // ---------- render loop ----------

  scene.camX = predX;
  scene.camY = predY;

  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    const now = performance.now();
    const renderTime = conn.renderTime();
    const selfId = welcome.id;

    if (!mobile) {
      const world = scene.screenToWorld(input.mouseX, input.mouseY);
      aim = Math.atan2(world.y - dispY, world.x - dispX);
    }

    dispX += (predX - dispX) * Math.min(1, dt * 14);
    dispY += (predY - dispY) * Math.min(1, dt * 14);

    for (const [id, r] of conn.entities) {
      let view = views.get(id);
      if (!view) {
        view = new EntityView(r.state, id === selfId);
        views.set(id, view);
        layerFor(r.state.kind).addChild(view.root);
      }
      if (id === selfId) {
        view.update(dispX, dispY, aim, now);
      } else {
        sample(r, renderTime, tmp);
        view.update(tmp.x, tmp.y, tmp.angle, now);
      }
      // glowing trail behind projectiles (throttled to every other frame)
      if (r.state.kind === 'projectile' && (frame & 1) === 0) {
        const c = r.state.name === 'boss-burst' ? 0xff7b72 : 0xffe08a;
        effects.trail(view.root.position.x, view.root.position.y, c);
      }
    }
    frame++;
    updateMotes(dt);

    if (ghost) {
      const pos = scene.screenToWorld(input.mouseX, input.mouseY);
      ghost.position.set(pos.x, pos.y);
    }

    if (bossWarnUntil > now) {
      hud.bossBanner(`⚠ ${bossWarnName} появится через ${Math.ceil((bossWarnUntil - now) / 1000)}с — смотри на миникарту!`);
    }

    hud.killFeedEnabled = settings.values.killFeed;
    effects.update(dt);
    scene.update(dispX, dispY, dt);
    minimap.draw(dispX, dispY, selfId, conn.entities);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** First-time tips: a few rotating hints, then never again (localStorage flag). */
function runOnboarding(mobile: boolean): void {
  if (localStorage.getItem('farmclash-onboarded')) return;
  const tips = mobile
    ? ['👈 Левый джойстик — движение', '⚔ Большая кнопка — атака (тап = автоприцел)', '🛒 Кнопка магазина — оружие и уровни', '🍖 Ешь еду, чтобы выжить в бою']
    : ['WASD — движение, мышь — прицел, ЛКМ — атака', 'Убивай мобов и собирай монеты 💰', 'B — магазин: оружие, постройки, уровни', 'Q — съешь еду, чтобы выжить в бою 🍖'];
  const el = document.getElementById('onboarding')!;
  let i = 0;
  const step = (): void => {
    if (i >= tips.length) {
      el.style.opacity = '0';
      setTimeout(() => el.classList.add('hidden'), 400);
      localStorage.setItem('farmclash-onboarded', '1');
      return;
    }
    el.textContent = tips[i++];
    el.classList.remove('hidden');
    el.style.opacity = '1';
    setTimeout(step, 4200);
  };
  step();
}

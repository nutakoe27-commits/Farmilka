import { Application, Container, Graphics, Sprite } from 'pixi.js';
import { SPARK } from './game/textures.js';
import { clamp } from '@shared/math.js';
import { resolveSolids, type Solid } from '@shared/collision.js';
import type { WeaponId } from '@shared/types.js';
import type { WelcomeMsg } from '@shared/protocol.js';
import { Connection } from './net/connection.js';
import { sample, type Sampled } from './net/interpolation.js';
import { Scene } from './game/scene.js';
import { EntityView, WEAPON_ICONS, TIER_COLORS, setPrestigeCfg } from './game/entities.js';
import { prestigeTier } from '@shared/prestige.js';
import { Effects } from './game/effects.js';
import { InputManager } from './game/input.js';
import { MobileControls, isTouchDevice } from './game/mobile.js';
import { Hud } from './ui/hud.js';
import { Shop } from './ui/shop.js';
import { Minimap } from './ui/minimap.js';
import { Leaderboard } from './ui/leaderboard.js';
import { Settings } from './ui/settings.js';
import { t, tList, lang, setLang, applyStaticI18n, bossName, hatName, weaponName, prestigeTierName } from './ui/i18n.js';
import {
  initPlatform, onPlatform, platformBodyClass, identity as platformIdentity, promptAuth,
  wantsInstantPlay, invitedRoom, gameReady, gameplayStart, gameplayStop, showInterstitial,
  happytime, enterRoom, leaveRoom, isPortalBuild, onAdVisibility, adActive,
} from './net/platform.js';
import { audio } from './game/audio.js';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

// Suppress the browser context menu across the whole game — right-click on
// desktop and long-press on mobile (Yandex moderation 1.6.1.8 / 1.6.2.7).
window.addEventListener('contextmenu', (e) => e.preventDefault());

// Audio may only start after a user gesture (autoplay policy) — unlock on first
// interaction. Silence sound while the tab is hidden (Yandex moderation 1.3).
const unlockAudio = (): void => audio.unlock();
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });
document.addEventListener('visibilitychange', () => audio.duckForBlur(document.hidden));
window.addEventListener('blur', () => audio.duckForBlur(true));
window.addEventListener('focus', () => audio.duckForBlur(false));

/**
 * Boot veil (Yandex 1.19): the menu exists from the first frame but must not be
 * usable until the platform's LoadingAPI.ready has been signalled. The veil
 * covers the page and eats pointer events; bootDone() lifts it. On the
 * standalone site initPlatform() resolves immediately, so it is a blink.
 */
function bootDone(): void {
  // The fallback timer always fires long after the veil is gone, and by then
  // the node has been removed — so this must tolerate not finding it.
  const veil = document.getElementById('boot-veil');
  if (!veil || veil.classList.contains('gone')) return;
  veil.classList.add('gone');
  setTimeout(() => veil.remove(), 300);
  nameInput.focus();
}
// Never leave a player staring at the veil if the SDK never answers.
setTimeout(bootDone, 8000);

// translate all static markup up front, then wire the language switchers
applyStaticI18n();
for (const btn of document.querySelectorAll<HTMLButtonElement>('.lang-switch button')) {
  btn.classList.toggle('active', btn.dataset.lang === lang);
  btn.onclick = () => setLang(btn.dataset.lang as 'ru' | 'en');
}

/** Copy/native-share an invite link to the game. */
function shareGame(feedback?: HTMLElement): void {
  const url = location.origin || `${location.protocol}//${location.host}`;
  if (navigator.share) {
    navigator.share({ title: 'FarmClash', text: t('menu.shareText'), url }).catch(() => {});
    return;
  }
  navigator.clipboard?.writeText(t('menu.shareText') + url).then(() => {
    if (feedback) {
      const prev = feedback.textContent;
      feedback.textContent = t('menu.shareCopied');
      setTimeout(() => { if (feedback.textContent === t('menu.shareCopied')) feedback.textContent = prev; }, 2500);
    }
  }).catch(() => {});
}
$('menu-share').onclick = () => shareGame($('conn-error'));
$('settings-share').onclick = () => shareGame($('settings-share'));

// ---------- name/login screen ----------

const nameInput = $('name-input') as HTMLInputElement;
const passInput = $('pass-input') as HTMLInputElement;
nameInput.value = localStorage.getItem('farmclash-name') ?? '';

let inGame = false;

// On a portal, gate play behind the platform login (a user gesture), then fall
// through to the normal start with the platform name pre-filled.
function tryStart(register: boolean): void {
  if (onPlatform() && !platformIdentity()) {
    promptAuth().then((ok) => {
      if (ok) nameInput.value = platformIdentity()!.name || nameInput.value;
      doStart(register);
    });
    return;
  }
  doStart(register);
}

function doStart(register: boolean): void {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }
  const password = passInput.value;
  if (register && !password) {
    showError(t('menu.needPass'));
    return;
  }
  localStorage.setItem('farmclash-name', name);
  $('conn-error').textContent = '';
  $('name-screen').classList.add('hidden');
  // a followed invite must land in the friend's world, overriding any saved pick
  const serverPref = invitedRoom() ?? (Number(localStorage.getItem('farmclash-server')) || undefined);
  startGame(name, password, register, serverPref).catch((err) => {
    console.error(err);
    showError(t('menu.startFailed'));
  });
}

// Portal bootstrap: init the SDK (no-op on the standalone site), signal
// "loaded", hide site/TG/share links on-platform, and auto-join when the
// platform already knows the player or sent us in through an invite.
// Portal archives hide every off-site link from the first frame — the rule is
// about the build, not about whether the SDK answered in time (Yandex 8.4.2 /
// 8.4.3). Done before init so a slow or failed handshake cannot expose them.
if (isPortalBuild()) document.body.classList.add(platformBodyClass());

initPlatform().then(() => {
  gameReady();
  bootDone(); // Yandex 1.19: nothing is clickable until LoadingAPI.ready fired
  // the SDK may have switched the language (rule 2.14) — re-sync the RU/EN toggle
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.lang-switch button')) {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  }
  if (!onPlatform()) return;
  const id = platformIdentity();
  if (id) nameInput.value = id.name || nameInput.value;
  // an invite link / instant-multiplayer launch must land straight in gameplay
  if (id || wantsInstantPlay()) doStart(false);
});

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
  $('retry-btn').classList.add('hidden'); // no retry for validation messages
}

/** Connection failure: informative message + an explicit retry action (required by Yandex host review). */
function showConnError(reason: string): void {
  $('name-screen').classList.remove('hidden');
  $('conn-error').textContent = reason || t('menu.connFail');
  $('retry-btn').classList.remove('hidden');
}

$('retry-btn').onclick = () => {
  $('retry-btn').classList.add('hidden');
  $('conn-error').textContent = '';
  tryStart(false);
};

// ---------- game ----------

async function startGame(name: string, password: string, register: boolean, server?: number): Promise<void> {
  const conn = new Connection(name, password, register, server);
  conn.onClose = (reason) => {
    leaveRoom();
    if (inGame) {
      // hard reload keeps state clean after a real session
      sessionStorage.setItem('farmclash-msg', reason);
      location.reload();
      return;
    }
    $('queue-screen').classList.add('hidden');
    $('hud').classList.add('hidden');
    showConnError(reason);
  };
  conn.onQueued = (pos) => {
    $('queue-screen').classList.remove('hidden');
    $('queue-pos').textContent = String(pos);
  };
  conn.onWelcome = (w) => {
    inGame = true;
    $('queue-screen').classList.add('hidden');
    enterRoom(w.server); // portal Join/Invite: friends can join this world
    initGame(conn, w).catch((err) => {
      console.error(err);
      showError(t('menu.initFailed'));
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
  // Read-only hook for the store-asset capture scripts (marketing/), which need
  // to turn a screen click into the world coordinate the server will see. It
  // exposes nothing a player could not already read off their own screen.
  (window as unknown as { farmclashView?: unknown }).farmclashView = {
    screenToWorld: (x: number, y: number) => scene.screenToWorld(x, y),
    zoom: () => scene.zoom,
    // whether the render loop is stopped — how the ad-pause check (Yandex 4.7)
    // observes that the game really does stand still behind an ad
    paused: () => !app.ticker.started,
  };
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
  hud.setRankCfg(welcome.rank);
  hud.killFeedEnabled = settings.values.killFeed;
  const shop = new Shop(welcome);
  const minimap = new Minimap(welcome.world.size);
  const leaderboard = new Leaderboard(welcome.prestige);
  const input = new InputManager();
  const mobile = isTouchDevice() ? new MobileControls() : null;
  hud.show();
  gameplayStart(); // Yandex: player is actively in the world
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
  let lastMoney = -1; // for the coin-pickup sound
  let bossWarnUntil = 0;
  let bossWarnName = '';

  let ghost: Graphics | null = null;
  /** building the demolish marker is currently snapped to */
  let ghostForId: string | null = null;
  /** last finger position while in build mode; -1 = pointer is a mouse */
  let touchX = -1;
  let touchY = -1;

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

  /**
   * Buildings that block us right now. Our own base is walked through, exactly
   * as the server does it — otherwise prediction would fight the server and
   * the player would rubber-band at their own vault.
   */
  const BLOCK_REACH = 600; // generous: prediction replays a few frames of movement
  function blockers(cx: number, cy: number): Solid[] {
    const out: Solid[] = [];
    for (const r of conn.entities.values()) {
      const s = r.state;
      if (s.kind !== 'building' || s.owner === welcome.id) continue;
      if (Math.abs(s.x - cx) > BLOCK_REACH || Math.abs(s.y - cy) > BLOCK_REACH) continue;
      out.push(s);
    }
    return out;
  }

  function applyMove(x: number, y: number, mx: number, my: number, dt: number, attack: boolean, solids: Solid[]): { x: number; y: number } {
    const speed = moveSpeed(attack);
    const r = welcome.player.radius;
    const nx = clamp(x + mx * speed * dt, r, welcome.world.size - r);
    const ny = clamp(y + my * speed * dt, r, welcome.world.size - r);
    const res = resolveSolids(nx, ny, r, solids);
    return {
      x: clamp(res.x, r, welcome.world.size - r),
      y: clamp(res.y, r, welcome.world.size - r),
    };
  }

  // ---------- server events ----------

  conn.onSnapshot = () => {
    const self = conn.self!;
    let px = self.x;
    let py = self.y;
    const solids = blockers(self.x, self.y);
    for (const inp of conn.pending) {
      const res = applyMove(px, py, inp.mx, inp.my, inp.dt, inp.attack, solids);
      px = res.x;
      py = res.y;
    }
    predX = px;
    predY = py;

    if (lastMoney >= 0 && self.money > lastMoney) audio.coin(); // income (coins, mob/boss reward)
    lastMoney = self.money;

    // build mode ends by itself when the next one is no longer affordable or
    // the slots are full — otherwise you keep tapping into a red error toast
    if (shop.placing) {
      const cfg = welcome.buildings[shop.placing];
      const atLimit = shop.placing === 'wall'
        ? self.walls >= welcome.maxWalls
        : self.buildings >= welcome.maxBuildings;
      if (self.money < cfg.price || atLimit) endBuildMode();
    }

    hud.update(self);
    shop.refresh(self);
    mobile?.setFoodCount(self.food);
    mobile?.setWeapon(WEAPON_ICONS[self.equipped] ?? '👊', weaponName(self.equipped));
    if (selfDead) {
      if (self.respawnIn === undefined) {
        selfDead = false;
        hud.hideDeathScreen();
        gameplayStart(); // Yandex: back in the world after respawn
      } else if (shop.visible) {
        hud.hideDeathScreen(); // shopping during the death break — let the shop show
      } else {
        hud.showDeathScreen();
        hud.setRespawn(self.respawnIn);
      }
    }
  };

  conn.onRemove = (id, state) => {
    const view = views.get(id);
    if (view) {
      if (state.kind === 'player' || state.kind === 'mob' || state.kind === 'boss') {
        if (state.kind === 'mob' || state.kind === 'boss') audio.mobDie();
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
        hud.killFeed(`${badge}<b>${escapeHtml(ev.killer)}</b> ⚔ ${escapeHtml(ev.victim)} <span style="color:#6a7085">(${escapeHtml(weaponName(ev.weapon))})</span>`);
        break;
      }
      case 'damage': {
        // amount 0 = the attack missed (mirror_blade) — show it, no hit feedback
        if (ev.amount === 0) {
          effects.missText(ev.x, ev.y, t('ev.miss'));
          break;
        }
        audio.hit();
        if (settings.values.damageNumbers) effects.damageNumber(ev.x, ev.y, ev.amount);
        views.get(ev.target)?.flash();
        if (ev.target === conn.welcome!.id && settings.values.shake) scene.shake = 7;
        break;
      }
      case 'bank': {
        audio.reward();
        hud.notice(ev.action === 'deposit'
          ? t('ev.banked', { amount: ev.amount, total: ev.banked })
          : t('ev.withdrew', { amount: ev.amount }));
        break;
      }
      case 'collect': {
        effects.gainNumber(ev.x, ev.y, ev.amount);
        break;
      }
      case 'raided': {
        audio.death();
        hud.bossBanner(t('ev.raidedBanner', { name: escapeHtml(ev.byName) }));
        setTimeout(() => hud.bossBanner(null), 6000);
        hud.notice(t('ev.raided', { name: escapeHtml(ev.byName), lost: ev.lost }), 9000);
        break;
      }
      case 'heal':
        audio.heal();
        effects.incomeNumber(dispX, dispY, ev.amount);
        break;
      case 'swing': {
        const cfg = welcome.weapons[ev.weapon as WeaponId];
        if (!cfg || cfg.type !== 'melee') break;
        const isSelf = ev.id === welcome.id;
        if (isSelf) audio.swing();
        effects.swing(isSelf ? dispX : ev.x, isSelf ? dispY : ev.y, isSelf ? aim : ev.angle, cfg.range, cfg.arc ?? 90, swingColor(ev.weapon));
        break;
      }
      case 'hat': {
        const hName = hatName(ev.hat, ev.name);
        if (ev.dup) {
          hud.notice(t('ev.hatDup', { name: escapeHtml(hName), gold: ev.gold }));
        } else {
          audio.reward();
          happytime();
          hud.bossBanner(t('ev.hatNewBanner', { name: hName }));
          setTimeout(() => hud.bossBanner(null), 5000);
          hud.notice(t('ev.hatNew', { name: escapeHtml(hName) }));
        }
        break;
      }
      case 'lootbox': {
        if (ev.result === 'gold') { audio.reward(); hud.notice(t('ev.lootGold', { gold: ev.gold })); }
        else if (ev.result === 'food') { audio.reward(); hud.notice(t('ev.lootFood', { n: ev.food ?? 0 })); }
        else if (ev.result === 'nothing') hud.notice(t('ev.lootNothing'));
        break;
      }
      case 'weaponLoot': {
        const name = ev.weapon ? weaponName(ev.weapon) : '';
        if (ev.result === 'unique') {
          audio.reward();
          happytime();
          const color = TIER_COLORS[ev.tier ?? 'epic'];
          hud.bossBanner(t('ev.wlootUniqueBanner', { name })); // banner is plain text
          setTimeout(() => hud.bossBanner(null), 5000);
          hud.notice(t('ev.wlootUnique', { name: escapeHtml(name), color }));
        } else if (ev.result === 'weapon') {
          audio.reward();
          hud.notice(t('ev.wlootWeapon', { name: escapeHtml(name) }));
        } else if (ev.result === 'gold') {
          audio.reward();
          hud.notice(t('ev.wlootGold', { gold: ev.gold }));
        } else {
          hud.notice(t('ev.wlootNothing'));
        }
        break;
      }
      case 'prestige': {
        audio.reward();
        hud.bossBanner(t('ev.prestige', { level: ev.level, tier: ev.tier ? ` — ${prestigeTierName(ev.tier)}!` : '!' }));
        setTimeout(() => hud.bossBanner(null), 5000);
        break;
      }
      case 'level': {
        audio.level();
        happytime(); // portal celebration on a real achievement
        effects.levelBurst(dispX, dispY);
        const maxed = ev.level >= ev.max;
        hud.notice(maxed ? t('ev.levelMax', { n: ev.level }) : t('ev.level', { n: ev.level }));
        break;
      }
      case 'dailyReward':
        hud.notice(t('ev.daily', { gold: ev.gold, streak: ev.streak }), 9000);
        break;
      case 'death':
        selfDead = true;
        audio.death();
        hud.showDeath(ev);
        gameplayStop(); // Yandex: gameplay ended
        break;
      case 'bossWarn':
        bossWarnUntil = performance.now() + ev.inSec * 1000;
        bossWarnName = bossName(ev.bossId, ev.boss);
        minimap.ping(ev.x, ev.y, ev.inSec * 1000);
        break;
      case 'bossSpawned':
        bossWarnUntil = 0;
        audio.boss();
        hud.bossBanner(t('ev.bossSpawned', { boss: bossName(ev.bossId, ev.boss) }));
        minimap.ping(ev.x, ev.y, 60_000);
        setTimeout(() => hud.bossBanner(null), 6000);
        break;
      case 'bossTelegraph':
        effects.telegraph(ev.x, ev.y, ev.angle, ev.range, ev.arc, ev.sec);
        break;
      case 'bossKilled': {
        const myName = views.get(welcome.id)?.state.name ?? '';
        if (myName && ev.rewards.some((r) => r.name === myName)) happytime();
        const top = ev.rewards.slice(0, 3).map((r) => `${escapeHtml(r.name)}: +${r.amount}`).join(' · ');
        hud.bossBanner(t('ev.bossKilled', { boss: bossName(ev.bossId, ev.boss), top }));
        setTimeout(() => hud.bossBanner(null), 8000);
        break;
      }
      case 'bossGone':
        hud.bossBanner(t('ev.bossGone', { boss: bossName(ev.bossId, ev.boss) }));
        setTimeout(() => hud.bossBanner(null), 4000);
        break;
      case 'buildingAttacked':
        hud.notice(t('ev.buildAttacked'));
        minimap.ping(ev.x, ev.y, 5000);
        break;
      case 'buildingDestroyed':
        hud.notice(ev.own ? t('ev.buildDestroyedMine', { name: escapeHtml(ev.byName) }) : t('ev.buildDestroyedTheirs'));
        break;
      case 'purchase':
        if (!ev.ok && ev.reason) shop.message(ev.reason);
        else if (ev.ok) audio.reward();
        break;
      case 'placed':
        if (!ev.ok && ev.reason) hud.notice(`🚫 ${escapeHtml(ev.reason)}`);
        break;
      case 'demolished':
        if (ev.ok) hud.notice(t('ev.demolished', { n: ev.refund ?? 0 }));
        else if (ev.reason) hud.notice(`🚫 ${escapeHtml(ev.reason)}`);
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
  hud.onRespawn = () => {
    // Yandex 4.4: the spot has to follow a *non-game* action at a logical pause.
    // Dying is not an action the player took — asking to go back in is, and the
    // death screen is exactly such a pause. So the ad rides on this tap, starts
    // in the same turn (well inside the 0.33 s the rules allow), and the respawn
    // itself waits for it: play resumes only once the screen is ours again.
    showInterstitial(() => conn.send({ t: 'respawn' }));
  };
  $('death-shop-btn').onclick = () => shop.show(); // shop from the death screen
  shop.onBuy = (item) => conn.send({ t: 'buy', item });
  shop.onSell = (item) => conn.send({ t: 'sell', weapon: item });
  shop.onLootbox = () => conn.send({ t: 'lootbox' });
  shop.onWeaponLootbox = () => conn.send({ t: 'weaponLootbox' });
  shop.onWithdraw = () => conn.send({ t: 'withdraw' });
  shop.onEquipHat = (hat) => conn.send({ t: 'equipHat', hat });
  shop.onPrestige = () => conn.send({ t: 'prestige' });
  conn.onLeaderboard = (top, rank, total) => leaderboard.update(top, rank, total);
  settings.onExit = () => conn.ws.close();
  settings.onNotice = (text) => hud.notice(escapeHtml(text));
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

  /** Redraws the build ghost: green square to place, red outline to demolish. */
  function setGhost(radius: number | null, demolish = false): void {
    if (ghost) {
      ghost.destroy();
      ghost = null;
    }
    if (radius === null) return;
    ghost = new Graphics();
    if (demolish) {
      ghost.roundRect(-radius, -radius, radius * 2, radius * 2, 8)
        .fill({ color: 0xe0574f, alpha: 0.25 }).stroke({ width: 3, color: 0xff8a80 });
    } else {
      ghost.roundRect(-radius, -radius, radius * 2, radius * 2, 8)
        .fill({ color: 0x2ea043, alpha: 0.35 }).stroke({ width: 2, color: 0x7ee787 });
    }
    scene.layers.effects.addChild(ghost);
  }

  /** Leaves whichever build mode is active. */
  function endBuildMode(): void {
    shop.setPlacing(null);
    shop.setDemolishing(false);
    ghostForId = null;
    setGhost(null);
  }

  /** Our own building under a world point, if any. Buildings are drawn as squares. */
  function ownBuildingAt(wx: number, wy: number): { id: string; radius: number } | null {
    let best: { id: string; radius: number } | null = null;
    let bestD = Infinity;
    for (const [id, r] of conn.entities) {
      const st = r.state;
      if (st.kind !== 'building' || st.owner !== welcome.id) continue;
      const d = Math.max(Math.abs(st.x - wx), Math.abs(st.y - wy));
      if (d <= st.radius && d < bestD) {
        bestD = d;
        best = { id, radius: st.radius };
      }
    }
    return best;
  }

  shop.onStartPlace = (b) => {
    shop.setPlacing(b);
    setGhost(welcome.buildings[b].radius);
  };
  shop.onStartDemolish = () => {
    shop.setDemolishing(true);
    ghostForId = null;
    setGhost(null); // the ghost appears once a building of ours is under the cursor
  };
  ($('place-done') as HTMLButtonElement).onclick = () => endBuildMode();
  input.onCancel = () => {
    endBuildMode();
    shop.hide();
    settings.hide();
  };
  input.onWorldClick = (sx, sy) => {
    const pos = scene.screenToWorld(sx, sy);
    if (shop.demolishing) {
      const target = ownBuildingAt(pos.x, pos.y);
      if (target) conn.send({ t: 'demolish', id: target.id });
      return true;
    }
    if (!shop.placing) return false;
    conn.send({ t: 'place', building: shop.placing, x: Math.round(pos.x), y: Math.round(pos.y) });
    // Stay in build mode: a wall line is a dozen blocks, and reopening the shop
    // between each one was the whole complaint. It ends on Done/Esc/right-click,
    // or by itself once gold or slots run out (see the snapshot handler).
    return true;
  };

  // Touch: drag to aim the ghost, lift to place. A plain tap still works, so
  // this is strictly more control than the old place-on-touch behaviour.
  {
    const overUi = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement && !!target.closest('.panel,.joy-zone,#mob-buttons,#place-hint,#settings-btn,#fullscreen-btn');
    const track = (e: TouchEvent): void => {
      if ((!shop.placing && !shop.demolishing) || overUi(e.target)) return;
      const t = e.touches[0];
      if (t) {
        touchX = t.clientX;
        touchY = t.clientY;
      }
    };
    window.addEventListener('touchstart', track, { passive: true });
    window.addEventListener('touchmove', track, { passive: true });
    window.addEventListener('touchend', (e) => {
      if ((!shop.placing && !shop.demolishing) || overUi(e.target)) return;
      const t = e.changedTouches[0];
      if (t) input.onWorldClick(t.clientX, t.clientY);
    });
  }

  // ---------- ad pause (Yandex 4.7) ----------
  // While an ad or its warning owns the screen the game stops dead: no frames
  // are drawn, no input is read and nothing is sent to the server. The mobile
  // pads come off screen too, so a stray touch behind the overlay does nothing.
  onAdVisibility((active) => {
    if (active) {
      app.ticker.stop();
      input.attackHeld = false;
      mobile?.setVisible(false);
    } else {
      mobile?.setVisible(true);
      app.ticker.start();
    }
  });

  // input send loop: 20 Hz, mirrors server tick rate
  setInterval(() => {
    if (!conn.self || selfDead || adActive()) return;
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
    const res = applyMove(predX, predY, mx, my, 0.05, attack, blockers(predX, predY));
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

    if (shop.placing || shop.demolishing) {
      const px = touchX >= 0 ? touchX : input.mouseX;
      const py = touchX >= 0 ? touchY : input.mouseY;
      const pos = scene.screenToWorld(px, py);
      if (shop.demolishing) {
        // snap the marker onto whichever of our buildings is under the pointer
        const target = ownBuildingAt(pos.x, pos.y);
        if (target?.id !== ghostForId) {
          ghostForId = target?.id ?? null;
          setGhost(target ? target.radius : null, true);
        }
        if (ghost && target) {
          const st = conn.entities.get(target.id)!.state;
          ghost.position.set(st.x, st.y);
        }
      } else if (ghost) {
        ghost.position.set(pos.x, pos.y);
      }
    }

    if (bossWarnUntil > now) {
      hud.bossBanner(t('ev.bossWarn', { boss: bossWarnName, n: Math.ceil((bossWarnUntil - now) / 1000) }));
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

function swingColor(weapon: string): number {
  switch (weapon) {
    case 'venom_blade': return 0x8fe86a;
    case 'vampire_blade': return 0xff6b6b;
    case 'hammer': return 0xffb86a;
    case 'scythe': return 0xd8a0ff;
    case 'daggers': return 0xcfe8ff;
    case 'spear': return 0x9fe0ff;
    default: return 0xdff0ff;
  }
}

/** First-time tips: a few rotating hints, then never again (localStorage flag). */
function runOnboarding(mobile: boolean): void {
  if (localStorage.getItem('farmclash-onboarded')) return;
  const tips = tList(mobile ? 'onboard.mobile' : 'onboard.desktop');
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

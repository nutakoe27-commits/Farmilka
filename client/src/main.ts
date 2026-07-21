import { Application, Graphics } from 'pixi.js';
import { clamp } from '@shared/math.js';
import type { BuildingId, WeaponId } from '@shared/types.js';
import type { WelcomeMsg } from '@shared/protocol.js';
import { Connection } from './net/connection.js';
import { sample, type Sampled } from './net/interpolation.js';
import { Scene } from './game/scene.js';
import { EntityView } from './game/entities.js';
import { Effects } from './game/effects.js';
import { InputManager } from './game/input.js';
import { Hud } from './ui/hud.js';
import { Shop } from './ui/shop.js';
import { Minimap } from './ui/minimap.js';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

// ---------- name screen ----------

const nameInput = $('name-input') as HTMLInputElement;
nameInput.value = localStorage.getItem('farmilka-name') ?? '';
nameInput.focus();

function tryStart(): void {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }
  localStorage.setItem('farmilka-name', name);
  $('name-screen').classList.add('hidden');
  startGame(name).catch((err) => {
    console.error(err);
    showError('Не удалось запустить игру');
  });
}

$('play-btn').onclick = tryStart;
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryStart();
});

function showError(text: string): void {
  $('name-screen').classList.remove('hidden');
  $('conn-error').textContent = text;
}

// ---------- game ----------

async function startGame(name: string): Promise<void> {
  const conn = new Connection(name);
  conn.onClose = (reason) => {
    $('hud').classList.add('hidden');
    showError(reason);
  };
  conn.onWelcome = (w) => {
    initGame(conn, w).catch((err) => {
      console.error(err);
      showError('Ошибка инициализации графики');
    });
  };
}

async function initGame(conn: Connection, welcome: WelcomeMsg): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x0a0c11, antialias: true });
  $('app').appendChild(app.canvas);

  const scene = new Scene(app);
  scene.drawGround(welcome.world.size, welcome.world.safeZoneRadius);
  const effects = new Effects(scene.layers.effects, scene.layers.telegraphs);
  const hud = new Hud();
  const shop = new Shop(welcome);
  const minimap = new Minimap(welcome.world.size, welcome.world.safeZoneRadius);
  const input = new InputManager();
  hud.show();

  const views = new Map<string, EntityView>();
  const tmp: Sampled = { x: 0, y: 0, angle: 0 };

  // predicted local position
  let predX = welcome.world.size / 2;
  let predY = welcome.world.size / 2;
  let dispX = predX;
  let dispY = predY;
  let aim = 0;
  let seq = 0;
  let selfDead = false;
  let bossWarnUntil = 0;
  let bossWarnPos = { x: 0, y: 0 };

  // placement ghost
  let ghost: Graphics | null = null;

  const layerFor = (kind: string) => {
    switch (kind) {
      case 'player': return scene.layers.players;
      case 'mob': return scene.layers.mobs;
      case 'boss': return scene.layers.players;
      case 'projectile': return scene.layers.projectiles;
      case 'coin': return scene.layers.coins;
      case 'building': return scene.layers.buildings;
      default: return scene.layers.effects;
    }
  };

  function moveSpeed(attack: boolean): number {
    let speed = welcome.player.speed;
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
    // reconcile: server position + replay unacked inputs
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
      } else if (state.kind === 'coin') {
        effects.burst(view.root.position.x, view.root.position.y, 0xffd76e, 6, 90);
      } else if (state.kind === 'building') {
        effects.burst(view.root.position.x, view.root.position.y, 0x9aa5b8, 24, 220);
      }
      view.destroy();
      views.delete(id);
    }
  };

  conn.onEvent = (ev) => {
    switch (ev.e) {
      case 'kill':
        hud.killFeed(`<b>${escapeHtml(ev.killer)}</b> ⚔ ${escapeHtml(ev.victim)} <span style="color:#6a7085">(${ev.weapon})</span>`);
        break;
      case 'damage': {
        effects.damageNumber(ev.x, ev.y, ev.amount);
        const selfView = views.get(conn.welcome!.id);
        if (selfView && ev.target === conn.welcome!.id) scene.shake = 7;
        break;
      }
      case 'death':
        selfDead = true;
        hud.showDeath(ev.dropped, ev.cause);
        break;
      case 'bossWarn':
        bossWarnUntil = performance.now() + ev.inSec * 1000;
        bossWarnPos = { x: ev.x, y: ev.y };
        minimap.ping(ev.x, ev.y, ev.inSec * 1000);
        break;
      case 'bossSpawned':
        bossWarnUntil = 0;
        hud.bossBanner('💀 БОСС ПОЯВИЛСЯ! Убей его ради награды!');
        minimap.ping(ev.x, ev.y, 60_000);
        setTimeout(() => hud.bossBanner(null), 6000);
        break;
      case 'bossTelegraph':
        effects.telegraph(ev.x, ev.y, ev.angle, ev.range, ev.arc, ev.sec);
        break;
      case 'bossKilled': {
        const top = ev.rewards.slice(0, 3).map((r) => `${escapeHtml(r.name)}: +${r.amount}`).join(' · ');
        hud.bossBanner(`💀 Босс повержен! ${top}`);
        setTimeout(() => hud.bossBanner(null), 8000);
        break;
      }
      case 'bossGone':
        hud.bossBanner('Босс исчез…');
        setTimeout(() => hud.bossBanner(null), 4000);
        break;
      case 'buildingAttacked':
        hud.killFeed('⚠ <b style="color:#ffd76e">Вашу постройку атакуют!</b>');
        minimap.ping(ev.x, ev.y, 5000);
        break;
      case 'buildingDestroyed':
        hud.killFeed(ev.own ? `💥 Вашу постройку разрушил <b>${escapeHtml(ev.byName)}</b>` : '💥 Вы разрушили постройку — заберите лут!');
        break;
      case 'purchase':
        if (!ev.ok && ev.reason) shop.message(ev.reason);
        break;
      case 'placed':
        if (!ev.ok && ev.reason) hud.killFeed(`🚫 ${escapeHtml(ev.reason)}`);
        break;
      case 'notice':
        hud.killFeed(escapeHtml(ev.text));
        break;
    }
  };

  // ---------- input wiring ----------

  input.onZoom = (d) => scene.addZoom(d);
  input.onToggleShop = () => shop.toggle();
  input.onHotbar = (i) => {
    const self = conn.self;
    if (self && self.weapons[i]) conn.send({ t: 'equip', weapon: self.weapons[i] });
  };
  hud.onEquip = (w) => conn.send({ t: 'equip', weapon: w });
  shop.onBuy = (item) => conn.send({ t: 'buy', item });
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

  // input send loop: 20 Hz, mirrors server tick rate
  setInterval(() => {
    if (!conn.self || selfDead) return;
    const { mx, my } = input.moveVector();
    const attack = input.attackHeld;
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

    // aim from mouse in world space
    const world = scene.screenToWorld(input.mouseX, input.mouseY);
    aim = Math.atan2(world.y - dispY, world.x - dispX);

    // smooth displayed self position toward prediction
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
    }

    if (ghost) {
      const pos = scene.screenToWorld(input.mouseX, input.mouseY);
      ghost.position.set(pos.x, pos.y);
    }

    // boss warn countdown
    if (bossWarnUntil > now) {
      hud.bossBanner(`⚠ Босс появится через ${Math.ceil((bossWarnUntil - now) / 1000)}с — смотри на миникарту!`);
    }

    effects.update(dt);
    scene.update(dispX, dispY, dt);
    minimap.draw(dispX, dispY, selfId, conn.entities);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

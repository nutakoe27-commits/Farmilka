// Records the gameplay video for the store from real play, at a true 60 fps.
//
//   SLOWMO=14 node make-video-rig.mjs       # once, to build the rig balance
//   DATA_DIR=/tmp/vid PORT=3993 BALANCE_PATH=marketing/video-rig-balance.json \
//     npx tsx src/index.ts                  # from server/
//   SLOWMO=14 VID_BEAT=2.8 VID_LANG=ru node marketing/record-gameplay.mjs
//
// Why it is recorded in slow motion
// --------------------------------
// Headless Chromium has no GPU: WebGL falls back to SwiftShader, which pegs
// three of the four cores, and the game draws 4-6 fps at 720p while a take is
// running — measured, not assumed. So the *world* runs at 1/S speed and the
// *video* is sped back up by S at encode time. Every frame the browser did
// manage to draw then lands on a distinct moment, and ~4.5 raw fps × S=14 puts
// about 62 distinct frames into each second of finished video — enough to fill
// 60 fps honestly rather than by duplicating frames.
//
// S costs wall clock and nothing else: a second of finished video takes S
// seconds to film. VID_BEAT scales the choreography to match, so the same beats
// come out the same length whatever S is — measure the capture rate first, set
// S to 60/rate, set VID_BEAT to S/5.
//
// Frames are pulled through CDP screencast rather than Playwright's recordVideo,
// because each frame arrives with the timestamp of its own swap. Those stamps
// drive the concat list, so a capture hiccup lands at the right moment in the
// finished cut instead of smearing the motion around it.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { dirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cutAndEncode } from './video-cut.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.VID_TMP || '/tmp/farmclash-gameplay';
const BASE = process.env.VID_URL || 'http://localhost:3993/';
const WORLD = Number(process.env.RIG_WORLD_SIZE || 3600);
const SLOWMO = Number(process.env.SLOWMO || 14); // must match make-video-rig.mjs
const LANG = process.env.VID_LANG || 'ru';
const FPS = Number(process.env.VID_FPS || 60);
const W = 1280, H = 720;   // capture size; upscaled to 1080p at encode time
const CX = W / 2, CY = H / 2;
const NAME = process.env.VID_OUT || `farmclash-gameplay-${LANG}.mp4`;
/** Scales every choreography duration. VID_BEAT=0.12 smoke-tests the pipeline. */
const BEAT = Number(process.env.VID_BEAT || 1);
const dur = (x) => Math.max(120, Math.round(x * BEAT));

/**
 * Re-cut an existing take instead of filming a new one. The frames and the beat
 * stamps are already on disk, so changing which windows are kept — or dropping
 * a beat that did not come off — costs an encode, not another take.
 */
const RECUT = process.env.VID_RECUT === '1';
/** Beat names to leave out of the cut, comma-separated (VID_DROP=crate). */
const DROP = new Set((process.env.VID_DROP || '').split(',').filter(Boolean));

if (!RECUT) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(`${OUT}/frames`, { recursive: true });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--enable-webgl', '--hide-scrollbars', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});

const errors = [];
const beats = [];
/** Beats are stamped on the same clock as the frames, so cuts land exactly. */
const beat = (n) => {
  const t = Date.now() / 1000;
  beats.push({ n, t });
  console.log(`beat ${n} @ ${frames.length} frames`);
};

async function join(name, { lang = LANG } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate((l) => localStorage.setItem('farmclash-lang', l), lang);
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('#name-input', name);
  await page.click('#play-btn');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 20000 }).catch(() => {});
  await sleep(3000);
  return { ctx, page };
}

// ---------- actor helpers ----------

const where = (page) => page.evaluate(([x, y]) => window.farmclashView?.screenToWorld(x, y) ?? null, [CX, CY]);
const zoomOf = (page) => page.evaluate(() => window.farmclashView?.zoom() ?? 1);

const held = new Map();
async function keys(page, want) {
  const cur = held.get(page) ?? new Set();
  for (const k of cur) if (!want.has(k)) { await page.keyboard.up(k); cur.delete(k); }
  for (const k of want) if (!cur.has(k)) { await page.keyboard.down(k); cur.add(k); }
  held.set(page, cur);
}
const aimAt = (page, ang, r = 300) => page.mouse.move(CX + Math.cos(ang) * r, CY + Math.sin(ang) * r);

/**
 * Walks toward a world point. `spin` keeps the aim turning, which reads as
 * fighting through rather than commuting; `wobble` adds a little drift to the
 * heading so the path is not a machine-straight line.
 */
async function driveTo(page, target, { ms = 20000, stopAt = 120, attack = false, spin = false, wobble = 0 } = {}) {
  const start = Date.now();
  let spinA = Math.random() * 6;
  let arrived = false;
  if (attack) await page.mouse.down();
  while (Date.now() - start < ms) {
    const me = await where(page);
    if (!me) break;
    const drift = wobble ? Math.sin((Date.now() - start) / 900) * wobble : 0;
    const dx = target.x - me.x + drift, dy = target.y - me.y + drift;
    const d = Math.hypot(dx, dy);
    if (d < stopAt) { arrived = true; break; }
    const k = new Set();
    if (dy < -20) k.add('KeyW');
    if (dy > 20) k.add('KeyS');
    if (dx < -20) k.add('KeyA');
    if (dx > 20) k.add('KeyD');
    await keys(page, k);
    if (spin) { spinA += 0.45; await aimAt(page, spinA); }
    else await aimAt(page, Math.atan2(dy, dx));
    await sleep(130);
  }
  await keys(page, new Set());
  if (attack) await page.mouse.up();
  return arrived;
}

/** Fights in place, sweeping the aim around. */
async function brawl(page, ms, { sweep = 0.3 } = {}) {
  await page.mouse.down();
  const start = Date.now();
  let a = Math.random() * 6;
  while (Date.now() - start < ms) { a += sweep; await aimAt(page, a); await sleep(130); }
  await page.mouse.up();
}

async function openShop(page, tab) {
  if (await page.locator('#shop.hidden').count()) {
    await page.keyboard.press('b');
    await page.waitForSelector('#shop:not(.hidden)', { timeout: 5000 });
  }
  await page.click(`.shop-tab[data-tab="${tab}"]`);
  await sleep(400);
}

async function buy(page, tab, sel) {
  await openShop(page, tab);
  const row = page.locator(sel);
  if (!(await row.count()) || (await row.isDisabled())) return false;
  await row.click();
  await sleep(400);
  return true;
}

/** Buys a building and drops it at a world offset from the hero. */
async function build(page, item, wx, wy, z) {
  await openShop(page, 'buildings');
  const row = page.locator(`#shop-buildings .shop-item[data-item="${item}"] button`);
  if (!(await row.count()) || (await row.isDisabled())) { await page.keyboard.press('Escape'); return false; }
  await row.click();
  await sleep(300);
  await page.mouse.move(CX + wx * z, CY + wy * z); // let the ghost show where it lands
  await sleep(260);
  await page.mouse.click(CX + wx * z, CY + wy * z);
  await sleep(320);
  return true;
}

/** Gold in hand, read off the HUD. Buildings and crates are paid from this. */
const carried = (page) => page.evaluate(() => {
  const el = document.querySelector('#money .carry');
  return Number((el?.textContent ?? '').replace(/[^0-9]/g, '')) || 0;
});

/**
 * Empties the vault into the purse, standing next to it.
 *
 * Withdrawing is refused unless the hero is actually at his own vault, and
 * walking home at slow-motion speed does not always arrive inside the budget —
 * so this checks the purse afterwards and closes the distance before retrying
 * rather than assuming the click worked.
 */
async function withdrawAtVault(page, home) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await driveTo(page, home, { ms: dur(9000), stopAt: 55 });
    await openShop(page, 'buildings');
    const before = await carried(page);
    const btn = page.locator('#withdraw-btn');
    if (await btn.count() && !(await btn.isDisabled())) {
      await btn.click();
      await sleep(900);
      if ((await carried(page)) > before) return true;
    }
    await page.keyboard.press('Escape');
    await sleep(300);
  }
  console.warn('withdrawal never landed — the hero never got close enough to his vault');
  return false;
}

/** Reads the boss pip (light purple) off the minimap, as a 0..1 world fraction. */
const findBoss = (page) => page.evaluate(() => {
  const c = document.getElementById('minimap');
  const g = c?.getContext('2d');
  if (!g) return null;
  const S = c.width || 160;
  const d = g.getImageData(0, 0, S, S).data;
  let bx = 0, by = 0, n = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (d[i + 3] < 40) continue;
    if (d[i] > 228 && d[i] < 250 && d[i + 1] > 188 && d[i + 1] < 214 && d[i + 2] > 246) { bx += x; by += y; n++; }
  }
  return n ? { x: bx / n / S, y: by / n / S } : null;
});

// ---------- frame capture ----------

const frames = []; // { file, t } — t is the swap timestamp in seconds
let capturing = false;

async function startCapture(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', (f) => {
    if (capturing) {
      const file = `f_${String(frames.length).padStart(6, '0')}.jpg`;
      writeFileSync(pathJoin(OUT, 'frames', file), Buffer.from(f.data, 'base64'));
      frames.push({ file, t: f.metadata.timestamp });
    }
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  capturing = true;
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  return async () => { capturing = false; await cdp.send('Page.stopScreencast').catch(() => {}); };
}

// ---------- off camera: a neighbour whose base is worth breaking into ----------

const nb = await join('Neighbour');
{
  const z = await zoomOf(nb.page);
  for (let i = -2; i <= 2; i++) await build(nb.page, 'wall', 250, i * 66, z);
  await build(nb.page, 'mine', -230, 140, z);
  await build(nb.page, 'farm', -240, -160, z);
  await nb.page.keyboard.press('Escape');
}
const target = await where(nb.page);
console.log('raid target at', target);
// It has to stay connected: a guest's buildings are removed the moment they
// disconnect, and this base is the thing we are going to break into. But every
// frame it draws comes out of the same software rasteriser that is drawing the
// take, so it is shrunk to a stamp and throttled down to a crawl. It keeps its
// socket, and hands the GPU process back to the page being filmed.
await nb.page.setViewportSize({ width: 60, height: 60 });
{
  const nbCdp = await nb.ctx.newCDPSession(nb.page);
  await nbCdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
}

// ---------- the hero ----------

const hero = await join('FarmClash');
const page = hero.page;

// Pre-roll, off camera: a weapon in hand, so the video opens on a real fight
// instead of on shopping.
await buy(page, 'weapons', '#shop-weapons .shop-item[data-item="scythe"] .buy');
await page.keyboard.press('Escape');
await sleep(400);
await page.keyboard.press('Digit2');
await sleep(600);

const stopCapture = await startCapture(hero.ctx, page);
beat('start');

const z = await zoomOf(page);
const home = await where(page);

// 1. cold open — straight into a fight
await driveTo(page, { x: home.x - 520, y: home.y - 380 }, { ms: dur(26000), spin: true, attack: true, wobble: 40 });
await brawl(page, dur(12000));
beat('combat');

// 2. back home, and wall the base in. The gold has to come out of the vault
// first: walking past your own vault banks whatever you are carrying, and
// buildings are paid for out of the carried purse — so without this the whole
// build beat is a row of greyed-out buttons.
await driveTo(page, { x: home.x, y: home.y }, { ms: dur(26000), stopAt: 90, wobble: 30 });
await withdrawAtVault(page, home);
for (let i = -2; i <= 2; i++) await build(page, 'wall', 250, i * 66, z);
await build(page, 'turret', -60, -210, z);
await build(page, 'farm', -250, 150, z);
await page.keyboard.press('Escape');
await sleep(700);
beat('built');

// 3. the vault and the Base Rank line that banking moves
await openShop(page, 'buildings');
await sleep(dur(2600));
await page.keyboard.press('Escape');
beat('banked');

// 4. the crate — a unique weapon reveal. The purse went into the walls, and
// whatever survived that was banked again on the way past the vault, so the
// gold has to come back out before the crate is affordable.
await withdrawAtVault(page, home);
await openShop(page, 'weapons');
const crate = page.locator('#weapon-lootbox-btn');
if (await crate.count() && !(await crate.isDisabled())) { await crate.click(); await sleep(dur(2600)); }
else console.warn('crate beat skipped — not affordable');
await page.keyboard.press('Escape');
await sleep(600);
await page.keyboard.press('Digit2');
beat('crate');

// 5. the raid: cross to the neighbour's base and break the wall down
await driveTo(page, { x: target.x + 520, y: target.y }, { ms: dur(50000), spin: true, attack: true, wobble: 50 });
await driveTo(page, { x: target.x + 330, y: target.y }, { ms: dur(16000), stopAt: 60 });
beat('at-wall');
await page.mouse.down();
await aimAt(page, Math.PI);
await sleep(dur(16000));
await page.mouse.up();
beat('breached');
await driveTo(page, { x: target.x + 120, y: target.y }, { ms: dur(14000), stopAt: 50, attack: true });
beat('looted');

// 6. the boss finale
{
  const t = Date.now();
  let seen = false;
  while (Date.now() - t < 120_000) {
    const b = await findBoss(page);
    if (b) {
      if (!seen) { seen = true; beat('boss'); }
      await driveTo(page, { x: b.x * WORLD, y: b.y * WORLD }, { ms: dur(7000), stopAt: 210, attack: true });
      await brawl(page, dur(3500), { sweep: 0.22 });
    } else {
      await driveTo(page, { x: WORLD / 2, y: WORLD / 2 }, { ms: dur(5000), spin: true, attack: true });
    }
  }
}
beat('end');

await keys(page, new Set());
await sleep(600);
await stopCapture();
await hero.ctx.close();
await nb.ctx.close();
await browser.close();

const bytes = readdirSync(pathJoin(OUT, 'frames')).reduce((a, f) => a + statSync(pathJoin(OUT, 'frames', f)).size, 0);
const span = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
console.log(`captured ${frames.length} frames over ${span.toFixed(1)}s = ${(frames.length / span).toFixed(1)} fps, ${(bytes / 1e6).toFixed(0)} MB`);
console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
writeFileSync(`${OUT}/beats.json`, JSON.stringify({ beats, errors, frames, span }, null, 2));

// ---------- cut ----------
cutAndEncode({ frames, beats, out: OUT, dir: DIR, name: NAME, slowmo: SLOWMO, fps: FPS, drop: DROP });

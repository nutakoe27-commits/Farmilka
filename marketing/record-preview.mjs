// Records the store preview video from real play and encodes it to H.264.
//
//   node marketing/record-preview.mjs
//
// Needs a server on :3993 started with video-rig-balance.json (generate it with
// make-video-rig.mjs). See CRAZYGAMES.md for why the world runs in slow motion.
//
// Two clients join the same world. Only the hero's page is recorded; the
// neighbour is off-camera scaffolding whose walled base gives the hero
// something real to break into. Steering is closed-loop: the client exposes
// screenToWorld, so the world coordinate under the centre of the screen is the
// actor's own position, and the minimap is read for the boss.

import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.PREVIEW_TMP || '/tmp/farmclash-preview';
const BASE = process.env.PREVIEW_URL || 'http://localhost:3993/';
const WORLD = Number(process.env.RIG_WORLD_SIZE || 3600);
const SLOWMO = Number(process.env.SLOWMO || 2.5); // must match make-video-rig.mjs
const W = 1280, H = 720;                          // upscaled at encode time; 720p renders ~3x faster
const CX = W / 2, CY = H / 2;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-webgl', '--hide-scrollbars'],
});

const errors = [];
const beats = [];
let t0 = 0;
const beat = (n) => { const t = Date.now() - t0; beats.push({ n, t }); console.log(`beat ${n} @ ${t}ms`); };

async function join(name, { record = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    ...(record ? { recordVideo: { dir: `${OUT}/raw`, size: { width: W, height: H } } } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('farmclash-lang', 'en'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('#name-input', name);
  await page.click('#play-btn');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 20000 }).catch(() => {});
  await sleep(3000);
  return { ctx, page };
}

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
 * Walks toward a world point, optionally swinging the whole way (`spin` keeps
 * the aim rotating, which reads as "fighting through" rather than "walking").
 */
async function driveTo(page, target, { ms = 20000, stopAt = 120, attack = false, spin = false } = {}) {
  const start = Date.now();
  let spinA = 0;
  if (attack) await page.mouse.down();
  let arrived = false;
  while (Date.now() - start < ms) {
    const me = await where(page);
    if (!me) break;
    const dx = target.x - me.x, dy = target.y - me.y;
    const d = Math.hypot(dx, dy);
    if (d < stopAt) { arrived = true; break; }
    const k = new Set();
    if (dy < -20) k.add('KeyW');
    if (dy > 20) k.add('KeyS');
    if (dx < -20) k.add('KeyA');
    if (dx > 20) k.add('KeyD');
    await keys(page, k);
    if (spin) { spinA += 0.5; await aimAt(page, spinA); }
    else await aimAt(page, Math.atan2(dy, dx));
    await sleep(100);
  }
  await keys(page, new Set());
  if (attack) await page.mouse.up();
  return arrived;
}

/** Fights in place for a while, sweeping the aim around. */
async function brawl(page, ms) {
  await page.mouse.down();
  const start = Date.now();
  let a = 0;
  while (Date.now() - start < ms) { a += 0.35; await aimAt(page, a); await sleep(100); }
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

async function build(page, item, wx, wy, z) {
  await openShop(page, 'buildings');
  const row = page.locator(`#shop-buildings .shop-item[data-item="${item}"] button`);
  if (!(await row.count()) || (await row.isDisabled())) { await page.keyboard.press('Escape'); return false; }
  await row.click();
  await sleep(300);
  await page.mouse.click(CX + wx * z, CY + wy * z);
  await sleep(350);
  return true;
}

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

// ---------- off-camera: a neighbour with a base worth raiding ----------
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

// ---------- on camera ----------
const hero = await join('FarmClash', { record: true });
const page = hero.page;
t0 = Date.now();
beat('start');

const z = await zoomOf(page);
const home = await where(page);

// 1. wall the home base in — the build beat
for (let i = -2; i <= 2; i++) await build(page, 'wall', 250, i * 66, z);
await build(page, 'turret', -60, -210, z);
await page.keyboard.press('Escape');
beat('base-walled');

// 2. out into the field, killing what is there
await driveTo(page, { x: home.x - 600, y: home.y - 400 }, { ms: 14000, spin: true, attack: true });
await brawl(page, 7000);
beat('mobs');

// 3. the crate: a legendary weapon reveal. Take the gold back out of the vault
// first — walking past your own vault banks everything you are carrying, which
// otherwise leaves nothing to spend by the time we get here.
await openShop(page, 'buildings');
const takeAll = page.locator('#withdraw-btn');
if (await takeAll.count() && !(await takeAll.isDisabled())) { await takeAll.click(); await sleep(600); }
await openShop(page, 'hats');
const crate = page.locator('#weapon-lootbox-btn');
if (await crate.count() && !(await crate.isDisabled())) { await crate.click(); await sleep(2200); }
else console.warn('crate beat skipped — not affordable');
await page.keyboard.press('Escape');
await sleep(500);
await page.keyboard.press('Digit2');
beat('crate');

// 4. the raid: walk to the neighbour's wall and break in
await driveTo(page, { x: target.x + 520, y: target.y }, { ms: 45000, spin: true, attack: true });
await driveTo(page, { x: target.x + 330, y: target.y }, { ms: 15000, stopAt: 60 });
await page.mouse.down();
await aimAt(page, Math.PI);
await sleep(14000);
await page.mouse.up();
beat('raid');
// scoop the spill
await driveTo(page, { x: target.x + 120, y: target.y }, { ms: 12000, stopAt: 50, attack: true });
beat('looted');

// 5. the boss finale
{
  const t = Date.now();
  let seen = false;
  while (Date.now() - t < 70_000) {
    const b = await findBoss(page);
    if (b) {
      if (!seen) { seen = true; beat('boss-spotted'); }
      await driveTo(page, { x: b.x * WORLD, y: b.y * WORLD }, { ms: 6000, stopAt: 220, attack: true });
      await brawl(page, 3000);
    } else {
      await driveTo(page, { x: WORLD / 2, y: WORLD / 2 }, { ms: 5000, spin: true, attack: true });
    }
  }
}
beat('end');

await keys(page, new Set());
await sleep(800);
const video = page.video();
await hero.ctx.close();
const raw = await video.path();
await nb.ctx.close();
await browser.close();

writeFileSync(`${OUT}/beats.json`, JSON.stringify({ raw, beats, errors }, null, 2));
console.log('raw video:', raw);
console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');

// ---------- encode ----------
// The take is longer than a store preview should be, so it is cut down to the
// four beats that carry the pitch. The capture is slow motion; speeding it back
// up by SLOWMO restores real time and turns ~5 rendered fps into ~29 distinct
// frames per second.
const at = (name) => beats.find((b) => b.n === name)?.t ?? null;

/** [start, end] windows in raw capture seconds, in story order. */
function cut() {
  const s0 = (ms) => Math.max(0, ms / 1000);
  const walled = at('base-walled'), mobs = at('mobs'), raid = at('raid'), looted = at('looted');
  const bossAt = at('boss-spotted'), end = at('end');
  const win = [];
  const push = (from, to, max) => {
    if (from == null || to == null || to <= from) return;
    const a = s0(from), b = s0(to);
    win.push([Math.max(a, b - max), b]);
  };
  push(at('start'), walled, 32);            // walling the base in
  push(walled, mobs, 24);                   // a fight in the field
  push(raid ? raid - 30_000 : null, looted ?? raid, 36); // breaking into a base
  push(bossAt, end, 34);                    // the boss
  return win;
}

const windows = cut();
console.log('cut windows (raw s):', windows.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}`).join(', '));

function encode(out, extra) {
  const parts = windows.map(([a, b], i) =>
    `[0:v]trim=start=${a.toFixed(2)}:end=${b.toFixed(2)},setpts=PTS-STARTPTS[v${i}]`);
  const chain =
    `${parts.join(';')};${windows.map((_, i) => `[v${i}]`).join('')}concat=n=${windows.length}:v=1:a=0[cat];` +
    `[cat]setpts=PTS/${SLOWMO},${extra},fps=30[out]`;
  const r = spawnSync(ffmpeg, [
    '-y', '-i', raw, '-filter_complex', chain, '-map', '[out]',
    '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    out,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${out}`);
  console.log('wrote', out);
}

if (!windows.length) throw new Error('no beats recorded — nothing to cut');
encode(pathJoin(DIR, 'farmclash-preview.mp4'), 'scale=1920:1080:flags=lanczos');
encode(pathJoin(DIR, 'farmclash-preview-vertical.mp4'), 'crop=ih*9/16:ih,scale=1080:1920:flags=lanczos');

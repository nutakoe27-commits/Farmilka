// Captures the store screenshots from real play — nothing is mocked or staged
// in an image editor.
//
//   node marketing/capture-screens.mjs
//
// Needs a server on :3996 started with capture-rig-balance.json (a compact
// world so the two actors meet, gold enough to wall a base in on camera, and a
// boss timed to arrive after the quieter shots are in the can).
//
// Two browsers join the same world: the Defender builds a walled base, the
// Raider walks over and breaks into it. Steering is closed-loop — the client
// exposes screenToWorld, so reading the world coordinate under the centre of
// the screen gives each actor its own position, and one can walk to the other.

import { chromium } from 'playwright';
import { dirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.CAPTURE_URL || 'http://localhost:3996/';
// Yandex 8.2.3: the screenshots uploaded to a draft must be in that draft's
// language, so the same run is repeated per language with its own file prefix.
const LANG = process.env.CAP_LANG || 'en';
const PREFIX = process.env.CAP_PREFIX || '';
const WORLD = Number(process.env.RIG_WORLD_SIZE || 3000);
const W = 1280, H = 720;
const CX = W / 2, CY = H / 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--enable-webgl', '--hide-scrollbars'],
});

/** Joins the game in English and waits until the world is on screen. */
async function join(name, { width = W, height = H, mobile = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    hasTouch: mobile,
    isMobile: mobile,
    userAgent: mobile
      ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'
      : undefined,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${name}]`, String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate((l) => localStorage.setItem('farmclash-lang', l), LANG);
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('#name-input', name);
  await page.click('#play-btn');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  return page;
}

/** Where this actor is standing: the camera is centred on them. */
const where = (page) => page.evaluate(([x, y]) => window.farmclashView?.screenToWorld(x, y) ?? null, [CX, CY]);
const zoomOf = (page) => page.evaluate(() => window.farmclashView?.zoom() ?? 1);

const held = new Map();
async function keys(page, want) {
  const cur = held.get(page) ?? new Set();
  for (const k of cur) if (!want.has(k)) { await page.keyboard.up(k); cur.delete(k); }
  for (const k of want) if (!cur.has(k)) { await page.keyboard.down(k); cur.add(k); }
  held.set(page, cur);
}

/** Walks to a world point, giving up after `ms`. Returns true if it arrived. */
async function driveTo(page, target, { ms = 30000, stopAt = 120, attack = false } = {}) {
  const t0 = Date.now();
  if (attack) await page.mouse.down();
  let arrived = false;
  while (Date.now() - t0 < ms) {
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
    await page.mouse.move(CX + (dx / d) * 200, CY + (dy / d) * 200);
    await sleep(90);
  }
  await keys(page, new Set());
  if (attack) await page.mouse.up();
  return arrived;
}

/** Opens the shop on the given tab (it always starts on weapons). */
async function openShop(page, tab = 'buildings') {
  if (await page.locator('#shop.hidden').count()) {
    await page.keyboard.press('b');
    await page.waitForSelector('#shop:not(.hidden)', { timeout: 5000 });
  }
  await page.click(`.shop-tab[data-tab="${tab}"]`);
  await sleep(300);
}

/** Buys a building and drops it at a world offset from the hero. */
async function build(page, item, wx, wy, z) {
  await openShop(page, 'buildings');
  const row = page.locator(`#shop-buildings .shop-item[data-item="${item}"] button`);
  if (!(await row.count()) || (await row.isDisabled())) {
    await page.keyboard.press('Escape');
    return false;
  }
  await row.click();
  await sleep(250);
  await page.mouse.click(CX + wx * z, CY + wy * z);
  await sleep(300);
  return true;
}

/** Swings toward a world direction for a while. */
async function attackToward(page, dx, dy, ms) {
  const d = Math.hypot(dx, dy) || 1;
  await page.mouse.move(CX + (dx / d) * 220, CY + (dy / d) * 220);
  await page.mouse.down();
  await sleep(ms);
  await page.mouse.up();
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

/** Lets any error toast or boss banner fade before the shutter. */
const settle = (page, ms = 4500) => sleep(ms);

const shot = async (page, name) => {
  await page.screenshot({ path: pathJoin(DIR, PREFIX + name) });
  console.log('shot', PREFIX + name);
};

// ---------- the defender: vault, farms, and a wall line ----------
const def = await join('Harvest');
const z = await zoomOf(def);
// Wall blocks touch when their centres are two half-sizes (64 world units)
// apart. The line stands clear of the starter farm so nothing is refused.
for (let i = -3; i <= 3; i++) await build(def, 'wall', 250, i * 66, z);
await build(def, 'turret', -60, -210, z);
await build(def, 'mine', -230, 150, z);
await def.keyboard.press('Escape');
const home = await where(def);
// step aside so the whole base is in frame rather than under the hero
await driveTo(def, { x: home.x - 120, y: home.y + 60 }, { ms: 5000, stopAt: 40 });
await settle(def);
await shot(def, 'screen-1-base.png');

const base = await where(def);

// ---------- the raider: walks over and breaks in ----------
const raid = await join('Breaker');
await driveTo(raid, { x: base.x + 480, y: base.y }, { ms: 45000, stopAt: 90 });
await driveTo(raid, { x: base.x + 340, y: base.y }, { ms: 12000, stopAt: 60 });
for (let i = 0; i < 3; i++) await attackToward(raid, -1, 0, 1400);
await settle(raid, 2500);
await raid.mouse.move(CX - 220, CY);
await raid.mouse.down();
await sleep(600);
await shot(raid, 'screen-2-raid.png');
await raid.mouse.up();

// ---------- field combat ----------
await driveTo(def, { x: base.x - 520, y: base.y - 320 }, { ms: 16000, stopAt: 80, attack: true });
await attackToward(def, 1, 0, 1600);
await shot(def, 'screen-3-combat.png');

// ---------- the shop: vault, Base Rank, buildings ----------
await openShop(def, 'buildings');
await sleep(700);
await shot(def, 'screen-4-shop.png');
await def.keyboard.press('Escape');

// ---------- the boss, once the timer brings one in ----------
{
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < 200_000 && !done) {
    const seen = await findBoss(def);
    if (seen) {
      await driveTo(def, { x: seen.x * WORLD, y: seen.y * WORLD }, { ms: 30000, stopAt: 250, attack: true });
      await attackToward(def, 1, 0, 1500);
      await settle(def, 3000);
      await attackToward(def, 1, 0, 500);
      await shot(def, 'screen-5-boss.png');
      done = true;
    } else {
      await sleep(3000);
    }
  }
  if (!done) console.warn('no boss showed up — screen-5-boss.png not refreshed');
}

// ---------- mobile ----------
const mob = await join('Harvest', { width: 430, height: 932, mobile: true });
await sleep(2500);
await mob.screenshot({ path: pathJoin(DIR, PREFIX + 'mobile-1-play.png') });
console.log('shot', PREFIX + 'mobile-1-play.png');
await mob.keyboard.press('b').catch(() => {});
await sleep(500);
if (await mob.locator('#shop:not(.hidden)').count()) {
  await mob.click('.shop-tab[data-tab="buildings"]').catch(() => {});
  await sleep(800);
  await mob.screenshot({ path: pathJoin(DIR, PREFIX + 'mobile-2-shop.png') });
  console.log('shot', PREFIX + 'mobile-2-shop.png');
}

await browser.close();

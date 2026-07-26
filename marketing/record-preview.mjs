// Records a scripted gameplay take for the store preview video.
//
// The hero is steered with real feedback rather than blind key presses: the
// in-game minimap is a 2D canvas, so we read its pixels to find our own dot
// (white) and the boss dot (light purple). That keeps the hero away from the
// world edge — where the camera would show black past the boundary — and walks
// it straight into the boss fight instead of hoping the boss wanders over.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const OUT = '/tmp/claude-0/-home-user-Farmilka/9e0a0f6e-42bb-5164-af32-dc77ab722252/scratchpad';
const BASE = 'http://localhost:3993/';
const W = 1920, H = 1080;
const CX = W / 2, CY = H / 2;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--hide-scrollbars'],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: `${OUT}/video-raw`, size: { width: W, height: H } },
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const beats = [];
let t0 = 0;
const beat = (n) => { const t = Date.now() - t0; beats.push({ n, t }); console.log(`beat ${n} @ ${t}ms`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Reads hero + boss positions off the minimap canvas, as 0..1 world fractions. */
async function readMap() {
  return page.evaluate(() => {
    const c = document.getElementById('minimap');
    if (!c) return null;
    const g = c.getContext('2d');
    if (!g) return null;
    const S = c.width || 160;
    const d = g.getImageData(0, 0, S, S).data;
    let sx = 0, sy = 0, sn = 0, bx = 0, by = 0, bn = 0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const r = d[i], gg = d[i + 1], b = d[i + 2], a = d[i + 3];
        if (a < 40) continue;
        if (r > 248 && gg > 248 && b > 248) { sx += x; sy += y; sn++; }                              // self (white)
        else if (r > 228 && r < 250 && gg > 188 && gg < 214 && b > 246) { bx += x; by += y; bn++; }  // boss
      }
    }
    return {
      self: sn ? { x: sx / sn / S, y: sy / sn / S } : null,
      boss: bn ? { x: bx / bn / S, y: by / bn / S } : null,
    };
  });
}

const held = new Set();
async function setKeys(want) {
  for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
}
const releaseAll = () => setKeys(new Set());

/** Keys that push the hero along (dx, dy) in world-fraction space. */
function keysFor(dx, dy, thr = 0.012) {
  const k = new Set();
  if (dy < -thr) k.add('KeyW');
  if (dy > thr) k.add('KeyS');
  if (dx < -thr) k.add('KeyA');
  if (dx > thr) k.add('KeyD');
  return k;
}

const aimAt = (ang, r = 320) => page.mouse.move(CX + Math.cos(ang) * r, CY + Math.sin(ang) * r);

/**
 * Walks toward a target (0..1 world fraction) while attacking.
 * `target` may be 'boss' to chase whatever the minimap currently shows.
 */
async function driveTo(target, ms, { attack = true, spin = false, stopAt = 0.02 } = {}) {
  const start = Date.now();
  let spinA = 0;
  if (attack) await page.mouse.down();
  while (Date.now() - start < ms) {
    const m = await readMap();
    const self = m?.self;
    const dest = target === 'boss' ? m?.boss : target;
    if (self && dest) {
      const dx = dest.x - self.x, dy = dest.y - self.y;
      if (Math.hypot(dx, dy) < stopAt && target !== 'boss') await setKeys(new Set());
      else await setKeys(keysFor(dx, dy));
      if (spin) { spinA += 0.5; await aimAt(spinA); }
      else await aimAt(Math.atan2(dy, dx));
    } else if (spin) {
      spinA += 0.5;
      await aimAt(spinA);
    }
    await sleep(120);
  }
  if (attack) await page.mouse.up();
  await releaseAll();
}

await page.goto(BASE);
await page.waitForTimeout(1200);
await page.fill('#name-input', 'FarmClash');
await page.click('#play-btn');
await page.waitForTimeout(3500);
t0 = Date.now();
beat('start');

const CENTER = { x: 0.5, y: 0.5 };

// --- 1. head for the middle of the map, killing whatever is on the way ---
await driveTo(CENTER, 7000, { spin: true });
beat('recentred');

// --- 2. orbit the centre so the fight stays framed and away from the edges ---
await driveTo({ x: 0.56, y: 0.44 }, 3000, { spin: true });
await driveTo({ x: 0.44, y: 0.56 }, 3000, { spin: true });
beat('mobs-done');

// --- 3. shop: buy a weapon that reads well on video ---
await page.keyboard.press('KeyB');
await page.waitForTimeout(900);
const buy = await page.$('#shop-weapons .shop-item[data-item="scythe"] .buy');
if (buy) { await buy.click(); await page.waitForTimeout(600); }
beat('bought-weapon');

// --- 4. the money shot: weapon crate -> guaranteed legendary ---
const hatsTab = await page.$('.shop-tab[data-tab="hats"]');
if (hatsTab) { await hatsTab.click(); await page.waitForTimeout(700); }
const crate = await page.$('#weapon-lootbox-btn');
if (crate) { await crate.click(); await page.waitForTimeout(1800); }
beat('crate-opened');
await page.keyboard.press('KeyB');
await page.waitForTimeout(600);
// keep the legendary visible in the hotbar but fight with the scythe: the
// Tamer's Blade would make mobs ignore us and drain the scene
await page.keyboard.press('Digit2');
await page.waitForTimeout(300);

// --- 5. show off the new kit near the centre ---
await driveTo({ x: 0.52, y: 0.52 }, 4000, { spin: true });
beat('showing-off');

// --- 6. hunt the boss: walk it down as soon as the minimap shows it ---
const hunt = Date.now();
let sawBoss = false;
while (Date.now() - hunt < 50_000) {
  const m = await readMap();
  if (m?.boss) {
    if (!sawBoss) { sawBoss = true; beat('boss-spotted'); }
    await driveTo('boss', 3000, { spin: false });
  } else {
    await driveTo(CENTER, 2500, { spin: true }); // keep the frame busy until it shows up
  }
}
beat('end');

await releaseAll();
await page.waitForTimeout(600);
const video = page.video();
await ctx.close();
const raw = await video.path();
await browser.close();

writeFileSync(`${OUT}/beats.json`, JSON.stringify({ raw, beats, errors }, null, 2));
console.log('raw video:', raw);
console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');

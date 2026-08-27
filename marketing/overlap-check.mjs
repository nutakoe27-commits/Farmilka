// Overlap check for Yandex requirement 1.10.3: no interface element may sit on
// top of another. Every visible HUD box is measured in a real browser and every
// pair is intersected, across the viewport shapes the game actually meets —
// including the short, wide window a phone gets in the Yandex frame when it is
// held sideways, which is where the reported collisions happened.
//
// Needs the capture server (bots fill the leaderboard):
//   DATA_DIR=/tmp/i18n PORT=3996 BALANCE_PATH=marketing/capture-rig-balance.json \
//     npx tsx src/index.ts        # from server/
//
//   node marketing/overlap-check.mjs

import { chromium } from 'playwright';

const BASE = process.env.CAPTURE_URL || 'http://localhost:3996/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

// The HUD boxes a player can see. The joystick *zone* is left out on purpose:
// it is an invisible touch region covering the lower-left of the screen, not a
// drawn element, so its rectangle means nothing to the eye.
const BOXES = [
  '#money', '#zone-label', '#hp-wrap', '#killfeed', '#leaderboard', '#minimap',
  '#settings-btn', '#fullscreen-btn', '#hotbar', '#food-slot', '#mob-buttons',
  '#atk-btn', '#hint', '#boss-banner', '#onboarding', '#place-hint',
];

const VIEWPORTS = [
  { name: 'desktop 1280×720', width: 1280, height: 720, mobile: false },
  { name: 'desktop 1600×600', width: 1600, height: 600, mobile: false },
  { name: 'laptop 1366×640', width: 1366, height: 640, mobile: false },
  { name: 'phone portrait 390×844', width: 390, height: 844, mobile: true },
  { name: 'phone landscape 844×390', width: 844, height: 390, mobile: true },
  // what the Yandex frame leaves a sideways phone once its chrome is subtracted
  { name: 'phone landscape 730×310', width: 730, height: 310, mobile: true },
  { name: 'tablet 768×1024', width: 768, height: 1024, mobile: true },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--enable-webgl', '--hide-scrollbars'],
});

/** Visible rectangles of the HUD boxes, keyed by selector. */
const rects = (page, sel) => page.evaluate((list) => {
  const out = {};
  for (const s of list) {
    const el = document.querySelector(s);
    if (!el) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out[s] = { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  return out;
}, sel);

/** Overlapping pairs, ignoring slivers of a couple of pixels. */
function collisions(boxes) {
  const SLACK = 2; // antialiasing / rounded corners, not a real overlap
  const names = Object.keys(boxes);
  const hits = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = boxes[names[i]], b = boxes[names[j]];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > SLACK && oy > SLACK) {
        hits.push(`${names[i]} × ${names[j]} (${Math.round(ox)}×${Math.round(oy)}px)`);
      }
    }
  }
  return hits;
}

/** Anything hanging off the edge of the window (1.10.1, re-checked per shape). */
function offscreen(boxes, w, h) {
  return Object.entries(boxes)
    .filter(([, r]) => r.x < -1 || r.y < -1 || r.x + r.w > w + 1 || r.y + r.h > h + 1)
    .map(([n, r]) => `${n} @ ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}×${Math.round(r.h)}`);
}

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.mobile,
    isMobile: vp.mobile,
    userAgent: vp.mobile
      ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'
      : undefined,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('farmclash-lang', 'ru'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('#name-input', 'Мерка');
  await page.click('#play-btn');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 20000 });
  // long enough for the leaderboard to arrive and the onboarding tip to clear
  await sleep(9000);

  // Worst case, all at once: a full kill feed and both banners up with their
  // longest real text. The desktop collision showed up on a notice; the phone
  // one needed the boss warning and the onboarding tip on screen together.
  await page.evaluate(() => {
    const feed = document.getElementById('killfeed');
    for (const t of ['🏦 В хранилище: +20 (всего 190)', '⚔ Ловкач срубил Тихоню (Меч)',
                     '⚔ Разоритель срубил Землекопа (Клинок вампира)', '🎩 Выпала шляпа: Корона чемпиона']) {
      const el = document.createElement('div');
      el.className = 'kf';
      el.textContent = t;
      feed.appendChild(el);
    }
    const boss = document.getElementById('boss-banner');
    boss.textContent = '⚠ КРИСТАЛЬНАЯ КОРОЛЕВА придёт через 12с';
    boss.classList.remove('hidden');
    const tip = document.getElementById('onboarding');
    tip.textContent = '⚔ Большая кнопка — атака (тап = автоприцел)';
    tip.classList.remove('hidden');
    tip.style.opacity = '1';
  });
  await sleep(300);

  const boxes = await rects(page, BOXES);
  const hits = collisions(boxes);
  const out = offscreen(boxes, vp.width, vp.height);
  check(`${vp.name}: nothing overlaps`, hits.length === 0, hits.join(' | '));
  check(`${vp.name}: nothing runs off the edge`, out.length === 0, out.join(' | '));

  // build mode adds a toolbar along the bottom, over the same crowded corner
  await page.keyboard.press('b').catch(() => {});
  await page.waitForSelector('#shop:not(.hidden)', { timeout: 5000 }).catch(() => {});
  const panels = await rects(page, ['#shop']);
  const panelOut = offscreen(panels, vp.width, vp.height);
  check(`${vp.name}: the shop fits on screen`, panelOut.length === 0, panelOut.join(' | '));
  // short timeouts: a viewport where these cannot be reached should be reported
  // by the surrounding checks, not sat on for Playwright's 30s default
  await page.click('.shop-tab[data-tab="buildings"]', { timeout: 4000 }).catch(() => {});
  await sleep(300);
  const wall = '#shop-buildings .shop-item[data-item="wall"] button';
  const built = await page.click(wall, { timeout: 4000 }).then(() => true).catch(() => false);
  await sleep(500);
  const building = await rects(page, BOXES);
  const buildHits = collisions(building);
  check(`${vp.name}: nothing overlaps in build mode`, built && buildHits.length === 0,
    built ? buildHits.join(' | ') : 'could not enter build mode');
  await page.keyboard.press('Escape').catch(() => {});

  if ((hits.length || buildHits.length || panelOut.length) && process.env.SHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/overlap-${vp.width}x${vp.height}.png` });
  }
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

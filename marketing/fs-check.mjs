// UI smoke check for the fullscreen button and screen rotation. Lives here
// because this is where the Playwright install lives (see package.json); it is
// not a store asset. Needs the capture server — see ux-check.mjs.
//
// Fullscreen button: present on desktop and on a phone viewport, actually
// toggles the fullscreen element, and the portrait layout survives a rotation
// (nothing is orientation-locked).
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || '/tmp';
const BASE = 'http://localhost:3996/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (l, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-webgl'] });

async function join(name, viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('farmclash-lang', 'en'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('#name-input', name);
  await page.click('#play-btn');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });
  await sleep(2000);
  return { page, ctx, errors };
}

// ---------- desktop ----------
const d = await join('FsDesk', { width: 1280, height: 720 });
check('the button is in the HUD', await d.page.locator('#fullscreen-btn').isVisible());
check('it sits next to the gear, not on top of it',
  (await d.page.locator('#fullscreen-btn').boundingBox()).x < (await d.page.locator('#settings-btn').boundingBox()).x);
await d.page.click('#fullscreen-btn');
await sleep(700);
check('clicking it enters fullscreen', await d.page.evaluate(() => !!document.fullscreenElement));
check('the button marks itself active', await d.page.locator('#fullscreen-btn.active').count() === 1);
await d.page.click('#fullscreen-btn');
await sleep(700);
check('clicking again leaves fullscreen', await d.page.evaluate(() => !document.fullscreenElement));

// also reachable from the settings panel
await d.page.click('#settings-btn');
await sleep(400);
check('settings offers the same toggle', await d.page.locator('#set-fullscreen-btn').isVisible());
check('the settings row is labelled for the current state',
  ['Enter', 'Leave'].includes((await d.page.locator('#set-fullscreen-btn').textContent()).trim()),
  await d.page.locator('#set-fullscreen-btn').textContent());
await d.page.click('#settings-close');

// ---------- phone, portrait ----------
const m = await join('FsPhone', { width: 430, height: 932 }, true);
check('phone: the button is there too', await m.page.locator('#fullscreen-btn').isVisible());
const fsBox = await m.page.locator('#fullscreen-btn').boundingBox();
const gearBox = await m.page.locator('#settings-btn').boundingBox();
check('phone: both corner buttons are on the left, side by side',
  gearBox.x < 60 && fsBox.x > gearBox.x && fsBox.x < 120, `gear=${gearBox.x} fs=${fsBox.x}`);
check('phone: portrait layout — joystick zone at the bottom left',
  await m.page.evaluate(() => {
    const z = document.getElementById('joy-left').getBoundingClientRect();
    return z.left === 0 && z.bottom >= window.innerHeight - 1;
  }));
await m.page.screenshot({ path: `${OUT}/fs-portrait.png` });

// ---------- phone, rotated ----------
await m.page.setViewportSize({ width: 932, height: 430 });
await sleep(1200);
check('rotation is not blocked — the game re-lays out in landscape',
  await m.page.evaluate(() => window.innerWidth > window.innerHeight));
check('rotated: the HUD is still alive', await m.page.locator('#fullscreen-btn').isVisible());
check('rotated: the canvas followed the viewport',
  await m.page.evaluate(() => {
    const c = document.querySelector('canvas');
    return Math.abs(c.clientWidth - window.innerWidth) < 4;
  }));
// A rotated phone must not become a scouting advantage over a desktop player.
const seen = await m.page.evaluate(() => {
  const c = document.querySelector('canvas');
  const z = window.farmclashView.zoom();
  return { w: c.clientWidth / z, h: c.clientHeight / z };
});
check('rotated: the visible world stays close to the desktop view',
  seen.w <= 1600 * 1.2 && seen.h <= 900 * 1.2,
  `${seen.w.toFixed(0)}x${seen.h.toFixed(0)} vs desktop 1600x900`);
await m.page.screenshot({ path: `${OUT}/fs-landscape.png` });

check('no console errors', d.errors.length === 0 && m.errors.length === 0,
  [...d.errors, ...m.errors].slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

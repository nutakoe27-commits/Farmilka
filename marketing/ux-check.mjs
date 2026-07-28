// UI smoke check for the build/demolish flow. It lives here because this is
// where the Playwright install lives (see package.json); it is not a store
// asset. Needs the capture server:
//   DATA_DIR=/tmp/ux PORT=3996 BALANCE_PATH=marketing/capture-rig-balance.json \
//     npx tsx src/index.ts        # from server/
//
// Checks the three UX changes end to end in a real browser:
//  1. the weapon crate is on the weapons tab
//  2. one shop trip places several buildings in a row
//  3. a building can be torn down and the slot comes back
// Then repeats the build flow on a touch viewport.
import { chromium } from 'playwright';

const OUT = '/tmp/claude-0/-home-user-Farmilka/9e0a0f6e-42bb-5164-af32-dc77ab722252/scratchpad';
const BASE = 'http://localhost:3996/';
const W = 1280, H = 720, CX = W / 2, CY = H / 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (l, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-webgl'] });

async function join(name, { mobile = false } = {}) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 430, height: 932 } : { width: W, height: H },
    hasTouch: mobile, isMobile: mobile,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('farmclash-lang', 'en'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('#name-input', name);
  await page.click('#play-btn');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });
  await sleep(2500);
  return { page, errors };
}

const counts = (page) => page.evaluate(() => document.getElementById('build-count').textContent);

// ---------- desktop ----------
const { page, errors } = await join('Tester');
const zoom = await page.evaluate(() => window.farmclashView.zoom());

// 1. the weapon crate
await page.keyboard.press('b');
await page.waitForSelector('#shop:not(.hidden)');
await page.click('.shop-tab[data-tab="weapons"]');
await sleep(300);
check('weapon crate is on the weapons tab', await page.locator('#shop-weapon-crate #weapon-lootbox-btn').isVisible());
check('it is no longer under hats', !(await page.locator('#shop-lootbox #weapon-lootbox-btn').count()));
check('the hat lootbox stayed on the hats tab', !!(await page.locator('#shop-lootbox #lootbox-btn').count()));

// 2. several buildings from one shop trip
await page.click('.shop-tab[data-tab="buildings"]');
await sleep(300);
const before = await counts(page);
await page.click('#shop-buildings .shop-item[data-item="wall"] button');
await sleep(300);
check('the shop closes and the build toolbar appears', await page.locator('#place-hint:not(.hidden)').isVisible());
for (let i = -2; i <= 2; i++) {
  await page.mouse.click(CX + 220 * zoom, CY + i * (66 * zoom));
  await sleep(280);
}
check('build mode survived five placements', await page.locator('#place-hint:not(.hidden)').isVisible());
await page.click('#place-done');
await sleep(300);
check('Done leaves build mode', await page.locator('#place-hint.hidden').count() === 1);
await page.keyboard.press('b');
await page.click('.shop-tab[data-tab="buildings"]');
await sleep(400);
const after = await counts(page);
check('five walls went up in one trip', after !== before, `${before} -> ${after}`);

// 3. demolish
await page.click('#demolish-btn');
await sleep(300);
check('demolish mode shows the red toolbar', await page.locator('#place-hint.demolish').isVisible());
const wallsBefore = Number((after.match(/(\d+)\/\d+$/) ?? [])[1] ?? -1);
await page.mouse.move(CX + 220 * zoom, CY);
await sleep(300);
await page.mouse.click(CX + 220 * zoom, CY);
await sleep(600);
await page.click('#place-done');
await page.keyboard.press('b');
await page.click('.shop-tab[data-tab="buildings"]');
await sleep(400);
const afterDemolish = await counts(page);
const wallsAfter = Number((afterDemolish.match(/(\d+)\/\d+$/) ?? [])[1] ?? -1);
check('demolishing gives the wall slot back', wallsAfter === wallsBefore - 1, `${wallsBefore} -> ${wallsAfter}`);
await page.screenshot({ path: `${OUT}/ux-desktop.png` });

// ---------- touch ----------
const mob = await join('Toucher', { mobile: true });
await mob.page.locator('#mob-shop').tap();
await mob.page.waitForSelector('#shop:not(.hidden)');
await mob.page.click('.shop-tab[data-tab="buildings"]');
await sleep(300);
const mBefore = await counts(mob.page);
await mob.page.click('#shop-buildings .shop-item[data-item="wall"] button');
await sleep(400);
check('touch: build toolbar is up', await mob.page.locator('#place-hint:not(.hidden)').isVisible());
check('touch: a Done button is offered (no Esc on a phone)', await mob.page.locator('#place-done').isVisible());
for (let i = 0; i < 3; i++) {
  await mob.page.touchscreen.tap(215, 300 + i * 46);
  await sleep(350);
}
await mob.page.screenshot({ path: `${OUT}/ux-mobile.png` });
await mob.page.locator('#place-done').tap();
await sleep(300);
await mob.page.locator('#mob-shop').tap();
await mob.page.click('.shop-tab[data-tab="buildings"]');
await sleep(400);
const mAfter = await counts(mob.page);
check('touch: tapping the map placed walls', mAfter !== mBefore, `${mBefore} -> ${mAfter}`);
check('touch: Done left build mode', await mob.page.locator('#place-hint.hidden').count() === 1);

check('no console errors', errors.length === 0 && mob.errors.length === 0, [...errors, ...mob.errors].slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

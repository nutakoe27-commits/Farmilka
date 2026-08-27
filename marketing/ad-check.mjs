// Ad-placement check for Yandex requirements 4.4 and 4.7.
//
//  4.4 — the spot may only follow a *non-game* action at a logical pause, and
//        must start within 0.33 s of it. Dying is not an action the player took;
//        tapping "Возродиться" on the death screen is, and that pause is exactly
//        the platform's own example. Play resumes only once the ad is closed.
//  4.7 — the game stands still for the whole time the ad, or the warning that
//        precedes it, owns the screen.
//
// The page is opened on portal.test (mapped to localhost) so the client takes
// itself for a portal build and loads /sdk.js — which is served here by a stub
// standing in for the Yandex SDK. Off our own hostname the client talks to an
// absolute server address, so the build under test has to be pointed back at
// the local one:
//
//   VITE_PLATFORM=yandex VITE_SERVER_ORIGIN=http://portal.test:3997 \
//     npm run build -w client
//   DATA_DIR=/tmp/ad PORT=3997 BALANCE_PATH=marketing/ad-rig-balance.json \
//     npx tsx src/index.ts        # from server/, one mob bite is fatal there
//   node marketing/ad-check.mjs
//
// Rebuild normally afterwards — that dist points at localhost and nothing else.

import { chromium } from 'playwright';

const PORT = process.env.AD_PORT || 3997;
const BASE = `http://portal.test:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

// Stub SDK. showFullscreenAdv waits before onOpen, standing in for the warning
// Yandex shows ahead of the spot: the game must already be paused by then.
const WARNING_MS = 700;
const AD_MS = 1500;
const SDK = `
window.__ad = { requested: 0, openedAt: 0, closedAt: 0, requestedAt: 0 };
window.YaGames = {
  init: () => Promise.resolve({
    environment: { i18n: { lang: 'ru' } },
    features: { LoadingAPI: { ready() {} }, GameplayAPI: { start() {}, stop() {} } },
    getPlayer: () => Promise.reject(new Error('guest')),
    auth: { openAuthDialog: () => Promise.reject(new Error('guest')) },
    adv: {
      showFullscreenAdv({ callbacks }) {
        window.__ad.requested++;
        window.__ad.requestedAt = performance.now();
        setTimeout(() => {
          window.__ad.openedAt = performance.now();
          callbacks.onOpen && callbacks.onOpen();
          setTimeout(() => {
            window.__ad.closedAt = performance.now();
            callbacks.onClose && callbacks.onClose();
          }, ${AD_MS});
        }, ${WARNING_MS});
      },
    },
  }),
};
`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--enable-webgl', '--hide-scrollbars', '--host-resolver-rules=MAP portal.test 127.0.0.1', '--no-proxy-server'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.route('**/sdk.js', (route) => route.fulfill({ contentType: 'application/javascript', body: SDK }));

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('#name-input', 'Doomed');
await page.click('#play-btn');
await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });

// The ad lasts a couple of seconds, so instead of sleeping and hoping to look
// at the right moment, the page records whether it was paused every 50 ms. The
// whole window from the ad request (i.e. from the warning) to its close then
// has to come back paused, with no gap anywhere in it.
await page.evaluate(() => {
  window.__samples = [];
  setInterval(() => window.__samples.push([performance.now(), window.farmclashView?.paused()]), 50);
});
await sleep(1500);

const adState = () => page.evaluate(() => window.__ad);
const paused = () => page.evaluate(() => window.farmclashView?.paused() ?? null);

check('no ad before the player dies', (await adState()).requested === 0);
check('the game runs while the player is alive', (await paused()) === false);

// walk until something bites: on this rig one hit is fatal
const dead = () => page.locator('#death-screen:not(.hidden)').count().then((n) => n > 0);
const t0 = Date.now();
let died = false;
const dirs = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
outer:
for (let i = 0; Date.now() - t0 < 90_000; i++) {
  const k = dirs[i % dirs.length];
  await page.keyboard.down(k);
  for (let j = 0; j < 8; j++) {
    await sleep(200);
    if (await dead()) { died = true; await page.keyboard.up(k); break outer; }
  }
  await page.keyboard.up(k);
}
check('the player died', died);

if (died) {
  // 4.4: dying is not a player action, so nothing may run off it
  await sleep(1500);
  check('death alone shows no ad', (await adState()).requested === 0);
  check('the death screen is up, waiting on the player', await dead());

  const btn = page.locator('#respawn-btn');
  for (let i = 0; i < 40 && (await btn.isDisabled()); i++) await sleep(500);
  // Time the gap inside the page, from the click event itself: measuring it
  // from here would time Playwright's own round trips, not the game.
  await page.evaluate(() => {
    window.__tapAt = 0;
    document.getElementById('respawn-btn').addEventListener(
      'click', () => { window.__tapAt = performance.now(); }, true);
  });
  await btn.click();

  // 4.4: the spot must start within 0.33 s of the action that asked for it
  for (let i = 0; i < 20 && !(await adState()).requested; i++) await sleep(50);
  const ad0 = await adState();
  const tapAt = await page.evaluate(() => window.__tapAt);
  check('the ad follows the respawn tap', ad0.requested === 1);
  check('and starts within the 0.33 s the rules allow',
    tapAt > 0 && ad0.requestedAt > 0 && ad0.requestedAt - tapAt < 330,
    `${Math.round(ad0.requestedAt - tapAt)}ms`);

  // 4.4: the hero must still be dead behind the ad — play resumes after it
  await sleep(WARNING_MS + Math.round(AD_MS / 2));
  check('the hero is still dead while the ad plays', await dead());

  for (let i = 0; i < 40 && !(await adState()).closedAt; i++) await sleep(200);
  await sleep(1200);

  const { ad, samples } = await page.evaluate(() => ({ ad: window.__ad, samples: window.__samples }));
  const inAd = samples.filter(([t]) => t >= ad.requestedAt && t <= ad.closedAt);
  const running = inAd.filter(([, p]) => p !== true);
  check('the ad closed', ad.closedAt > 0);
  // 4.7: paused for the whole window, warning included
  check('the game is paused for the whole ad, warning included',
    inAd.length > 5 && running.length === 0,
    `${inAd.length} samples, ${running.length} of them running`);
  const after = samples.filter(([t]) => t > ad.closedAt + 300);
  check('the game runs again once the ad closes', after.length > 0 && after.every(([, p]) => p === false));
  check('exactly one ad for one respawn', ad.requested === 1);
  check('and the hero is back in the world', (await page.locator('#death-screen.hidden').count()) > 0);
}

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' / '));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

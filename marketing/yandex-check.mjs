// UI compliance check for the Yandex moderation points, run against the built
// client. Lives here because this is where the Playwright install lives; it is
// not a store asset. Needs the capture server — see CRAZYGAMES.md.
//
// Covers: 1.19 (not clickable before GameReady), 1.6.1.8 / 1.6.2.7 (no
// selection, no context menu), 8.4.2 / 8.4.3 (no off-site links on a portal
// build) and 1.10.1 (nothing clipped by a notch or running off the edge).
import { chromium, devices } from 'playwright';
const OUT = process.env.SHOT_DIR || '/tmp';
const BASE = process.env.CHECK_URL || 'http://localhost:3996/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (l, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${l} ${extra}`); ok ? pass++ : fail++; };
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  // A fake hostname that is not one of our own: only then does the client
  // believe it is portal-hosted and actually wait for the Yandex SDK.
  args: ['--enable-webgl', '--host-resolver-rules=MAP portal.test 127.0.0.1'],
});
const PORTAL = BASE.replace(/\/\/[^/:]+/, '//portal.test');

// ---------- 1.19: nothing clickable before GameReady ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // Hold the SDK script for 2.5 s so the pre-ready window is observable at all
  // (locally it otherwise resolves in ~50 ms and the veil is a blink).
  await page.route(/sdk\.js|yandex\.ru\/games\/sdk/, async (r) => { await sleep(2500); await r.abort(); });
  await page.goto(PORTAL, { waitUntil: 'commit' });
  await sleep(900);
  const veilUp = await page.locator('#boot-veil:not(.gone)').count() > 0;
  const blocks = veilUp && await page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return el?.closest('#boot-veil') !== null;
  });
  check('a veil covers the game while the SDK is still loading', veilUp);
  check('the veil swallows clicks (nothing under it is reachable)', blocks);
  await page.waitForSelector('#boot-veil', { state: 'detached', timeout: 12000 });
  check('the veil lifts once loading is signalled', true);
  // 8.4.2 / 8.4.3: off-site links must be gone even though the SDK never answered
  const links = await page.evaluate(() => [...document.querySelectorAll('.yandex-hide')]
    .filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.id || el.className));
  check('no off-site link is visible on a portal build', links.length === 0, links.join(', '));
  const anchors = await page.evaluate(() => [...document.querySelectorAll('a[href^="http"]')]
    .filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.href));
  check('no visible outbound anchor at all', anchors.length === 0, anchors.join(', '));
  await page.close();
}

// ---------- 8.2.3: the platform owns the language ----------
// A draft is published per language, so the interface must be in the language
// the SDK reports — and the game must not offer a competing switch of its own,
// nor remember a choice that could contradict the next draft.
for (const sdkLang of ['ru', 'en']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  // Stub the SDK so it reports `sdkLang`, and plant the opposite language in
  // storage first: the platform must win over anything remembered locally.
  await page.route(/sdk\.js|yandex\.ru\/games\/sdk/, (r) => r.fulfill({
    contentType: 'application/javascript',
    body: `window.YaGames={init:()=>Promise.resolve({environment:{i18n:{lang:'${sdkLang}'}},`
      + `features:{LoadingAPI:{ready(){}},GameplayAPI:{start(){},stop(){}}},`
      + `getPlayer:()=>Promise.reject(new Error('guest')),`
      + `auth:{openAuthDialog:()=>Promise.reject(new Error('guest'))},adv:{}})};`,
  }));
  await page.addInitScript((other) => localStorage.setItem('farmclash-lang', other), sdkLang === 'ru' ? 'en' : 'ru');
  await page.goto(PORTAL, { waitUntil: 'commit' });
  await page.waitForSelector('#boot-veil', { state: 'detached', timeout: 12000 });
  await sleep(400);

  const shown = await page.evaluate(() => ({
    html: document.documentElement.lang,
    play: document.getElementById('play-btn')?.textContent?.trim() ?? '',
    stored: localStorage.getItem('farmclash-lang'),
    switches: [...document.querySelectorAll('.lang-switch')]
      .filter((el) => el.getBoundingClientRect().width > 0).length,
  }));
  const wantPlay = sdkLang === 'ru' ? 'Играть' : 'Play';
  check(`SDK says ${sdkLang}: the interface follows it, not the stored choice`,
    shown.html === sdkLang && shown.play === wantPlay, `${shown.html} / "${shown.play}"`);
  check(`SDK says ${sdkLang}: the stored choice is cleared`, shown.stored === null, String(shown.stored));
  check(`SDK says ${sdkLang}: no language switch is offered`, shown.switches === 0, `${shown.switches} visible`);
  await ctx.close();
}

// ---------- 1.6.x: no selection, no context menu ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#boot-veil', { state: 'detached', timeout: 12000 });
  const sel = await page.evaluate(() => getComputedStyle(document.getElementById('logo')).userSelect
    || getComputedStyle(document.getElementById('logo')).webkitUserSelect);
  check('UI text cannot be selected', sel === 'none', sel);
  const inputSel = await page.evaluate(() => getComputedStyle(document.getElementById('name-input')).userSelect);
  check('but the name field still accepts text', inputSel === 'text' || inputSel === 'auto', inputSel);
  // triple-click must not produce a selection
  await page.click('#logo', { clickCount: 3 });
  check('triple-click selects nothing', await page.evaluate(() => String(getSelection()).length === 0));
  let menu = false;
  page.on('dialog', () => { menu = true; });
  await page.click('body', { button: 'right' });
  check('right-click raises no context menu', !menu);
  await page.close();
}

// ---------- 1.10.1: nothing clipped on a notched phone ----------
{
  const iphone = devices['iPhone 13'];
  const ctx = await browser.newContext({ ...iphone });
  const page = await ctx.newPage();
  // emulate a notch: Chromium has no env() values, so inject the same insets
  await page.addInitScript(() => {
    const st = document.createElement('style');
    st.textContent = ':root{--sat:47px;--sab:34px;--sal:0px;--sar:0px}';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#boot-veil', { state: 'detached', timeout: 12000 });
  await page.fill('#name-input', 'Notch');
  await page.click('#play-btn');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });
  await sleep(3000);
  const ids = ['money', 'settings-btn', 'fullscreen-btn', 'minimap', 'leaderboard', 'atk-btn', 'mob-buttons', 'hp-wrap'];
  const clipped = await page.evaluate((list) => {
    const inset = { top: 47, bottom: 34, left: 0, right: 0 };
    const bad = [];
    for (const id of list) {
      const el = document.getElementById(id);
      if (!el || el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.top < inset.top - 0.5 || r.left < inset.left - 0.5
        || r.right > innerWidth - inset.right + 0.5 || r.bottom > innerHeight - inset.bottom + 0.5) {
        bad.push(`${id}(${Math.round(r.top)},${Math.round(r.left)},${Math.round(r.right)},${Math.round(r.bottom)})`);
      }
    }
    return bad;
  }, ids);
  check('no HUD element crosses the notch or the home indicator', clipped.length === 0, clipped.join(' '));

  // Overlapping readouts are the same defect from the player's side: the gold
  // line ran under the minimap before the top bar was restacked.
  const overlaps = await page.evaluate((list) => {
    const boxes = list.map((id) => [id, document.getElementById(id)])
      .filter(([, el]) => el && el.offsetParent !== null)
      .map(([id, el]) => [id, el.getBoundingClientRect()])
      .filter(([, r]) => r.width > 0 && r.height > 0);
    const bad = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [ia, a] = boxes[i], [ib, b] = boxes[j];
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 2 && oy > 2) bad.push(`${ia}~${ib}`);
    }
    return bad;
  }, ['money', 'zone-label', 'settings-btn', 'fullscreen-btn', 'minimap', 'leaderboard', 'killfeed', 'mob-buttons', 'atk-btn']);
  check('no two HUD readouts overlap', overlaps.length === 0, overlaps.join(' '));

  // Transient notices are the easiest thing to let run off the edge.
  await page.evaluate(() => {
    const feed = document.getElementById('killfeed');
    const el = document.createElement('div');
    el.className = 'kf';
    el.textContent = 'Level 2 — more HP and damage. Keep killing to reach the next one!';
    feed.prepend(el);
  });
  await sleep(200);
  const spill = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('#killfeed .kf, #boss-banner, #onboarding, #money')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > innerWidth + 0.5 || r.left < -0.5) bad.push(`${el.className || el.id}:${Math.round(r.left)}..${Math.round(r.right)}/${innerWidth}`);
    }
    return bad;
  });
  check('a long notice wraps instead of running off the edge', spill.length === 0, spill.join(' '));
  await page.screenshot({ path: `${OUT}/yx-notch.png` });
  await ctx.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

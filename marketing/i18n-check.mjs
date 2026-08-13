// Localisation check: plays the game once in Russian and once in English and
// reads every label the player can actually see, looking for text in the wrong
// alphabet. Yandex 8.2.3 (and plain common sense) wants the interface to be in
// one language, so a Cyrillic word in the English build is a bug and so is a
// bare English id in the Russian one.
//
// Needs the capture server:
//   DATA_DIR=/tmp/i18n PORT=3996 BALANCE_PATH=marketing/capture-rig-balance.json \
//     npx tsx src/index.ts        # from server/
//
//   node marketing/i18n-check.mjs

import { chromium } from 'playwright';

const BASE = process.env.CAPTURE_URL || 'http://localhost:3996/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const CYRILLIC = /[А-Яа-яЁё]/;
// Words that are legitimately the same in both languages: the title, the
// language switcher, key caps, genre shorthand and one deliberately bilingual
// label (the language row in Settings reads "Язык / Language" by design).
const ALLOWED = new Set([
  'farmclash', 'farm', 'clash', 'ru', 'en', 'wasd', 'q', 'b', 'w', 'a', 's', 'd',
  'hp', 'x', 'v', 'vs', 'fps', 'id', 'esc', 'pvp', 'pve', 'aoe', 'telegram',
  'language', 'язык',
]);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--enable-webgl', '--hide-scrollbars'],
});

/**
 * Every visible label in the DOM, one entry per element that owns the text.
 * Anything showing a player-chosen name is skipped: those are whatever the
 * people online typed, in whatever alphabet, and are not ours to translate.
 */
async function visibleLabels(page) {
  return page.evaluate(() => {
    const SKIP = ['killfeed', 'leaderboard', 'boss-banner'];
    const out = [];
    const walk = (el) => {
      if (SKIP.includes(el.id)) return;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return;
      for (const n of el.childNodes) {
        if (n.nodeType === 3) {
          const txt = n.textContent.trim();
          if (txt) out.push({ txt, where: el.id || el.className || el.tagName });
        } else if (n.nodeType === 1) {
          walk(n);
        }
      }
    };
    walk(document.body);
    return out;
  });
}

/** Words in the wrong alphabet for `lang`, ignoring numbers, emoji and IDs. */
function offenders(labels, lang) {
  const bad = [];
  for (const { txt, where } of labels) {
    const words = txt.split(/[^\p{L}_]+/u).filter(Boolean);
    for (const w of words) {
      const low = w.toLowerCase();
      if (ALLOWED.has(low)) continue;
      if (lang === 'en' && CYRILLIC.test(w)) bad.push(`${where}: "${txt}"`);
      if (lang === 'ru' && /^[A-Za-z_]+$/.test(w) && w.length > 1) bad.push(`${where}: "${txt}"`);
    }
  }
  return [...new Set(bad)];
}

async function run(lang) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate((l) => localStorage.setItem('farmclash-lang', l), lang);
  await page.reload({ waitUntil: 'networkidle' });

  const found = [];
  const sweep = async (screen) => {
    const bad = offenders(await visibleLabels(page), lang);
    if (bad.length) found.push(`[${screen}] ${bad.join(' | ')}`);
  };

  await sweep('menu');
  await page.fill('#name-input', lang === 'ru' ? 'Жнец' : 'Reaper');
  await page.click('#play-btn');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });
  await sleep(3000);
  await sweep('hud');

  // every shop tab, including the hotbar and build toolbar behind it
  await page.keyboard.press('b');
  await page.waitForSelector('#shop:not(.hidden)', { timeout: 5000 });
  for (const tab of ['weapons', 'buildings', 'hats']) {
    await page.click(`.shop-tab[data-tab="${tab}"]`);
    await sleep(400);
    await sweep(`shop:${tab}`);
  }

  // the placement toolbar names the building being carried
  await page.click('.shop-tab[data-tab="buildings"]');
  await sleep(300);
  await page.click('#shop-buildings .shop-item[data-item="wall"] button');
  await sleep(500);
  await sweep('place-hint');
  await page.keyboard.press('Escape');
  await sleep(300);

  // demolition toolbar
  await page.keyboard.press('b');
  await page.click('.shop-tab[data-tab="buildings"]');
  await page.click('#demolish-btn');
  await sleep(500);
  await sweep('demolish-hint');
  await page.keyboard.press('Escape');

  // settings panel
  await page.click('#settings-btn');
  await sleep(900);
  await sweep('settings');
  await page.click('#settings-btn');

  check(`${lang}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' / '));
  check(`${lang}: every visible label is in ${lang}`, found.length === 0, found.slice(0, 6).join('\n     '));
  await ctx.close();
}

await run('ru');
await run('en');

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

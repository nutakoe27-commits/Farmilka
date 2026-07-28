// Rasterises the marketing SVGs to PNG at their native size, using the
// Chromium that Playwright already ships (no ImageMagick/librsvg needed).
//
//   node marketing/render-svg.mjs                  # every *.svg in this folder
//   node marketing/render-svg.mjs cover-square.svg # or just the named ones

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const DIR = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const files = args.length ? args.map((a) => basename(a)) : readdirSync(DIR).filter((f) => f.endsWith('.svg'));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
for (const file of files) {
  const src = readFileSync(join(DIR, file), 'utf8');
  const [, w, h] = src.match(/viewBox="0 0 (\d+) (\d+)"/) ?? [];
  if (!w) {
    console.warn('skip (no viewBox):', file);
    continue;
  }
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
  // wrapped in a document rather than opened directly: a bare SVG has no <head>
  // to style, and the default page margin would offset the render
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#05060a}svg{display:block}</style>${src}`,
    { waitUntil: 'load' },
  );
  await page.evaluate(() => document.fonts.ready);
  const out = file.replace(/\.svg$/, '.png');
  await page.screenshot({ path: join(DIR, out), omitBackground: false });
  await page.close();
  console.log('rendered', out, `${w}x${h}`);
}
await browser.close();

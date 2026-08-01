// Yandex Games artwork: one icon and a cover per draft language.
//
//   node marketing/make-yandex-assets.mjs
//   node marketing/render-svg.mjs yandex-icon.svg yandex-cover-ru.svg yandex-cover-en.svg
//
// Three moderation rules shape this file:
//  * 8.3.3 — media must have no rounded corners and no frames, so the artwork
//    is full-bleed to the canvas edge and the logo mark is a plain square.
//  * 8.2.3 — every text that varies by language must match the draft it is
//    uploaded to, hence a Russian cover and an English one.
//  * 8.4.2 — no domain zones in any text: the old cover said ".io-битва".

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { C, DEFS, vault, farm, wall, coin, player, hammer, bow, burst, grid } from './art.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="'DejaVu Sans','Arial',sans-serif">
${DEFS}
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${grid(w, h, Math.round(w / 5), Math.round(h / 4))}
${body}
</svg>`;
}

/** Square logo mark — no rounded corners anywhere (8.3.3). */
const markSquare = (x, y, s) => `
  <g transform="translate(${x},${y}) scale(${s})">
    <rect x="-46" y="-46" width="92" height="92" fill="url(#mark)"/>
    <g stroke="#fff" stroke-width="11" stroke-linecap="round"><line x1="-22" y1="22" x2="20" y2="-20"/><line x1="22" y1="22" x2="-20" y2="-20"/></g>
    <circle cx="-22" cy="22" r="8" fill="#eaf6ee"/><circle cx="22" cy="22" r="8" fill="#eaf6ee"/>
  </g>`;

const TITLE = (x, y, size, anchor = 'middle') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="800" letter-spacing="1">` +
  `<tspan fill="#f2f5f8">Farm</tspan><tspan fill="#2ee06a">Clash</tspan></text>`;

const line = (x, y, size, fill, weight, text, anchor = 'middle') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${fill}">${text}</text>`;

// ---------- icon: 512x512, full bleed, no rounding ----------
const icon = svg(512, 512, `
  <circle cx="200" cy="215" r="230" fill="#1f9c4b" opacity="0.26" filter="url(#soft)"/>
  <circle cx="380" cy="300" r="190" fill="#e0574f" opacity="0.20" filter="url(#soft)"/>
  ${vault(256, 250, 108)}
  ${coin(96, 120, 34)}
  ${coin(420, 132, 26)}
  ${coin(120, 402, 28)}
  ${wall(430, 386, 52)}
  ${markSquare(256, 250, 1.35)}
`);

// ---------- covers: 800x470, one per draft language ----------
function cover(strings) {
  return svg(800, 470, `
  <circle cx="150" cy="180" r="230" fill="#1f9c4b" opacity="0.24" filter="url(#soft)"/>
  <circle cx="690" cy="190" r="200" fill="#e0574f" opacity="0.22" filter="url(#soft)"/>
  ${farm(96, 96, 40, 0.85)}
  ${vault(238, 168, 54)}
  ${player(148, 190, 30, C.defender, 10, bow)}
  ${[-1, 0, 1].map((i) => wall(392, 168 + i * 74, 36, i === 0 ? 0.75 : 0)).join('')}
  ${burst(348, 168, 54)}
  ${player(560, 168, 36, C.raider, 180, hammer)}
  ${coin(300, 268, 20)}
  ${coin(452, 262, 16)}
  ${TITLE(400, 372, 74)}
  ${line(400, 412, 25, '#c7cedb', 700, strings.tagline)}
  ${line(400, 444, 20, '#8a93a5', 600, strings.sub)}
`);
}

const out = [
  ['yandex-icon.svg', icon],
  ['yandex-cover-ru.svg', cover({
    tagline: 'Строй ферму. Грабь чужие.',
    sub: 'Фарми золото · Обноси стеной · Взламывай базы',
  })],
  ['yandex-cover-en.svg', cover({
    tagline: 'Build your farm. Raid theirs.',
    sub: 'Farm gold · Wall it in · Break into the rest',
  })],
];
for (const [name, content] of out) {
  writeFileSync(join(DIR, name), content);
  console.log('wrote', name);
}

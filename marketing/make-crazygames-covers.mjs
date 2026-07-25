// Generates the three CrazyGames cover orientations (landscape / portrait /
// square) from one design, in English. Everything is vector, so re-rendering
// at whatever exact pixel sizes the portal asks for is a one-line change.
//
//   node marketing/make-crazygames-covers.mjs
//
// Writes .svg next to this file; PNGs are rendered from them by the caller.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

const DEFS = `
  <defs>
    <radialGradient id="bg" cx="50%" cy="44%" r="80%">
      <stop offset="0%" stop-color="#141a23"/><stop offset="60%" stop-color="#0b0e14"/><stop offset="100%" stop-color="#05060a"/>
    </radialGradient>
    <linearGradient id="btn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#43e07a"/><stop offset="100%" stop-color="#1f9c4b"/></linearGradient>
    <radialGradient id="coin" cx="38%" cy="34%" r="72%"><stop offset="0%" stop-color="#ffe79a"/><stop offset="100%" stop-color="#e39a24"/></radialGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="soft" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="34"/></filter>
    <filter id="tg" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;

const slime = (x, y, s) => `
  <g transform="translate(${x},${y}) scale(${s})" filter="url(#glow)">
    <ellipse rx="160" ry="140" fill="#2fae55"/><ellipse cy="-34" rx="120" ry="86" fill="#7ff0a0" opacity="0.30"/>
    <circle cx="-52" cy="-6" r="30" fill="#fff"/><circle cx="-45" cy="-2" r="14" fill="#10151c"/>
    <circle cx="52" cy="-6" r="30" fill="#fff"/><circle cx="59" cy="-2" r="14" fill="#10151c"/>
    <path d="M-34 58 Q0 88 34 58" stroke="#10151c" stroke-width="9" fill="none" stroke-linecap="round"/>
  </g>`;

const boss = (x, y, s) => `
  <g transform="translate(${x},${y}) scale(${s})" filter="url(#glow)">
    <g fill="#b5327a"><path d="M0 -190 L34 -120 L-34 -120 Z"/><path d="M150 -70 L120 -20 L172 -8 Z"/><path d="M-150 -70 L-120 -20 L-172 -8 Z"/><path d="M0 190 L34 120 L-34 120 Z"/></g>
    <circle r="150" fill="#d1418c"/><ellipse cy="-40" rx="110" ry="70" fill="#ff8fca" opacity="0.28"/>
    <path d="M-70 -34 L-18 -6" stroke="#2a0a1c" stroke-width="14" stroke-linecap="round"/><path d="M70 -34 L18 -6" stroke="#2a0a1c" stroke-width="14" stroke-linecap="round"/>
    <circle cx="-44" cy="6" r="16" fill="#2a0a1c"/><circle cx="44" cy="6" r="16" fill="#2a0a1c"/>
    <path d="M-40 66 Q0 40 40 66" stroke="#2a0a1c" stroke-width="12" fill="none" stroke-linecap="round"/>
  </g>`;

const coin = (x, y, r) => `
  <g filter="url(#glow)"><g transform="translate(${x},${y})">
    <circle r="${r}" fill="url(#coin)"/><circle r="${r / 2}" fill="none" stroke="#c9821c" stroke-width="${r / 5}"/>
  </g></g>`;

/** The crossed-swords mark used as the game's logo. */
const mark = (x, y, s) => `
  <g transform="translate(${x},${y}) scale(${s})">
    <rect x="-44" y="-44" width="88" height="88" rx="22" fill="url(#btn)" filter="url(#glow)"/>
    <g stroke="#fff" stroke-width="11" stroke-linecap="round"><line x1="-22" y1="22" x2="20" y2="-20"/><line x1="22" y1="22" x2="-20" y2="-20"/></g>
    <circle cx="-22" cy="22" r="8" fill="#eaf6ee"/><circle cx="22" cy="22" r="8" fill="#eaf6ee"/>
  </g>`;

const grid = (w, h, stepX, stepY) => {
  const lines = [];
  for (let y = stepY; y < h; y += stepY) lines.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}"/>`);
  for (let x = stepX; x < w; x += stepX) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}"/>`);
  return `<g stroke="#9ecbff" stroke-opacity="0.05" stroke-width="1">${lines.join('')}</g>`;
};

const TITLE = (x, y, size) =>
  `<g filter="url(#tg)"><text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="800" letter-spacing="1">` +
  `<tspan fill="#f2f5f8">Farm</tspan><tspan fill="#2ee06a">Clash</tspan></text></g>`;

const sub = (x, y, size, fill, weight, text) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${fill}">${text}</text>`;

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="'DejaVu Sans','Arial',sans-serif">
${DEFS}
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${grid(w, h, Math.round(w / 5), Math.round(h / 4))}
${body}
</svg>`;
}

// ---- landscape 16:9 ----
const landscape = svg(1920, 1080, `
  <circle cx="260" cy="250" r="300" fill="#1f9c4b" opacity="0.26" filter="url(#soft)"/>
  <circle cx="1680" cy="280" r="320" fill="#8a5cf6" opacity="0.20" filter="url(#soft)"/>
  ${slime(250, 260, 1.15)}
  ${boss(1690, 270, 1.0)}
  ${coin(230, 900, 62)}
  ${coin(1700, 910, 54)}
  ${mark(960, 300, 2.1)}
  ${TITLE(960, 640, 190)}
  ${sub(960, 745, 58, '#c7cedb', 700, 'Multiplayer .io battle arena')}
  ${sub(960, 830, 46, '#8a93a5', 600, 'Farm · Level up · Slay bosses and players')}
`);

// ---- portrait 9:16 ----
const portrait = svg(1080, 1920, `
  <circle cx="180" cy="420" r="320" fill="#1f9c4b" opacity="0.26" filter="url(#soft)"/>
  <circle cx="900" cy="1500" r="340" fill="#8a5cf6" opacity="0.20" filter="url(#soft)"/>
  ${slime(250, 430, 1.05)}
  ${boss(830, 1520, 0.95)}
  ${coin(880, 430, 52)}
  ${coin(210, 1520, 58)}
  ${mark(540, 800, 2.4)}
  ${TITLE(540, 1120, 150)}
  ${sub(540, 1215, 50, '#c7cedb', 700, 'Multiplayer .io battle arena')}
  ${sub(540, 1290, 40, '#8a93a5', 600, 'Farm · Level up · Slay bosses')}
`);

// ---- square 1:1 ----
const square = svg(1080, 1080, `
  <circle cx="180" cy="220" r="300" fill="#1f9c4b" opacity="0.26" filter="url(#soft)"/>
  <circle cx="900" cy="240" r="300" fill="#8a5cf6" opacity="0.20" filter="url(#soft)"/>
  ${slime(190, 230, 0.85)}
  ${boss(900, 235, 0.72)}
  ${coin(190, 900, 52)}
  ${coin(900, 905, 46)}
  ${mark(540, 470, 2.0)}
  ${TITLE(540, 730, 132)}
  ${sub(540, 820, 44, '#c7cedb', 700, 'Multiplayer .io battle arena')}
  ${sub(540, 890, 36, '#8a93a5', 600, 'Farm · Level up · Slay bosses')}
`);

const out = [
  ['crazygames-cover-landscape.svg', landscape],
  ['crazygames-cover-portrait.svg', portrait],
  ['crazygames-cover-square.svg', square],
];
for (const [name, content] of out) {
  writeFileSync(join(DIR, name), content);
  console.log('wrote', name);
}

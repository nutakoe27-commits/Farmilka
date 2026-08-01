// Shared vector pieces for the store artwork. Both the CrazyGames covers and
// the Yandex icon/covers draw from here so the two stores cannot drift into
// looking like different games.
//
// Shapes and colours are lifted from the game's own rendering
// (client/src/game/entities.ts): a cover should look like the first second of
// play, not like a different product.

// the game's palette
const C = {
  vault: '#c9a227',
  vaultTrim: '#ffd76e',
  farm: '#3f8f4a',
  wall: '#4a5060',
  wallTop: '#5b626f',
  ink: '#0d0f14',
  coin: '#ffd76e',
  raider: '#e0574f',
  defender: '#4fb0e8',
};

const DEFS = `
  <defs>
    <radialGradient id="bg" cx="42%" cy="40%" r="86%">
      <stop offset="0%" stop-color="#151b24"/><stop offset="58%" stop-color="#0b0e14"/><stop offset="100%" stop-color="#05060a"/>
    </radialGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#43e07a"/><stop offset="100%" stop-color="#1f9c4b"/></linearGradient>
    <radialGradient id="coin" cx="38%" cy="34%" r="72%"><stop offset="0%" stop-color="#ffe79a"/><stop offset="100%" stop-color="#e39a24"/></radialGradient>
    <radialGradient id="hot" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#fff3c4" stop-opacity="0.95"/><stop offset="100%" stop-color="#ff9d3c" stop-opacity="0"/></radialGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="soft" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="38"/></filter>
    <filter id="tg" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;

/** A building, drawn exactly the way the game draws one: rounded square + inner rim. */
const box = (x, y, r, fill, inner = '') => `
  <g transform="translate(${x},${y})">
    <rect x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" rx="${r * 0.2}" fill="${fill}" stroke="${C.ink}" stroke-width="${r * 0.08}"/>
    <rect x="${-r + r * 0.16}" y="${-r + r * 0.16}" width="${r * 1.68}" height="${r * 1.68}" rx="${r * 0.15}" fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="${r * 0.05}"/>
    ${inner}
  </g>`;

/** The vault: gold trim, a deposit slot and the coin stack behind it. */
const vault = (x, y, r) => box(x, y, r, C.vault, `
    <rect x="${-r + r * 0.09}" y="${-r + r * 0.09}" width="${r * 1.82}" height="${r * 1.82}" rx="${r * 0.16}" fill="none" stroke="${C.vaultTrim}" stroke-width="${r * 0.09}" opacity="0.95"/>
    <rect x="${-r * 0.3}" y="${-r * 0.74}" width="${r * 0.6}" height="${r * 0.15}" rx="${r * 0.07}" fill="#2a2410"/>
    <g fill="#2a2410">
      <ellipse cy="${r * 0.34}" rx="${r * 0.52}" ry="${r * 0.15}"/>
      <ellipse cy="${r * 0.06}" rx="${r * 0.46}" ry="${r * 0.14}"/>
      <ellipse cy="${-r * 0.2}" rx="${r * 0.34}" ry="${r * 0.12}"/>
    </g>
    <g fill="${C.vaultTrim}" opacity="0.75">
      <ellipse cy="${r * 0.3}" rx="${r * 0.52}" ry="${r * 0.15}"/>
      <ellipse cy="${r * 0.02}" rx="${r * 0.46}" ry="${r * 0.14}"/>
      <ellipse cy="${-r * 0.24}" rx="${r * 0.34}" ry="${r * 0.12}"/>
    </g>`);

/** A farm: ears of wheat over the silo bar the game draws when it is loaded. */
const farm = (x, y, r, fill = 0.8) => {
  const ear = (dx, rot) => `<g transform="translate(${dx},0) rotate(${rot})">
      <line x1="0" y1="${r * 0.5}" x2="0" y2="${-r * 0.34}" stroke="#c8d977" stroke-width="${r * 0.08}" stroke-linecap="round"/>
      ${[0, 1, 2].map((i) => {
        const yy = -r * 0.34 + i * r * 0.19;
        return `<ellipse cx="${-r * 0.14}" cy="${yy}" rx="${r * 0.13}" ry="${r * 0.08}" fill="#e8e08a" transform="rotate(-30 ${-r * 0.14} ${yy})"/>` +
               `<ellipse cx="${r * 0.14}" cy="${yy}" rx="${r * 0.13}" ry="${r * 0.08}" fill="#e8e08a" transform="rotate(30 ${r * 0.14} ${yy})"/>`;
      }).join('')}
      <ellipse cy="${-r * 0.46}" rx="${r * 0.1}" ry="${r * 0.15}" fill="#f2eca4"/>
    </g>`;
  return box(x, y, r, C.farm, `
    ${ear(-r * 0.34, -14)}${ear(r * 0.34, 14)}${ear(0, 0)}
    <rect x="${-r * 0.9}" y="${r * 1.18}" width="${r * 1.8}" height="${r * 0.22}" rx="${r * 0.11}" fill="#1b1f27"/>
    <rect x="${-r * 0.9}" y="${r * 1.18}" width="${r * 1.8 * fill}" height="${r * 0.22}" rx="${r * 0.11}" fill="${C.coin}"/>`);
};

/** A wall block: brick seams read as fortification even at thumbnail size. */
const wall = (x, y, r, damage = 0) => box(x, y, r, C.wall, `
    <g stroke="#2b3038" stroke-width="${r * 0.09}" stroke-linecap="round">
      <line x1="${-r * 0.74}" y1="${-r * 0.3}" x2="${r * 0.74}" y2="${-r * 0.3}"/>
      <line x1="${-r * 0.74}" y1="${r * 0.3}" x2="${r * 0.74}" y2="${r * 0.3}"/>
      <line x1="0" y1="${-r * 0.74}" x2="0" y2="${-r * 0.3}"/>
      <line x1="${-r * 0.37}" y1="${-r * 0.3}" x2="${-r * 0.37}" y2="${r * 0.3}"/>
      <line x1="${r * 0.37}" y1="${-r * 0.3}" x2="${r * 0.37}" y2="${r * 0.3}"/>
      <line x1="0" y1="${r * 0.3}" x2="0" y2="${r * 0.74}"/>
    </g>
    ${damage > 0.4 ? `<g stroke="#12151b" stroke-width="${r * 0.11}" stroke-linecap="round" fill="none">
      <path d="M${-r * 0.9} ${-r * 0.1} l ${r * 0.34} ${r * 0.2} l ${-r * 0.2} ${r * 0.3} l ${r * 0.5} ${r * 0.24}"/>
      <path d="M${-r * 0.2} ${-r * 0.9} l ${r * 0.16} ${r * 0.4} l ${r * 0.34} ${r * 0.12}"/>
    </g>` : ''}
    <rect x="${-r * 0.9}" y="${-r * 1.4}" width="${r * 1.8}" height="${r * 0.2}" rx="${r * 0.1}" fill="#1b1f27"/>
    <rect x="${-r * 0.9}" y="${-r * 1.4}" width="${r * 1.8 * (1 - damage)}" height="${r * 0.2}" rx="${r * 0.1}" fill="${damage > 0.4 ? '#e0574f' : '#43e07a'}"/>`);

const coin = (x, y, r) => `
  <g filter="url(#glow)" transform="translate(${x},${y})">
    <circle r="${r}" fill="url(#coin)"/><circle r="${r / 2}" fill="none" stroke="#c9821c" stroke-width="${r / 5}"/>
  </g>`;

/**
 * A player: the game draws them as a glowing disc with a weapon held out at the
 * aim angle. `swing` rotates the weapon so the raider reads as mid-strike.
 */
const player = (x, y, r, color, angle, weapon) => `
  <g transform="translate(${x},${y})" filter="url(#glow)">
    <circle r="${r * 1.6}" fill="${color}" opacity="0.18"/>
    <circle r="${r}" fill="${color}" stroke="${C.ink}" stroke-width="${r * 0.14}"/>
    <ellipse cy="${-r * 0.3}" rx="${r * 0.62}" ry="${r * 0.4}" fill="#ffffff" opacity="0.22"/>
    <g transform="rotate(${angle})">${weapon(r)}</g>
  </g>`;

const hammer = (r) => `
  <g transform="translate(${r * 0.5},0)">
    <rect x="0" y="${-r * 0.14}" width="${r * 1.5}" height="${r * 0.28}" rx="${r * 0.1}" fill="#8a6a4a" stroke="${C.ink}" stroke-width="${r * 0.07}"/>
    <rect x="${r * 1.12}" y="${-r * 0.78}" width="${r * 0.86}" height="${r * 1.56}" rx="${r * 0.16}" fill="#b9c2d0" stroke="${C.ink}" stroke-width="${r * 0.1}"/>
    <rect x="${r * 1.26}" y="${-r * 0.6}" width="${r * 0.24}" height="${r * 1.2}" rx="${r * 0.1}" fill="#ffffff" opacity="0.28"/>
  </g>`;

const bow = (r) => `
  <g transform="translate(${r * 0.7},0)">
    <path d="M0 ${-r * 0.85} q ${r * 0.75} ${r * 0.85} 0 ${r * 1.7}" fill="none" stroke="#c98a3c" stroke-width="${r * 0.17}" stroke-linecap="round"/>
    <line x1="0" y1="${-r * 0.85}" x2="0" y2="${r * 0.85}" stroke="#e6e9ef" stroke-width="${r * 0.06}"/>
    <line x1="${-r * 0.1}" y1="0" x2="${r * 1.5}" y2="0" stroke="#ffe6a8" stroke-width="${r * 0.1}" stroke-linecap="round"/>
  </g>`;

/** Impact burst where the hammer meets the wall. */
const burst = (x, y, r) => `
  <g transform="translate(${x},${y})">
    <circle r="${r * 1.5}" fill="url(#hot)"/>
    <g stroke="#ffe08a" stroke-width="${r * 0.16}" stroke-linecap="round" filter="url(#glow)">
      ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const rad = (a * Math.PI) / 180;
        const i = r * 0.45, o = r * (a % 90 === 0 ? 1.05 : 0.8);
        return `<line x1="${Math.cos(rad) * i}" y1="${Math.sin(rad) * i}" x2="${Math.cos(rad) * o}" y2="${Math.sin(rad) * o}"/>`;
      }).join('')}
    </g>
  </g>`;

/** The crossed-swords mark used as the game's logo. */
const logo = (x, y, s) => `
  <g transform="translate(${x},${y}) scale(${s})">
    <rect x="-44" y="-44" width="88" height="88" rx="22" fill="url(#mark)" filter="url(#glow)"/>
    <g stroke="#fff" stroke-width="11" stroke-linecap="round"><line x1="-22" y1="22" x2="20" y2="-20"/><line x1="22" y1="22" x2="-20" y2="-20"/></g>
    <circle cx="-22" cy="22" r="8" fill="#eaf6ee"/><circle cx="22" cy="22" r="8" fill="#eaf6ee"/>
  </g>`;

const grid = (w, h, stepX, stepY) => {
  const lines = [];
  for (let y = stepY; y < h; y += stepY) lines.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}"/>`);
  for (let x = stepX; x < w; x += stepX) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}"/>`);
  return `<g stroke="#9ecbff" stroke-opacity="0.05" stroke-width="1">${lines.join('')}</g>`;
};


export { C, DEFS, box, vault, farm, wall, coin, player, hammer, bow, burst, logo, grid };

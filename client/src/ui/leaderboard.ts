import type { LeaderEntry } from '@shared/protocol.js';
import { prestigeTier, type PrestigeCfg } from '@shared/prestige.js';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmt(n: number): string {
  return n.toLocaleString('ru-RU');
}
const MEDAL = ['🥇', '🥈', '🥉'];

/** Live server leaderboard (top players by net worth). */
export class Leaderboard {
  constructor(private prestigeCfg: PrestigeCfg) {}

  update(top: LeaderEntry[], rank: number, total: number): void {
    const rows = top.map((e, i) => {
      const tier = e.prestige > 0 ? prestigeTier(e.prestige, this.prestigeCfg) : null;
      const badge = e.prestige > 0 ? `<span class="lb-badge" style="color:${tier ? tier.color : '#d88bff'}">✦${e.prestige}</span> ` : '';
      const mine = i + 1 === rank ? ' lb-me' : '';
      const pos = MEDAL[i] ?? `${i + 1}`;
      return `<div class="lb-row${mine}"><span class="lb-pos">${pos}</span><span class="lb-name">${badge}${esc(e.name)}</span><span class="lb-money">${fmt(e.money)}</span></div>`;
    }).join('');
    const you = rank > top.length ? `<div class="lb-you">Ты: #${rank} из ${total}</div>` : '';
    $('leaderboard').innerHTML = `<div class="lb-title">🏆 Топ сервера</div>${rows}${you}`;
    $('leaderboard').classList.remove('hidden');
  }
}

import { Router } from 'express';
import { getDb } from '../db/db.js';
import { reloadBalance } from '../game/balance.js';
import { WEAPON_IDS } from '@shared/balance-schema.js';
import type { World } from '../game/world.js';

function esc(v: unknown): string {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function table(title: string, headers: string[], rows: (string | number)[][], rawHtml = false): string {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.length
    ? rows.map((r) => `<tr>${r.map((c) => `<td>${rawHtml ? c : esc(c)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}" class="empty">нет данных</td></tr>`;
  return `<section><h2>${esc(title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fmtDur(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
}

const STYLE = `<style>
body{font-family:system-ui,sans-serif;background:#12141a;color:#e8e8ef;max-width:1100px;margin:24px auto;padding:0 16px}
h1{font-size:22px} h2{font-size:16px;margin:24px 0 8px;color:#9ecbff}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #2a2e3a;padding:5px 10px;text-align:left}
th{background:#1b1f2a} tr:nth-child(even){background:#171a22} .empty{color:#666;text-align:center}
.note{color:#8a8fa3;font-size:12px} a{color:#9ecbff} .tag{font-size:11px;padding:1px 6px;border-radius:6px;background:#1f6feb;color:#fff}
.tag.guest{background:#30363d}
</style>`;

function playerLink(name: string, token: string): string {
  return `<a href="/admin/player?token=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}">${esc(name)}</a>`;
}

const PLAYER_WEAPONS: string[] = WEAPON_IDS;

export function adminRouter(worlds: World[]): Router {
  const router = Router();
  const token = process.env.ADMIN_TOKEN ?? 'dev';

  router.use((req, res, next) => {
    if ((req.query.token ?? req.headers['x-admin-token']) !== token) {
      res.status(403).send('Forbidden: pass ?token=ADMIN_TOKEN');
      return;
    }
    next();
  });

  router.post('/reload', (_req, res) => {
    res.json(reloadBalance());
  });

  // ---------- player profile ----------
  router.get('/player', (req, res) => {
    const db = getDb();
    const name = String(req.query.name ?? '');
    const now = Date.now();

    const acc = db.prepare('SELECT created_ts, last_seen_ts, money, weapons FROM accounts WHERE name = ? COLLATE NOCASE').get(name) as
      | { created_ts: number; last_seen_ts: number; money: number; weapons: string }
      | undefined;
    const sess = db.prepare('SELECT COUNT(*) n, SUM(COALESCE(left_ts, ?) - joined_ts) total, SUM(kills) kills, SUM(deaths) deaths, SUM(money_earned) earned FROM sessions WHERE player = ? COLLATE NOCASE').get(now, name) as { n: number; total: number | null; kills: number | null; deaths: number | null; earned: number | null };
    const online = worlds.some((w) => [...w.players.values()].some((p) => p.ws && p.name.toLowerCase() === name.toLowerCase()));

    const killsByWeapon = db.prepare(`SELECT weapon, COUNT(*) n FROM kills WHERE killer = ? COLLATE NOCASE GROUP BY weapon ORDER BY n DESC`).all(name) as { weapon: string; n: number }[];
    const killsByKind = db.prepare(`SELECT victim_kind, COUNT(*) n FROM kills WHERE killer = ? COLLATE NOCASE GROUP BY victim_kind`).all(name) as { victim_kind: string; n: number }[];
    const deathsByCause = db.prepare(`SELECT cause, COUNT(*) n FROM deaths WHERE player = ? COLLATE NOCASE GROUP BY cause ORDER BY n DESC`).all(name) as { cause: string; n: number }[];
    const incomeBySource = db.prepare(`SELECT source, SUM(amount) s FROM income WHERE player = ? COLLATE NOCASE GROUP BY source ORDER BY s DESC`).all(name) as { source: string; s: number }[];
    const purchases = db.prepare(`SELECT item, COUNT(*) n, SUM(price) total FROM purchases WHERE player = ? COLLATE NOCASE GROUP BY item ORDER BY n DESC`).all(name) as { item: string; n: number; total: number }[];
    const healsRow = db.prepare(`SELECT COUNT(*) n, SUM(amount) total FROM heals WHERE player = ? COLLATE NOCASE`).get(name) as { n: number; total: number | null };
    const lastSessions = db.prepare(`SELECT joined_ts, left_ts, kills, deaths, money_earned FROM sessions WHERE player = ? COLLATE NOCASE ORDER BY joined_ts DESC LIMIT 15`).all(name) as { joined_ts: number; left_ts: number | null; kills: number; deaths: number; money_earned: number }[];

    const kills = sess.kills ?? 0;
    const deaths = sess.deaths ?? 0;

    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(name)} — Farmilka</title>${STYLE}</head><body>
<p><a href="/admin/stats?token=${encodeURIComponent(token)}">← ко всей статистике</a></p>
<h1>Профиль: ${esc(name)} ${online ? '<span class="tag">онлайн</span>' : ''} ${acc ? '<span class="tag">аккаунт</span>' : '<span class="tag guest">гость</span>'}</h1>
${acc ? `<p class="note">Зарегистрирован: ${fmtDate(acc.created_ts)} · был в сети: ${fmtDate(acc.last_seen_ts)} · золото на счету: ${fmt(acc.money)} · оружие: ${esc(acc.weapons)}</p>` : '<p class="note">Играет без аккаунта (имя может использоваться разными людьми).</p>'}
${table('Сводка', ['Сессий', 'Время в игре', 'Убийств', 'Смертей', 'K/D', 'Заработано денег', 'Съедено еды', 'Отхилено HP'], [[
  sess.n, fmtDur(sess.total ?? 0), kills, deaths, fmt(deaths > 0 ? kills / deaths : kills), fmt(sess.earned ?? 0), healsRow.n, fmt(healsRow.total ?? 0),
]])}
${table('Убийства по оружию', ['Оружие', 'Убийств'], killsByWeapon.map((r) => [r.weapon, r.n]))}
${table('Убийства по типу жертв', ['Тип', 'Убийств'], killsByKind.map((r) => [r.victim_kind, r.n]))}
${table('Смерти по причинам', ['Причина', 'Смертей'], deathsByCause.map((r) => [r.cause, r.n]))}
${table('Доход по источникам', ['Источник', 'Всего'], incomeBySource.map((r) => [r.source, fmt(r.s)]))}
${table('Покупки', ['Предмет', 'Раз', 'Сумма'], purchases.map((r) => [r.item, r.n, fmt(r.total)]))}
${table('Последние сессии', ['Вход', 'Длительность', 'Убийств', 'Смертей', 'Заработано'], lastSessions.map((s) => [
  fmtDate(s.joined_ts), fmtDur((s.left_ts ?? now) - s.joined_ts), s.kills, s.deaths, fmt(s.money_earned),
]))}
</body></html>`;
    res.type('html').send(html);
  });

  // ---------- main dashboard ----------
  router.get('/stats', (req, res) => {
    const db = getDb();
    const hours = Math.max(1, Math.min(24 * 30, Number(req.query.hours) || 24));
    const since = Date.now() - hours * 3600_000;
    const now = Date.now();

    // --- live online (all game servers) ---
    const onlineRows: string[][] = [];
    let onlineTotal = 0;
    for (const w of worlds) {
      for (const p of w.connectedPlayers()) {
        onlineTotal++;
        onlineRows.push([
          String(w.serverId),
          playerLink(p.name, token),
          p.account ? '<span class="tag">аккаунт</span>' : '<span class="tag guest">гость</span>',
          fmt(p.money),
          String(p.session.kills),
          String(p.session.deaths),
          esc(p.equipped),
          esc(p.hat ?? '—'),
          String(p.buildingIds.size),
          esc(fmtDur(now - p.session.joinedAt)),
        ]);
      }
    }

    // --- totals ---
    const totalPlayers = (db.prepare('SELECT COUNT(DISTINCT player COLLATE NOCASE) n FROM sessions').get() as { n: number }).n;
    const totalAccounts = (db.prepare('SELECT COUNT(*) n FROM accounts').get() as { n: number }).n;
    const totalSessions = (db.prepare('SELECT COUNT(*) n FROM sessions').get() as { n: number }).n;
    const totalPlayMs = (db.prepare('SELECT SUM(COALESCE(left_ts, ?) - joined_ts) t FROM sessions').get(now) as { t: number | null }).t ?? 0;
    const newAccounts = (db.prepare('SELECT COUNT(*) n FROM accounts WHERE created_ts >= ?').get(since) as { n: number }).n;
    const periodPlayers = (db.prepare('SELECT COUNT(DISTINCT player COLLATE NOCASE) n FROM sessions WHERE joined_ts >= ?').get(since) as { n: number }).n;

    // --- weapon balance ---
    // Restrict to real player weapons: mobs/bosses/turrets record their own type
    // as the "weapon", which would otherwise pollute this table.
    const wIn = `(${PLAYER_WEAPONS.map(() => '?').join(',')})`;
    const pvpKills = db.prepare(`SELECT weapon, COUNT(*) n, AVG(distance) avgDist FROM kills WHERE victim_kind='player' AND weapon IN ${wIn} AND ts>=? GROUP BY weapon`).all(...PLAYER_WEAPONS, since) as { weapon: string; n: number; avgDist: number }[];
    const allKills = db.prepare(`SELECT weapon, COUNT(*) n FROM kills WHERE weapon IN ${wIn} AND ts>=? GROUP BY weapon`).all(...PLAYER_WEAPONS, since) as { weapon: string; n: number }[];
    const deathsEq = db.prepare(`SELECT equipped, COUNT(*) n FROM deaths WHERE equipped IN ${wIn} AND ts>=? GROUP BY equipped`).all(...PLAYER_WEAPONS, since) as { equipped: string; n: number }[];
    const dmg = db.prepare(`SELECT weapon, SUM(amount) total, COUNT(DISTINCT attacker) users FROM damage WHERE weapon IN ${wIn} AND ts>=? GROUP BY weapon`).all(...PLAYER_WEAPONS, since) as { weapon: string; total: number; users: number }[];

    const weaponSet = new Set<string>();
    for (const r of pvpKills) weaponSet.add(r.weapon);
    for (const r of allKills) weaponSet.add(r.weapon);
    for (const r of deathsEq) weaponSet.add(r.equipped);
    for (const r of dmg) weaponSet.add(r.weapon);
    const totalPvp = pvpKills.reduce((s, r) => s + r.n, 0) || 1;
    const weaponRows = [...weaponSet].sort().map((w) => {
      const pk = pvpKills.find((r) => r.weapon === w)?.n ?? 0;
      const ak = allKills.find((r) => r.weapon === w)?.n ?? 0;
      const de = deathsEq.find((r) => r.equipped === w)?.n ?? 0;
      const dm = dmg.find((r) => r.weapon === w);
      const kd = de > 0 ? pk / de : pk;
      return [w, ak, pk, `${fmt((pk / totalPvp) * 100)}%`, de, fmt(kd), fmt(dm?.total ?? 0), dm?.users ?? 0, fmt(pvpKills.find((r) => r.weapon === w)?.avgDist ?? 0)];
    });

    // --- income by source ---
    const playerMs = db.prepare(`SELECT SUM(COALESCE(left_ts, ?) - joined_ts) total FROM sessions WHERE joined_ts>=?`).get(now, since) as { total: number | null };
    const playerHours = Math.max((playerMs.total ?? 0) / 3600_000, 0.001);
    const income = db.prepare(`SELECT source, SUM(amount) total, COUNT(*) n FROM income WHERE ts>=? GROUP BY source ORDER BY total DESC`).all(since) as { source: string; total: number; n: number }[];
    const incomeRows = income.map((r) => [r.source, fmt(r.total), r.n, fmt(r.total / playerHours)]);

    // --- food/heals ---
    const healsAgg = db.prepare(`SELECT COUNT(*) n, SUM(amount) total, COUNT(DISTINCT player) players FROM heals WHERE ts>=?`).get(since) as { n: number; total: number | null; players: number };
    const topHealers = db.prepare(`SELECT player, COUNT(*) n, SUM(amount) total FROM heals WHERE ts>=? GROUP BY player ORDER BY n DESC LIMIT 8`).all(since) as { player: string; n: number; total: number }[];

    // --- boss ---
    const bossKills = db.prepare(`SELECT COUNT(*) n FROM kills WHERE victim_kind='boss' AND ts>=?`).get(since) as { n: number };
    const bossIncome = db.prepare(`SELECT COUNT(DISTINCT player) players, SUM(amount) total, COUNT(*) payouts FROM income WHERE source='boss' AND ts>=?`).get(since) as { players: number; total: number | null; payouts: number };
    const bossRows = [[bossKills.n, bossIncome.players ?? 0, bossIncome.payouts ?? 0, fmt(bossIncome.total ?? 0)]];

    // --- mob kills (PvE), kept separate from the weapon table ---
    // kills.victim holds the mob type, kills.weapon holds the killer's weapon
    const mobRows = (db.prepare(`SELECT victim AS mob, COUNT(*) n FROM kills WHERE victim_kind='mob' AND ts>=? GROUP BY victim ORDER BY n DESC`).all(since) as { mob: string; n: number }[]).map((r) => [r.mob, r.n]);

    // --- deaths by cause ---
    const deathRows = (db.prepare(`SELECT cause, COUNT(*) n, SUM(money_dropped) lost FROM deaths WHERE ts>=? GROUP BY cause ORDER BY n DESC`).all(since) as { cause: string; n: number; lost: number }[]).map((r) => [r.cause, r.n, fmt(r.lost)]);

    // --- purchases ---
    const purchaseRows = (db.prepare(`SELECT item, COUNT(*) n, SUM(price) total FROM purchases WHERE ts>=? GROUP BY item ORDER BY n DESC`).all(since) as { item: string; n: number; total: number }[]).map((r) => [r.item, r.n, fmt(r.total)]);

    // --- top players over the period ---
    const topPlayers = db.prepare(`SELECT player, SUM(kills) k, SUM(deaths) d, SUM(money_earned) e, SUM(COALESCE(left_ts, ?) - joined_ts) t FROM sessions WHERE joined_ts>=? GROUP BY player COLLATE NOCASE ORDER BY k DESC LIMIT 10`).all(now, since) as { player: string; k: number; d: number; e: number; t: number }[];
    const topRows = topPlayers.map((r) => [playerLink(r.player, token), String(r.k), String(r.d), fmt(r.k / Math.max(1, r.d)), fmt(r.e), esc(fmtDur(r.t))]);

    // --- session histogram ---
    const sessions = db.prepare(`SELECT COALESCE(left_ts, ?) - joined_ts dur FROM sessions WHERE joined_ts>=?`).all(now, since) as { dur: number }[];
    const buckets = [0, 0, 0, 0, 0];
    for (const s of sessions) {
      const m = s.dur / 60000;
      buckets[m < 5 ? 0 : m < 15 ? 1 : m < 30 ? 2 : m < 60 ? 3 : 4]++;
    }
    const sessionRows = [['< 5 мин', buckets[0]], ['5–15 мин', buckets[1]], ['15–30 мин', buckets[2]], ['30–60 мин', buckets[3]], ['> 60 мин', buckets[4]]];

    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Farmilka — статистика</title>${STYLE}</head><body>
<h1>Farmilka — статистика (период: ${hours} ч)</h1>
<p class="note">Период: <a href="?token=${esc(token)}&hours=1">1ч</a> · <a href="?token=${esc(token)}&hours=24">24ч</a> · <a href="?token=${esc(token)}&hours=168">неделя</a> · <a href="?token=${esc(token)}&hours=720">месяц</a>.
Кликните имя игрока — откроется его профиль.</p>
${table(`Сейчас онлайн: ${onlineTotal} (${worlds.map((w) => `сервер ${w.serverId}: ${w.connectedPlayers().length}`).join(' · ')})`, ['Срв', 'Игрок', 'Тип', 'Деньги', 'Убийств', 'Смертей', 'Оружие', 'Шляпа', 'Построек', 'В игре'], onlineRows, true)}
${table('Всего за всё время', ['Уникальных игроков', 'Зарегистрировано аккаунтов', 'Сессий', 'Суммарное время игры', `Новых аккаунтов за ${hours}ч`, `Игроков за ${hours}ч`], [[
  totalPlayers, totalAccounts, totalSessions, fmtDur(totalPlayMs), newAccounts, periodPlayers,
]])}
${table('Топ игроков за период', ['Игрок', 'Убийств', 'Смертей', 'K/D', 'Заработано', 'Время'], topRows, true)}
${table('Баланс оружия (только игроцкое оружие)', ['Оружие', 'Убийств всего', 'PvP-убийств', 'Доля PvP', 'Смертей с ним', 'K/D (PvP)', 'Урон', 'Игроков', 'Ср. дистанция'], weaponRows)}
${table('Убито мобов (PvE)', ['Моб', 'Убито'], mobRows)}
${table('Доход по источникам', ['Источник', 'Всего', 'Событий', 'Доход / игро-час'], incomeRows)}
${table('Еда (скилловый фактор)', ['Съедено', 'Отхилено HP', 'Игроков ело'], [[healsAgg.n, fmt(healsAgg.total ?? 0), healsAgg.players]])}
${table('Топ по еде', ['Игрок', 'Съедено', 'Отхилено'], topHealers.map((r) => [playerLink(r.player, token), String(r.n), fmt(r.total)]), true)}
${table('Боссы', ['Убито', 'Участников', 'Выплат', 'Роздано'], bossRows)}
${table('Смерти по причинам', ['Причина', 'Смертей', 'Потеряно денег'], deathRows)}
${table('Покупки', ['Предмет', 'Раз', 'Сумма'], purchaseRows)}
${table('Длина сессий', ['Длительность', 'Сессий'], sessionRows)}
<p class="note">Правка баланса: balance/balance.json на хосте — применяется на лету, или POST /admin/reload?token=…</p>
</body></html>`;
    res.type('html').send(html);
  });

  return router;
}

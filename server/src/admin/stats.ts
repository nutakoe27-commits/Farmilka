import { Router } from 'express';
import { getDb } from '../db/db.js';
import { reloadBalance } from '../game/balance.js';

function esc(v: unknown): string {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function table(title: string, headers: string[], rows: unknown[][]): string {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.length
    ? rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}" class="empty">нет данных</td></tr>`;
  return `<section><h2>${esc(title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function adminRouter(): Router {
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

  router.get('/stats', (req, res) => {
    const db = getDb();
    const hours = Math.max(1, Math.min(24 * 30, Number(req.query.hours) || 24));
    const since = Date.now() - hours * 3600_000;

    // --- weapon balance ---
    const pvpKills = db.prepare(`SELECT weapon, COUNT(*) n, AVG(distance) avgDist FROM kills WHERE victim_kind='player' AND ts>=? GROUP BY weapon`).all(since) as { weapon: string; n: number; avgDist: number }[];
    const allKills = db.prepare(`SELECT weapon, COUNT(*) n FROM kills WHERE ts>=? GROUP BY weapon`).all(since) as { weapon: string; n: number }[];
    const deathsEq = db.prepare(`SELECT equipped, COUNT(*) n FROM deaths WHERE ts>=? GROUP BY equipped`).all(since) as { equipped: string; n: number }[];
    const dmg = db.prepare(`SELECT weapon, SUM(amount) total, COUNT(DISTINCT attacker) users FROM damage WHERE ts>=? GROUP BY weapon`).all(since) as { weapon: string; total: number; users: number }[];

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
    const playerMs = db.prepare(`SELECT SUM(COALESCE(left_ts, ?) - joined_ts) total FROM sessions WHERE joined_ts>=?`).get(Date.now(), since) as { total: number | null };
    const playerHours = Math.max((playerMs.total ?? 0) / 3600_000, 0.001);
    const income = db.prepare(`SELECT source, SUM(amount) total, COUNT(*) n FROM income WHERE ts>=? GROUP BY source ORDER BY total DESC`).all(since) as { source: string; total: number; n: number }[];
    const incomeRows = income.map((r) => [r.source, fmt(r.total), r.n, fmt(r.total / playerHours)]);

    // --- boss ---
    const bossKills = db.prepare(`SELECT COUNT(*) n FROM kills WHERE victim_kind='boss' AND ts>=?`).get(since) as { n: number };
    const bossIncome = db.prepare(`SELECT COUNT(DISTINCT player) players, SUM(amount) total, COUNT(*) payouts FROM income WHERE source='boss' AND ts>=?`).get(since) as { players: number; total: number | null; payouts: number };
    const bossRows = [[bossKills.n, bossIncome.players ?? 0, bossIncome.payouts ?? 0, fmt(bossIncome.total ?? 0)]];

    // --- deaths by cause ---
    const deathRows = (db.prepare(`SELECT cause, COUNT(*) n, SUM(money_dropped) lost FROM deaths WHERE ts>=? GROUP BY cause ORDER BY n DESC`).all(since) as { cause: string; n: number; lost: number }[]).map((r) => [r.cause, r.n, fmt(r.lost)]);

    // --- purchases ---
    const purchaseRows = (db.prepare(`SELECT item, COUNT(*) n, SUM(price) total FROM purchases WHERE ts>=? GROUP BY item ORDER BY n DESC`).all(since) as { item: string; n: number; total: number }[]).map((r) => [r.item, r.n, fmt(r.total)]);

    // --- session histogram ---
    const sessions = db.prepare(`SELECT COALESCE(left_ts, ?) - joined_ts dur FROM sessions WHERE joined_ts>=?`).all(Date.now(), since) as { dur: number }[];
    const buckets = [0, 0, 0, 0, 0];
    for (const s of sessions) {
      const m = s.dur / 60000;
      buckets[m < 5 ? 0 : m < 15 ? 1 : m < 30 ? 2 : m < 60 ? 3 : 4]++;
    }
    const sessionRows = [['< 5 мин', buckets[0]], ['5–15 мин', buckets[1]], ['15–30 мин', buckets[2]], ['30–60 мин', buckets[3]], ['> 60 мин', buckets[4]]];

    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Farmilka — баланс</title>
<style>
body{font-family:system-ui,sans-serif;background:#12141a;color:#e8e8ef;max-width:1100px;margin:24px auto;padding:0 16px}
h1{font-size:22px} h2{font-size:16px;margin:24px 0 8px;color:#9ecbff}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #2a2e3a;padding:5px 10px;text-align:left}
th{background:#1b1f2a} tr:nth-child(even){background:#171a22} .empty{color:#666;text-align:center}
.note{color:#8a8fa3;font-size:12px} a{color:#9ecbff}
</style></head><body>
<h1>Farmilka — статистика баланса (за ${hours} ч)</h1>
<p class="note">Период: <a href="?token=${esc(token)}&hours=1">1ч</a> · <a href="?token=${esc(token)}&hours=24">24ч</a> · <a href="?token=${esc(token)}&hours=168">неделя</a>.
Игро-часов за период: ${fmt(playerHours)}. Выбросы K/D — кандидаты на нерф/бафф.</p>
${table('Баланс оружия', ['Оружие', 'Убийств всего', 'PvP-убийств', 'Доля PvP-убийств', 'Смертей с ним в руках', 'K/D (PvP)', 'Урон всего', 'Игроков использовало', 'Ср. дистанция убийства'], weaponRows)}
${table('Доход по источникам', ['Источник', 'Всего', 'Событий', 'Доход / игро-час'], incomeRows)}
${table('Боссы', ['Убито боссов', 'Участников (получили награду)', 'Выплат', 'Роздано денег'], bossRows)}
${table('Смерти по причинам', ['Причина', 'Смертей', 'Потеряно денег'], deathRows)}
${table('Покупки', ['Предмет', 'Куплено', 'Потрачено'], purchaseRows)}
${table('Длина сессий', ['Длительность', 'Сессий'], sessionRows)}
<p class="note">Горячая правка баланса: отредактируйте balance/balance.json — применится автоматически, или POST /admin/reload?token=…</p>
</body></html>`;
    res.type('html').send(html);
  });

  return router;
}

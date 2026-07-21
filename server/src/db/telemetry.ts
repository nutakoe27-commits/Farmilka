import type { IncomeSource, DeathCause } from '@shared/types.js';
import { getDb } from './db.js';

interface KillRow { ts: number; killer: string; victim: string; weapon: string; distance: number; victimKind: string }
interface DamageRow { ts: number; attacker: string; weapon: string; amount: number; targetKind: string }
interface IncomeRow { ts: number; player: string; source: IncomeSource; amount: number }
interface PurchaseRow { ts: number; player: string; item: string; price: number }
interface DeathRow { ts: number; player: string; cause: DeathCause; weapon: string; equipped: string; moneyDropped: number }

interface HealRow { ts: number; player: string; amount: number }

const kills: KillRow[] = [];
const damages: DamageRow[] = [];
const incomes: IncomeRow[] = [];
const purchases: PurchaseRow[] = [];
const deaths: DeathRow[] = [];
const heals: HealRow[] = [];

// damage rows are aggregated per (attacker, weapon, targetKind) between flushes
const damageAgg = new Map<string, DamageRow>();

export const telemetry = {
  kill(killer: string, victim: string, weapon: string, distance: number, victimKind: string): void {
    kills.push({ ts: Date.now(), killer, victim, weapon, distance, victimKind });
  },
  damage(attacker: string, weapon: string, amount: number, targetKind: string): void {
    const key = `${attacker}|${weapon}|${targetKind}`;
    const row = damageAgg.get(key);
    if (row) row.amount += amount;
    else damageAgg.set(key, { ts: Date.now(), attacker, weapon, amount, targetKind });
  },
  income(player: string, source: IncomeSource, amount: number): void {
    incomes.push({ ts: Date.now(), player, source, amount });
  },
  purchase(player: string, item: string, price: number): void {
    purchases.push({ ts: Date.now(), player, item, price });
  },
  death(player: string, cause: DeathCause, weapon: string, equipped: string, moneyDropped: number): void {
    deaths.push({ ts: Date.now(), player, cause, weapon, equipped, moneyDropped });
  },
  heal(player: string, amount: number): void {
    heals.push({ ts: Date.now(), player, amount });
  },
  sessionStart(player: string): number {
    const res = getDb()
      .prepare('INSERT INTO sessions (player, joined_ts) VALUES (?, ?)')
      .run(player, Date.now());
    return Number(res.lastInsertRowid);
  },
  sessionEnd(sessionId: number, kills: number, deaths: number, moneyEarned: number): void {
    getDb()
      .prepare('UPDATE sessions SET left_ts = ?, kills = ?, deaths = ?, money_earned = ? WHERE id = ?')
      .run(Date.now(), kills, deaths, moneyEarned, sessionId);
  },
};

export function startTelemetryFlusher(): void {
  const db = getDb();
  const insKill = db.prepare('INSERT INTO kills (ts, killer, victim, weapon, distance, victim_kind) VALUES (?,?,?,?,?,?)');
  const insDamage = db.prepare('INSERT INTO damage (ts, attacker, weapon, amount, target_kind) VALUES (?,?,?,?,?)');
  const insIncome = db.prepare('INSERT INTO income (ts, player, source, amount) VALUES (?,?,?,?)');
  const insPurchase = db.prepare('INSERT INTO purchases (ts, player, item, price) VALUES (?,?,?,?)');
  const insDeath = db.prepare('INSERT INTO deaths (ts, player, cause, weapon, equipped, money_dropped) VALUES (?,?,?,?,?,?)');
  const insHeal = db.prepare('INSERT INTO heals (ts, player, amount) VALUES (?,?,?)');

  const flush = db.transaction(() => {
    for (const r of kills) insKill.run(r.ts, r.killer, r.victim, r.weapon, Math.round(r.distance), r.victimKind);
    for (const r of damageAgg.values()) insDamage.run(r.ts, r.attacker, r.weapon, r.amount, r.targetKind);
    for (const r of incomes) insIncome.run(r.ts, r.player, r.source, r.amount);
    for (const r of purchases) insPurchase.run(r.ts, r.player, r.item, r.price);
    for (const r of deaths) insDeath.run(r.ts, r.player, r.cause, r.weapon, r.equipped, r.moneyDropped);
    for (const r of heals) insHeal.run(r.ts, r.player, r.amount);
    kills.length = 0;
    damageAgg.clear();
    incomes.length = 0;
    purchases.length = 0;
    deaths.length = 0;
    heals.length = 0;
  });

  setInterval(() => {
    try {
      if (kills.length || damageAgg.size || incomes.length || purchases.length || deaths.length || heals.length) flush();
    } catch (err) {
      console.error('[telemetry] flush failed', err);
    }
  }, 1000);
}

import crypto from 'node:crypto';
import type { WeaponId } from '@shared/types.js';
import { getDb } from './db.js';
import { tr, type Lang } from '../game/i18n.js';

export interface Account {
  name: string;
  money: number;
  weapons: WeaponId[];
  hats: string[];
  hat: string | null;
  prestige: number;
  /** per-life character level, persisted across logout (reset only on death) */
  level: number;
  /** carried food, persisted across logout (reset only on death) */
  food: number;
  createdTs: number;
}

function hash(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

/** Case-insensitive lookup: is this name taken by a registered account? */
export function accountExists(name: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM accounts WHERE name = ? COLLATE NOCASE').get(name);
}

export function register(name: string, password: string, startMoney = 0, lang: Lang = 'ru'): { ok: boolean; reason?: string; account?: Account } {
  if (password.length < 4) return { ok: false, reason: tr(lang, 'passShort') };
  if (accountExists(name)) return { ok: false, reason: tr(lang, 'nameTaken') };
  const salt = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  getDb()
    .prepare('INSERT INTO accounts (name, pass_hash, salt, money, weapons, created_ts, last_seen_ts) VALUES (?,?,?,?,?,?,?)')
    .run(name, hash(password, salt), salt, startMoney, JSON.stringify(['fists']), now, now);
  return { ok: true, account: { name, money: startMoney, weapons: ['fists'], hats: [], hat: null, prestige: 0, level: 1, food: 0, createdTs: now } };
}

export function login(name: string, password: string, lang: Lang = 'ru'): { ok: boolean; reason?: string; account?: Account } {
  const row = getDb()
    .prepare('SELECT name, pass_hash, salt, money, weapons, hats, hat, prestige, level, food, created_ts FROM accounts WHERE name = ? COLLATE NOCASE')
    .get(name) as { name: string; pass_hash: string; salt: string; money: number; weapons: string; hats: string | null; hat: string | null; prestige: number | null; level: number | null; food: number | null; created_ts: number } | undefined;
  if (!row) return { ok: false, reason: tr(lang, 'accountNotFound') };
  const attempt = hash(password, row.salt);
  if (!crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(row.pass_hash))) {
    return { ok: false, reason: tr(lang, 'wrongPass') };
  }
  let weapons: WeaponId[];
  try {
    weapons = JSON.parse(row.weapons);
    if (!Array.isArray(weapons) || !weapons.includes('fists')) weapons = ['fists'];
  } catch {
    weapons = ['fists'];
  }
  let hats: string[] = [];
  try {
    const parsed = JSON.parse(row.hats ?? '[]');
    if (Array.isArray(parsed)) hats = parsed.filter((h) => typeof h === 'string');
  } catch {
    hats = [];
  }
  const hat = row.hat && hats.includes(row.hat) ? row.hat : null;
  return { ok: true, account: { name: row.name, money: row.money, weapons, hats, hat, prestige: row.prestige ?? 0, level: Math.max(1, row.level ?? 1), food: Math.max(0, row.food ?? 0), createdTs: row.created_ts } };
}

type AccountRow = {
  name: string; money: number; weapons: string; hats: string | null; hat: string | null;
  prestige: number | null; level: number | null; food: number | null; created_ts: number;
};

function rowToAccount(row: AccountRow): Account {
  let weapons: WeaponId[];
  try {
    weapons = JSON.parse(row.weapons);
    if (!Array.isArray(weapons) || !weapons.includes('fists')) weapons = ['fists'];
  } catch { weapons = ['fists']; }
  let hats: string[] = [];
  try {
    const parsed = JSON.parse(row.hats ?? '[]');
    if (Array.isArray(parsed)) hats = parsed.filter((h) => typeof h === 'string');
  } catch { hats = []; }
  const hat = row.hat && hats.includes(row.hat) ? row.hat : null;
  return { name: row.name, money: row.money, weapons, hats, hat, prestige: row.prestige ?? 0, level: Math.max(1, row.level ?? 1), food: Math.max(0, row.food ?? 0), createdTs: row.created_ts };
}

const ACC_COLS = 'name, money, weapons, hats, hat, prestige, level, food, created_ts';

/**
 * Logs in (or transparently creates) an account tied to a Yandex Games player
 * id. No password — identity is proven by the platform's signed player id
 * (verified upstream in the socket handler). The in-game name comes from the
 * Yandex profile, made unique on first creation.
 */
export function loginYandex(yandexId: string, displayName: string, startMoney = 0): Account {
  const db = getDb();
  const found = db.prepare(`SELECT ${ACC_COLS} FROM accounts WHERE yandex_id = ?`).get(yandexId) as AccountRow | undefined;
  if (found) return rowToAccount(found);

  const now = Date.now();
  const salt = crypto.randomBytes(16).toString('hex');
  const passHash = crypto.randomBytes(32).toString('hex'); // unusable — Yandex accounts never log in by password
  let base = (displayName || 'Игрок').trim().slice(0, 16) || 'Игрок';
  let name = base;
  for (let i = 2; accountExists(name); i++) name = `${base.slice(0, 13)}#${i}`; // dodge name-uniqueness clashes
  db.prepare('INSERT INTO accounts (name, pass_hash, salt, money, weapons, created_ts, last_seen_ts, yandex_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(name, passHash, salt, startMoney, JSON.stringify(['fists']), now, now, yandexId);
  return { name, money: startMoney, weapons: ['fists'], hats: [], hat: null, prestige: 0, level: 1, food: 0, createdTs: now };
}

const DAY_MS = 86_400_000;
const REWARD_BASE = 100; // day-1 reward
const REWARD_STEP = 50; // added per consecutive day
const REWARD_MAX_STREAK = 7; // streak beyond this no longer raises the reward

/**
 * Grants a daily login reward once per UTC day. The streak grows on
 * consecutive days and resets after a missed day. Returns null if already
 * claimed today (or the account is missing). Gold is persisted immediately so
 * a crash before logout can't yield a second claim.
 */
export function claimDailyReward(name: string): { gold: number; streak: number } | null {
  const db = getDb();
  const row = db
    .prepare('SELECT last_reward_day, reward_streak FROM accounts WHERE name = ? COLLATE NOCASE')
    .get(name) as { last_reward_day: number; reward_streak: number } | undefined;
  if (!row) return null;
  const today = Math.floor(Date.now() / DAY_MS);
  if (row.last_reward_day === today) return null; // already claimed today
  const streak = row.last_reward_day === today - 1 ? row.reward_streak + 1 : 1;
  const gold = REWARD_BASE + (Math.min(streak, REWARD_MAX_STREAK) - 1) * REWARD_STEP;
  db.prepare('UPDATE accounts SET last_reward_day = ?, reward_streak = ?, money = money + ? WHERE name = ? COLLATE NOCASE')
    .run(today, streak, gold, name);
  return { gold, streak };
}

/** Persists gold, weapons, hats, prestige, level and food at logout. */
export function saveProgress(name: string, money: number, weapons: WeaponId[], hats: string[], hat: string | null, prestige: number, level: number, food: number): void {
  getDb()
    .prepare('UPDATE accounts SET money = ?, weapons = ?, hats = ?, hat = ?, prestige = ?, level = ?, food = ?, last_seen_ts = ? WHERE name = ? COLLATE NOCASE')
    .run(money, JSON.stringify(weapons), JSON.stringify(hats), hat, prestige, Math.max(1, Math.floor(level)), Math.max(0, Math.floor(food)), Date.now(), name);
}

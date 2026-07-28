import crypto from 'node:crypto';
import type { WeaponId } from '@shared/types.js';
import { getDb } from './db.js';
import { tr, type Lang } from '../game/i18n.js';

export interface Account {
  name: string;
  money: number;
  /** gold sitting in the player's vault — safe from death, raidable in part */
  banked: number;
  /** every coin ever deposited — drives Base Rank and never goes down */
  bankedTotal: number;
  /** gold withdrawn from the vault and not yet re-banked (see depositAll) */
  withdrawCredit: number;
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
  return { ok: true, account: { name, money: startMoney, banked: 0, bankedTotal: 0, withdrawCredit: 0, weapons: ['fists'], hats: [], hat: null, prestige: 0, level: 1, food: 0, createdTs: now } };
}

export function login(name: string, password: string, lang: Lang = 'ru'): { ok: boolean; reason?: string; account?: Account } {
  const row = getDb()
    .prepare('SELECT name, pass_hash, salt, money, banked, banked_total, withdraw_credit, weapons, hats, hat, prestige, level, food, created_ts FROM accounts WHERE name = ? COLLATE NOCASE')
    .get(name) as { name: string; pass_hash: string; salt: string; money: number; banked: number | null; banked_total: number | null; withdraw_credit: number | null; weapons: string; hats: string | null; hat: string | null; prestige: number | null; level: number | null; food: number | null; created_ts: number } | undefined;
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
  return { ok: true, account: { name: row.name, money: row.money, banked: Math.max(0, row.banked ?? 0), bankedTotal: Math.max(0, row.banked_total ?? 0), withdrawCredit: Math.max(0, row.withdraw_credit ?? 0), weapons, hats, hat, prestige: row.prestige ?? 0, level: Math.max(1, row.level ?? 1), food: Math.max(0, row.food ?? 0), createdTs: row.created_ts } };
}

type AccountRow = {
  name: string; money: number; banked: number | null; banked_total: number | null; withdraw_credit: number | null; weapons: string; hats: string | null; hat: string | null;
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
  return { name: row.name, money: row.money, banked: Math.max(0, row.banked ?? 0), bankedTotal: Math.max(0, row.banked_total ?? 0), withdrawCredit: Math.max(0, row.withdraw_credit ?? 0), weapons, hats, hat, prestige: row.prestige ?? 0, level: Math.max(1, row.level ?? 1), food: Math.max(0, row.food ?? 0), createdTs: row.created_ts };
}

const ACC_COLS = 'name, money, banked, banked_total, withdraw_credit, weapons, hats, hat, prestige, level, food, created_ts';

/** Account columns that hold a third-party portal's player id. */
type PlatformIdColumn = 'yandex_id' | 'cg_id';

/**
 * Logs in (or transparently creates) an account tied to a portal player id.
 * No password — identity is proven by the platform (signature/token verified
 * upstream in the socket handler). The in-game name comes from the portal
 * profile, made unique on first creation.
 */
function loginPlatform(column: PlatformIdColumn, platformId: string, displayName: string, startMoney = 0): Account {
  const db = getDb();
  const found = db.prepare(`SELECT ${ACC_COLS} FROM accounts WHERE ${column} = ?`).get(platformId) as AccountRow | undefined;
  if (found) return rowToAccount(found);

  const now = Date.now();
  const salt = crypto.randomBytes(16).toString('hex');
  const passHash = crypto.randomBytes(32).toString('hex'); // unusable — portal accounts never log in by password
  const base = (displayName || 'Игрок').trim().slice(0, 16) || 'Игрок';
  let name = base;
  for (let i = 2; accountExists(name); i++) name = `${base.slice(0, 13)}#${i}`; // dodge name-uniqueness clashes
  db.prepare(`INSERT INTO accounts (name, pass_hash, salt, money, weapons, created_ts, last_seen_ts, ${column}) VALUES (?,?,?,?,?,?,?,?)`)
    .run(name, passHash, salt, startMoney, JSON.stringify(['fists']), now, now, platformId);
  return { name, money: startMoney, banked: 0, bankedTotal: 0, withdrawCredit: 0, weapons: ['fists'], hats: [], hat: null, prestige: 0, level: 1, food: 0, createdTs: now };
}

/** Yandex Games player id → account. */
export function loginYandex(yandexId: string, displayName: string, startMoney = 0): Account {
  return loginPlatform('yandex_id', yandexId, displayName, startMoney);
}

/** CrazyGames user id (from the verified user token) → account. */
export function loginCrazyGames(cgId: string, displayName: string, startMoney = 0): Account {
  return loginPlatform('cg_id', cgId, displayName, startMoney);
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

/** Reads the stored base layout for an account, or null when it has none. */
export function loadBase(name: string): string | null {
  const row = getDb().prepare('SELECT base FROM accounts WHERE name = ? COLLATE NOCASE').get(name) as { base: string | null } | undefined;
  return row?.base ?? null;
}

/**
 * Accounts with a stored base, most recently seen first — the pool absent
 * players' bases are seeded from.
 */
export function listRaidableBases(limit: number): { name: string; base: string | null }[] {
  return getDb()
    .prepare("SELECT name, base FROM accounts WHERE base IS NOT NULL AND base != '' ORDER BY last_seen_ts DESC LIMIT ?")
    .all(limit) as { name: string; base: string | null }[];
}

/** Drops bases of accounts nobody has touched in a while, keeping the pool fresh. */
export function pruneStaleBases(maxAgeMs: number): number {
  const res = getDb()
    .prepare("UPDATE accounts SET base = NULL WHERE base IS NOT NULL AND last_seen_ts < ?")
    .run(Date.now() - maxAgeMs);
  return res.changes;
}

/** Writes the base layout so it can be rebuilt on the next login. */
export function saveBase(name: string, json: string): void {
  getDb().prepare('UPDATE accounts SET base = ? WHERE name = ? COLLATE NOCASE').run(json, name);
}

/** Persists gold, weapons, hats, prestige, level and food at logout. */
export function saveProgress(name: string, money: number, banked: number, bankedTotal: number, withdrawCredit: number, weapons: WeaponId[], hats: string[], hat: string | null, prestige: number, level: number, food: number): void {
  getDb()
    .prepare('UPDATE accounts SET money = ?, banked = ?, banked_total = ?, withdraw_credit = ?, weapons = ?, hats = ?, hat = ?, prestige = ?, level = ?, food = ?, last_seen_ts = ? WHERE name = ? COLLATE NOCASE')
    .run(money, Math.max(0, Math.floor(banked)), Math.max(0, Math.floor(bankedTotal)), Math.max(0, Math.floor(withdrawCredit)), JSON.stringify(weapons), JSON.stringify(hats), hat, prestige, Math.max(1, Math.floor(level)), Math.max(0, Math.floor(food)), Date.now(), name);
}

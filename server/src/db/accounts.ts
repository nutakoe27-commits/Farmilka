import crypto from 'node:crypto';
import type { WeaponId } from '@shared/types.js';
import { getDb } from './db.js';

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

export function register(name: string, password: string, startMoney = 0): { ok: boolean; reason?: string; account?: Account } {
  if (password.length < 4) return { ok: false, reason: 'Пароль слишком короткий (мин. 4 символа)' };
  if (accountExists(name)) return { ok: false, reason: 'Это имя уже зарегистрировано' };
  const salt = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  getDb()
    .prepare('INSERT INTO accounts (name, pass_hash, salt, money, weapons, created_ts, last_seen_ts) VALUES (?,?,?,?,?,?,?)')
    .run(name, hash(password, salt), salt, startMoney, JSON.stringify(['fists']), now, now);
  return { ok: true, account: { name, money: startMoney, weapons: ['fists'], hats: [], hat: null, prestige: 0, level: 1, food: 0, createdTs: now } };
}

export function login(name: string, password: string): { ok: boolean; reason?: string; account?: Account } {
  const row = getDb()
    .prepare('SELECT name, pass_hash, salt, money, weapons, hats, hat, prestige, level, food, created_ts FROM accounts WHERE name = ? COLLATE NOCASE')
    .get(name) as { name: string; pass_hash: string; salt: string; money: number; weapons: string; hats: string | null; hat: string | null; prestige: number | null; level: number | null; food: number | null; created_ts: number } | undefined;
  if (!row) return { ok: false, reason: 'Аккаунт не найден — отметьте «Создать аккаунт»' };
  const attempt = hash(password, row.salt);
  if (!crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(row.pass_hash))) {
    return { ok: false, reason: 'Неверный пароль' };
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

/** Persists gold, weapons, hats, prestige, level and food at logout. */
export function saveProgress(name: string, money: number, weapons: WeaponId[], hats: string[], hat: string | null, prestige: number, level: number, food: number): void {
  getDb()
    .prepare('UPDATE accounts SET money = ?, weapons = ?, hats = ?, hat = ?, prestige = ?, level = ?, food = ?, last_seen_ts = ? WHERE name = ? COLLATE NOCASE')
    .run(money, JSON.stringify(weapons), JSON.stringify(hats), hat, prestige, Math.max(1, Math.floor(level)), Math.max(0, Math.floor(food)), Date.now(), name);
}

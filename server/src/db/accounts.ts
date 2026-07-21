import crypto from 'node:crypto';
import type { WeaponId } from '@shared/types.js';
import { getDb } from './db.js';

export interface Account {
  name: string;
  money: number;
  weapons: WeaponId[];
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
  return { ok: true, account: { name, money: startMoney, weapons: ['fists'], createdTs: now } };
}

export function login(name: string, password: string): { ok: boolean; reason?: string; account?: Account } {
  const row = getDb()
    .prepare('SELECT name, pass_hash, salt, money, weapons, created_ts FROM accounts WHERE name = ? COLLATE NOCASE')
    .get(name) as { name: string; pass_hash: string; salt: string; money: number; weapons: string; created_ts: number } | undefined;
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
  return { ok: true, account: { name: row.name, money: row.money, weapons, createdTs: row.created_ts } };
}

/** Persists gold and owned weapons at logout. */
export function saveProgress(name: string, money: number, weapons: WeaponId[]): void {
  getDb()
    .prepare('UPDATE accounts SET money = ?, weapons = ?, last_seen_ts = ? WHERE name = ? COLLATE NOCASE')
    .run(money, JSON.stringify(weapons), Date.now(), name);
}

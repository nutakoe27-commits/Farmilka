import fs from 'node:fs';
import path from 'node:path';
import { validateBalance, type Balance } from '@shared/balance-schema.js';

let current: Balance | null = null;
let filePath = '';

export function balancePath(): string {
  return process.env.BALANCE_PATH ?? path.resolve(process.cwd(), '../balance/balance.json');
}

export function loadBalance(file?: string): Balance {
  filePath = file ?? balancePath();
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  current = validateBalance(raw);
  return current;
}

export function getBalance(): Balance {
  if (!current) throw new Error('balance not loaded');
  return current;
}

/** Re-reads balance.json; keeps the old config when the new one is invalid. */
export function reloadBalance(): { ok: boolean; error?: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    current = validateBalance(raw);
    console.log('[balance] reloaded');
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[balance] reload failed, keeping previous config:', msg);
    return { ok: false, error: msg };
  }
}

/** Watches balance.json and hot-swaps the config on edit. */
export function watchBalance(): void {
  let timer: NodeJS.Timeout | null = null;
  try {
    fs.watch(filePath, () => {
      // editors fire several events per save; debounce
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => reloadBalance(), 200);
    });
    console.log(`[balance] watching ${filePath} for live tuning`);
  } catch (err) {
    console.warn('[balance] fs.watch unavailable, use POST /admin/reload instead');
  }
}

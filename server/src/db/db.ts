import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let db: Database.Database | null = null;

export function openDb(): Database.Database {
  if (db) return db;
  const dataDir = process.env.DATA_DIR ?? path.resolve(process.cwd(), '../data');
  fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(path.join(dataDir, 'game.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf-8'));
  // lightweight migrations for databases created before these columns existed
  for (const ddl of [
    "ALTER TABLE accounts ADD COLUMN hats TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE accounts ADD COLUMN hat TEXT',
    'ALTER TABLE accounts ADD COLUMN prestige INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE accounts ADD COLUMN level INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE accounts ADD COLUMN food INTEGER NOT NULL DEFAULT 0',
  ]) {
    try {
      db.exec(ddl);
    } catch {
      // column already exists
    }
  }
  console.log(`[db] sqlite at ${path.join(dataDir, 'game.db')}`);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('db not opened');
  return db;
}

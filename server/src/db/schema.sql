CREATE TABLE IF NOT EXISTS kills (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  killer TEXT NOT NULL,
  victim TEXT NOT NULL,
  weapon TEXT NOT NULL,
  distance REAL NOT NULL,
  victim_kind TEXT NOT NULL -- player | mob | boss | building
);

CREATE TABLE IF NOT EXISTS damage (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  attacker TEXT NOT NULL,
  weapon TEXT NOT NULL,
  amount REAL NOT NULL,
  target_kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS income (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  player TEXT NOT NULL,
  source TEXT NOT NULL, -- mob | boss | building | loot | raid
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  player TEXT NOT NULL,
  item TEXT NOT NULL,
  price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS deaths (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  player TEXT NOT NULL,
  cause TEXT NOT NULL, -- player | mob | boss | turret
  weapon TEXT NOT NULL, -- killer's weapon
  equipped TEXT NOT NULL, -- victim's equipped weapon
  money_dropped REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  player TEXT NOT NULL,
  joined_ts INTEGER NOT NULL,
  left_ts INTEGER,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  money_earned REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_kills_ts ON kills(ts);
CREATE INDEX IF NOT EXISTS idx_damage_ts ON damage(ts);
CREATE INDEX IF NOT EXISTS idx_income_ts ON income(ts);

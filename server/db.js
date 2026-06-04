import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH || new URL('../data/pronostix.sqlite', import.meta.url).pathname;

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS teams (
  id           INTEGER PRIMARY KEY,
  idx          INTEGER,
  name_fr      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  fifa_code    TEXT,
  iso          TEXT,
  flag         TEXT,            -- flag asset filename, e.g. "fr.svg"
  group_letter TEXT
);

CREATE TABLE IF NOT EXISTS matches (
  id            INTEGER PRIMARY KEY,
  num           INTEGER,         -- openfootball match number (KO bracket)
  stage         TEXT NOT NULL,   -- group | R32 | R16 | QF | SF | 3RD | F
  group_letter  TEXT,
  matchday      TEXT,
  kickoff_utc   TEXT NOT NULL,   -- ISO 8601 UTC
  ground        TEXT,
  home_team_id  INTEGER REFERENCES teams(id),
  away_team_id  INTEGER REFERENCES teams(id),
  home_label    TEXT,            -- placeholder until resolved, e.g. "1A", "W74"
  away_label    TEXT,
  home_score    INTEGER,
  away_score    INTEGER,
  advancing_team_id INTEGER REFERENCES teams(id), -- KO qualifier (official)
  status        TEXT NOT NULL DEFAULT 'scheduled'  -- scheduled | finished
);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  pseudo     TEXT NOT NULL UNIQUE,
  pin_hash   TEXT NOT NULL,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS predictions (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id          INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  home_score        INTEGER NOT NULL,
  away_score        INTEGER NOT NULL,
  qualifier_team_id INTEGER REFERENCES teams(id),  -- KO only
  points            INTEGER,
  updated_at        TEXT NOT NULL,
  UNIQUE(user_id, match_id)
);

CREATE TABLE IF NOT EXISTS group_order_predictions (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_letter TEXT NOT NULL,
  order_json   TEXT NOT NULL,   -- JSON array of 4 team ids, ranked 1..4
  points       INTEGER,
  updated_at   TEXT NOT NULL,
  UNIQUE(user_id, group_letter)
);

CREATE TABLE IF NOT EXISTS bonus_predictions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,    -- winner | top_scorer
  team_id     INTEGER REFERENCES teams(id),
  player_name TEXT,
  points      INTEGER,
  updated_at  TEXT NOT NULL,
  UNIQUE(user_id, type)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_pred_match ON predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_matches_group ON matches(group_letter);
`);

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value == null ? null : String(value));
}

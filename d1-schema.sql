-- ============================================================
-- BBC-SEC DOMAIN_GUARD — D1 SCHEMA
-- Run this once in the Cloudflare D1 console (Workers & Pages > D1 > your DB > Console)
-- after creating the database, before deploying the new Worker.
-- ============================================================

CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  domain TEXT NOT NULL,
  agent TEXT DEFAULT '',
  price TEXT DEFAULT '',
  expiration TEXT DEFAULT '',
  account TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  redirected TEXT DEFAULT '',
  pldt TEXT DEFAULT '',
  pldt_remarks TEXT DEFAULT '',
  globe TEXT DEFAULT '',
  globe_remarks TEXT DEFAULT '',
  converge TEXT DEFAULT '',
  converge_remarks TEXT DEFAULT '',
  dito TEXT DEFAULT '',
  dito_remarks TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_domains_brand_domain ON domains(brand, domain);
CREATE INDEX IF NOT EXISTS idx_domains_brand ON domains(brand);

CREATE TABLE IF NOT EXISTS dpv_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT DEFAULT '',
  domain TEXT NOT NULL,
  team TEXT DEFAULT '',
  pldt TEXT DEFAULT '',
  pldt_remarks TEXT DEFAULT '',
  globe TEXT DEFAULT '',
  globe_remarks TEXT DEFAULT '',
  converge TEXT DEFAULT '',
  converge_remarks TEXT DEFAULT '',
  dito TEXT DEFAULT '',
  dito_remarks TEXT DEFAULT '',
  cicc TEXT DEFAULT '',
  agent TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dpv_domain ON dpv_records(domain);
CREATE INDEX IF NOT EXISTS idx_dpv_team ON dpv_records(team);
CREATE INDEX IF NOT EXISTS idx_dpv_batch ON dpv_records(batch_id);

-- password_hash stores "salt:derivedHashHex" (PBKDF2-SHA256, one-way — not recoverable).
-- This is a deliberate change from plaintext storage; see migration notes.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT DEFAULT '',
  image TEXT DEFAULT '',
  permissions TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  permissions TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT DEFAULT (datetime('now')),
  type TEXT DEFAULT '',
  user TEXT DEFAULT '',
  details TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_logs_time ON activity_logs(time DESC);

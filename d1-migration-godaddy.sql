-- GoDaddy monitor: domains synced from the GoDaddy API (read-only), a change log, and per-account sync status.
CREATE TABLE IF NOT EXISTS gd_domains (
  domain TEXT NOT NULL,
  account TEXT NOT NULL,
  domain_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  expires TEXT NOT NULL DEFAULT '',
  renew_auto INTEGER NOT NULL DEFAULT 0,
  renewable INTEGER NOT NULL DEFAULT 0,
  renew_deadline TEXT NOT NULL DEFAULT '',
  locked INTEGER NOT NULL DEFAULT 0,
  name_servers TEXT NOT NULL DEFAULT '',
  gd_created TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (domain, account)
);
CREATE INDEX IF NOT EXISTS idx_gd_domains_account ON gd_domains(account);
CREATE INDEX IF NOT EXISTS idx_gd_domains_expires ON gd_domains(expires);

CREATE TABLE IF NOT EXISTS gd_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  domain TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,            -- renewed | expired | status_changed | ns_changed | added | removed
  old_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL DEFAULT '',
  by_user TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'sync',   -- sync | bot_log | portal
  order_no TEXT NOT NULL DEFAULT '',
  receipt_ref TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_gd_events_at ON gd_events(at);
CREATE INDEX IF NOT EXISTS idx_gd_events_domain ON gd_events(domain);

CREATE TABLE IF NOT EXISTS gd_accounts (
  account TEXT PRIMARY KEY,
  domains INTEGER NOT NULL DEFAULT 0,
  last_sync TEXT NOT NULL DEFAULT '',
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT ''
);

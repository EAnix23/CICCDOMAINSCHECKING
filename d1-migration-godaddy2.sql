-- GoDaddy monitor, part 2: removal tracking, removed-domain archive, receipt storage.
ALTER TABLE gd_domains ADD COLUMN miss INTEGER NOT NULL DEFAULT 0;

-- Domains that disappeared from a GoDaddy account. The BBC domain row (ISP statuses included) is kept here as JSON.
CREATE TABLE IF NOT EXISTS gd_removed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  removed_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_status TEXT NOT NULL DEFAULT '',
  last_expires TEXT NOT NULL DEFAULT '',
  snapshot TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'sync'
);
CREATE INDEX IF NOT EXISTS idx_gd_removed_at ON gd_removed(removed_at);

-- Receipt files from GoDaddy (the file itself lives in R2 under godaddy-receipts/).
CREATE TABLE IF NOT EXISTS gd_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by TEXT NOT NULL DEFAULT '',
  account TEXT NOT NULL DEFAULT '',
  order_no TEXT NOT NULL DEFAULT '',
  amount REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  paid_at TEXT NOT NULL DEFAULT '',
  domains TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gd_receipts_paid ON gd_receipts(paid_at);

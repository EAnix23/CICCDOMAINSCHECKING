-- GoDaddy orders pulled from the orders API (the data behind each receipt).
CREATE TABLE IF NOT EXISTS gd_orders (
  order_id TEXT PRIMARY KEY,
  account TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT '',
  total REAL,
  subtotal REAL,
  taxes REAL,
  payment TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',          -- renewal | registration | transfer | other
  domains TEXT NOT NULL DEFAULT '',       -- comma separated, lower case
  items_json TEXT NOT NULL DEFAULT '',    -- [{label, period, domains}]
  detailed INTEGER NOT NULL DEFAULT 0,    -- 0 list only, 1 full detail, 2 detail not available
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gd_orders_created ON gd_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_gd_orders_detailed ON gd_orders(detailed);

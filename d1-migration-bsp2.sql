-- Payment Gateway merchant/QR registry — a different data source than bsp_submissions (individual
-- investigator submission events): this is a detected/registered merchant QR list with its own
-- status lifecycle (Pending/etc), imported from the team's separate gateway tracking export.
CREATE TABLE IF NOT EXISTS payment_gateway_merchants (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL DEFAULT '',
  store_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  brand_names TEXT NOT NULL DEFAULT '',
  related_domains TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Pending',
  username TEXT NOT NULL DEFAULT '',
  team TEXT NOT NULL DEFAULT '',
  created_by_tag TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL,
  qr_data TEXT NOT NULL DEFAULT '',
  qr_normalized TEXT NOT NULL DEFAULT '',
  qr_type TEXT NOT NULL DEFAULT '',
  qr_extracted_merchant_id TEXT NOT NULL DEFAULT '',
  qr_extracted_store_id TEXT NOT NULL DEFAULT '',
  qr_extracted_merchant_name TEXT NOT NULL DEFAULT '',
  qr_extracted_provider TEXT NOT NULL DEFAULT '',
  qr_mcc TEXT NOT NULL DEFAULT '',
  qr_currency TEXT NOT NULL DEFAULT '',
  qr_amount TEXT NOT NULL DEFAULT '',
  qr_country_code TEXT NOT NULL DEFAULT '',
  qr_merchant_city TEXT NOT NULL DEFAULT '',
  qr_crc TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'historical_import',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pgm_username_date ON payment_gateway_merchants(username, submitted_at);
CREATE INDEX IF NOT EXISTS idx_pgm_status ON payment_gateway_merchants(status);

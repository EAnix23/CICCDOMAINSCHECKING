-- BSP QR / Payment Reporting Portal — unified table for both Automated (QR scan) and Manual Entry
-- submissions, migrated off the standalone Google Apps Script tool + Google Sheet onto D1/R2 like
-- the rest of the system. mode-specific fields are simply blank on rows of the other mode.
CREATE TABLE IF NOT EXISTS bsp_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  username TEXT NOT NULL,
  team TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  domain_link TEXT NOT NULL DEFAULT '',
  payment_vendor TEXT NOT NULL DEFAULT '',
  raw_qr_payload TEXT NOT NULL DEFAULT '',
  qr_image_ref TEXT NOT NULL DEFAULT '',
  proof_ref TEXT NOT NULL DEFAULT '',
  merchant_name TEXT NOT NULL DEFAULT '',
  merchant_city TEXT NOT NULL DEFAULT '',
  mcc TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT '',
  qr_amount TEXT NOT NULL DEFAULT '',
  emv_tags_json TEXT NOT NULL DEFAULT '',
  transaction_type TEXT NOT NULL DEFAULT '',
  amount REAL,
  bank TEXT NOT NULL DEFAULT '',
  bank_account_name TEXT NOT NULL DEFAULT '',
  bank_account_number TEXT NOT NULL DEFAULT '',
  reference_number TEXT NOT NULL DEFAULT '',
  screenshot_ref TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'live',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bsp_username_date ON bsp_submissions(username, submitted_at);
CREATE INDEX IF NOT EXISTS idx_bsp_mode ON bsp_submissions(mode);

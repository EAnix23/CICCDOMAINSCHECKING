-- Per-operator domain-check log, fed by checker.js (Playwright ISP-checking bot) via
-- submitDomainCheckResult once the operator has been identified via resolveKpiOperator.
-- Append-only: every ISP check submission gets its own row, so completion (unique domains
-- checked vs. domains assigned to that agent) can be computed from it later.
CREATE TABLE IF NOT EXISTS kpi_domain_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  team TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL,
  batch TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL,
  isp TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kdc_user_date ON kpi_domain_checks(username, checked_at);
CREATE INDEX IF NOT EXISTS idx_kdc_domain_isp ON kpi_domain_checks(domain, isp);

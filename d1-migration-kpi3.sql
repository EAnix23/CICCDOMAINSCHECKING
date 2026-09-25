-- ============================================================
-- KPI REPORT migration #3 — Day Off plotting.
-- (break_start/break_end on kpi_attendance were already added
-- directly in the D1 console earlier — don't re-run those here,
-- SQLite errors on ALTER ADD COLUMN for a column that exists.)
-- Run once against bbc-sec-db (D1 > bbc-sec-db > Console),
-- paste, then Execute.
-- ============================================================

CREATE TABLE IF NOT EXISTS kpi_dayoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  team TEXT DEFAULT '',
  date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_dayoffs_user_date ON kpi_dayoffs(username, date);
CREATE INDEX IF NOT EXISTS idx_kpi_dayoffs_team ON kpi_dayoffs(team);

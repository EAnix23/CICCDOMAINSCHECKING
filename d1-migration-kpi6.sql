-- Schedule history (per-cutoff/seasonal shift changes) — the applicable scheduled Time In for a
-- given date is the latest row with effective_from <= that date. Supersedes the single static
-- users.scheduled_time_in column (left in place, unused, rather than risking a DROP COLUMN on D1).
CREATE TABLE IF NOT EXISTS kpi_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  scheduled_time_in TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kpi_schedules_user_date ON kpi_schedules(username, effective_from);

-- GPS coordinates captured client-side (browser Geolocation API, permission-gated) at the moment
-- of each punch — coordinates only, no reverse geocoding.
ALTER TABLE kpi_attendance ADD COLUMN time_in_lat REAL;
ALTER TABLE kpi_attendance ADD COLUMN time_in_lng REAL;
ALTER TABLE kpi_attendance ADD COLUMN time_out_lat REAL;
ALTER TABLE kpi_attendance ADD COLUMN time_out_lng REAL;

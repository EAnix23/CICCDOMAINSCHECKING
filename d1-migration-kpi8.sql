-- Overtime Request system, mirroring the real "Overtime Request Form" HR template: file with a
-- reason/justification, punch actual OT Time In/Out to auto-compute hours, Super Admin (acting as
-- Department Head signer) approves/rejects, then export for HR submission.
CREATE TABLE IF NOT EXISTS kpi_overtime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  team TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ot_time_in TEXT NOT NULL DEFAULT '',
  ot_time_out TEXT NOT NULL DEFAULT '',
  ot_time_in_lat REAL,
  ot_time_in_lng REAL,
  ot_time_out_lat REAL,
  ot_time_out_lng REAL,
  total_ot_hours REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(username, date)
);
CREATE INDEX IF NOT EXISTS idx_kpi_overtime_team_date ON kpi_overtime(team, date);

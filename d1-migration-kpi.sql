-- ============================================================
-- KPI REPORT migration — run this once against the bbc-sec-db
-- D1 database (Cloudflare Dashboard > D1 > bbc-sec-db > Console),
-- paste the whole file, then click "Execute".
-- ============================================================

ALTER TABLE users ADD COLUMN team TEXT DEFAULT '';
ALTER TABLE sessions ADD COLUMN team TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS kpi_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'manual',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT DEFAULT '',
  task_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kpi_tasks_team_date ON kpi_tasks(team, task_date);

CREATE TABLE IF NOT EXISTS kpi_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  team TEXT DEFAULT '',
  date TEXT NOT NULL,
  time_in TEXT DEFAULT '',
  time_out TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_attendance_user_date ON kpi_attendance(username, date);

CREATE TABLE IF NOT EXISTS kpi_achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'accomplishment',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kpi_achievements_team ON kpi_achievements(team);

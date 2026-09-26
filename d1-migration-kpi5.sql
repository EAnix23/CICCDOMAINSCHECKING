-- Generic daily-checklist system: fixed per-agent assignment lists (Brand Status Update now,
-- Competitor Promotion Check later — same tables, different `category`), with a required photo
-- attachment before an item counts as done for a given day. Feeds "how productive were they today."
CREATE TABLE IF NOT EXISTS kpi_checklist_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  team TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  subtype1 TEXT NOT NULL DEFAULT '',
  subtype2 TEXT NOT NULL DEFAULT '',
  ref_link TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kca_user_cat ON kpi_checklist_assignments(username, category, active);

CREATE TABLE IF NOT EXISTS kpi_checklist_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  task_date TEXT NOT NULL,
  attachment_key TEXT NOT NULL DEFAULT '',
  attachment_filename TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(assignment_id, task_date)
);
CREATE INDEX IF NOT EXISTS idx_kcc_user_date ON kpi_checklist_completions(username, task_date);

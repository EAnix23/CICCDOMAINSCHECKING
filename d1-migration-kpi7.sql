-- Multiple proof photos per checklist completion (agents report needing more than one screenshot
-- per brand update). kpi_checklist_completions stays as the "done" marker (one row per
-- assignment+day); the actual photos move to their own child table.
CREATE TABLE IF NOT EXISTS kpi_checklist_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  completion_id INTEGER NOT NULL,
  attachment_key TEXT NOT NULL,
  attachment_filename TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kcp_completion ON kpi_checklist_photos(completion_id);

-- Backfill: every completion that already has a single attachment_key gets that photo carried
-- over as its first row here, so nothing already submitted by the team is lost.
INSERT INTO kpi_checklist_photos (completion_id, attachment_key, attachment_filename, created_at)
SELECT id, attachment_key, attachment_filename, completed_at FROM kpi_checklist_completions WHERE attachment_key != '';

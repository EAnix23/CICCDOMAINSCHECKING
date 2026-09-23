-- ============================================================
-- KPI REPORT migration #2 — per-person task assignment, DTR
-- export fields, and KPI scoreboard support. Run once against
-- bbc-sec-db (D1 > bbc-sec-db > Console), paste, then Execute.
-- ============================================================

ALTER TABLE users ADD COLUMN hrid_number TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN position TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN sub_department TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN rest_day TEXT DEFAULT '';

ALTER TABLE kpi_tasks ADD COLUMN assigned_to TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_kpi_tasks_assigned ON kpi_tasks(assigned_to, task_date);

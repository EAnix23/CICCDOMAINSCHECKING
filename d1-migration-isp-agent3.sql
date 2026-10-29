-- ISP Check: big jobs are split into parts so several PCs on the same ISP can share them.
-- Run once:  npx wrangler d1 execute bbc-sec-db --remote --file d1-migration-isp-agent3.sql
ALTER TABLE isp_jobs ADD COLUMN part_no INTEGER DEFAULT 0;
ALTER TABLE isp_jobs ADD COLUMN parts INTEGER DEFAULT 0;
ALTER TABLE isp_jobs ADD COLUMN group_id INTEGER DEFAULT 0;
ALTER TABLE isp_jobs ADD COLUMN domains TEXT DEFAULT '';   -- the exact domains of this part (JSON); empty = work the list out when the job starts

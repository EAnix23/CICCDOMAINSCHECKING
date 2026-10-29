-- ISP Check: records when the owner confirmed the PC is on a HOME (residential) internet line.
-- Run once:  npx wrangler d1 execute bbc-sec-db --remote --file d1-migration-isp-agent2.sql
ALTER TABLE isp_agents ADD COLUMN home_confirmed_at TEXT DEFAULT '';

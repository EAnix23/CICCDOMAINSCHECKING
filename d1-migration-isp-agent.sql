-- ISP Check: PCs that run the domain checker (agents), one-time link codes, and the queue of check jobs.
-- Run once:  npx wrangler d1 execute bbc-sec-db --remote --file d1-migration-isp-agent.sql

CREATE TABLE IF NOT EXISTS isp_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,                 -- the portal account this PC is linked to (who gets the KPI credit)
  label TEXT DEFAULT '',                  -- PC name shown in the portal
  token_hash TEXT NOT NULL UNIQUE,        -- SHA-256 of the agent token (the token itself is shown once, never stored)
  isp TEXT DEFAULT '',                    -- pldt | globe | converge | dito, detected by the runner
  ip TEXT DEFAULT '',
  net_type TEXT DEFAULT '',               -- fixed | mobile | override
  dns TEXT DEFAULT '',                    -- resolvers the PC uses
  safe INTEGER DEFAULT 0,                 -- 1 = residential ISP line, no VPN/hosting, ISP DNS
  unsafe_reason TEXT DEFAULT '',
  status TEXT DEFAULT 'idle',             -- idle | working | blocked
  current_job INTEGER DEFAULT 0,
  version TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  last_seen TEXT DEFAULT '',
  revoked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS isp_link_codes (
  code TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS isp_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  target TEXT NOT NULL,                   -- brand (BBC domains) | dpv
  batch TEXT NOT NULL,                    -- brand name or DPV batch
  isp TEXT NOT NULL,
  mode TEXT DEFAULT 'all',                -- all | retry
  status TEXT DEFAULT 'pending',          -- pending | running | done | cancelled
  total INTEGER DEFAULT 0,
  done INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  agent_id INTEGER DEFAULT 0,
  agent_user TEXT DEFAULT '',
  claimed_at TEXT DEFAULT '',
  heartbeat TEXT DEFAULT '',
  finished_at TEXT DEFAULT '',
  note TEXT DEFAULT '',
  net_info TEXT DEFAULT ''                -- ISP, IP, connection type and DNS seen when the job started (the evidence)
);
CREATE INDEX IF NOT EXISTS idx_isp_jobs_pick ON isp_jobs(status, isp);
CREATE INDEX IF NOT EXISTS idx_isp_agents_user ON isp_agents(username);

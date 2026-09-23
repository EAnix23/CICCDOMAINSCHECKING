// ============================================================
// BBC-SEC DOMAIN_GUARD — CLOUDFLARE WORKER (D1-BACKED)
// Replaces the old Apps Script proxy entirely. Bind a D1 database
// named "DB" to this Worker (Settings > Bindings > Add > D1 database),
// then run d1-schema.sql once against it before deploying this.
// ============================================================

const SESSION_TTL_HOURS = 24 * 7; // 7 days, matches the app's "stay logged in" behavior

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status) {
  return new Response(JSON.stringify({ data }), {
    status: status || 200,
    headers: { ...corsHeaders(), "Content-Type": "application/json" }
  });
}

function uuid() { return crypto.randomUUID(); }

// ---- Password hashing (PBKDF2-SHA256, one-way — not recoverable) ----
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return bufToHex(salt) + ":" + bufToHex(hash);
}
async function verifyPassword(password, stored) {
  if (!stored || stored.indexOf(":") === -1) return false;
  const [saltHex, hashHex] = stored.split(":");
  const salt = hexToBuf(saltHex);
  const hash = await pbkdf2(password, salt);
  return bufToHex(hash) === hashHex;
}
async function pbkdf2(password, salt) {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  return new Uint8Array(bits);
}
function bufToHex(buf) { return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join(""); }
function hexToBuf(hex) { const b = new Uint8Array(hex.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16); return b; }

// ---- Session helpers ----
async function createSession(db, username, role, permissions) {
  const token = uuid();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  await db.prepare("INSERT INTO sessions (token, username, role, permissions, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(token, username, role, JSON.stringify(permissions || []), expiresAt).run();
  return token;
}
async function validateSession(db, token) {
  if (!token) return null;
  const row = await db.prepare("SELECT username, role, permissions, expires_at FROM sessions WHERE token = ?").bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  let permissions = [];
  try { permissions = JSON.parse(row.permissions || "[]"); } catch (e) {}
  return { username: row.username, role: row.role, permissions };
}
async function checkSession(db, token, requireSuperAdmin) {
  const session = await validateSession(db, token);
  if (!session) throw new Error("SESSION_INVALID: Session expired or invalid. Please log in again.");
  if (requireSuperAdmin && session.role !== "Super Admin") throw new Error("ACCESS_DENIED: Super Admin only.");
  return session;
}

// ============================================================
// ACTION HANDLERS — same names/signatures as the old code.gs
// ============================================================
const actions = {

  async verifyLogin(db, username, password) {
    const row = await db.prepare("SELECT username, password_hash, email, image, permissions FROM users WHERE username = ? COLLATE NOCASE")
      .bind(String(username).trim()).first();
    if (!row) return { success: false, message: "Invalid credentials. Access Denied." };

    const ok = await verifyPassword(String(password).trim(), row.password_hash);
    if (!ok) return { success: false, message: "Invalid credentials. Access Denied." };

    let perms = [];
    try { perms = JSON.parse(row.permissions || "[]"); } catch (e) {}
    let role = "Agent";
    if (row.username.toUpperCase() === "LIO" || perms.includes("All Access") || perms.includes("Super Admin")) role = "Super Admin";
    else if (perms.includes("Admin")) role = "Admin";

    await actions.saveActivityLogBackend(db, { type: "SYSTEM ACCESS", user: row.username, details: "User logged in (" + role + ")" });
    const token = await createSession(db, row.username, role, perms);

    return {
      success: true, token, username: row.username, name: row.username, role, permissions: perms,
      email: row.email || "",
      avatar: row.image || "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
    };
  },

  async logoutSessionBackend(db, token) {
    await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return { success: true };
  },

  async getUniqueBrands(db, token) {
    try {
      await checkSession(db, token);
      const { results } = await db.prepare("SELECT DISTINCT brand FROM domains WHERE brand != '' ORDER BY brand ASC").all();
      return results.map(r => r.brand);
    } catch (e) { return []; }
  },

  async getDomainsData(db, token) {
    try {
      await checkSession(db, token);
      const { results } = await db.prepare(`SELECT brand, domain, agent, price, expiration, account, notes, redirected,
        pldt, pldt_remarks as pldtRemarks, globe, globe_remarks as globeRemarks,
        converge, converge_remarks as convergeRemarks, dito, dito_remarks as ditoRemarks
        FROM domains ORDER BY id DESC`).all();
      return results;
    } catch (e) { return []; }
  },

  async saveNewDomain(db, token, data) {
    await checkSession(db, token);
    const existing = data.originalDomain ? await db.prepare("SELECT id FROM domains WHERE brand = ? AND domain = ?").bind(data.brand, data.originalDomain).first() : null;
    if (existing) {
      await db.prepare(`UPDATE domains SET brand=?, domain=?, agent=?, price=?, expiration=?, account=?, notes=?, redirected=?, updated_at=datetime('now') WHERE id=?`)
        .bind(data.brand, data.domain, data.agent || "", data.price || "", data.expiration || "", data.account || "", data.notes || "", data.redirected || "", existing.id).run();
      return { success: true, message: "Domain successfully updated!" };
    }
    await db.prepare(`INSERT INTO domains (brand, domain, agent, price, expiration, account, notes, redirected) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(data.brand, data.domain, data.agent || "", data.price || "", data.expiration || "", data.account || "", data.notes || "", data.redirected || "").run();
    return { success: true, message: "New domain successfully registered!" };
  },

  async deleteDomainRecordBackend(db, token, brand, domain) {
    await checkSession(db, token);
    const res = await db.prepare("DELETE FROM domains WHERE brand = ? AND domain = ?").bind(brand, domain).run();
    if (res.meta.changes === 0) return { success: false, message: "Domain not found in the database." };
    return { success: true, message: "Domain deleted successfully." };
  },

  async getUsersData(db, token) {
    try {
      await checkSession(db, token, true);
      const { results } = await db.prepare("SELECT username, email, image, permissions FROM users").all();
      return results.map(r => {
        let perms = []; try { perms = JSON.parse(r.permissions || "[]"); } catch (e) {}
        // password is never sent to the client anymore — hashes aren't recoverable, and shouldn't be either
        return { username: r.username, password: "", email: r.email || "", image: r.image || "", permissions: perms };
      });
    } catch (e) { return []; }
  },

  async saveNewUserBackend(db, token, userObj) {
    await checkSession(db, token, true);
    const hash = await hashPassword(userObj.password);
    await db.prepare("INSERT INTO users (username, password_hash, email, permissions) VALUES (?, ?, ?, ?)")
      .bind(userObj.username, hash, userObj.email || "", JSON.stringify(userObj.permissions || [])).run();
    return { success: true, message: "User successfully created!" };
  },

  async updateUserBackend(db, token, userObj) {
    await checkSession(db, token, true);
    if (userObj.password && userObj.password.trim() !== "") {
      const hash = await hashPassword(userObj.password);
      await db.prepare("UPDATE users SET username=?, password_hash=?, email=?, permissions=? WHERE username=?")
        .bind(userObj.username, hash, userObj.email || "", JSON.stringify(userObj.permissions || []), userObj.originalUsername).run();
    } else {
      await db.prepare("UPDATE users SET username=?, email=?, permissions=? WHERE username=?")
        .bind(userObj.username, userObj.email || "", JSON.stringify(userObj.permissions || []), userObj.originalUsername).run();
    }
    return { success: true, message: "User permissions updated successfully!" };
  },

  async deleteUserBackend(db, token, username) {
    await checkSession(db, token, true);
    const res = await db.prepare("DELETE FROM users WHERE username = ?").bind(username).run();
    if (res.meta.changes === 0) return { success: false, message: "User not found." };
    return { success: true, message: "User deleted successfully." };
  },

  // team is optional — when provided, only that team's rows are pulled (this is the normal
  // path from the per-team tab UI, so we never ship the whole table over the wire for one tab).
  // Omitting it returns everything, kept only for back-compat / small installs.
  // offset/limit are optional — when given, only that page of rows is fetched (the client now
  // pulls a large team like TEAM 001 in 2,000-row pages instead of one giant request, since a
  // single request for 11K+ rows was hanging in the browser even with the CPU-time limit gone —
  // that many rows is just too much to serialize/transfer in one HTTP response). Omitting them
  // keeps the old fetch-everything behavior for back-compat.
  async getPostVerificationData(db, token, team, offset, limit) {
    try {
      await checkSession(db, token);
      const base = `SELECT batch_id as batchId, domain, team, pldt, pldt_remarks as pldtRemarks,
        globe, globe_remarks as globeRemarks, converge, converge_remarks as convergeRemarks,
        dito, dito_remarks as ditoRemarks, cicc, agent FROM dpv_records`;
      let sql = team ? base + ` WHERE team = ? ORDER BY id DESC` : base + ` ORDER BY id DESC`;
      const binds = team ? [team] : [];
      if (limit) { sql += ` LIMIT ? OFFSET ?`; binds.push(limit, offset || 0); }
      const { results } = await db.prepare(sql).bind(...binds).all();
      return results;
    } catch (e) { return []; }
  },

  // Lightweight — just the distinct team names for the tab bar / permission picker.
  // Cheap even at 24K+ rows since it never touches the full row data.
  async getDpvTeams(db, token) {
    try {
      await checkSession(db, token);
      const { results } = await db.prepare(`SELECT DISTINCT team FROM dpv_records WHERE team != '' AND team NOT LIKE '%INIT_%' ORDER BY team ASC`).all();
      return results.map(r => r.team);
    } catch (e) { return []; }
  },

  // Overview stats computed in SQL (COUNT/AVG/GROUP BY) instead of shipping all 24K+ rows to the
  // browser just to count them there — this is the main fix for the DPV Overview being slow at scale.
  async getDpvOverviewStats(db, token) {
    try {
      await checkSession(db, token);
      const scoredCTE = `
        WITH scored AS (
          SELECT team, agent,
            (CASE WHEN pldt LIKE '%active%' OR pldt LIKE '%clear%' THEN 1 ELSE 0 END +
             CASE WHEN globe LIKE '%active%' OR globe LIKE '%clear%' THEN 1 ELSE 0 END +
             CASE WHEN converge LIKE '%active%' OR converge LIKE '%clear%' THEN 1 ELSE 0 END +
             CASE WHEN dito LIKE '%active%' OR dito LIKE '%clear%' THEN 1 ELSE 0 END) AS active_count
          FROM dpv_records WHERE domain NOT LIKE 'init-%'
        )`;

      const totals = await db.prepare(scoredCTE + `
        SELECT COUNT(*) as total,
               SUM(CASE WHEN active_count > 0 THEN 1 ELSE 0 END) as accessible,
               SUM(CASE WHEN active_count = 0 THEN 1 ELSE 0 END) as fullyBlocked,
               COALESCE(AVG(active_count) * 25.0, 0) as avgHealth
        FROM scored`).first();

      const { results: byTeam } = await db.prepare(scoredCTE + `
        SELECT team, COUNT(*) as count, COALESCE(AVG(active_count) * 25.0, 0) as avgHealth
        FROM scored GROUP BY team ORDER BY team ASC`).all();

      const { results: byAgent } = await db.prepare(
        `SELECT COALESCE(NULLIF(TRIM(agent), ''), 'UNKNOWN AGENT') as agent, COUNT(*) as uploads
         FROM dpv_records WHERE domain NOT LIKE 'init-%' GROUP BY agent ORDER BY agent ASC`).all();

      return {
        totalDomains: totals.total || 0,
        accessibleCount: totals.accessible || 0,
        blockedCount: totals.fullyBlocked || 0,
        avgHealth: Math.round(totals.avgHealth || 0),
        teams: byTeam.map(t => ({ team: t.team, count: t.count, avgHealth: Math.round(t.avgHealth || 0) })),
        agents: byAgent.map(a => ({ agent: a.agent.toUpperCase(), uploads: a.uploads }))
      };
    } catch (e) {
      return { totalDomains: 0, accessibleCount: 0, blockedCount: 0, avgHealth: 0, teams: [], agents: [] };
    }
  },

  async saveDpvRecordBackend(db, token, data) {
    await checkSession(db, token);
    if (data.originalDomain) {
      await db.prepare("UPDATE dpv_records SET batch_id=?, domain=?, team=?, cicc=?, agent=?, updated_at=datetime('now') WHERE domain=?")
        .bind(data.batchId, data.domain, data.team, data.cicc || "", data.agent || "", data.originalDomain).run();
      return { success: true, message: "Record successfully updated!" };
    }
    let count = 0;
    for (const dom of (data.domains || [])) {
      try {
        await db.prepare(`INSERT INTO dpv_records (batch_id, domain, team, pldt, globe, converge, dito, cicc, agent) VALUES (?, ?, ?, '-', '-', '-', '-', ?, ?)`)
          .bind(data.batchId, dom, data.team, data.cicc || "", data.agent || "").run();
        count++;
      } catch (e) { /* duplicate domain (unique index) — skip */ }
    }
    return { success: true, message: count + " new record(s) successfully saved!" };
  },

  async deleteDpvRecordBackend(db, token, domainName) {
    await checkSession(db, token);
    const res = await db.prepare("DELETE FROM dpv_records WHERE domain = ?").bind(domainName).run();
    if (res.meta.changes === 0) return { success: false, message: "Record not found in the database." };
    return { success: true, message: "Record permanently deleted." };
  },

  async deleteDpvDuplicatesBackend(db, token, duplicatesToDelete) {
    await checkSession(db, token);
    let count = 0;
    for (const d of (duplicatesToDelete || [])) {
      const res = await db.prepare("DELETE FROM dpv_records WHERE domain = ? AND batch_id = ? AND team = ?")
        .bind(d.domain, d.batchId, d.team).run();
      count += res.meta.changes;
    }
    return { success: true, message: count + " duplicate row(s) successfully cleaned up!" };
  },

  async saveActivityLogBackend(db, logData) {
    await db.prepare("INSERT INTO activity_logs (time, type, user, details) VALUES (?, ?, ?, ?)")
      .bind(new Date().toISOString(), logData.type || "", logData.user || "", logData.details || "").run();
    return { success: true };
  },

  async getActivityLogsBackend(db, token) {
    try {
      await checkSession(db, token);
      const { results } = await db.prepare("SELECT time, type, user, details FROM activity_logs ORDER BY id DESC LIMIT 50").all();
      return results;
    } catch (e) { return []; }
  },

  async bulkUpdateDpvBackend(db, token, data) {
    await checkSession(db, token);
    let count = 0;
    for (const dom of (data.domainsToUpdate || [])) {
      const sets = [], vals = [];
      if (data.updates.cicc) { sets.push("cicc=?"); vals.push(data.updates.cicc); }
      if (data.updates.team) { sets.push("team=?"); vals.push(data.updates.team); }
      if (data.updates.agent) { sets.push("agent=?"); vals.push(data.updates.agent); }
      if (data.updates.status) { sets.push("pldt=?", "globe=?", "converge=?", "dito=?"); vals.push(data.updates.status, data.updates.status, data.updates.status, data.updates.status); }
      if (data.updates.domain && data.domainsToUpdate.length === 1) { sets.push("domain=?"); vals.push(data.updates.domain); }
      if (sets.length === 0) continue;
      vals.push(dom);
      const res = await db.prepare(`UPDATE dpv_records SET ${sets.join(", ")}, updated_at=datetime('now') WHERE domain=?`).bind(...vals).run();
      count += res.meta.changes;
    }
    return { success: true, message: count + " records updated in database." };
  },

  async bulkDeleteDpvBackend(db, token, domainsToDelete) {
    await checkSession(db, token);
    let count = 0;
    for (const dom of (domainsToDelete || [])) {
      const res = await db.prepare("DELETE FROM dpv_records WHERE domain = ?").bind(dom).run();
      count += res.meta.changes;
    }
    return { success: true, message: count + " records permanently deleted." };
  },

  // ---- Automated domain-checker endpoints (Node.js/Playwright pipeline) ----
  // Auth here is a shared API key (env.AUTOMATION_API_KEY), NOT a user session token — this is
  // called by an unattended script, not a logged-in person, so it can't go through checkSession().

  // Tells the checker script which domains to run for a given batch (DATASHEET/dpv_records) or
  // brand (BBC DOMAIN/domains table), optionally narrowed to only the ones missing evidence for
  // one ISP ("retry mode"). Replaces the old sheets.spreadsheets.values.get() read step — the
  // checker no longer needs to track spreadsheet row numbers at all, it just matches by domain.
  async getDomainsToCheck(db, params) {
    var target = (params.target === 'brand') ? 'brand' : 'dpv';
    var isp = String(params.isp || '').toLowerCase();
    var validIsps = ['pldt', 'globe', 'converge', 'dito'];
    if (validIsps.indexOf(isp) === -1) {
      return { success: false, message: "isp must be one of: pldt, globe, converge, dito" };
    }
    if (!params.batch) return { success: false, message: "batch is required." };

    var remarksCol = isp + '_remarks';
    var table = target === 'brand' ? 'domains' : 'dpv_records';
    var matchCol = target === 'brand' ? 'brand' : 'batch_id';

    var sql = `SELECT domain, ${remarksCol} as remarks FROM ${table} WHERE ${matchCol} = ? COLLATE NOCASE`;
    var { results } = await db.prepare(sql).bind(params.batch).all();

    var rows = results || [];
    if (params.retryOnly) {
      rows = rows.filter(function (r) {
        var v = (r.remarks || '').toString();
        return v.indexOf('NO_IMAGE') !== -1 || v.trim() === '';
      });
    }
    return { success: true, domains: rows.map(function (r) { return r.domain; }) };
  },

  // Writes one ISP's check result back. target 'dpv' (default) updates dpv_records by domain
  // (unique); target 'brand' updates the domains table by brand+domain (its unique key) and also
  // requires params.brand. Optional params.redirectedUrl records a REDIRECTED result: for 'brand'
  // it's written straight into domains.redirected; for 'dpv' (which has no such column) it's
  // logged into activity_logs instead, mirroring the old separate "REDIRECTED DOMAINS" tab.
  async submitDomainCheckResult(db, params) {
    var target = (params.target === 'brand') ? 'brand' : 'dpv';
    var isp = String(params.isp || '').toLowerCase();
    var validIsps = ['pldt', 'globe', 'converge', 'dito'];
    if (validIsps.indexOf(isp) === -1) {
      return { success: false, message: "isp must be one of: pldt, globe, converge, dito" };
    }
    if (!params.domain) return { success: false, message: "domain is required." };

    var status = params.status || '';
    var remarks = params.remarks || ''; // e.g. "Aug 18, 2026, 10:45 AM (IMAGE) | https://drive.google.com/..."
    var res;

    if (target === 'brand') {
      if (!params.brand) return { success: false, message: "brand is required when target is 'brand'." };
      var sql = "UPDATE domains SET " + isp + "=?, " + isp + "_remarks=?, updated_at=datetime('now')";
      var binds = [status, remarks];
      if (params.redirectedUrl) { sql += ", redirected=?"; binds.push(params.redirectedUrl); }
      sql += " WHERE brand=? AND domain=?";
      binds.push(params.brand, params.domain);
      res = await db.prepare(sql).bind(...binds).run();
      if (res.meta.changes === 0) {
        return { success: false, message: "No domain record found for '" + params.domain + "' under brand '" + params.brand + "'. Add it in the app first." };
      }
    } else {
      var sql2 = "UPDATE dpv_records SET " + isp + "=?, " + isp + "_remarks=?, updated_at=datetime('now') WHERE domain=?";
      res = await db.prepare(sql2).bind(status, remarks, params.domain).run();
      if (res.meta.changes === 0) {
        return { success: false, message: "No DPV record found for domain '" + params.domain + "'. Add it in the app first." };
      }
      if (params.redirectedUrl) {
        await actions.saveActivityLogBackend(db, {
          type: "REDIRECT", user: "AUTOMATION",
          details: (params.batch ? params.batch + " | " : "") + params.domain + " -> " + params.redirectedUrl
        });
      }
    }
    return { success: true, message: "Updated " + isp.toUpperCase() + " for " + params.domain };
  },

  // Manual test trigger for the Telegram "expiring soon" report — same shared-secret auth as the
  // other automation endpoints. Lets us verify the report/formatting works without waiting for the
  // daily Cron Trigger to fire.
  async runExpiringDomainsReportNow(db, params, env) {
    return await runExpiringDomainsReport(db, env);
  },

  // Manual test triggers for the newer Telegram reports — same shared-secret auth, so they can be
  // verified via a browser URL before relying on the real Telegram commands.
  async runTodayUploadsReportNow(db, params, env) {
    return await runTodayUploadsReport(db, env);
  },
  async runUserKpiReportNow(db, params, env) {
    return await runUserKpiReport(db, env, params.period);
  },
  async runFollowupReportNow(db, params, env) {
    return await runFollowupReport(db, env, params.teamSlug || "");
  },

  // TEMPORARY diagnostic — confirms whether the Telegram secrets are actually reaching the Worker
  // at runtime, without ever revealing their real values (only presence + length + first/last
  // character, enough to catch a stray leading/trailing space typo). Safe to delete once the
  // Telegram report is confirmed working.
  async debugCheckSecrets(db, params, env) {
    function probe(name) {
      const v = env[name];
      if (v === undefined) return { present: false };
      const s = String(v);
      return { present: true, length: s.length, startsWith: s.slice(0, 3), endsWith: s.slice(-3) };
    }
    return {
      TELEGRAM_BOT_TOKEN: probe("TELEGRAM_BOT_TOKEN"),
      TELEGRAM_CHAT_ID: probe("TELEGRAM_CHAT_ID"),
      AUTOMATION_API_KEY: probe("AUTOMATION_API_KEY")
    };
  }
};

// ============================================================
// SCHEDULED REPORT — "Domains Expiring Soon" → Telegram
// Runs automatically via the Worker's Cron Trigger (Workers & Pages > bbc-api-gateway > Triggers).
// ============================================================

// The domains.expiration column is free text, always written as "D-MMM-YY" (e.g. "8-Apr-26") by
// the CSV import — this parses that exact format into a real Date. Anything that doesn't match is
// skipped rather than guessed at, so a malformed row never silently produces a wrong alert.
function parseExpirationDate(raw) {
  if (!raw) return null;
  var months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var m = String(raw).trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  var day = parseInt(m[1], 10);
  var mon = months[m[2].toLowerCase()];
  if (mon === undefined) return null;
  var year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  var d = new Date(Date.UTC(year, mon, day));
  return isNaN(d.getTime()) ? null : d;
}

function formatDateHuman(d) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegramMessage(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return { ok: false, description: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID secret on the Worker." };
  }
  const res = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text, parse_mode: "HTML", disable_web_page_preview: true })
  });
  return res.json();
}

// Groups by brand + registrar account + exact expiration date (domains registered together almost
// always share all three), within a rolling window matching the team's existing manual practice of
// flagging domains 15 days out. Domains already past their expiration are treated as even more
// urgent and still included (negative "day(s) left" makes that obvious in the message) rather than
// silently dropped once the date has passed. Shows the registrar account (e.g. "Godaddy") — the
// person renewing needs to know WHERE to log in and renew, not who last touched the record.
async function runExpiringDomainsReport(db, env) {
  const WARNING_DAYS = 15;
  const MAX_MESSAGE_LEN = 3800; // Telegram's real hard limit is 4096 chars/message — leaving headroom

  const { results } = await db.prepare(
    "SELECT brand, domain, account, expiration FROM domains WHERE expiration != '' ORDER BY brand ASC"
  ).all();

  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const groups = {};

  results.forEach(function (r) {
    const expDate = parseExpirationDate(r.expiration);
    if (!expDate) return;
    const daysLeft = Math.round((expDate - today) / 86400000);
    if (daysLeft > WARNING_DAYS) return; // not yet within the alert window

    const key = r.brand + "|" + (r.account || "UNASSIGNED") + "|" + r.expiration;
    if (!groups[key]) groups[key] = { brand: r.brand, account: r.account || "UNASSIGNED", expDate: expDate, daysLeft: daysLeft, domains: [] };
    groups[key].domains.push(r.domain);
  });

  const groupList = Object.values(groups).sort(function (a, b) { return a.daysLeft - b.daysLeft; });

  if (groupList.length === 0) {
    return { success: true, sent: false, message: "No domains expiring within " + WARNING_DAYS + " days — nothing to report." };
  }

  // Flatten into individual lines (one per group-header, one per domain) so packing into
  // Telegram's 4096-char message limit never needs a special case for an oversized group — a
  // brand with a huge domain list just spills naturally into the next message.
  const lines = [];
  groupList.forEach(function (g) {
    const label = g.daysLeft < 0 ? Math.abs(g.daysLeft) + " day(s) OVERDUE" : g.daysLeft + " day(s) left";
    lines.push("📁 <b>" + escapeHtml(g.brand) + "</b> — Registrar Account: " + escapeHtml(g.account) + "\n🗓 " + label + " (Exp: " + formatDateHuman(g.expDate) + ")");
    g.domains.forEach(function (d) { lines.push("• " + escapeHtml(d)); });
    lines.push(""); // blank spacer between groups
  });

  const HEADER_TEXT = "⚠️ <b>DOMAINS EXPIRING SOON</b>\n<i>Source: BBC Dashboard Domain</i>\n\n";
  const chunks = [];
  let current = HEADER_TEXT;
  lines.forEach(function (line) {
    if ((current + line + "\n").length > MAX_MESSAGE_LEN) {
      chunks.push(current.trim());
      current = "";
    }
    current += line + "\n";
  });
  if (current.trim()) chunks.push(current.trim());

  const sendResults = [];
  for (let i = 0; i < chunks.length; i++) {
    const prefix = chunks.length > 1 ? "<i>(Part " + (i + 1) + "/" + chunks.length + ")</i>\n" : "";
    sendResults.push(await sendTelegramMessage(env, prefix + chunks[i]));
  }

  return { success: true, sent: true, groups: groupList.length, chunks: chunks.length, telegram: sendResults };
}

// Packs an array of pre-built lines into <=3800-char Telegram messages and sends each one in
// order, prefixing "(Part X/Y)" whenever more than one message is needed. Shared by every report
// below so none of them have to re-implement Telegram's 4096-char message limit themselves.
async function sendChunkedTelegramReport(env, headerText, lines) {
  const MAX_MESSAGE_LEN = 3800;
  const chunks = [];
  let current = headerText;
  lines.forEach(function (line) {
    if ((current + line + "\n").length > MAX_MESSAGE_LEN) {
      chunks.push(current.trim());
      current = "";
    }
    current += line + "\n";
  });
  if (current.trim()) chunks.push(current.trim());

  const sendResults = [];
  for (let i = 0; i < chunks.length; i++) {
    const prefix = chunks.length > 1 ? "<i>(Part " + (i + 1) + "/" + chunks.length + ")</i>\n" : "";
    sendResults.push(await sendTelegramMessage(env, prefix + chunks[i]));
  }
  return sendResults;
}

// Sends a file as a Telegram document attachment (e.g. a CSV follow-up report). Uses multipart
// form data, same as sendMessage but through the sendDocument endpoint.
async function sendTelegramDocument(env, filename, content, mimeType, caption) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return { ok: false, description: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID secret on the Worker." };
  }
  const formData = new FormData();
  formData.append("chat_id", env.TELEGRAM_CHAT_ID);
  if (caption) formData.append("caption", caption);
  formData.append("document", new Blob([content], { type: mimeType }), filename);
  const res = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendDocument", {
    method: "POST",
    body: formData
  });
  return res.json();
}

// Plain CSV builder (with a UTF-8 BOM so Excel opens special characters correctly) — used by the
// follow-up report's file attachment.
function buildCsvString(headers, rows) {
  function esc(v) {
    v = (v === undefined || v === null) ? "" : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  const lines = [headers.map(esc).join(",")];
  rows.forEach(function (r) { lines.push(r.map(esc).join(",")); });
  return "﻿" + lines.join("\r\n");
}

// "YYYY-MM-DD HH:MM:SS" for the start of "today" in Philippine time (UTC+8, no DST) — matches the
// text format SQLite's datetime('now') writes into created_at, so a plain string comparison works.
function getPHTodayStartSQL() {
  const now = new Date();
  const phShifted = new Date(now.getTime() + 8 * 3600000);
  const y = phShifted.getUTCFullYear(), m = phShifted.getUTCMonth(), d = phShifted.getUTCDate();
  const phMidnightUTC = new Date(Date.UTC(y, m, d, 0, 0, 0) - 8 * 3600000);
  return phMidnightUTC.toISOString().slice(0, 19).replace("T", " ");
}

// Same format, but N days back from right now — used for the weekly/monthly KPI window.
function getPeriodStartSQL(daysBack) {
  return new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 19).replace("T", " ");
}

function isIspActive(val) {
  const s = (val || "").toString().toLowerCase();
  return s.includes("active") || s.includes("clear");
}

// Turns a team name into a Telegram-command-safe slug (letters/digits/underscore only) — e.g.
// "TEAM 001" -> "team_001", "Kyle Batch" -> "kyle_batch". Used both directions: to build the
// "/Followup_teamname" command a person would type, and to match a typed command back to the real
// team name stored in the database.
function slugifyTeam(team) {
  return String(team).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// ---- Report 1: who uploaded what today (BBC Dashboard Domain + DPV combined), grouped by agent ----
async function runTodayUploadsReport(db, env) {
  const startSQL = getPHTodayStartSQL();

  const { results: bbcRows } = await db.prepare(
    "SELECT agent, brand, domain FROM domains WHERE created_at >= ? ORDER BY agent ASC"
  ).bind(startSQL).all();
  const { results: dpvRows } = await db.prepare(
    "SELECT agent, team, domain FROM dpv_records WHERE created_at >= ? AND domain NOT LIKE 'init-%' ORDER BY agent ASC"
  ).bind(startSQL).all();

  const byAgent = {};
  bbcRows.forEach(function (r) {
    const ag = (r.agent || "UNASSIGNED").trim() || "UNASSIGNED";
    if (!byAgent[ag]) byAgent[ag] = [];
    byAgent[ag].push("[BBC] " + r.brand + " — " + r.domain);
  });
  dpvRows.forEach(function (r) {
    const ag = (r.agent || "UNASSIGNED").trim() || "UNASSIGNED";
    if (!byAgent[ag]) byAgent[ag] = [];
    byAgent[ag].push("[DPV] " + (r.team || "?") + " — " + r.domain);
  });

  const agents = Object.keys(byAgent).sort();
  if (agents.length === 0) {
    await sendTelegramMessage(env, "📋 <b>TODAY'S UPLOADS</b>\n\nWalang na-upload na domain ngayong araw.");
    return { success: true, sent: true, agents: 0 };
  }

  const lines = [];
  agents.forEach(function (ag) {
    lines.push("👤 <b>" + escapeHtml(ag) + "</b> — " + byAgent[ag].length + " upload(s)");
    byAgent[ag].forEach(function (item) { lines.push("• " + escapeHtml(item)); });
    lines.push("");
  });

  await sendChunkedTelegramReport(env, "📋 <b>TODAY'S UPLOADS</b>\n\n", lines);
  return { success: true, sent: true, agents: agents.length };
}

// ---- Report 2: upload-count leaderboard per agent, across BBC + DPV, for the last week/month ----
// Deliberately limited to raw upload counts for now — duplicate-attempt logging and per-user
// ISP-update attribution don't exist yet (see the earlier discussion), so those can't be included
// without risking a misleading "Top Performer" call.
async function runUserKpiReport(db, env, periodArg) {
  const period = (periodArg || "week").toLowerCase();
  const days = period === "month" ? 30 : 7;
  const startSQL = getPeriodStartSQL(days);
  const periodLabel = period === "month" ? "Last 30 Days" : "Last 7 Days";

  const { results: bbcCounts } = await db.prepare(
    "SELECT COALESCE(NULLIF(TRIM(agent),''),'UNASSIGNED') as agent, COUNT(*) as cnt FROM domains WHERE created_at >= ? GROUP BY agent"
  ).bind(startSQL).all();
  const { results: dpvCounts } = await db.prepare(
    "SELECT COALESCE(NULLIF(TRIM(agent),''),'UNASSIGNED') as agent, COUNT(*) as cnt FROM dpv_records WHERE created_at >= ? AND domain NOT LIKE 'init-%' GROUP BY agent"
  ).bind(startSQL).all();

  const totals = {};
  bbcCounts.forEach(function (r) { totals[r.agent] = totals[r.agent] || { bbc: 0, dpv: 0 }; totals[r.agent].bbc = r.cnt; });
  dpvCounts.forEach(function (r) { totals[r.agent] = totals[r.agent] || { bbc: 0, dpv: 0 }; totals[r.agent].dpv = r.cnt; });

  const leaderboard = Object.keys(totals).map(function (agent) {
    const t = totals[agent];
    return { agent: agent, bbc: t.bbc || 0, dpv: t.dpv || 0, total: (t.bbc || 0) + (t.dpv || 0) };
  }).sort(function (a, b) { return b.total - a.total; });

  if (leaderboard.length === 0) {
    await sendTelegramMessage(env, "📊 <b>USER KPI — " + periodLabel + "</b>\n\nWalang recorded uploads sa loob ng period na ito.");
    return { success: true, sent: true, agents: 0 };
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines = leaderboard.map(function (row, i) {
    const medal = medals[i] || "▪️";
    return medal + " <b>" + escapeHtml(row.agent) + "</b> — " + row.total + " upload(s) total (BBC: " + row.bbc + ", DPV: " + row.dpv + ")";
  });

  const header = "📊 <b>USER KPI — " + periodLabel + "</b>\n" +
    "<i>Note: bilang ng uploads lang muna (hindi pa kasama duplicate-attempts o ISP-update activity)</i>\n" +
    "🏆 <b>Top Performer: " + escapeHtml(leaderboard[0].agent) + "</b>\n\n";

  await sendChunkedTelegramReport(env, header, lines);
  return { success: true, sent: true, agents: leaderboard.length, topPerformer: leaderboard[0].agent };
}

// ---- Report 3: DPV domains still ACTIVE on at least one ISP for one team — needs a follow-up
// check/reblock — sent as a text summary plus a CSV attachment. ----
async function runFollowupReport(db, env, teamSlug) {
  const { results: allTeams } = await db.prepare(
    "SELECT DISTINCT team FROM dpv_records WHERE team != '' AND team NOT LIKE '%INIT_%'"
  ).all();
  // Compared with ALL non-letters/digits stripped (not just slugified) so "/Followup_TEAM001" and
  // "/Followup_TEAM_001" both match a real team named "TEAM 001" regardless of whether the person
  // typed the underscore — Telegram commands can't contain spaces, so we can't require an exact match.
  const alnum = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ""); };
  const wantedAlnum = alnum(teamSlug);
  const matchedTeam = allTeams.map(function (r) { return r.team; }).find(function (t) { return alnum(t) === wantedAlnum; });

  if (!matchedTeam) {
    await sendTelegramMessage(env, "⚠️ Hindi nakita ang team na tumutugma sa '<b>" + escapeHtml(teamSlug) + "</b>'. Gamitin ang format: /Followup_TeamName (hal. /Followup_TEAM001)");
    return { success: false, message: "Team not found for slug: " + teamSlug };
  }

  const { results } = await db.prepare(
    "SELECT batch_id, domain, cicc, pldt, globe, converge, dito FROM dpv_records WHERE team = ? AND domain NOT LIKE 'init-%' ORDER BY batch_id ASC"
  ).bind(matchedTeam).all();

  const followUps = results.filter(function (r) {
    return isIspActive(r.pldt) || isIspActive(r.globe) || isIspActive(r.converge) || isIspActive(r.dito);
  }).map(function (r) {
    const activeIsps = [];
    if (isIspActive(r.pldt)) activeIsps.push("PLDT");
    if (isIspActive(r.globe)) activeIsps.push("GLOBE");
    if (isIspActive(r.converge)) activeIsps.push("CONVERGE");
    if (isIspActive(r.dito)) activeIsps.push("DITO");
    return { team: matchedTeam, batchId: r.batch_id, domain: r.domain, cicc: r.cicc || "-", status: activeIsps.join("/") + " ACTIVE" };
  });

  if (followUps.length === 0) {
    await sendTelegramMessage(env, "✅ Walang domain na kailangan pa i-follow up para sa <b>" + escapeHtml(matchedTeam) + "</b> — naka-block na ang lahat sa apat na ISP.");
    return { success: true, sent: true, count: 0 };
  }

  const headers = ["Assigned Team", "Batch ID", "Domain", "CICC Ref Number", "Status"];
  const csvRows = followUps.map(function (f) { return [f.team, f.batchId, f.domain, f.cicc, f.status]; });
  const csvContent = buildCsvString(headers, csvRows);
  const filename = "Followup_" + slugifyTeam(matchedTeam) + ".csv";
  const caption = "📌 Follow-up Report: " + matchedTeam + " — " + followUps.length + " domain(s) still ACTIVE on at least one ISP.";

  const docRes = await sendTelegramDocument(env, filename, csvContent, "text/csv", caption);
  return { success: true, sent: true, count: followUps.length, telegram: docRes };
}

// ============================================================
// TELEGRAM BOT COMMANDS — on-demand reports triggered by typing a keyword in the group
// (e.g. "/domainToRenew"). Requires a one-time setup step: tell Telegram to forward messages
// to this Worker via setWebhook (see the instructions given alongside this code).
// ============================================================

// Add new commands here — key is the exact command text (lowercase, no leading "/"), value is an
// async function(env, arg) that runs and sends its own reply ("arg" is whatever text follows the
// command, e.g. "/userKpi month" -> arg = "month"). To add a new keyword-triggered report later,
// just add another entry; no other code needs to change. "/Followup_<teamname>" is handled
// separately below since it's a dynamic prefix, not a fixed word.
const TELEGRAM_COMMANDS = {
  "domaintorenew": async function (env) { await runExpiringDomainsReport(env.DB, env); },
  "todayuploads": async function (env) { await runTodayUploadsReport(env.DB, env); },
  "date_username_report": async function (env) { await runTodayUploadsReport(env.DB, env); }, // alias
  "userkpi": async function (env, arg) { await runUserKpiReport(env.DB, env, arg); },
};

// Telegram POSTs every message the bot can see to this same Worker URL once a webhook is set.
// Update payloads always have "update_id" — that's how we tell a Telegram webhook call apart from
// our own {action, args} API calls, which never have that field.
function isTelegramWebhookPayload(body) {
  return body && typeof body === "object" && body.update_id !== undefined;
}

async function handleTelegramWebhook(body, env) {
  try {
    const text = body.message && body.message.text ? body.message.text.trim() : "";
    if (!text.startsWith("/")) return; // not a command — ignore (regular chatter in the group)

    // Strips a leading "/" and an optional "@botusername" suffix (Telegram appends the bot's own
    // username to commands typed in a group, e.g. "/domainToRenew@bbcsec_domain_alerts_bot").
    // Anything after the first space is passed through as "arg" (e.g. "/userKpi month").
    const withoutSlash = text.slice(1);
    const parts = withoutSlash.split(" ");
    const command = parts[0].split("@")[0].toLowerCase();
    const arg = parts.slice(1).join(" ").trim();

    if (command.indexOf("followup_") === 0) {
      await runFollowupReport(env.DB, env, command.slice("followup_".length));
      return;
    }

    const handler = TELEGRAM_COMMANDS[command];
    if (handler) await handler(env, arg);
  } catch (e) {
    // Never let a bad command crash the webhook response — Telegram will keep retrying a failing
    // webhook, which would just spam the same error over and over.
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    if (!env.DB) {
      return json({ success: false, message: "D1 database not bound to this Worker. Add a 'DB' binding in Settings > Bindings." }, 500);
    }

    try {
      let action, args;
      if (request.method === "POST") {
        const body = JSON.parse(await request.text());

        // Telegram webhook calls (someone typed a command in the group) look completely different
        // from our own {action, args} API calls — handle them separately and return immediately.
        if (isTelegramWebhookPayload(body)) {
          await handleTelegramWebhook(body, env);
          return new Response("OK", { status: 200 });
        }

        action = body.action; args = body.args || [];
      } else {
        const url = new URL(request.url);
        action = url.searchParams.get("action");
        args = url.searchParams.get("args") ? JSON.parse(url.searchParams.get("args")) : [];
      }

      if (!action || typeof actions[action] !== "function") {
        return json({ success: false, message: "Action blocked by API Gateway." }, 404);
      }

      // Machine-to-machine actions: gated by a shared secret (env.AUTOMATION_API_KEY), not a user
      // session — the domain-checker script has no human logging in to hand it a token.
      const automationActions = ["submitDomainCheckResult", "getDomainsToCheck", "runExpiringDomainsReportNow", "debugCheckSecrets", "runTodayUploadsReportNow", "runUserKpiReportNow", "runFollowupReportNow"];
      if (automationActions.indexOf(action) !== -1) {
        const apiKey = args[0];
        const params = args[1] || {};
        if (!env.AUTOMATION_API_KEY || apiKey !== env.AUTOMATION_API_KEY) {
          return json({ success: false, message: "Invalid or missing automation API key." }, 401);
        }
        // env is passed through (not just env.DB) because runExpiringDomainsReportNow needs
        // env.TELEGRAM_BOT_TOKEN / env.TELEGRAM_CHAT_ID, not just the database binding.
        const result = await actions[action](env.DB, params, env);
        return json(result);
      }

      const result = await actions[action](env.DB, ...args);
      return json(result);

    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      return json({ success: false, message: msg }, 500);
    }
  },

  // Fired automatically by the Cron Trigger (Workers & Pages > bbc-api-gateway > Triggers >
  // Cron Triggers) — no HTTP request involved. ctx.waitUntil keeps the Worker alive until the
  // report finishes sending, since there's no request to hold the invocation open otherwise.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runExpiringDomainsReport(env.DB, env));
  }
};

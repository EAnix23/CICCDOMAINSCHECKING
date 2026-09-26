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
async function createSession(db, username, role, permissions, team) {
  const token = uuid();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  await db.prepare("INSERT INTO sessions (token, username, role, permissions, expires_at, team) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(token, username, role, JSON.stringify(permissions || []), expiresAt, team || "").run();
  return token;
}
async function validateSession(db, token) {
  if (!token) return null;
  const row = await db.prepare("SELECT username, role, permissions, expires_at, team FROM sessions WHERE token = ?").bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  let permissions = [];
  try { permissions = JSON.parse(row.permissions || "[]"); } catch (e) {}
  return { username: row.username, role: row.role, permissions, team: row.team || "" };
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
    const row = await db.prepare("SELECT username, password_hash, email, image, permissions, team FROM users WHERE username = ? COLLATE NOCASE")
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
    const team = row.team || "";
    const token = await createSession(db, row.username, role, perms, team);

    return {
      success: true, token, username: row.username, name: row.username, role, permissions: perms, team,
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
      const { results } = await db.prepare("SELECT username, email, image, permissions, team, hrid_number, position, sub_department, rest_day, full_name FROM users").all();
      return results.map(r => {
        let perms = []; try { perms = JSON.parse(r.permissions || "[]"); } catch (e) {}
        // password is never sent to the client anymore — hashes aren't recoverable, and shouldn't be either
        return {
          username: r.username, password: "", email: r.email || "", image: r.image || "", permissions: perms, team: r.team || "",
          hridNumber: r.hrid_number || "", position: r.position || "", subDepartment: r.sub_department || "", restDay: r.rest_day || "",
          fullName: r.full_name || ""
        };
      });
    } catch (e) { return []; }
  },

  async saveNewUserBackend(db, token, userObj) {
    await checkSession(db, token, true);
    const hash = await hashPassword(userObj.password);
    await db.prepare("INSERT INTO users (username, password_hash, email, permissions, team, hrid_number, position, sub_department, rest_day, full_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(userObj.username, hash, userObj.email || "", JSON.stringify(userObj.permissions || []), userObj.team || "",
        userObj.hridNumber || "", userObj.position || "", userObj.subDepartment || "", userObj.restDay || "", userObj.fullName || "").run();
    return { success: true, message: "User successfully created!" };
  },

  async updateUserBackend(db, token, userObj) {
    await checkSession(db, token, true);
    if (userObj.password && userObj.password.trim() !== "") {
      const hash = await hashPassword(userObj.password);
      await db.prepare("UPDATE users SET username=?, password_hash=?, email=?, permissions=?, team=?, hrid_number=?, position=?, sub_department=?, rest_day=?, full_name=? WHERE username=?")
        .bind(userObj.username, hash, userObj.email || "", JSON.stringify(userObj.permissions || []), userObj.team || "",
          userObj.hridNumber || "", userObj.position || "", userObj.subDepartment || "", userObj.restDay || "", userObj.fullName || "", userObj.originalUsername).run();
    } else {
      await db.prepare("UPDATE users SET username=?, email=?, permissions=?, team=?, hrid_number=?, position=?, sub_department=?, rest_day=?, full_name=? WHERE username=?")
        .bind(userObj.username, userObj.email || "", JSON.stringify(userObj.permissions || []), userObj.team || "",
          userObj.hridNumber || "", userObj.position || "", userObj.subDepartment || "", userObj.restDay || "", userObj.fullName || "", userObj.originalUsername).run();
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

  // Matches the first name the checker.js operator typed against users.full_name, so the bot can
  // attribute every check it submits to a real system username without requiring a login/token.
  // full_name is stored inconsistently across teams — "LASTNAME, FIRSTNAME" for some (Team 001),
  // plain "FIRSTNAME LASTNAME" for others (Team 002) — so the first-name extraction has to handle
  // both: split on the comma when present (first name is what follows it), otherwise take the
  // first word. Tries an exact full-name match first (lets someone disambiguate by typing more).
  async resolveKpiOperator(db, params) {
    const raw = String(params.name || '').trim();
    if (!raw) return { success: false, message: "Pakilagay ang pangalan." };
    const nameLower = raw.toLowerCase();
    function firstNameOf(fullName) {
      const s = (fullName || '').trim();
      if (s.indexOf(',') !== -1) {
        const afterComma = s.split(',').slice(1).join(',').trim();
        return (afterComma.split(/\s+/)[0] || '').toLowerCase();
      }
      return (s.split(/\s+/)[0] || '').toLowerCase();
    }
    const { results } = await db.prepare("SELECT username, full_name as fullName, team FROM users WHERE full_name != ''").all();
    const all = results || [];
    const exact = all.filter(u => (u.fullName || '').trim().toLowerCase() === nameLower);
    if (exact.length === 1) return { success: true, username: exact[0].username, fullName: exact[0].fullName, team: exact[0].team };
    const firstMatches = all.filter(u => firstNameOf(u.fullName) === nameLower);
    if (firstMatches.length === 1) return { success: true, username: firstMatches[0].username, fullName: firstMatches[0].fullName, team: firstMatches[0].team };
    if (firstMatches.length > 1) {
      return {
        success: false, ambiguous: true,
        message: "May " + firstMatches.length + " user na ang first name ay '" + raw + "': " + firstMatches.map(m => m.fullName + " (" + m.username + ")").join(", ") + ". I-type ang buong pangalan para malinaw.",
      };
    }
    return { success: false, message: "Walang user na nahanap sa system na ang pangalan ay '" + raw + "'. I-check kung tama ang Full Name sa User Management." };
  },

  // Writes one ISP's check result back. target 'dpv' (default) updates dpv_records by domain
  // (unique); target 'brand' updates the domains table by brand+domain (its unique key) and also
  // requires params.brand. Optional params.redirectedUrl records a REDIRECTED result: for 'brand'
  // it's written straight into domains.redirected; for 'dpv' (which has no such column) it's
  // logged into activity_logs instead, mirroring the old separate "REDIRECTED DOMAINS" tab.
  // params.operatorUsername/operatorTeam (set by checker.js after resolveKpiOperator) get logged
  // into kpi_domain_checks so the KPI dashboard can show who actually checked which domains.
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

    if (params.operatorUsername) {
      await db.prepare("INSERT INTO kpi_domain_checks (username, team, target, batch, domain, isp, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(params.operatorUsername, params.operatorTeam || '', target, params.batch || '', params.domain, isp, status).run();
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
  },

  // ============================================================
  // KPI REPORT — per-team To-Do (auto + manual), Time In/Out, Achievements.
  // "team" comes from users.team, assigned per-account in User Management.
  // A non-Super-Admin caller is always pinned to their own session team, no
  // matter what team they pass in — stops an Agent from reading another team's data.
  // ============================================================

  async getKpiTeams(db, token) {
    const session = await checkSession(db, token);
    if (session.role === "Super Admin") {
      const { results } = await db.prepare("SELECT DISTINCT team FROM users WHERE team != '' ORDER BY team ASC").all();
      return results.map(r => r.team);
    }
    return session.team ? [session.team] : [];
  },

  async getKpiTodayTasks(db, token, team) {
    const session = await checkSession(db, token);
    const targetTeam = session.role === "Super Admin" ? (team || session.team || "") : (session.team || "");
    if (!targetTeam) return { autoTasks: [], manualTasks: [], members: [], team: "" };

    const startSQL = getPHTodayStartSQL();
    const { results: bbcRows } = await db.prepare(
      `SELECT agent, brand, domain FROM domains WHERE created_at >= ? AND agent IN (SELECT username FROM users WHERE team = ?) ORDER BY agent ASC`
    ).bind(startSQL, targetTeam).all();
    const { results: dpvRows } = await db.prepare(
      `SELECT agent, domain FROM dpv_records WHERE created_at >= ? AND team = ? AND domain NOT LIKE 'init-%' ORDER BY agent ASC`
    ).bind(startSQL, targetTeam).all();

    // Super Admin can assign a task to anyone across every team they manage, not just this one —
    // an Agent/Admin only ever sees their own team, so they're still limited to targetTeam.
    const memberResult = session.role === "Super Admin"
      ? await db.prepare("SELECT username, full_name as fullName FROM users WHERE team != '' ORDER BY username ASC").all()
      : await db.prepare("SELECT username, full_name as fullName FROM users WHERE team = ? ORDER BY username ASC").bind(targetTeam).all();
    const { results: memberRows } = memberResult;
    const nameMap = {};
    memberRows.forEach(function (r) { nameMap[r.username] = r.fullName || r.username; });

    const autoTasks = [];
    bbcRows.forEach(function (r) { autoTasks.push({ label: "[BBC] " + r.brand + " — " + r.domain, agent: r.agent || "", agentName: nameMap[r.agent] || r.agent || "" }); });
    dpvRows.forEach(function (r) { autoTasks.push({ label: "[DPV] " + r.domain, agent: r.agent || "", agentName: nameMap[r.agent] || r.agent || "" }); });

    // Manual tasks are a persistent Kanban board, not scoped to today — a card created yesterday
    // and still "In Progress" needs to keep showing up, not vanish once the date rolls over.
    const { results: manualTasksRaw } = await db.prepare(
      "SELECT id, title, status, created_by, assigned_to as assignedTo, created_at FROM kpi_tasks WHERE team = ? ORDER BY id DESC"
    ).bind(targetTeam).all();
    const manualTasks = manualTasksRaw.map(function (t) {
      return Object.assign({}, t, { assignedToName: t.assignedTo ? (nameMap[t.assignedTo] || t.assignedTo) : "", createdByName: nameMap[t.created_by] || t.created_by });
    });

    return { autoTasks, manualTasks, members: memberRows.map(r => ({ username: r.username, fullName: r.fullName || r.username })), team: targetTeam };
  },

  async addKpiManualTask(db, token, team, title, assignedTo) {
    const session = await checkSession(db, token);
    const targetTeam = session.role === "Super Admin" ? (team || session.team || "") : (session.team || "");
    if (!targetTeam) return { success: false, message: "No team assigned to your account." };
    if (!title || !title.trim()) return { success: false, message: "Task title is required." };
    await db.prepare("INSERT INTO kpi_tasks (team, task_type, title, status, created_by, task_date, assigned_to) VALUES (?, 'manual', ?, 'todo', ?, ?, ?)")
      .bind(targetTeam, title.trim(), session.username, getPHDateStr(), assignedTo || "").run();
    return { success: true, message: "Task added." };
  },

  // Kanban-style status move (To Do / In Progress / Done) — replaces the old pending/done toggle.
  async updateKpiTaskStatus(db, token, taskId, status) {
    await checkSession(db, token);
    const validStatuses = ["todo", "in_progress", "done"];
    const newStatus = validStatuses.indexOf(status) !== -1 ? status : "todo";
    const res = await db.prepare("UPDATE kpi_tasks SET status=?, updated_at=datetime('now') WHERE id=?").bind(newStatus, taskId).run();
    if (res.meta.changes === 0) return { success: false, message: "Task not found." };
    return { success: true, status: newStatus };
  },

  async deleteKpiTask(db, token, taskId) {
    await checkSession(db, token);
    await db.prepare("DELETE FROM kpi_tasks WHERE id = ?").bind(taskId).run();
    return { success: true };
  },

  async getKpiAttendanceToday(db, token) {
    const session = await checkSession(db, token);
    const row = await db.prepare("SELECT time_in, time_out, break_start, break_end FROM kpi_attendance WHERE username = ? AND date = ?")
      .bind(session.username, getPHDateStr()).first();
    return row || { time_in: "", time_out: "", break_start: "", break_end: "" };
  },

  async kpiBreakStart(db, token) {
    const session = await checkSession(db, token);
    const today = getPHDateStr();
    const existing = await db.prepare("SELECT id, time_in, time_out, break_start FROM kpi_attendance WHERE username = ? AND date = ?").bind(session.username, today).first();
    if (!existing || !existing.time_in) return { success: false, message: "You haven't logged a Time In today." };
    if (existing.time_out) return { success: false, message: "You're already done for today." };
    if (existing.break_start) return { success: false, message: "You already have a Break Start logged today." };
    const nowTime = getPHTimeStr();
    await db.prepare("UPDATE kpi_attendance SET break_start=? WHERE id=?").bind(nowTime, existing.id).run();
    return { success: true, break_start: nowTime };
  },

  async kpiBreakEnd(db, token) {
    const session = await checkSession(db, token);
    const today = getPHDateStr();
    const existing = await db.prepare("SELECT id, break_start, break_end FROM kpi_attendance WHERE username = ? AND date = ?").bind(session.username, today).first();
    if (!existing || !existing.break_start) return { success: false, message: "You haven't logged a Break Start today." };
    if (existing.break_end) return { success: false, message: "You already have a Break End logged today." };
    const nowTime = getPHTimeStr();
    await db.prepare("UPDATE kpi_attendance SET break_end=? WHERE id=?").bind(nowTime, existing.id).run();
    return { success: true, break_end: nowTime };
  },

  async kpiTimeIn(db, token) {
    const session = await checkSession(db, token);
    const today = getPHDateStr();
    const existing = await db.prepare("SELECT id, time_in FROM kpi_attendance WHERE username = ? AND date = ?").bind(session.username, today).first();
    if (existing && existing.time_in) return { success: false, message: "You already have a Time In logged today." };
    const nowTime = getPHTimeStr();
    if (existing) {
      await db.prepare("UPDATE kpi_attendance SET time_in=? WHERE id=?").bind(nowTime, existing.id).run();
    } else {
      await db.prepare("INSERT INTO kpi_attendance (username, team, date, time_in) VALUES (?, ?, ?, ?)")
        .bind(session.username, session.team || "", today, nowTime).run();
    }
    return { success: true, time_in: nowTime };
  },

  async kpiTimeOut(db, token) {
    const session = await checkSession(db, token);
    const today = getPHDateStr();
    const existing = await db.prepare("SELECT id, time_in, time_out FROM kpi_attendance WHERE username = ? AND date = ?").bind(session.username, today).first();
    if (!existing || !existing.time_in) return { success: false, message: "You haven't logged a Time In today." };
    if (existing.time_out) return { success: false, message: "You already have a Time Out logged today." };
    const nowTime = getPHTimeStr();
    await db.prepare("UPDATE kpi_attendance SET time_out=? WHERE id=?").bind(nowTime, existing.id).run();
    return { success: true, time_out: nowTime };
  },

  async getKpiAttendanceLog(db, token, team) {
    const session = await checkSession(db, token);
    const targetTeam = session.role === "Super Admin" ? (team || session.team || "") : (session.team || "");
    if (!targetTeam) return [];
    const startSQL = getPeriodStartSQL(14);
    const { results } = await db.prepare(
      "SELECT username, date, time_in, time_out FROM kpi_attendance WHERE team = ? AND date >= substr(?,1,10) ORDER BY date DESC, username ASC"
    ).bind(targetTeam, startSQL).all();
    return results;
  },

  async getKpiAchievements(db, token, team) {
    const session = await checkSession(db, token);
    const targetTeam = session.role === "Super Admin" ? (team || session.team || "") : (session.team || "");
    if (!targetTeam) return [];
    const { results } = await db.prepare(
      "SELECT id, category, title, description, created_by, created_at, " +
      "(SELECT full_name FROM users WHERE username = kpi_achievements.created_by) as createdByName " +
      "FROM kpi_achievements WHERE team = ? ORDER BY id DESC"
    ).bind(targetTeam).all();
    return results.map(function (r) { return Object.assign({}, r, { createdByName: r.createdByName || r.created_by }); });
  },

  async addKpiAchievement(db, token, team, category, title, description) {
    const session = await checkSession(db, token);
    const targetTeam = session.role === "Super Admin" ? (team || session.team || "") : (session.team || "");
    if (!targetTeam) return { success: false, message: "No team assigned to your account." };
    if (!title || !title.trim()) return { success: false, message: "Title is required." };
    const cat = ["accomplishment", "ongoing", "achievement"].indexOf(category) !== -1 ? category : "accomplishment";
    await db.prepare("INSERT INTO kpi_achievements (team, category, title, description, created_by) VALUES (?, ?, ?, ?, ?)")
      .bind(targetTeam, cat, title.trim(), (description || "").trim(), session.username).run();
    return { success: true, message: "Added." };
  },

  async deleteKpiAchievement(db, token, id) {
    await checkSession(db, token);
    await db.prepare("DELETE FROM kpi_achievements WHERE id = ?").bind(id).run();
    return { success: true };
  },

  // Combined KPI Score = Uploads(50%) + Attendance(30%) + Tasks(20%), per team member, over either
  // a `periodDays` preset (1/7/30 = Daily/Weekly/Monthly) or an explicit [customStart, customEnd]
  // range. Uploads is scored relative to the TEAM's own average (no fixed quota exists), capped at
  // 100 so one outlier can't blow the combined score past 100. Attendance counts a day only when
  // BOTH Time In and Time Out are logged (a lone Time In doesn't count — no schedule data exists to
  // know if the day was actually completed). Tasks is scored off tasks assigned directly to that
  // person; a member with zero assigned tasks gets 100 for that part rather than being penalized
  // for something that was never given to them.
  async getKpiScoreboard(db, token, team, periodDays, customStart, customEnd) {
    const session = await checkSession(db, token);

    // Super Admin always sees every team they manage combined here (matches the Attendance
    // Summary behavior) — a normal user still only ever sees their own single team.
    let teamList;
    if (session.role === "Super Admin") {
      const { results: teamRows } = await db.prepare("SELECT DISTINCT team FROM users WHERE team != '' ORDER BY team ASC").all();
      teamList = teamRows.map(r => r.team);
      if (team && teamList.indexOf(team) === -1) teamList.push(team);
    } else {
      if (!session.team) return [];
      teamList = [session.team];
    }
    if (teamList.length === 0) return [];
    const placeholders = teamList.map(() => "?").join(",");

    let days, startSQL, endSQL, startDate, endDate;
    if (customStart && customEnd) {
      startDate = customStart; endDate = customEnd;
      const d1 = new Date(customStart + "T00:00:00Z"), d2 = new Date(customEnd + "T00:00:00Z");
      days = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
      startSQL = customStart + " 00:00:00"; endSQL = customEnd + " 23:59:59";
    } else {
      days = (periodDays === 30) ? 30 : (periodDays === 1 ? 1 : 7);
      startSQL = getPeriodStartSQL(days); endSQL = getPHTodayStartSQL().slice(0, 10) + " 23:59:59";
      startDate = getPHDateStrDaysAgo(days - 1); endDate = getPHDateStr();
    }

    const { results: memberRows } = await db.prepare(`SELECT username, team, full_name as fullName FROM users WHERE team IN (${placeholders}) ORDER BY team ASC, username ASC`).bind(...teamList).all();
    const members = memberRows.map(r => r.username);
    const nameMap = {}, teamMap = {};
    memberRows.forEach(function (r) { nameMap[r.username] = r.fullName || r.username; teamMap[r.username] = r.team; });
    if (members.length === 0) return [];

    const { results: bbcRows } = await db.prepare(`SELECT agent, COUNT(*) as cnt FROM domains WHERE created_at >= ? AND created_at <= ? AND agent IN (SELECT username FROM users WHERE team IN (${placeholders})) GROUP BY agent`).bind(startSQL, endSQL, ...teamList).all();
    const { results: dpvRows } = await db.prepare(`SELECT agent, COUNT(*) as cnt FROM dpv_records WHERE created_at >= ? AND created_at <= ? AND team IN (${placeholders}) AND domain NOT LIKE 'init-%' GROUP BY agent`).bind(startSQL, endSQL, ...teamList).all();
    const { results: attRows } = await db.prepare(`SELECT username, COUNT(*) as cnt FROM kpi_attendance WHERE username IN (SELECT username FROM users WHERE team IN (${placeholders})) AND date >= ? AND date <= ? AND time_in != '' AND time_out != '' GROUP BY username`).bind(...teamList, startDate, endDate).all();
    const { results: taskRows } = await db.prepare(`SELECT assigned_to, status, COUNT(*) as cnt FROM kpi_tasks WHERE assigned_to IN (SELECT username FROM users WHERE team IN (${placeholders})) AND task_date >= ? AND task_date <= ? GROUP BY assigned_to, status`).bind(...teamList, startDate, endDate).all();

    const uploads = {}; members.forEach(m => uploads[m] = 0);
    bbcRows.forEach(r => { if (uploads[r.agent] !== undefined) uploads[r.agent] += r.cnt; });
    dpvRows.forEach(r => { if (uploads[r.agent] !== undefined) uploads[r.agent] += r.cnt; });

    const attendance = {}; members.forEach(m => attendance[m] = 0);
    attRows.forEach(r => { if (attendance[r.username] !== undefined) attendance[r.username] = r.cnt; });

    const taskTotals = {}, taskDone = {};
    members.forEach(m => { taskTotals[m] = 0; taskDone[m] = 0; });
    taskRows.forEach(r => {
      if (taskTotals[r.assigned_to] === undefined) return;
      taskTotals[r.assigned_to] += r.cnt;
      if (r.status === "done") taskDone[r.assigned_to] += r.cnt;
    });

    // Uploads are scored against each person's OWN team average, not a global one across every
    // team combined — otherwise a small team gets unfairly squashed against a bigger one's volume.
    const teamAvgUploads = {};
    teamList.forEach(function (t) {
      const teamMembers = members.filter(m => teamMap[m] === t);
      const vals = teamMembers.map(m => uploads[m]);
      teamAvgUploads[t] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });

    return members.map(function (m) {
      const avg = teamAvgUploads[teamMap[m]] || 0;
      const uploadScore = avg > 0 ? Math.min(100, Math.round((uploads[m] / avg) * 100)) : (uploads[m] > 0 ? 100 : 0);
      const attendancePct = Math.min(100, Math.round((attendance[m] / days) * 100));
      const tasksPct = taskTotals[m] > 0 ? Math.round((taskDone[m] / taskTotals[m]) * 100) : 100;
      const combinedScore = Math.round(uploadScore * 0.5 + attendancePct * 0.3 + tasksPct * 0.2);
      return { username: m, fullName: nameMap[m] || m, team: teamMap[m] || "", uploads: uploads[m], uploadScore, attendanceDays: attendance[m], attendancePct, tasksDone: taskDone[m], tasksTotal: taskTotals[m], tasksPct, combinedScore };
    }).sort(function (a, b) { return b.combinedScore - a.combinedScore; });
  },

  // Per-agent domain-check completion: of the domains a person uploaded (agent=username, their own
  // BBC + DPV rows), how many have they actually run through checker.js at least once (any ISP)?
  // This is cumulative/all-time by design — the point is "did they finish checking everything
  // assigned to them," not a daily/weekly snapshot — separate from the period-based KPI Scoreboard.
  async getKpiDomainCheckStats(db, token) {
    const session = await checkSession(db, token);
    let teamList;
    if (session.role === "Super Admin") {
      const { results: teamRows } = await db.prepare("SELECT DISTINCT team FROM users WHERE team != '' ORDER BY team ASC").all();
      teamList = teamRows.map(r => r.team);
    } else {
      if (!session.team) return [];
      teamList = [session.team];
    }
    if (teamList.length === 0) return [];
    const placeholders = teamList.map(() => "?").join(",");

    const { results: memberRows } = await db.prepare(`SELECT username, team, full_name as fullName FROM users WHERE team IN (${placeholders}) ORDER BY team ASC, username ASC`).bind(...teamList).all();
    const members = memberRows.map(r => r.username);
    if (members.length === 0) return [];
    const nameMap = {}, teamMap = {};
    memberRows.forEach(r => { nameMap[r.username] = r.fullName || r.username; teamMap[r.username] = r.team; });

    // Assigned, broken down by Brand (BBC DOMAIN) and by Batch (DATASHEET/DPV) — batch_id is DPV's
    // natural grouping key the same way brand is BBC's.
    const { results: bbcRows } = await db.prepare(`SELECT agent, brand, COUNT(*) as cnt FROM domains WHERE agent IN (SELECT username FROM users WHERE team IN (${placeholders})) GROUP BY agent, brand`).bind(...teamList).all();
    const { results: dpvRows } = await db.prepare(`SELECT agent, batch_id as batch, COUNT(*) as cnt FROM dpv_records WHERE team IN (${placeholders}) AND domain NOT LIKE 'init-%' GROUP BY agent, batch_id`).bind(...teamList).all();
    // Checked, from the kpi_domain_checks log — its "batch" column already holds the brand name for
    // target='brand' rows (checker.js sends the same value as both batch and brand for BBC checks)
    // and the batch id for target='dpv' rows, so grouping by (target, batch) lines up with the above.
    const { results: checkedRows } = await db.prepare(`SELECT username, target, batch, COUNT(DISTINCT domain) as cnt FROM kpi_domain_checks WHERE username IN (SELECT username FROM users WHERE team IN (${placeholders})) GROUP BY username, target, batch`).bind(...teamList).all();

    const assignedMap = {}; members.forEach(m => assignedMap[m] = {});
    bbcRows.forEach(r => {
      if (assignedMap[r.agent] === undefined) return;
      const key = "brand|" + (r.brand || "UNKNOWN");
      assignedMap[r.agent][key] = (assignedMap[r.agent][key] || 0) + r.cnt;
    });
    dpvRows.forEach(r => {
      if (assignedMap[r.agent] === undefined) return;
      const key = "dpv|" + (r.batch || "UNKNOWN");
      assignedMap[r.agent][key] = (assignedMap[r.agent][key] || 0) + r.cnt;
    });

    const checkedMap = {}; members.forEach(m => checkedMap[m] = {});
    checkedRows.forEach(r => {
      if (checkedMap[r.username] === undefined) return;
      const key = r.target + "|" + (r.batch || "UNKNOWN");
      checkedMap[r.username][key] = (checkedMap[r.username][key] || 0) + r.cnt;
    });

    return members.map(function (m) {
      const keys = new Set(Object.keys(assignedMap[m]).concat(Object.keys(checkedMap[m])));
      const breakdown = Array.from(keys).map(function (key) {
        const sep = key.indexOf("|");
        const type = key.slice(0, sep), label = key.slice(sep + 1);
        const a = assignedMap[m][key] || 0;
        const rawChecked = checkedMap[m][key] || 0;
        const cappedChecked = a > 0 ? Math.min(rawChecked, a) : rawChecked;
        const pct = a > 0 ? Math.round((cappedChecked / a) * 100) : (rawChecked > 0 ? 100 : 0);
        return { type: type === "brand" ? "BBC" : "DPV", label: label, assigned: a, checked: rawChecked, pct: pct };
      }).sort(function (x, y) { return x.type !== y.type ? (x.type === "BBC" ? -1 : 1) : x.label.localeCompare(y.label); });

      const totalAssigned = breakdown.reduce((s, b) => s + b.assigned, 0);
      const totalChecked = breakdown.reduce((s, b) => s + Math.min(b.checked, b.assigned || b.checked), 0);
      const pct = totalAssigned > 0 ? Math.round((totalChecked / totalAssigned) * 100) : (totalChecked > 0 ? 100 : 0);

      return { username: m, fullName: nameMap[m] || m, team: teamMap[m] || "", assigned: totalAssigned, checked: totalChecked, pct: pct, breakdown: breakdown };
    }).sort(function (a, b) { return b.pct - a.pct; });
  },

  // Raw material for the bi-monthly DTR spreadsheet HR asks for — per-member daily hours computed
  // strictly from Time In/Time Out pairs. A day with no record, or only one of the two punches, is
  // left as null rather than guessed at (could be a rest day, an approved leave, or a missed punch —
  // this system has no schedule data to tell those apart, so it's left for HR to mark by hand).
  async exportDtrData(db, token, team, startDate, endDate, teams) {
    const session = await checkSession(db, token);
    let teamList;
    if (session.role === "Super Admin" && Array.isArray(teams) && teams.length > 0) {
      teamList = teams;
    } else {
      const targetTeam = session.role === "Super Admin" ? (team || session.team || "") : (session.team || "");
      if (!targetTeam) return { team: "", dateList: [], members: [] };
      teamList = [targetTeam];
    }
    const placeholders = teamList.map(() => "?").join(",");

    const { results: memberRows } = await db.prepare(
      `SELECT username, team, hrid_number as hridNumber, position, sub_department as subDepartment, rest_day as restDay, full_name as fullName FROM users WHERE team IN (${placeholders}) ORDER BY team ASC, username ASC`
    ).bind(...teamList).all();

    // Joined against the member list (current team membership) rather than filtered by
    // kpi_attendance.team directly, so a since-reassigned user's older rows still show up here.
    const { results: attRows } = await db.prepare(
      `SELECT username, date, time_in, time_out, break_start, break_end, day_status FROM kpi_attendance WHERE username IN (SELECT username FROM users WHERE team IN (${placeholders})) AND date >= ? AND date <= ? ORDER BY date ASC`
    ).bind(...teamList, startDate, endDate).all();

    const byUser = {};
    attRows.forEach(function (r) {
      if (!byUser[r.username]) byUser[r.username] = {};
      // An explicit day_status (RD = Rest Day, A = Absent) always wins over hours — it's a direct
      // fact carried over from the source DTR file, not something to recompute from punches.
      if (r.day_status) {
        byUser[r.username][r.date] = r.day_status;
      } else if (r.time_in && r.time_out) {
        const inMin = timeStrToMinutes(r.time_in), outMin = timeStrToMinutes(r.time_out);
        let diffMin = outMin - inMin;
        // Deduct the actual logged break (Break Start -> Break End) when present — the raw
        // Time In/Out span otherwise includes lunch/break time as if it were worked hours.
        if (r.break_start && r.break_end) {
          const breakMin = timeStrToMinutes(r.break_end) - timeStrToMinutes(r.break_start);
          if (breakMin > 0) diffMin -= breakMin;
        }
        byUser[r.username][r.date] = diffMin > 0 ? Math.round((diffMin / 60) * 10) / 10 : null;
      } else {
        byUser[r.username][r.date] = null;
      }
    });

    const dateList = [];
    let cursor = new Date(startDate + "T00:00:00Z");
    const last = new Date(endDate + "T00:00:00Z");
    while (cursor <= last) { dateList.push(cursor.toISOString().slice(0, 10)); cursor = new Date(cursor.getTime() + 86400000); }

    // Approved leaves overlay the grid live (rather than writing fake attendance rows) — a date
    // that already has real logged hours keeps those; only a blank day picks up the leave label.
    const { results: leaveRows } = await db.prepare(
      `SELECT username, leave_type, start_date, end_date FROM kpi_leaves WHERE status = 'approved' AND username IN (SELECT username FROM users WHERE team IN (${placeholders})) AND start_date <= ? AND end_date >= ?`
    ).bind(...teamList, endDate, startDate).all();
    const byLeave = {};
    leaveRows.forEach(function (r) {
      if (!byLeave[r.username]) byLeave[r.username] = {};
      dateList.forEach(function (d) {
        if (d >= r.start_date && d <= r.end_date) byLeave[r.username][d] = r.leave_type;
      });
    });

    const members = memberRows.map(function (u) {
      const days = {};
      let totalDays = 0, totalHours = 0;
      dateList.forEach(function (d) {
        const h = (byUser[u.username] || {})[d];
        if (typeof h === "number" && h) { days[d] = h; totalDays++; totalHours += h; }
        else if (h) { days[d] = h; } // RD / A — a status label, not worked hours
        else { days[d] = (byLeave[u.username] || {})[d] || null; }
      });
      return { username: u.username, team: u.team || "", fullName: u.fullName || "", hridNumber: u.hridNumber || "", position: u.position || "", subDepartment: u.subDepartment || "", restDay: u.restDay || "", days: days, totalDays: totalDays, totalHours: Math.round(totalHours * 10) / 10 };
    });

    return { team: teamList.join(", "), dateList: dateList, members: members };
  },

  // Bulk-loads historical Time In/Out rows (e.g. from an old spreadsheet) via upsert keyed on
  // (username, date) — re-importing the same file twice just overwrites those rows instead of
  // duplicating them, since kpi_attendance has a UNIQUE index on that pair.
  async importKpiAttendance(db, token, team, rows) {
    const session = await checkSession(db, token);
    const targetTeam = session.role === "Super Admin" ? (team || session.team || "") : (session.team || "");
    if (!targetTeam) return { success: false, message: "No team assigned to your account." };
    if (!Array.isArray(rows) || rows.length === 0) return { success: false, message: "The file is empty." };

    const stmt = db.prepare(
      "INSERT INTO kpi_attendance (username, team, date, time_in, time_out, day_status) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(username, date) DO UPDATE SET time_in=excluded.time_in, time_out=excluded.time_out, day_status=excluded.day_status, team=excluded.team"
    );
    const batch = [];
    let skipped = 0;
    rows.forEach(function (r) {
      const username = String(r.username || "").trim();
      const date = String(r.date || "").trim();
      if (!username || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; return; }
      const dayStatus = ["RD", "A"].indexOf(r.dayStatus) !== -1 ? r.dayStatus : "";
      batch.push(stmt.bind(username, targetTeam, date, String(r.timeIn || "").trim(), String(r.timeOut || "").trim(), dayStatus));
    });
    if (batch.length === 0) return { success: false, message: "No valid rows (bad date or username format).", imported: 0, skipped: skipped };
    await db.batch(batch);
    return { success: true, message: batch.length + " attendance record(s) imported" + (skipped > 0 ? (", " + skipped + " skipped due to bad format") : "") + ".", imported: batch.length, skipped: skipped };
  },

  // Feeds the edit modal with whatever's already on file for that day (or blanks, if none yet).
  async getKpiAttendanceRecord(db, token, username, date) {
    await checkSession(db, token, true);
    const row = await db.prepare("SELECT time_in, time_out, break_start, break_end, day_status FROM kpi_attendance WHERE username = ? AND date = ?").bind(username, date).first();
    return row || { time_in: "", time_out: "", break_start: "", break_end: "", day_status: "" };
  },

  // Manual correction of one person's one-day record — Super Admin only. Upserts on
  // (username, date) same as the CSV import, so editing a day with no existing row just creates it.
  // dayStatus ("RD"/"A") overrides the punches in exportDtrData, so both are stored even if a Time
  // In/Out was also entered — the status wins on display, but the raw punches aren't discarded.
  async updateKpiAttendanceRecord(db, token, username, date, timeIn, timeOut, breakStart, breakEnd, dayStatus) {
    const session = await checkSession(db, token, true);
    if (!username || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return { success: false, message: "A valid username and date are required." };
    const userRow = await db.prepare("SELECT team FROM users WHERE username = ?").bind(username).first();
    if (!userRow) return { success: false, message: "User not found." };
    const cleanStatus = ["RD", "A"].indexOf(dayStatus) !== -1 ? dayStatus : "";
    await db.prepare(
      "INSERT INTO kpi_attendance (username, team, date, time_in, time_out, break_start, break_end, day_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(username, date) DO UPDATE SET time_in=excluded.time_in, time_out=excluded.time_out, break_start=excluded.break_start, break_end=excluded.break_end, day_status=excluded.day_status"
    ).bind(username, userRow.team || "", date, String(timeIn || "").trim(), String(timeOut || "").trim(), String(breakStart || "").trim(), String(breakEnd || "").trim(), cleanStatus).run();
    return { success: true, message: "Attendance record updated." };
  },

  // Single-record delete — Super Admin only, used by the "Delete" button in the edit modal.
  async deleteKpiAttendanceRecord(db, token, username, date) {
    await checkSession(db, token, true);
    await db.prepare("DELETE FROM kpi_attendance WHERE username = ? AND date = ?").bind(username, date).run();
    return { success: true, message: "Record deleted." };
  },

  // Bulk-clears every attendance record in a date range for one or more teams — Super Admin only.
  // Meant for wiping placeholder/test data before importing the real attendance, without having to
  // click through and delete each cell one at a time.
  async clearKpiAttendanceRange(db, token, team, startDate, endDate, teams) {
    const session = await checkSession(db, token, true);
    let teamList;
    if (Array.isArray(teams) && teams.length > 0) teamList = teams;
    else {
      const t = team || session.team || "";
      if (!t) return { success: false, message: "No team specified." };
      teamList = [t];
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || ""))) {
      return { success: false, message: "A valid start and end date are required." };
    }
    const placeholders = teamList.map(() => "?").join(",");
    const res = await db.prepare(
      `DELETE FROM kpi_attendance WHERE username IN (SELECT username FROM users WHERE team IN (${placeholders})) AND date >= ? AND date <= ?`
    ).bind(...teamList, startDate, endDate).run();
    return { success: true, message: (res.meta.changes || 0) + " record(s) deleted.", deleted: res.meta.changes || 0 };
  },

  // Everyone on the team's plotted day-offs, for the "My Day Offs" panel and — for Super Admin —
  // the management list they can delete from.
  async getKpiDayoffs(db, token, team) {
    const session = await checkSession(db, token);
    const targetTeam = session.role === "Super Admin" ? (team || session.team || "") : (session.team || "");
    if (!targetTeam) return [];
    const { results } = await db.prepare(
      "SELECT d.id, d.username, d.date, d.created_at, u.full_name as fullName FROM kpi_dayoffs d LEFT JOIN users u ON u.username = d.username WHERE d.team = ? ORDER BY d.date ASC"
    ).bind(targetTeam).all();
    return results.map(function (r) { return Object.assign({}, r, { fullName: r.fullName || r.username }); });
  },

  // Self-service plot — once a person submits a day-off date it's immutable to them (no delete/edit
  // action exposed to non-admins); only deleteKpiDayoff (Super Admin only) can undo it.
  async plotKpiDayoff(db, token, date) {
    const session = await checkSession(db, token);
    if (!session.team) return { success: false, message: "No team assigned to your account." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return { success: false, message: "A valid date is required." };
    const existing = await db.prepare("SELECT id FROM kpi_dayoffs WHERE username = ? AND date = ?").bind(session.username, date).first();
    if (existing) return { success: false, message: "That date is already plotted." };
    await db.prepare("INSERT INTO kpi_dayoffs (username, team, date) VALUES (?, ?, ?)").bind(session.username, session.team, date).run();
    return { success: true, message: "Your Day Off has been plotted." };
  },

  async deleteKpiDayoff(db, token, id) {
    await checkSession(db, token, true);
    await db.prepare("DELETE FROM kpi_dayoffs WHERE id = ?").bind(id).run();
    return { success: true };
  },

  // Self-service leave filing, with an optional image/PDF attachment stored in R2. Starts as
  // "pending" — nothing shows up on the Attendance Summary until Super Admin approves it
  // (exportDtrData overlays approved leaves onto the date grid at read time).
  async fileKpiLeave(db, env, token, leaveType, startDate, endDate, reason, attachmentBase64, attachmentFilename, attachmentType) {
    const session = await checkSession(db, token);
    if (!session.team) return { success: false, message: "No team assigned to your account." };
    const validTypes = ["VL", "SL", "LWOP", "BL", "PL"];
    if (validTypes.indexOf(leaveType) === -1) return { success: false, message: "Invalid leave type." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || ""))) {
      return { success: false, message: "A valid start and end date are required." };
    }
    if (endDate < startDate) return { success: false, message: "End date can't be before the start date." };

    let attachmentKey = "";
    if (attachmentBase64 && attachmentFilename) {
      if (!/\.(png|jpe?g|pdf)$/i.test(attachmentFilename)) return { success: false, message: "Only PNG, JPG, or PDF files are allowed." };
      let bytes;
      try { bytes = base64ToBytes(attachmentBase64); } catch (e) { return { success: false, message: "Could not read the attachment." }; }
      if (bytes.length > 5 * 1024 * 1024) return { success: false, message: "File is too large (max 5MB)." };
      if (!env.LEAVE_ATTACHMENTS) return { success: false, message: "Attachment storage isn't configured on the Worker yet." };
      attachmentKey = "leaves/" + session.username + "/" + Date.now() + "_" + attachmentFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
      await env.LEAVE_ATTACHMENTS.put(attachmentKey, bytes, { httpMetadata: { contentType: attachmentType || "application/octet-stream" } });
    }

    await db.prepare(
      "INSERT INTO kpi_leaves (username, team, leave_type, start_date, end_date, reason, attachment_key, attachment_filename, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')"
    ).bind(session.username, session.team, leaveType, startDate, endDate, (reason || "").trim(), attachmentKey, attachmentFilename || "").run();
    return { success: true, message: "Leave request filed." };
  },

  // Everyone's leave requests for the team — the filer sees their own in the same list Super Admin
  // uses to review, so both share one action instead of two near-identical queries.
  async getKpiLeaves(db, token, team) {
    const session = await checkSession(db, token);
    const targetTeam = session.role === "Super Admin" ? (team || session.team || "") : (session.team || "");
    if (!targetTeam) return [];
    const { results } = await db.prepare(
      "SELECT l.id, l.username, l.leave_type, l.start_date, l.end_date, l.reason, l.attachment_filename, l.status, l.created_at, l.reviewed_by, u.full_name as fullName FROM kpi_leaves l LEFT JOIN users u ON u.username = l.username WHERE l.team = ? ORDER BY l.created_at DESC"
    ).bind(targetTeam).all();
    return results.map(function (r) { return Object.assign({}, r, { fullName: r.fullName || r.username }); });
  },

  // Approve/reject — Super Admin only. Approving doesn't write anything into kpi_attendance; the
  // date grid picks up approved leaves live (see exportDtrData) so there's one source of truth.
  async updateKpiLeaveStatus(db, token, id, status) {
    const session = await checkSession(db, token, true);
    if (["approved", "rejected", "pending"].indexOf(status) === -1) return { success: false, message: "Invalid status." };
    const res = await db.prepare("UPDATE kpi_leaves SET status=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?").bind(status, session.username, id).run();
    if (res.meta.changes === 0) return { success: false, message: "Leave request not found." };
    return { success: true, message: "Leave request " + status + "." };
  },

  // ---- Daily Checklist (Brand Status Update, Competitor Promotion Check, ...) ----
  // Generic system: a fixed per-agent assignment list (kpi_checklist_assignments, one row per
  // brand/competitor/etc a person is responsible for) plus a per-day completion log
  // (kpi_checklist_completions) that requires a photo attachment before an item counts as done.
  // New categories (e.g. "competitor_promo") reuse both tables — just a different `category` value.

  // Non-Super-Admin gets only their own list; Super Admin gets everyone's (for the review/overview
  // view), for the given day (defaults to today, PH time).
  async getKpiChecklistToday(db, token, dateStr) {
    const session = await checkSession(db, token);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || "")) ? dateStr : getPHDateStr();
    let usernames;
    if (session.role === "Super Admin") {
      const { results } = await db.prepare("SELECT username FROM users WHERE username != ''").all();
      usernames = results.map(r => r.username);
    } else {
      usernames = [session.username];
    }
    if (usernames.length === 0) return [];
    const placeholders = usernames.map(() => "?").join(",");
    const { results: assignments } = await db.prepare(
      `SELECT a.id, a.username, a.team, a.category, a.label, a.subtype1, a.subtype2, a.ref_link, u.full_name as fullName
       FROM kpi_checklist_assignments a LEFT JOIN users u ON u.username = a.username
       WHERE a.username IN (${placeholders}) AND a.active = 1 ORDER BY a.username ASC, a.category ASC, a.label ASC`
    ).bind(...usernames).all();
    if (assignments.length === 0) return [];
    const { results: completions } = await db.prepare(
      `SELECT id, assignment_id, attachment_filename, completed_at FROM kpi_checklist_completions WHERE task_date = ? AND username IN (${placeholders})`
    ).bind(date, ...usernames).all();
    const doneMap = {};
    completions.forEach(function (c) { doneMap[c.assignment_id] = c; });
    return assignments.map(function (a) {
      const c = doneMap[a.id];
      return {
        id: a.id, username: a.username, fullName: a.fullName || a.username, team: a.team,
        category: a.category, label: a.label, subtype1: a.subtype1, subtype2: a.subtype2, refLink: a.ref_link,
        done: !!c, completedAt: c ? c.completed_at : null, completionId: c ? c.id : null
      };
    });
  },

  // Uploads the proof photo to R2 (reusing the leave-attachments bucket, under its own key prefix)
  // and marks the item done for that day. An agent can only complete their own assignments; Super
  // Admin can too (e.g. filing on someone's behalf), matching how fileKpiLeave/other actions work.
  async completeKpiChecklistItem(db, env, token, assignmentId, dateStr, attachmentBase64, attachmentFilename, attachmentType) {
    const session = await checkSession(db, token);
    const assignment = await db.prepare("SELECT id, username FROM kpi_checklist_assignments WHERE id = ?").bind(assignmentId).first();
    if (!assignment) return { success: false, message: "Assignment not found." };
    if (session.role !== "Super Admin" && assignment.username !== session.username) {
      return { success: false, message: "Hindi mo ito assigned na task." };
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || "")) ? dateStr : getPHDateStr();
    if (!attachmentBase64 || !attachmentFilename) return { success: false, message: "Kailangan ng picture bago ma-mark done." };
    if (!/\.(png|jpe?g|webp)$/i.test(attachmentFilename)) return { success: false, message: "Larawan lang (PNG/JPG/WEBP) ang tinatanggap." };
    let bytes;
    try { bytes = base64ToBytes(attachmentBase64); } catch (e) { return { success: false, message: "Could not read the picture." }; }
    if (bytes.length > 5 * 1024 * 1024) return { success: false, message: "Max 5MB lang ang picture." };
    if (!env.LEAVE_ATTACHMENTS) return { success: false, message: "Attachment storage isn't configured on the Worker yet." };
    const key = "checklist/" + assignment.username + "/" + date + "/" + assignmentId + "_" + Date.now() + "_" + attachmentFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
    await env.LEAVE_ATTACHMENTS.put(key, bytes, { httpMetadata: { contentType: attachmentType || "image/png" } });
    await db.prepare(
      `INSERT INTO kpi_checklist_completions (assignment_id, username, task_date, attachment_key, attachment_filename) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(assignment_id, task_date) DO UPDATE SET attachment_key = excluded.attachment_key, attachment_filename = excluded.attachment_filename, completed_at = datetime('now')`
    ).bind(assignmentId, assignment.username, date, key, attachmentFilename).run();
    return { success: true, message: "Na-mark as done." };
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

// "YYYY-MM-DD" / "HH:MM" for the KPI Report's To-Do list and Time In/Out, in Philippine time.
function getPHDateStr() {
  const phShifted = new Date(Date.now() + 8 * 3600000);
  return phShifted.toISOString().slice(0, 10);
}
function getPHTimeStr() {
  const phShifted = new Date(Date.now() + 8 * 3600000);
  return phShifted.toISOString().slice(11, 16);
}
function getPHDateStrDaysAgo(daysBack) {
  const phShifted = new Date(Date.now() + 8 * 3600000 - daysBack * 86400000);
  return phShifted.toISOString().slice(0, 10);
}
// "HH:MM" -> minutes since midnight, for computing hours worked between a Time In and Time Out.
function timeStrToMinutes(str) {
  const parts = String(str).split(":");
  return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
}

// Accepts either a raw base64 string or a "data:...;base64,XXXX" data URL (strips the prefix).
function base64ToBytes(b64) {
  const cleaned = b64.indexOf(",") !== -1 ? b64.split(",")[1] : b64;
  const binaryStr = atob(cleaned);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return bytes;
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

        // Raw file download — can't go through the normal json(actions[action](...)) path since it
        // streams bytes (image/PDF), not a JSON payload. GET-only, e.g. from an <a href> or new tab.
        if (action === "downloadKpiLeaveAttachment") {
          const token = url.searchParams.get("token");
          const id = url.searchParams.get("id");
          const session = await checkSession(env.DB, token, true);
          const row = await env.DB.prepare("SELECT attachment_key, attachment_filename FROM kpi_leaves WHERE id = ?").bind(id).first();
          if (!row || !row.attachment_key) return new Response("Not found", { status: 404 });
          const obj = await env.LEAVE_ATTACHMENTS.get(row.attachment_key);
          if (!obj) return new Response("Not found", { status: 404 });
          return new Response(obj.body, {
            headers: { ...corsHeaders(), "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream", "Content-Disposition": "inline; filename=\"" + row.attachment_filename.replace(/"/g, "") + "\"" }
          });
        }

        // Same streaming pattern, for a checklist item's proof photo — the owning agent can view
        // their own proof, not just Super Admin (unlike leave attachments, which are admin-only).
        if (action === "downloadKpiChecklistAttachment") {
          const token = url.searchParams.get("token");
          const id = url.searchParams.get("id");
          const session = await checkSession(env.DB, token);
          const row = await env.DB.prepare("SELECT username, attachment_key, attachment_filename FROM kpi_checklist_completions WHERE id = ?").bind(id).first();
          if (!row || !row.attachment_key) return new Response("Not found", { status: 404 });
          if (session.role !== "Super Admin" && session.username !== row.username) return new Response("Forbidden", { status: 403 });
          const obj = await env.LEAVE_ATTACHMENTS.get(row.attachment_key);
          if (!obj) return new Response("Not found", { status: 404 });
          return new Response(obj.body, {
            headers: { ...corsHeaders(), "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream", "Content-Disposition": "inline; filename=\"" + row.attachment_filename.replace(/"/g, "") + "\"" }
          });
        }
      }

      if (!action || typeof actions[action] !== "function") {
        return json({ success: false, message: "Action blocked by API Gateway." }, 404);
      }

      // Machine-to-machine actions: gated by a shared secret (env.AUTOMATION_API_KEY), not a user
      // session — the domain-checker script has no human logging in to hand it a token.
      const automationActions = ["submitDomainCheckResult", "getDomainsToCheck", "resolveKpiOperator", "runExpiringDomainsReportNow", "debugCheckSecrets", "runTodayUploadsReportNow", "runUserKpiReportNow", "runFollowupReportNow"];
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

      // Session-authenticated actions that also need R2 access (leave attachment upload), not just
      // the D1 binding — kept as a short explicit list rather than passing full env everywhere, so
      // every other action keeps its existing (db, ...args) signature unchanged.
      const envActions = ["fileKpiLeave", "completeKpiChecklistItem"];
      if (envActions.indexOf(action) !== -1) {
        const result = await actions[action](env.DB, env, ...args);
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

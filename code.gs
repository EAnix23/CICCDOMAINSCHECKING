// ========================================================
// MASTER DATA ROUTING PIPELINE GATEWAY (SECURE JSONP COUPLING)
// ========================================================
const SHEET_ID = '1WrnZ57WspEGFs5HdvKx5vvmfJ908ZZFC3Q67TTqFwxQ';
const CYBERGUARD_SHEET_ID = '1TEdhzcQoJm5QznVkRjhA2uX84UPjYcpTIiyHcYidpyk';
const SESSION_TTL_HOURS = 24 * 7; // sessions stay valid 7 days, matching the existing "stay logged in" UX
const DATA_CACHE_TTL = 45;   // seconds a data read (domains/brands/DPV) is served from cache before re-reading Sheets
const SESSION_CACHE_TTL = 300; // seconds a validated session is served from cache before re-checking the Sessions sheet

// ==========================================
// LIGHTWEIGHT CACHE HELPERS (CacheService is far faster than a Sheets read)
// ==========================================
function getCached_(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function setCached_(key, value, ttlSeconds) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), ttlSeconds);
  } catch (e) { /* value too large for cache (100KB limit) — just skip caching it */ }
}

function clearCached_(key) {
  try { CacheService.getScriptCache().remove(key); } catch (e) {}
}

// ==========================================
// FALLBACK KUNG BINUKSAN DIRECTLY SA GOOGLE
// ==========================================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('BBC Cyberguard Domain System')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ==========================================
// CLOUDFLARE API GATEWAY UNIVERSAL RECEIVER
// ==========================================
function doPost(e) {
  try {
    var req;
    if (e && e.postData && e.postData.contents) {
      req = JSON.parse(e.postData.contents);
    } else {
      return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Empty payload received." })).setMimeType(ContentService.MimeType.JSON);
    }

    var action = req.action;
    var args = req.args || [];

    // SECURITY LIST: Pwede lang tawagin ang mga nandito sa listahan
    var allowedActions = [
      "verifyLogin", "getUniqueBrands", "getDomainsData",
      "getPostVerificationData", "getActivityLogsBackend",
      "saveNewDomain", "deleteDomainRecordBackend",
      "getUsersData", "saveNewUserBackend", "updateUserBackend",
      "deleteUserBackend", "saveDpvRecordBackend",
      "deleteDpvRecordBackend", "deleteDpvDuplicatesBackend",
      "saveActivityLogBackend", "bulkUpdateDpvBackend", "bulkDeleteDpvBackend",
      "logoutSessionBackend"
    ];

    if (!allowedActions.includes(action) || typeof this[action] !== 'function') {
      return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Action blocked by API Gateway." })).setMimeType(ContentService.MimeType.JSON);
    }

    // NOTE: the real auth gate lives INSIDE each function (checkSession_), not here.
    // Reason: this doPost path is only used by the Cloudflare Worker/fetch fallback. When the app
    // is opened natively inside Apps Script (google.script.run), calls go straight to the functions
    // below and never touch doPost at all — so a check only here would leave that path wide open.
    var result = this[action].apply(this, args); // Execute requested function with arguments
    return ContentService.createTextOutput(JSON.stringify({ data: result })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Backend Error: " + error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ========================================================
// SESSION MANAGEMENT (token issued at login, required by every other action)
// ========================================================
function getSessionsSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Sessions');
  if (!sheet) {
    sheet = ss.insertSheet('Sessions');
    sheet.appendRow(['Token', 'Username', 'Role', 'Permissions', 'CreatedAt', 'ExpiresAt']);
  }
  return sheet;
}

function createSession_(username, role, permissions) {
  var sheet = getSessionsSheet_();
  var token = Utilities.getUuid();
  var now = new Date();
  var expires = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  sheet.appendRow([token, username, role, JSON.stringify(permissions || []), now, expires]);
  return token;
}

function validateSession(token) {
  if (!token) return null;

  // Fast path: most calls re-validate the same token within seconds of each other
  // (dashboard load fires several requests back-to-back) — skip the Sheets read entirely.
  var cacheKey = 'sess_' + token;
  var cached = getCached_(cacheKey);
  if (cached) return cached;

  try {
    var sheet = getSessionsSheet_();
    var values = sheet.getDataRange().getValues();
    var now = new Date();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === String(token)) {
        var expires = new Date(values[i][5]);
        if (isNaN(expires.getTime()) || expires < now) {
          sheet.deleteRow(i + 1); // expired — clean it up
          return null;
        }
        var perms = [];
        try { perms = JSON.parse(values[i][3] || "[]"); } catch(e) {}
        var session = { username: String(values[i][1]), role: String(values[i][2]), permissions: perms };
        setCached_(cacheKey, session, SESSION_CACHE_TTL);
        return session;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

function logoutSessionBackend(token) {
  try {
    clearCached_('sess_' + token);
    var sheet = getSessionsSheet_();
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === String(token)) {
        sheet.deleteRow(i + 1);
        break;
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false };
  }
}

// Guard called at the top of every non-public function, regardless of whether it was reached via
// doPost (Worker/fetch) or directly via google.script.run (native Apps Script) — both paths land here.
// Throws so the caller's try/catch turns it into a clean {success:false, message:...} response instead
// of leaking a raw exception.
function checkSession_(token, requireSuperAdmin) {
  var session = validateSession(token);
  if (!session) throw new Error("SESSION_INVALID: Session expired or invalid. Please log in again.");
  if (requireSuperAdmin && session.role !== 'Super Admin') throw new Error("ACCESS_DENIED: Super Admin only.");
  return session;
}

// ========================================================
// VERIFY LOGIN FUNCTION
// ========================================================
function verifyLogin(username, password) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Login');
    if (!sheet) return { success: false, message: "Login sheet not found." };
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      let sheetUser = String(data[i][0]).trim();
      let sheetPass = String(data[i][1]).trim();
      let sheetEmail = String(data[i][2] || "").trim();
      let sheetAvatar = String(data[i][3] || "").trim();
      let rawPerms = data[i][4] ? String(data[i][4]).trim() : "[]";

      if (sheetUser.toUpperCase() === String(username).trim().toUpperCase() && sheetPass === String(password).trim()) {

        let perms = [];
        if (rawPerms) {
          try {
            perms = JSON.parse(rawPerms);
          } catch(e) {
            perms = rawPerms.split(',').map(item => item.replace(/["'\[\]]/g, '').trim());
          }
        }

        let role = "Agent";
        if (sheetUser.toUpperCase() === 'LIO' || perms.includes("All Access") || perms.includes("Super Admin")) {
          role = 'Super Admin';
        } else if (perms.includes("Admin")) {
          role = 'Admin';
        }

        saveActivityLogBackend({
          time: new Date(),
          type: "SYSTEM ACCESS",
          user: sheetUser,
          details: "User logged in via Domain Custom Proxy Framework (" + role + ")"
        });

        var token = createSession_(sheetUser, role, perms);

        return {
          success: true,
          token: token,
          username: sheetUser,
          name: sheetUser,
          role: role,
          permissions: perms,
          email: sheetEmail,
          avatar: sheetAvatar || "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
        };
      }
    }
    return { success: false, message: "Invalid credentials. Access Denied." };
  } catch (e) {
    return { success: false, message: "System Error: " + e.toString() };
  }
}

// ========================================================
// GET UNIQUE BRANDS FOR SIDEBAR
// ========================================================
function getUniqueBrands(token) {
  try {
    checkSession_(token);
    var cached = getCached_('cache_brands');
    if (cached) return cached;

    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Domain List');
    if (!sheet) return [];

    const data = sheet.getRange('A2:A').getValues();
    const uniqueBrands = [];
    for (let i = 0; i < data.length; i++) {
      const brandName = String(data[i][0]).trim();
      if (brandName !== "" && !uniqueBrands.includes(brandName)) {
        uniqueBrands.push(brandName);
      }
    }
    const sorted = uniqueBrands.sort();
    setCached_('cache_brands', sorted, DATA_CACHE_TTL);
    return sorted;
  } catch (e) {
    Logger.log("Error getting unique brands: " + e.toString());
    return [];
  }
}

// ========================================================
// GET ALL CORE DOMAIN LIST DATA
// ========================================================
function getDomainsData(token) {
  try {
    checkSession_(token);
    var cached = getCached_('cache_domains');
    if (cached) return cached;

    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Domain List');
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();
    const domains = [];

    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;

      let expDate = data[i][4];
      if (expDate instanceof Date) {
        expDate = Utilities.formatDate(expDate, Session.getScriptTimeZone(), "MMM dd, yyyy");
      } else {
        expDate = String(expDate || "");
      }

      domains.push({
        brand: String(data[i][0] || "").trim(),
        domain: String(data[i][1] || "").trim(),
        agent: String(data[i][2] || "").trim(),
        price: String(data[i][3] || "").trim(),
        expiration: expDate,
        account: String(data[i][5] || "").trim(),
        notes: String(data[i][6] || "").trim(),
        redirected: String(data[i][7] || "").trim(),
        pldt: String(data[i][8] || "").trim(),
        pldtRemarks: String(data[i][9] || "").trim(),
        globe: String(data[i][10] || "").trim(),
        globeRemarks: String(data[i][11] || "").trim(),
        converge: String(data[i][12] || "").trim(),
        convergeRemarks: String(data[i][13] || "").trim(),
        dito: String(data[i][14] || "").trim(),
        ditoRemarks: String(data[i][15] || "").trim()
      });
    }

    setCached_('cache_domains', domains, DATA_CACHE_TTL);
    return domains;
  } catch (e) {
    Logger.log(e);
    return [];
  }
}

// ========================================================
// DOMAIN MANAGEMENT FUNCTIONS
// ========================================================
function saveNewDomain(token, data) {
  try {
    checkSession_(token);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName('Domain List');

    if (data.originalDomain && data.originalDomain.trim() !== "") {
      const values = sheet.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]).trim() === String(data.brand).trim() &&
            String(values[i][1]).trim() === String(data.originalDomain).trim()) {

          const rowIndex = i + 1;
          sheet.getRange(rowIndex, 1, 1, 8).setValues([[
            data.brand, data.domain, data.agent, data.price,
            data.expiration, data.account, data.notes, data.redirected
          ]]);
          clearCached_('cache_domains'); clearCached_('cache_brands');
          return { success: true, message: "Domain successfully updated!" };
        }
      }
    }

    const rowData = [
      data.brand, data.domain, data.agent, data.price, data.expiration,
      data.account, data.notes, data.redirected,
      "", "", "", "", "", "", "", ""
    ];
    sheet.appendRow(rowData);
    clearCached_('cache_domains'); clearCached_('cache_brands');
    return { success: true, message: "New domain successfully registered!" };

  } catch (e) {
    return { success: false, message: "Failed to save: " + e.toString() };
  }
}

function deleteDomainRecordBackend(token, brand, domain) {
  try {
    checkSession_(token);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Domain List');
    if (!sheet) return { success: false, message: "Database sheet not found." };

    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === String(brand).trim() &&
          String(values[i][1]).trim() === String(domain).trim()) {
        sheet.deleteRow(i + 1);
        clearCached_('cache_domains'); clearCached_('cache_brands');
        return { success: true, message: "Domain deleted successfully." };
      }
    }
    return { success: false, message: "Domain not found in the database." };
  } catch (e) {
    return { success: false, message: "Error deleting: " + e.toString() };
  }
}

// ========================================================
// USER MANAGEMENT FUNCTIONS
// ========================================================
function getUsersData(token) {
  try {
    checkSession_(token, true);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Login');
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    const users = [];

    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        let perms = [];
        try { perms = JSON.parse(data[i][4] || "[]"); } catch(e){}
        users.push({
          username: String(data[i][0]).trim(),
          password: String(data[i][1]).trim(),
          email: String(data[i][2] || "").trim(),
          image: String(data[i][3] || "").trim(),
          permissions: perms
        });
      }
    }
    return users;
  } catch (e) { return []; }
}

function saveNewUserBackend(token, userObj) {
  try {
    checkSession_(token, true);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Login');
    sheet.appendRow([userObj.username, userObj.password, userObj.email, "", JSON.stringify(userObj.permissions)]);
    return { success: true, message: "User successfully created!" };
  } catch (e) { return { success: false, message: "Failed: " + e.toString() }; }
}

function updateUserBackend(token, userObj) {
  try {
    checkSession_(token, true);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Login');
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === userObj.originalUsername) {
        sheet.getRange(i + 1, 1, 1, 5).setValues([[
          userObj.username,
          userObj.password,
          userObj.email,
          String(data[i][3] || ""),
          JSON.stringify(userObj.permissions)
        ]]);
        return { success: true, message: "User permissions updated successfully!" };
      }
    }
    return { success: false, message: "User not found in database." };
  } catch (e) { return { success: false, message: "Error updating: " + e.toString() }; }
}

function deleteUserBackend(token, username) {
  try {
    checkSession_(token, true);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Login');
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === username) {
        sheet.deleteRow(i + 1);
        return { success: true, message: "User deleted successfully." };
      }
    }
    return { success: false, message: "User not found." };
  } catch (e) { return { success: false, message: "Error deleting: " + e.toString() }; }
}

// ========================================================
// CYBERGUARD DATASHEET MODULES
// ========================================================
function getPostVerificationData(token) {
  try {
    checkSession_(token);
    var cached = getCached_('cache_dpv');
    if (cached) return cached;

    const sheet = SpreadsheetApp.openById(CYBERGUARD_SHEET_ID).getSheetByName('DATASHEET');
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();
    const records = [];

    for (let i = 1; i < data.length; i++) {
      if (data[i][1]) {
        records.push({
          batchId: String(data[i][0] || "").trim(),
          domain: String(data[i][1] || "").trim(),
          team: String(data[i][2] || "").trim(),
          pldt: String(data[i][3] || "").trim(),
          pldtRemarks: String(data[i][4] || "").trim(),
          globe: String(data[i][5] || "").trim(),
          globeRemarks: String(data[i][6] || "").trim(),
          converge: String(data[i][7] || "").trim(),
          convergeRemarks: String(data[i][8] || "").trim(),
          dito: String(data[i][9] || "").trim(),
          ditoRemarks: String(data[i][10] || "").trim(),
          cicc: String(data[i][11] || "").trim(),
          agent: String(data[i][12] || "").trim()
        });
      }
    }
    setCached_('cache_dpv', records, DATA_CACHE_TTL);
    return records;
  } catch (e) {
    Logger.log(e);
    return [];
  }
}

function saveDpvRecordBackend(token, data) {
  try {
    checkSession_(token);
    const sheet = SpreadsheetApp.openById(CYBERGUARD_SHEET_ID).getSheetByName('DATASHEET');
    const values = sheet.getDataRange().getValues();

    if (data.originalDomain && data.originalDomain.trim() !== "") {
       for (let i = 1; i < values.length; i++) {
         if (String(values[i][1]).trim() === String(data.originalDomain).trim()) {
           sheet.getRange(i + 1, 1, 1, 3).setValues([[ data.batchId, data.domain, data.team ]]);
           sheet.getRange(i + 1, 12).setValue(data.cicc || "");
           sheet.getRange(i + 1, 13).setValue(data.agent || "");
           clearCached_('cache_dpv');
           return { success: true, message: "Record successfully updated!" };
         }
       }
    }

    const rowsToAppend = [];
    data.domains.forEach(function(dom) {
        rowsToAppend.push([
          data.batchId, dom, data.team,
          "-", "", "-", "", "-", "", "-", "",
          data.cicc || "",
          data.agent || ""
        ]);
    });

    if(rowsToAppend.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, 13).setValues(rowsToAppend);
    }

    clearCached_('cache_dpv');
    return { success: true, message: rowsToAppend.length + " new record(s) successfully saved!" };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function deleteDpvRecordBackend(token, domainName) {
  try {
    checkSession_(token);
    const sheet = SpreadsheetApp.openById(CYBERGUARD_SHEET_ID).getSheetByName('DATASHEET');
    const values = sheet.getDataRange().getValues();

    for (let i = 1; i < values.length; i++) {
      if (String(values[i][1]).trim() === String(domainName).trim()) {
        sheet.deleteRow(i + 1);
        clearCached_('cache_dpv');
        return { success: true, message: "Record permanently deleted." };
      }
    }
    return { success: false, message: "Record not found in the database." };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function deleteDpvDuplicatesBackend(token, duplicatesToDelete) {
  try {
    checkSession_(token);
    const sheet = SpreadsheetApp.openById(CYBERGUARD_SHEET_ID).getSheetByName('DATASHEET');
    const values = sheet.getDataRange().getValues();

    let deletedCount = 0;
    for (let i = values.length - 1; i >= 1; i--) {
       let rowBatch = String(values[i][0]).trim().toUpperCase();
       let rowDomain = String(values[i][1]).trim().toLowerCase();
       let rowTeam = String(values[i][2]).trim();

       let matchIndex = duplicatesToDelete.findIndex(d =>
          d.domain.toLowerCase() === rowDomain &&
          d.batchId.toUpperCase() === rowBatch &&
          d.team === rowTeam
       );

       if (matchIndex > -1) {
         sheet.deleteRow(i + 1);
         duplicatesToDelete.splice(matchIndex, 1);
         deletedCount++;
       }
    }
    clearCached_('cache_dpv');
    return { success: true, message: deletedCount + " duplicate row(s) successfully cleaned up!" };
  } catch (e) {
    return { success: false, message: "Cleanup Error: " + e.toString() };
  }
}

// ==========================================
// ACTIVITY LOGS BACKEND LOGIC
// ==========================================
function saveActivityLogBackend(logData) {
  try {
    const sheet = SpreadsheetApp.openById(CYBERGUARD_SHEET_ID).getSheetByName('ACTIVITY_LOGS');
    if (!sheet) return;

    sheet.appendRow([logData.time, logData.type, logData.user, logData.details]);
  } catch(e) {}
}

function getActivityLogsBackend(token) {
  try {
    checkSession_(token);
    const sheet = SpreadsheetApp.openById(CYBERGUARD_SHEET_ID).getSheetByName('ACTIVITY_LOGS');
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();
    if(data.length <= 0) return [];

    const logs = [];
    for (let i = data.length - 1; i >= 0 && i >= data.length - 50; i--) {
      if(data[i][0] !== '') {
        logs.push({
            time: data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss") : String(data[i][0]),
            type: String(data[i][1]),
            user: String(data[i][2]),
            details: String(data[i][3])
        });
      }
    }
    return logs;
  } catch(e) { return []; }
}

// ==========================================
// DPV BULK ACTIONS BACKEND
// ==========================================
function bulkUpdateDpvBackend(token, data) {
  try {
    checkSession_(token);
    const sheet = SpreadsheetApp.openById(CYBERGUARD_SHEET_ID).getSheetByName('DATASHEET');
    const values = sheet.getDataRange().getValues();
    let updateCount = 0;

    for (let i = 1; i < values.length; i++) {
      let rowDomain = String(values[i][1]).trim().toLowerCase();

      if (data.domainsToUpdate.includes(rowDomain)) {
        if (data.updates.cicc && data.updates.cicc !== "") sheet.getRange(i + 1, 12).setValue(data.updates.cicc);
        if (data.updates.team && data.updates.team !== "") sheet.getRange(i + 1, 3).setValue(data.updates.team);
        if (data.updates.agent && data.updates.agent !== "") sheet.getRange(i + 1, 13).setValue(data.updates.agent);

        if (data.updates.status && data.updates.status !== "") {
          sheet.getRange(i + 1, 4).setValue(data.updates.status);
          sheet.getRange(i + 1, 6).setValue(data.updates.status);
          sheet.getRange(i + 1, 8).setValue(data.updates.status);
          sheet.getRange(i + 1, 10).setValue(data.updates.status);
        }

        if (data.updates.domain && data.updates.domain !== "" && data.domainsToUpdate.length === 1) {
           sheet.getRange(i + 1, 2).setValue(data.updates.domain);
        }
        updateCount++;
      }
    }
    clearCached_('cache_dpv');
    return { success: true, message: updateCount + " records updated in database." };
  } catch (e) { return { success: false, message: e.toString() }; }
}

function bulkDeleteDpvBackend(token, domainsToDelete) {
  try {
    checkSession_(token);
    const sheet = SpreadsheetApp.openById(CYBERGUARD_SHEET_ID).getSheetByName('DATASHEET');
    const values = sheet.getDataRange().getValues();
    let deleteCount = 0;

    for (let i = values.length - 1; i >= 1; i--) {
      let rowDomain = String(values[i][1]).trim().toLowerCase();
      if (domainsToDelete.includes(rowDomain)) {
        sheet.deleteRow(i + 1);
        deleteCount++;
      }
    }
    clearCached_('cache_dpv');
    return { success: true, message: deleteCount + " records permanently deleted." };
  } catch (e) { return { success: false, message: e.toString() }; }
}

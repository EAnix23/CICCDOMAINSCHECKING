/**
 * DOMAIN SYSTEM SHEET <- PORTAL
 * Keeps the "Domain List" tab of the Domain System Google Sheet in step with the Target Brands in the portal,
 * so nobody has to paste domains from GoDaddy by hand any more.
 *
 *  1. Domains that were added to a brand in the portal (including the ones assigned from the GoDaddy monitor)
 *     are appended to "Domain List" (Brand, Domain, Agent, Expiration, Account, Notes).
 *  2. Domains that left GoDaddy (the portal marks them Removed) are moved from "Domain List" to a tab named
 *     "Removed from GoDaddy", with the date, so the data is kept but the brand list stays clean.
 *
 * It never edits or deletes anything else: the ISP status and proof columns, existing rows and formulas are untouched.
 *
 * ONE-TIME SETUP
 *  a. Open the Domain System sheet > Extensions > Apps Script, paste this whole file, Save.
 *  b. Paste the automation key into SET_KEY below (it is the AUTOMATION_API_KEY of the Worker), run saveKey() once,
 *     then delete the key from the file.
 *  c. Run dryRun() and read the log: it only shows what WOULD change.
 *  d. Run setupTrigger() once. After that it runs by itself every hour.
 */

const WORKER_URL = 'https://bbc-api-gateway.ea-nix.workers.dev/';
const SET_KEY = 'PASTE_AUTOMATION_KEY_HERE';
const LIST_TAB = 'Domain List';
const REMOVED_TAB = 'Removed from GoDaddy';
const MAX_REMOVALS_PER_RUN = 60;   // safety: a bigger batch is left alone and reported in the log

function saveKey() {
  PropertiesService.getScriptProperties().setProperty('AUTOMATION_API_KEY', SET_KEY);
  Logger.log('Key saved. Now delete it from the SET_KEY line above.');
}

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncFromPortal') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncFromPortal').timeBased().everyHours(1).create();
  Logger.log('Hourly trigger created.');
}

function dryRun() { return run_(true); }
function syncFromPortal() { return run_(false); }

function norm_(d) {
  return String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].replace(/\.$/, '');
}
function fmtDate_(iso) {
  if (!iso) return '';
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1];
  return mon + ' ' + m[3] + ', ' + m[1];
}

function fetchFeed_() {
  var key = PropertiesService.getScriptProperties().getProperty('AUTOMATION_API_KEY');
  if (!key) throw new Error('Run saveKey() first (see the setup steps at the top).');
  var res = UrlFetchApp.fetch(WORKER_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ action: 'getBrandSheetFeed', args: [key, {}] }) });
  if (res.getResponseCode() !== 200) throw new Error('Portal answered HTTP ' + res.getResponseCode());
  var body = JSON.parse(res.getContentText());
  if (!body.data || !body.data.domains) throw new Error('Unexpected answer: ' + res.getContentText().slice(0, 200));
  return body.data;
}

function run_(dry) {
  var feed = fetchFeed_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(LIST_TAB);
  if (!sh) throw new Error('Tab "' + LIST_TAB + '" not found.');

  var last = sh.getLastRow();
  var width = Math.max(sh.getLastColumn(), 8);
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
  var index = {};
  rows.forEach(function (r, i) { var k = norm_(r[1]); if (k && !index[k]) index[k] = i + 2; });

  var inPortal = {};
  feed.domains.forEach(function (d) { inPortal[norm_(d.domain)] = true; });

  // 1. new domains
  var add = [];
  feed.domains.forEach(function (d) {
    var k = norm_(d.domain);
    if (k && !index[k]) { add.push([d.brand, d.domain, d.agent || '', '', fmtDate_(d.expiration), d.account || '', d.notes || '', '']); index[k] = -1; }
  });

  // 2. removed from GoDaddy (and not back in the portal list)
  var gone = [];
  feed.removed.forEach(function (r) {
    var k = norm_(r.domain), row = index[k];
    if (row && row > 0 && !inPortal[k]) gone.push({ row: row, removedAt: r.removedAt, domain: r.domain });
  });

  Logger.log((dry ? '[DRY RUN] ' : '') + 'Portal domains: ' + feed.domains.length + ' | Sheet rows: ' + rows.length + ' | to add: ' + add.length + ' | to move to "' + REMOVED_TAB + '": ' + gone.length);
  add.slice(0, 15).forEach(function (r) { Logger.log('  + ' + r[0] + '  ' + r[1]); });
  gone.slice(0, 15).forEach(function (g) { Logger.log('  - ' + g.domain + '  (removed ' + g.removedAt + ')'); });
  if (dry) return { add: add.length, remove: gone.length };

  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 8).setValues(add);

  if (gone.length) {
    if (gone.length > MAX_REMOVALS_PER_RUN) { Logger.log('More than ' + MAX_REMOVALS_PER_RUN + ' removals in one run. Nothing was moved. Check the portal Removed tab first.'); return { add: add.length, remove: 0 }; }
    var rem = ss.getSheetByName(REMOVED_TAB);
    if (!rem) {
      rem = ss.insertSheet(REMOVED_TAB);
      var head = sh.getRange(1, 1, 1, width).getValues()[0].concat(['REMOVED FROM GODADDY ON']);
      rem.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
      rem.setFrozenRows(1);
    }
    // copy first, then delete from the bottom up so row numbers stay valid
    var copy = gone.map(function (g) { return sh.getRange(g.row, 1, 1, width).getValues()[0].concat([g.removedAt]); });
    rem.getRange(rem.getLastRow() + 1, 1, copy.length, copy[0].length).setValues(copy);
    gone.sort(function (a, b) { return b.row - a.row; }).forEach(function (g) { sh.deleteRow(g.row); });
  }
  SpreadsheetApp.flush();
  return { add: add.length, remove: gone.length };
}

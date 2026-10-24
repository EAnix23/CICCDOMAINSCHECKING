// ============================================================
// GODADDY MONITOR — KPI tab for Super Admin and users assigned to a team.
// Data: Worker actions getGodaddyDashboard (reads D1) and syncGodaddy (pulls fresh data from the GoDaddy API).
// The dashboard syncs by itself when the last sync is older than 6 hours.
// ============================================================
var GD = { ns: { domains: '', servers: '', preview: null, recent: [], running: false, confirmed: false, done: 0, total: 0, results: null }, data: null, tab: 'renewal', range: 30, account: 'all', q: '', evType: 'all', syncing: false, loaded: false };
var GD_LAPSED_LABEL = {
    ACTIVE: 'Past due (still in grace period)',
    CANCELLED_REDEEMABLE: 'In redemption (can still be recovered)',
    HELD_EXPIRED_REDEMPTION_MOCK: 'Held after expiry',
    CANCELLED: 'Expired and cancelled',
    UPDATED_OWNERSHIP: 'Moved to another owner',
    UPDATE_ACCOUNT_AUCTION: 'Going to auction'
};
var GD_EVENT_LABEL = { ns_failed: 'NS change failed', renewed: 'Renewed', expired: 'Expired', status_changed: 'Status changed', ns_changed: 'Nameserver changed', added: 'New domain', removed: 'Removed' };

function gdEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function gdN(v) { return Number(v || 0).toLocaleString('en-US'); }
function gdTime(s) { return s ? new Date(String(s).replace(' ', 'T') + 'Z') : null; }
function gdDay(s) { var d = gdTime(s); return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'; }
function gdDays(s) { var d = gdTime(s); return d && !isNaN(d) ? Math.floor((d.getTime() - Date.now()) / 86400000) : null; }
function gdAgo(s) { var d = gdTime(s); if (!d) return ''; var m = Math.round((Date.now() - d.getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; }
function gdNormDomain(d) { return String(d || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].replace(/\.$/, ''); }

// One typeface (Montserrat) for the whole GoDaddy section and its nameserver modal, including hostnames and numbers.
function gdInjectFont() {
    if (document.getElementById('gdFontStyle')) return;
    var st = document.createElement('style'); st.id = 'gdFontStyle';
    st.textContent = '#gdRoot, #gdRoot *, #gdNsModal, #gdNsModal *, #gdRoot .font-mono, #gdNsModal .font-mono, #gdRoot input, #gdRoot select, #gdRoot textarea, #gdNsModal input, #gdNsModal select, #gdNsModal textarea, #gdRoot button, #gdNsModal button { font-family: "Montserrat", "Segoe UI", system-ui, sans-serif !important; } #gdRoot, #gdNsModal { font-variant-numeric: tabular-nums; }';
    document.head.appendChild(st);
}
function renderKpiGodaddyTab() {
    var content = document.getElementById('kpiTabContent');
    if (!content) return;
    gdInjectFont();
    content.innerHTML = '<div id="gdRoot"></div>';
    gdLoad(true);
}

function gdLoad(allowAutoSync) {
    google.script.run.withSuccessHandler(function (d) {
        GD.data = d; GD.loaded = true;
        var stale = !d.lastSync || (Date.now() - gdTime(d.lastSync).getTime()) > 6 * 3600000;
        gdRender();
        if (allowAutoSync && stale) gdSync(true);
    }).withFailureHandler(function (e) {
        var el = document.getElementById('gdRoot');
        if (el) el.innerHTML = '<p class="text-sm text-subtle">Could not load the GoDaddy monitor. ' + gdEsc((e && e.message) || '') + '</p>';
    }).getGodaddyDashboard(currentSessionToken);
}

function gdSync(auto) {
    if (GD.syncing) return;
    GD.syncing = true; gdRenderHead();
    google.script.run.withSuccessHandler(function (r) {
        GD.syncing = false;
        var bad = (r.accounts || []).filter(function (a) { return !a.ok; }).length;
        var ev = (r.accounts || []).reduce(function (s, a) { var c = a.counts || {}; return s + (c.renewed || 0) + (c.expired || 0) + (c.ns || 0) + (c.status || 0) + (c.added || 0) + (c.removed || 0); }, 0);
        if (typeof showPremiumToast === 'function') showPremiumToast(auto ? 'Auto-synced' : 'Synced with GoDaddy', ev + ' change' + (ev === 1 ? '' : 's') + ' found' + (bad ? ', ' + bad + ' account(s) need attention.' : '.'), bad ? 'warning' : 'success');
        gdLoad(false);
    }).withFailureHandler(function (e) {
        GD.syncing = false; gdRenderHead();
        if (typeof showPremiumToast === 'function') showPremiumToast('Sync failed', (e && e.message) || 'Try again in a minute.', 'error');
    }).syncGodaddy(currentSessionToken);
}

// ---- model ----
function gdModel() {
    var d = GD.data, brandMap = {};
    d.brands.forEach(function (b) { brandMap[gdNormDomain(b.domain)] = b.brand; });
    var rows = d.domains.map(function (r) {
        var days = gdDays(r.expires);
        return { domain: r.domain, account: r.account.replace(/^Godaddy\s+/i, ''), status: r.status, expires: r.expires, days: days, auto: !!r.renewAuto, locked: !!r.locked, ns: r.ns, brand: brandMap[r.domain] || '' };
    });
    var active = rows.filter(function (r) { return r.status === 'ACTIVE'; });
    var renewal = active.filter(function (r) { return r.days != null && r.days >= 0 && r.days <= 60; }).sort(function (a, b) { return a.days - b.days; });
    var lapsed = rows.filter(function (r) { return r.days != null && r.days < 0 && r.days >= -180 && r.status !== 'UPDATED_OWNERSHIP'; }).sort(function (a, b) { return b.days - a.days; });
    var cut14 = Date.now() - 14 * 86400000;
    var events = d.events.map(function (e) { e.brand = brandMap[e.domain] || ''; e.accountShort = (e.account || '').replace(/^Godaddy\s+/i, ''); return e; });
    var recent = function (t) { return events.filter(function (e) { return e.type === t && gdTime(e.at) && gdTime(e.at).getTime() >= cut14; }); };
    return { rows: rows, active: active, renewal: renewal, lapsed: lapsed, events: events, renewed14: recent('renewed'), ns14: recent('ns_changed'), lapsedNow: lapsed.filter(function (r) { return r.days >= -90; }) };
}

// ---- rendering ----
function gdRender() {
    var root = document.getElementById('gdRoot'); if (!root) return;
    root.innerHTML = '<div id="gdHead"></div><div id="gdStats"></div><div id="gdAccounts"></div><div id="gdBody"></div>';
    gdRenderHead(); gdRenderStats(); gdRenderAccounts(); gdRenderBody();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function gdRenderHead() {
    var el = document.getElementById('gdHead'); if (!el || !GD.data) return;
    el.innerHTML = '<div class="flex items-center justify-between flex-wrap gap-3 mb-5"><div><h3 class="text-sm font-black text-heading flex items-center gap-2"><i data-lucide="globe" class="h-4 w-4 text-indigo-500"></i> GoDaddy Monitor</h3>' +
        '<p class="text-[10px] text-subtle mt-0.5">Live from the GoDaddy accounts. Last synced ' + (GD.data.lastSync ? gdEsc(gdAgo(GD.data.lastSync)) : 'never') + '. It refreshes by itself when older than 6 hours.</p></div>' +
        '<div class="flex items-center gap-2"><button onclick="gdOpenNs()" class="px-4 py-2 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app shadow-sm flex items-center gap-1.5"><i data-lucide="server-cog" class="h-3.5 w-3.5"></i> Change nameservers</button><button onclick="gdSync(false)" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 shadow-sm flex items-center gap-1.5 ' + (GD.syncing ? 'opacity-60 pointer-events-none' : '') + '"><i data-lucide="refresh-cw" class="h-3.5 w-3.5 ' + (GD.syncing ? 'animate-spin' : '') + '"></i> ' + (GD.syncing ? 'Syncing...' : 'Sync now') + '</button></div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function gdRenderStats() {
    var el = document.getElementById('gdStats'); if (!el) return; var m = gdModel();
    function stat(label, val, sub, color, tab) { return '<button onclick="gdSetTab(\'' + tab + '\')" class="panel-card p-4 text-left hover:border-indigo-400 transition-colors"><p class="text-[10px] font-bold text-subtle uppercase">' + label + '</p><p class="text-2xl font-black mt-1 ' + color + '">' + val + '</p><p class="text-[10px] text-subtle mt-0.5">' + sub + '</p></button>'; }
    var d7 = m.renewal.filter(function (r) { return r.days <= 7; }).length, d30 = m.renewal.filter(function (r) { return r.days <= 30; }).length;
    var autoOff30 = m.renewal.filter(function (r) { return r.days <= 30 && !r.auto; }).length;
    el.innerHTML = '<div class="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-5">' +
        stat('Active domains', gdN(m.active.length), 'in ' + GD.data.accounts.filter(function (a) { return a.ok; }).length + ' working accounts', 'text-heading', 'all') +
        stat('Expiring in 7 days', gdN(d7), 'renew now', 'text-rose-500', 'renewal') +
        stat('Expiring in 30 days', gdN(d30), autoOff30 + ' have auto-renew OFF', 'text-amber-500', 'renewal') +
        stat('Not renewed', gdN(m.lapsedNow.length), 'expired in the last 90 days', 'text-rose-500', 'lapsed') +
        stat('Just renewed', gdN(m.renewed14.length), 'last 14 days', 'text-emerald-500', 'renewed') +
        stat('NS changes', gdN(m.ns14.length), 'last 14 days', 'text-indigo-500', 'changes') + '</div>';
}

function gdRenderAccounts() {
    var el = document.getElementById('gdAccounts'); if (!el) return;
    el.innerHTML = '<div class="flex flex-wrap gap-2 mb-5">' + GD.data.accounts.map(function (a) {
        var short = a.account.replace(/^Godaddy\s+/i, '');
        return a.ok ? '<span class="px-3 py-1.5 rounded-lg border border-theme text-[11px] bg-panel text-body"><b class="text-heading">' + gdEsc(short) + '</b> &middot; ' + gdN(a.domains) + ' domains <span class="text-emerald-500 font-bold">OK</span></span>'
            : '<span class="px-3 py-1.5 rounded-lg border border-rose-500/40 text-[11px] bg-rose-500/10 text-rose-500" title="' + gdEsc(a.error) + '"><b>' + gdEsc(short) + '</b> &middot; token problem: ' + gdEsc(a.error) + '</span>';
    }).join('') + '</div>';
}

function gdSetTab(t) { GD.tab = t; GD.q = ''; GD.account = 'all'; gdRenderBody(); }
function gdTabBtn(id, label, n) { var on = GD.tab === id; return '<button onclick="gdSetTab(\'' + id + '\')" class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ' + (on ? 'bg-indigo-600 text-white shadow-sm' : 'text-subtle hover:text-body') + '">' + label + (n != null ? ' <span class="opacity-70">' + n + '</span>' : '') + '</button>'; }

function gdRenderBody() {
    var el = document.getElementById('gdBody'); if (!el) return; var m = gdModel();
    var tabs = '<div class="flex items-center gap-0.5 bg-app border border-theme rounded-xl p-1 shadow-sm flex-wrap">' + gdTabBtn('renewal', 'For renewal', m.renewal.length) + gdTabBtn('lapsed', 'Not renewed', m.lapsed.length) + gdTabBtn('renewed', 'Renewed', m.events.filter(function (e) { return e.type === 'renewed'; }).length) + gdTabBtn('changes', 'Changes', m.events.length) + gdTabBtn('all', 'All domains', m.rows.length) + '</div>';
    var accounts = GD.data.accounts.map(function (a) { return a.account.replace(/^Godaddy\s+/i, ''); });
    var tools = '<div class="flex items-center gap-2 flex-wrap">' +
        '<select onchange="GD.account=this.value;gdRenderTable()" class="px-2.5 py-2 bg-app border border-theme rounded-xl text-xs text-body"><option value="all">All accounts</option>' + accounts.map(function (a) { return '<option value="' + gdEsc(a) + '"' + (GD.account === a ? ' selected' : '') + '>' + gdEsc(a) + '</option>'; }).join('') + '</select>' +
        '<input id="gdSearch" oninput="GD.q=this.value;gdRenderTable()" value="' + gdEsc(GD.q) + '" placeholder="Search domain or brand..." class="px-3 py-2 bg-app border border-theme rounded-xl text-xs text-body focus:outline-none w-48">' +
        '<button onclick="gdDownload()" class="px-3 py-2 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app shadow-sm flex items-center gap-1.5"><i data-lucide="download" class="h-3.5 w-3.5"></i> CSV</button></div>';
    var sub = '';
    if (GD.tab === 'renewal') sub = '<div class="flex items-center gap-2 mb-3 text-[11px] text-subtle">Show domains expiring within ' + [7, 15, 30, 60].map(function (n) { return '<button onclick="GD.range=' + n + ';gdRenderBody()" class="px-2.5 py-1 rounded-lg border ' + (GD.range === n ? 'bg-indigo-600 text-white border-indigo-600' : 'border-theme text-body hover:bg-app') + ' font-bold">' + n + ' days</button>'; }).join('') + '</div>';
    if (GD.tab === 'changes') sub = '<p class="text-[11px] text-subtle mb-3">Expiry, status and new or removed domains are caught on every sync. Nameserver changes are recorded when made from this portal, and also when anyone changes them directly in GoDaddy: every active domain is re-read in rotation (30 domains every 15 minutes, so each one about every 11 hours).</p><div class="flex items-center gap-2 mb-3 flex-wrap">' + [['all', 'All'], ['ns_changed', 'Nameserver'], ['expired', 'Expired'], ['renewed', 'Renewed'], ['status_changed', 'Status'], ['added', 'New'], ['removed', 'Removed']].map(function (t) { return '<button onclick="GD.evType=\'' + t[0] + '\';gdRenderTable()" class="px-2.5 py-1 rounded-lg border text-[11px] font-bold ' + (GD.evType === t[0] ? 'bg-indigo-600 text-white border-indigo-600' : 'border-theme text-body hover:bg-app') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (GD.tab === 'renewed') sub = '<div class="text-[11px] text-subtle mb-3 p-3 rounded-xl border border-dashed border-theme">Renewals are detected when a domain\'s expiry date moves forward between syncs, so tracking starts from the first sync. <b class="text-body">Receipts and order numbers are not available</b> from the GoDaddy API with the current tokens (GoDaddy refuses the orders endpoint). Receipts stay in the GoDaddy account or its email.</div>';
    el.innerHTML = '<div class="panel-card p-5"><div class="flex items-center justify-between flex-wrap gap-3 mb-4">' + tabs + tools + '</div>' + sub + '<div id="gdSelBar"></div><div id="gdTable" class="overflow-x-auto"></div></div>';
    gdRenderTable(); gdRenderSelBar();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function gdCurrentRows() {
    var m = gdModel(), q = GD.q.trim().toLowerCase(), t = GD.tab, rows, cols;
    function match(r) { return (GD.account === 'all' || (r.account || r.accountShort) === GD.account) && (!q || (r.domain + ' ' + (r.brand || '')).toLowerCase().indexOf(q) !== -1); }
    var auto = function (r) { return r.auto ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap bg-emerald-500/15 text-emerald-500">Auto-renew ON</span>' : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap bg-rose-500/15 text-rose-500">Auto-renew OFF</span>'; };
    var dom = function (r) { return '<span class="font-bold text-heading">' + gdEsc(r.domain) + '</span>'; };
    GD.sel = GD.sel || {};
    var selCol = ['<input type="checkbox" onchange="gdToggleAll(this.checked)" title="Select all shown" aria-label="Select all shown">', function (r) { return r.status === 'ACTIVE' ? '<input type="checkbox" ' + (GD.sel[r.domain] ? 'checked' : '') + ' data-d="' + gdEsc(r.domain) + '" onchange="gdToggleSel(this.getAttribute(\'data-d\'),this.checked)" aria-label="Select ' + gdEsc(r.domain) + '">' : ''; }, function () { return ''; }, true];
    var editCol = ['', function (r) { return r.status === 'ACTIVE' ? '<button onclick="gdEditNs([this.getAttribute(\'data-d\')])" data-d="' + gdEsc(r.domain) + '" class="px-2.5 py-1 rounded-lg border border-theme text-[11px] font-bold text-body hover:bg-app hover:border-indigo-400 whitespace-nowrap">Edit NS</button>' : ''; }, function () { return ''; }, true];
    if (t === 'renewal') {
        rows = m.renewal.filter(function (r) { return r.days <= GD.range && match(r); });
        cols = [['Domain', dom, function (r) { return r.domain; }], ['Brand', function (r) { return gdEsc(r.brand || '-'); }, function (r) { return r.brand; }], ['Account', function (r) { return gdEsc(r.account); }, function (r) { return r.account; }], ['Expires', function (r) { return gdDay(r.expires); }, function (r) { return r.expires; }],
            ['Days left', function (r) { return '<b class="' + (r.days <= 7 ? 'text-rose-500' : r.days <= 15 ? 'text-amber-500' : 'text-body') + '">' + r.days + '</b>'; }, function (r) { return r.days; }], ['Auto-renew', auto, function (r) { return r.auto ? 'ON' : 'OFF'; }]];
        cols = [selCol].concat(cols, [editCol]);
    } else if (t === 'lapsed') {
        rows = m.lapsed.filter(match);
        cols = [['Domain', dom, function (r) { return r.domain; }], ['Brand', function (r) { return gdEsc(r.brand || '-'); }, function (r) { return r.brand; }], ['Account', function (r) { return gdEsc(r.account); }, function (r) { return r.account; }], ['Expired on', function (r) { return gdDay(r.expires); }, function (r) { return r.expires; }],
            ['Days ago', function (r) { return '<b class="text-rose-500">' + Math.abs(r.days) + '</b>'; }, function (r) { return Math.abs(r.days); }], ['What it means', function (r) { return gdEsc(GD_LAPSED_LABEL[r.status] || r.status); }, function (r) { return r.status; }]];
    } else if (t === 'renewed' || t === 'changes') {
        var types = t === 'renewed' ? ['renewed'] : (GD.evType === 'all' ? null : [GD.evType]);
        rows = m.events.filter(function (e) { return (!types || types.indexOf(e.type) !== -1) && match(Object.assign({}, e, { account: e.accountShort })); });
        var change = function (e) {
            if (e.type === 'ns_changed') return '<span class="font-mono text-[10px] text-subtle">' + gdEsc(e.oldValue || '(none)').replace(/,/g, '<br>') + '</span> &rarr; <span class="font-mono text-[10px] text-body">' + gdEsc(e.newValue || '(none)').replace(/,/g, '<br>') + '</span>';
            if (e.type === 'renewed') return gdDay(e.oldValue) + ' &rarr; <b class="text-emerald-500">' + gdDay(e.newValue) + '</b>';
            if (e.type === 'added') return 'expires ' + gdDay(e.newValue);
            return gdEsc(e.oldValue || '-') + ' &rarr; ' + gdEsc(e.newValue || '-');
        };
        cols = [['When', function (e) { return gdDay(e.at); }, function (e) { return e.at; }], ['Domain', function (e) { return '<span class="font-bold text-heading">' + gdEsc(e.domain) + '</span>'; }, function (e) { return e.domain; }], ['Brand', function (e) { return gdEsc(e.brand || '-'); }, function (e) { return e.brand; }], ['Account', function (e) { return gdEsc(e.accountShort); }, function (e) { return e.accountShort; }],
            ['Change', function (e) { return '<span class="font-bold">' + (GD_EVENT_LABEL[e.type] || e.type) + '</span><br>' + change(e); }, function (e) { return (GD_EVENT_LABEL[e.type] || e.type) + ': ' + e.oldValue + ' > ' + e.newValue; }], ['By', function (e) { return gdEsc(e.byUser || (e.source === 'sync' ? 'Detected on sync' : '-')); }, function (e) { return e.byUser || e.source; }]];
        if (t === 'renewed') cols.push(['Order / receipt', function () { return '<span class="text-subtle">Not available from GoDaddy</span>'; }, function () { return ''; }]);
    } else {
        rows = m.rows.filter(match).sort(function (a, b) { return a.domain.localeCompare(b.domain); });
        cols = [['Domain', dom, function (r) { return r.domain; }], ['Brand', function (r) { return gdEsc(r.brand || '-'); }, function (r) { return r.brand; }], ['Account', function (r) { return gdEsc(r.account); }, function (r) { return r.account; }], ['Status', function (r) { return gdEsc(r.status.replace(/_/g, ' ').toLowerCase()); }, function (r) { return r.status; }],
            ['Expires', function (r) { return gdDay(r.expires); }, function (r) { return r.expires; }], ['Auto-renew', function (r) { return r.status === 'ACTIVE' ? auto(r) : '-'; }, function (r) { return r.auto ? 'ON' : 'OFF'; }], ['Nameservers', function (r) { return '<span class="font-mono text-[10px] text-subtle">' + gdEsc(r.ns || '-').replace(/,/g, '<br>') + '</span>'; }, function (r) { return r.ns; }]];
        cols = [selCol].concat(cols, [editCol]);
    }
    return { rows: rows, cols: cols };
}

function gdRenderTable() {
    var el = document.getElementById('gdTable'); if (!el) return;
    var c = gdCurrentRows(), rows = c.rows;
    if (!rows.length) { el.innerHTML = '<p class="text-sm text-subtle py-8 text-center">' + (GD.tab === 'renewed' ? 'No renewals detected yet. They appear here after the next syncs notice an expiry date moving forward.' : GD.tab === 'changes' ? 'No changes recorded for this filter.' : 'Nothing matches this view.') + '</p>'; return; }
    var shown = rows.slice(0, 300);
    el.innerHTML = '<table class="w-full text-xs"><thead><tr class="text-left text-[10px] uppercase text-subtle border-b border-theme">' + c.cols.map(function (x) { return '<th class="py-2 pr-4">' + x[0] + '</th>'; }).join('') + '</tr></thead><tbody>' +
        shown.map(function (r) { return '<tr class="border-b border-theme/60 align-top">' + c.cols.map(function (x) { return '<td class="py-2 pr-4 text-body">' + x[1](r) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table><p class="text-[10px] text-subtle mt-3">' + gdN(rows.length) + ' rows' + (rows.length > shown.length ? ' (showing the first ' + shown.length + ', download the CSV for all)' : '') + '.</p>';
}

function gdDownload() {
    var c = gdCurrentRows();
    var cc = c.cols.filter(function (x) { return !x[3]; });
    var csv = cc.map(function (x) { return '"' + x[0] + '"'; }).join(',') + '\n' + c.rows.map(function (r) { return cc.map(function (x) { return '"' + String(x[2](r) == null ? '' : x[2](r)).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'godaddy-' + GD.tab + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
}

// ---- Change nameservers (modal wizard: Domains > Nameservers > Review > Result) ----
var GD_NS_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
var GD_NS_STEPS = ['Domains', 'Nameservers', 'Review', 'Result'];
var GD_NS_MAX = 300;

function gdNsFresh() {
    return { step: 1, selected: [], pickQ: '', pickAcct: 'all', pickSort: 'domain', pickDir: 1, paste: '', servers: '', recent: [], review: null, reviewQ: '', revOnly: 'all', revSort: 'domain', revDir: 1, confirmed: false, loadingReview: false, loadingCurrent: false, running: false, done: 0, total: 0, results: null, resFilter: 'all', resSort: 'domain', resDir: 1, discard: false };
}
function gdNsLines(t) { return String(t || '').split(/[\n,;]+/).map(function (x) { return x.trim().toLowerCase().replace(/\.$/, ''); }).filter(Boolean); }
function gdNsClean(d) { return String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[\/?#]/)[0].replace(/\.$/, ''); }
function gdNsProblem() {
    var ns = gdNsLines(GD.ns.servers);
    if (!ns.length) return '';
    if (ns.length < 2) return 'Add at least 2 nameservers.';
    if (ns.length > 13) return 'GoDaddy accepts at most 13 nameservers.';
    var bad = ns.filter(function (n) { return !GD_NS_RE.test(n); });
    return bad.length ? 'Not a valid hostname: ' + bad.join(', ') : '';
}
function gdNsNewKey() { return gdNsLines(GD.ns.servers).slice().sort().join(','); }
function gdNsHasInput() { var n = GD.ns; return n.selected.length > 0 || n.servers.trim() !== '' || n.paste.trim() !== ''; }
function gdNsSortTh(label, key, cur, dir, fn) {
    return '<th class="p-2 select-none"><button onclick="' + fn + '(\'' + key + '\')" class="uppercase tracking-wide hover:text-heading flex items-center gap-1">' + label + '<span class="' + (cur === key ? 'text-indigo-500' : 'opacity-30') + '">' + (cur === key ? (dir > 0 ? '&#9650;' : '&#9660;') : '&#9650;') + '</span></button></th>';
}
function gdNsCmp(a, b, dir) { a = a == null ? '' : a; b = b == null ? '' : b; return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))) * dir; }

// ----- modal shell -----
function gdOpenNs(keep) {
    gdInjectFont();
    var m = document.getElementById('gdNsModal');
    if (!m) {
        m = document.createElement('div'); m.id = 'gdNsModal';
        m.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(2,6,23,.62);backdrop-filter:blur(3px);display:none;align-items:flex-start;justify-content:center;padding:3vh 16px;overflow-y:auto';
        m.onmousedown = function (e) { if (e.target === m) gdNsRequestClose(); };
        document.body.appendChild(m);
        document.addEventListener('keydown', function (e) { var mm = document.getElementById('gdNsModal'); if (e.key === 'Escape' && mm && mm.style.display !== 'none') gdNsRequestClose(); });
    }
    if (!keep && !GD.ns.running) GD.ns = gdNsFresh();
    m.style.display = 'flex';
    gdNsRender();
}
function gdNsHide() { var m = document.getElementById('gdNsModal'); if (m) m.style.display = 'none'; }
// Cancel / X / Esc / click outside: ask first when something is filled in, never while a change is running.
function gdNsRequestClose() {
    var n = GD.ns;
    if (n.running) { if (typeof showPremiumToast === 'function') showPremiumToast('Please wait', 'The nameserver change is still running.', 'warning'); return; }
    if (n.step < 4 && gdNsHasInput()) { n.discard = true; gdNsRender(); return; }
    gdNsHide();
}
function gdNsKeepEditing() { GD.ns.discard = false; gdNsRender(); }
function gdNsDiscard() { GD.ns = gdNsFresh(); gdNsHide(); }
function gdNsDone() { GD.ns = gdNsFresh(); gdNsHide(); gdLoad(false); }

function gdNsRender() {
    var m = document.getElementById('gdNsModal'); if (!m) return;
    var n = GD.ns;
    var stepper = '<div class="flex items-center gap-2 flex-wrap mt-4">' + GD_NS_STEPS.map(function (s, i) {
        var k = i + 1, on = n.step === k, done = n.step > k;
        return '<div class="flex items-center gap-2"><span class="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black ' + (on ? 'bg-indigo-600 text-white' : done ? 'bg-emerald-500 text-white' : 'bg-app text-subtle border border-theme') + '">' + (done ? '&#10003;' : k) + '</span><span class="text-xs font-bold ' + (on ? 'text-heading' : 'text-subtle') + '">' + s + '</span>' + (k < 4 ? '<span class="w-6 h-px bg-current opacity-20 mx-1"></span>' : '') + '</div>';
    }).join('') + '</div>';
    var body = n.step === 1 ? gdNsStep1() : n.step === 2 ? gdNsStep2() : n.step === 3 ? gdNsStep3() : gdNsStep4();
    var discard = n.discard ? '<div style="position:absolute;inset:0;background:rgba(2,6,23,.55);border-radius:1rem;display:flex;align-items:center;justify-content:center;padding:20px;z-index:5"><div class="panel-card p-6" style="max-width:420px;box-shadow:0 20px 50px rgba(0,0,0,.45)"><h4 class="text-base font-black text-heading">Discard this change?</h4><p class="text-xs text-body mt-2">You have ' + n.selected.length + ' domain' + (n.selected.length === 1 ? '' : 's') + (n.servers.trim() ? ' and nameservers' : '') + ' filled in. If you cancel now, they are cleared. Nothing has been changed at GoDaddy.</p><div class="flex justify-end gap-2 mt-5"><button onclick="gdNsKeepEditing()" class="px-4 py-2 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Keep editing</button><button onclick="gdNsDiscard()" class="px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700">Yes, discard</button></div></div></div>' : '';
    m.innerHTML = '<div class="panel-card" style="position:relative;width:min(1040px,100%);padding:0;border-radius:1rem;box-shadow:0 30px 70px rgba(0,0,0,.45)">' +
        '<div style="padding:22px 26px 18px;border-bottom:1px solid var(--border-theme)"><div class="flex items-start justify-between gap-4"><div><h3 class="text-lg font-black text-heading flex items-center gap-2"><i data-lucide="server-cog" class="h-5 w-5 text-indigo-500"></i> Change Nameservers</h3><p class="text-[11px] text-subtle mt-1">Applied straight to the GoDaddy account that owns each domain. Every change is saved under your name.</p></div><button onclick="gdNsRequestClose()" aria-label="Close" class="text-subtle hover:text-heading text-2xl leading-none px-2">&times;</button></div>' + stepper + '</div>' +
        '<div id="gdNsBody" style="padding:20px 26px">' + body + '</div>' + gdNsFooter() + discard + '</div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (n.step === 1) gdNsRenderPick();
    if (n.step === 3) gdNsRenderRev();
    if (n.step === 4) gdNsRenderRes();
    gdNsRefreshNav();
}

function gdNsFooter() {
    var n = GD.ns, back = n.step === 2 || n.step === 3, left = n.step < 4 ? '<button onclick="gdNsRequestClose()" class="px-4 py-2.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Cancel</button>' : '<span></span>';
    var right = '';
    if (back && !n.running) right += '<button onclick="gdNsBack()" class="px-4 py-2.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Back</button>';
    if (n.step === 4) right += '<button onclick="gdNsDownload()" class="px-4 py-2.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app" ' + (n.running ? 'disabled style="opacity:.4;pointer-events:none"' : '') + '>Download CSV</button>' + '<button id="gdNsNext" onclick="gdNsNext()" class="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 shadow-sm">Done</button>';
    else right += '<button id="gdNsNext" onclick="gdNsNext()" class="px-5 py-2.5 text-white rounded-lg text-xs font-bold shadow-sm ' + (n.step === 3 ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700') + '">Next</button>';
    return '<div style="padding:14px 26px;border-top:1px solid var(--border-theme);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><div class="flex items-center gap-3">' + left + '<span id="gdNsHint" class="text-[11px] text-subtle"></span></div><div class="flex items-center gap-2">' + right + '</div></div>';
}

function gdNsNavState() {
    var n = GD.ns;
    if (n.step === 1) return { can: n.selected.length > 0, label: 'Next: nameservers (' + n.selected.length + ')', hint: n.selected.length ? '' : 'Pick or paste at least one domain.' };
    if (n.step === 2) { var p = gdNsProblem(); var has = gdNsLines(n.servers).length >= 2 && !p; return { can: has, label: 'Next: review', hint: p || (has ? '' : 'Add 2 or more nameservers.') }; }
    if (n.step === 3) {
        var todo = gdNsReviewTodo().length;
        return { can: n.confirmed && todo > 0 && !n.loadingReview && !n.loadingCurrent, label: 'Change ' + todo + ' domain' + (todo === 1 ? '' : 's'), hint: n.loadingReview || n.loadingCurrent ? 'Reading current nameservers from GoDaddy...' : (todo === 0 ? 'Nothing to change.' : (n.confirmed ? '' : 'Tick the confirmation to continue.')) };
    }
    return { can: !n.running, label: n.running ? 'Working...' : 'Done', hint: '' };
}
function gdNsRefreshNav() {
    var b = document.getElementById('gdNsNext'), h = document.getElementById('gdNsHint'); if (!b) return;
    var s = gdNsNavState();
    b.textContent = s.label; b.style.opacity = s.can ? '1' : '.45'; b.style.pointerEvents = s.can ? 'auto' : 'none';
    if (h) h.textContent = s.hint;
}
function gdNsBack() { if (GD.ns.running) return; if (GD.ns.step === 3) GD.ns.review = null; GD.ns.step--; GD.ns.confirmed = false; gdNsRender(); }
function gdNsNext() {
    var n = GD.ns, s = gdNsNavState(); if (!s.can) return;
    if (n.step === 1) { n.step = 2; gdNsRender(); }
    else if (n.step === 2) { n.step = 3; n.review = null; n.confirmed = false; n.loadingReview = true; gdNsRender(); gdNsLoadReview(); }
    else if (n.step === 3) gdNsApply();
    else gdNsDone();
}

// ----- step 1: domains (search + sort + paste) -----
function gdNsStep1() {
    var accts = []; (GD.data ? GD.data.accounts : []).forEach(function (a) { accts.push(a.account.replace(/^Godaddy\s+/i, '')); });
    return '<div class="grid grid-cols-1 lg:grid-cols-5 gap-5">' +
        '<div class="lg:col-span-3"><div class="flex items-center justify-between mb-2"><label class="text-xs font-black text-heading">Find domains in your GoDaddy accounts</label><span id="gdNsPickCount" class="text-[10px] text-subtle"></span></div>' +
        '<div class="flex gap-2 flex-wrap mb-2"><input id="gdNsPickQ" oninput="GD.ns.pickQ=this.value;gdNsRenderPick()" value="' + gdEsc(GD.ns.pickQ) + '" placeholder="Search domain or brand..." class="flex-1 min-w-[160px] px-3 py-2 bg-app border border-theme rounded-xl text-xs text-body focus:outline-none">' +
        '<select onchange="GD.ns.pickAcct=this.value;gdNsRenderPick()" class="px-2.5 py-2 bg-app border border-theme rounded-xl text-xs text-body"><option value="all">All accounts</option>' + accts.map(function (a) { return '<option value="' + gdEsc(a) + '"' + (GD.ns.pickAcct === a ? ' selected' : '') + '>' + gdEsc(a) + '</option>'; }).join('') + '</select>' +
        '<select onchange="var v=this.value.split(\':\');GD.ns.pickSort=v[0];GD.ns.pickDir=+v[1];gdNsRenderPick()" class="px-2.5 py-2 bg-app border border-theme rounded-xl text-xs text-body"><option value="domain:1">Name A-Z</option><option value="domain:-1">Name Z-A</option><option value="expires:1">Expires soonest</option><option value="expires:-1">Expires latest</option><option value="account:1">Account</option></select></div>' +
        '<div class="flex gap-2 mb-2"><button onclick="gdNsSelectShown()" class="px-3 py-1.5 bg-panel border border-theme rounded-lg text-[11px] font-bold text-body hover:bg-app">Select all shown</button><button onclick="GD.ns.selected=[];gdNsRender()" class="px-3 py-1.5 bg-panel border border-theme rounded-lg text-[11px] font-bold text-body hover:bg-app">Clear selection</button></div>' +
        '<div id="gdNsPickList" class="border border-theme rounded-xl overflow-y-auto" style="max-height:340px"></div></div>' +
        '<div class="lg:col-span-2"><label class="text-xs font-black text-heading">Or paste a list</label><textarea id="gdNsPaste" oninput="GD.ns.paste=this.value;gdNsRefreshNav()" rows="4" class="mt-1.5 w-full px-3 py-2 bg-app border border-theme rounded-xl text-xs font-mono text-body focus:outline-none" placeholder="example1.com&#10;https://www.example2.net/">' + gdEsc(GD.ns.paste) + '</textarea>' +
        '<button onclick="gdNsAddPasted()" class="mt-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-bold hover:bg-indigo-700">Add pasted domains</button>' +
        '<div class="flex items-center justify-between mt-4 mb-1.5"><span class="text-xs font-black text-heading">Selected <span id="gdNsSelCount" class="text-indigo-500"></span></span></div><div id="gdNsSelList" class="border border-theme rounded-xl overflow-y-auto p-2 flex flex-wrap gap-1.5" style="max-height:170px"></div></div></div>';
}
function gdNsPickRows() {
    var d = GD.data, n = GD.ns; if (!d) return [];
    var brandMap = {}; d.brands.forEach(function (b) { brandMap[gdNormDomain(b.domain)] = b.brand; });
    var q = n.pickQ.trim().toLowerCase();
    var rows = d.domains.filter(function (r) { return r.status === 'ACTIVE'; }).map(function (r) { return { domain: r.domain, account: r.account.replace(/^Godaddy\s+/i, ''), expires: r.expires, brand: brandMap[r.domain] || '' }; }).filter(function (r) {
        return (n.pickAcct === 'all' || r.account === n.pickAcct) && (!q || (r.domain + ' ' + r.brand).toLowerCase().indexOf(q) !== -1);
    });
    rows.sort(function (a, b) { return gdNsCmp(a[n.pickSort], b[n.pickSort], n.pickDir) || a.domain.localeCompare(b.domain); });
    return rows;
}
function gdNsRenderPick() {
    var el = document.getElementById('gdNsPickList'); if (!el) return;
    var rows = gdNsPickRows(), shown = rows.slice(0, 250), sel = {}; GD.ns.selected.forEach(function (x) { sel[x] = 1; });
    var cnt = document.getElementById('gdNsPickCount'); if (cnt) cnt.textContent = rows.length + ' match' + (rows.length === 1 ? '' : 'es');
    el.innerHTML = shown.length ? shown.map(function (r) {
        return '<label class="flex items-center gap-3 px-3 py-2 border-b border-theme/60 hover:bg-app cursor-pointer text-xs"><input type="checkbox" ' + (sel[r.domain] ? 'checked' : '') + ' onchange="gdNsPick(this.getAttribute(\'data-d\'),this.checked)" data-d="' + gdEsc(r.domain) + '"><span class="font-bold text-heading flex-1 truncate">' + gdEsc(r.domain) + '</span><span class="text-subtle truncate" style="max-width:120px">' + gdEsc(r.brand) + '</span><span class="text-subtle">' + gdEsc(r.account) + '</span></label>';
    }).join('') + (rows.length > shown.length ? '<p class="text-[10px] text-subtle p-2">Showing the first ' + shown.length + '. Search to narrow down.</p>' : '') : '<p class="text-xs text-subtle p-6 text-center">' + (GD.data ? 'No domain matches.' : 'Loading your domains...') + '</p>';
    gdNsRenderSel();
}
function gdNsRenderSel() {
    var el = document.getElementById('gdNsSelList'), c = document.getElementById('gdNsSelCount');
    if (c) c.textContent = '(' + GD.ns.selected.length + ')';
    if (el) el.innerHTML = GD.ns.selected.length ? GD.ns.selected.map(function (d) { return '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-app border border-theme text-[10px] font-mono text-body">' + gdEsc(d) + '<button onclick="gdNsPick(this.getAttribute(\'data-d\'),false);gdNsRenderPick()" data-d="' + gdEsc(d) + '" class="text-subtle hover:text-rose-500" aria-label="Remove">&times;</button></span>'; }).join('') : '<span class="text-[11px] text-subtle p-1">Nothing selected yet.</span>';
    gdNsRefreshNav();
}
function gdNsPick(d, on) {
    var i = GD.ns.selected.indexOf(d);
    if (on && i === -1) { if (GD.ns.selected.length >= GD_NS_MAX) { if (typeof showPremiumToast === 'function') showPremiumToast('Limit reached', 'You can change up to ' + GD_NS_MAX + ' domains at a time.', 'warning'); gdNsRenderPick(); return; } GD.ns.selected.push(d); }
    if (!on && i !== -1) GD.ns.selected.splice(i, 1);
    gdNsRenderSel();
}
function gdNsSelectShown() { gdNsPickRows().forEach(function (r) { if (GD.ns.selected.indexOf(r.domain) === -1 && GD.ns.selected.length < GD_NS_MAX) GD.ns.selected.push(r.domain); }); gdNsRenderPick(); }
function gdNsAddPasted() {
    var n = GD.ns, list = String(n.paste || '').split(/[\s,;]+/).map(gdNsClean).filter(Boolean), added = 0, dup = 0;
    list.forEach(function (d) { if (n.selected.indexOf(d) !== -1) dup++; else if (n.selected.length < GD_NS_MAX) { n.selected.push(d); added++; } });
    n.paste = ''; var ta = document.getElementById('gdNsPaste'); if (ta) ta.value = '';
    if (typeof showPremiumToast === 'function') showPremiumToast(added ? 'Domains added' : 'Nothing new', added + ' added' + (dup ? ', ' + dup + ' already selected' : '') + '.', added ? 'success' : 'warning');
    gdNsRenderPick();
}

// ----- step 2: nameservers -----
function gdNsStep2() {
    var chips = (GD.ns.recent || []).map(function (r, i) { return '<button onclick="gdNsUseSet(' + i + ')" class="px-3 py-2 rounded-xl border border-theme text-[11px] font-mono text-body hover:bg-app hover:border-indigo-400 text-left" title="Used ' + r.c + ' time(s), last ' + gdEsc(gdDay(r.at)) + '">' + gdEsc(r.ns).replace(/,/g, '<br>') + '</button>'; }).join('');
    if (!GD.ns.recentLoaded) gdNsLoadRecent();
    return '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6"><div><label class="text-xs font-black text-heading">New nameservers <span class="text-subtle font-normal">one per line, 2 to 13</span></label>' +
        '<textarea id="gdNsServers" oninput="GD.ns.servers=this.value;gdNsRefreshNav();gdNsLive()" rows="7" class="mt-1.5 w-full px-3 py-2 bg-app border border-theme rounded-xl text-sm font-mono text-body focus:outline-none" placeholder="ns1.example.net&#10;ns2.example.net">' + gdEsc(GD.ns.servers) + '</textarea>' +
        '<p id="gdNsLive" class="text-[11px] mt-2"></p></div>' +
        '<div><label class="text-xs font-black text-heading">Used before <span class="text-subtle font-normal">click to fill in</span></label><div id="gdNsRecent" class="mt-1.5 flex flex-wrap gap-2">' + (chips || '<span class="text-[11px] text-subtle">No earlier nameserver sets yet.</span>') + '</div>' +
        '<div class="mt-5 p-3 rounded-xl border border-dashed border-theme text-[11px] text-subtle">Changing <b class="text-heading">' + GD.ns.selected.length + ' domain' + (GD.ns.selected.length === 1 ? '' : 's') + '</b>. Nothing is sent to GoDaddy until the Review step is confirmed.</div></div></div>';
}
function gdNsLive() { var el = document.getElementById('gdNsLive'); if (!el) return; var p = gdNsProblem(), c = gdNsLines(GD.ns.servers).length; el.className = 'text-[11px] mt-2 ' + (p ? 'text-rose-500' : 'text-subtle'); el.textContent = p || (c ? c + ' nameserver' + (c === 1 ? '' : 's') + ' entered.' : ''); }
function gdNsUseSet(i) { var r = GD.ns.recent[i]; if (!r) return; GD.ns.servers = r.ns.split(',').join('\n'); var ta = document.getElementById('gdNsServers'); if (ta) ta.value = GD.ns.servers; gdNsLive(); gdNsRefreshNav(); }
function gdNsLoadRecent() {
    GD.ns.recentLoaded = true;
    google.script.run.withSuccessHandler(function (r) { GD.ns.recent = r.recentSets || []; if (GD.ns.step === 2) { var el = document.getElementById('gdNsRecent'); if (el) { gdNsRender(); } } })
        .withFailureHandler(function () {}).previewGodaddyNs(currentSessionToken, '');
}

// ----- step 3: review (live nameservers, search, sort, filter) -----
function gdNsLoadReview() {
    var n = GD.ns; n.loadingReview = true; gdNsRefreshNav();
    google.script.run.withSuccessHandler(function (r) {
        n.loadingReview = false; n.review = r.items; n.recent = r.recentSets || n.recent; gdNsRenderRev(); gdNsLoadCurrent();
    }).withFailureHandler(function (e) {
        n.loadingReview = false; n.review = []; gdNsRenderRev();
        if (typeof showPremiumToast === 'function') showPremiumToast('Could not check', (e && e.message) || 'Try again.', 'error');
    }).previewGodaddyNs(currentSessionToken, n.selected.join('\n'));
}
function gdNsLoadCurrent() {
    var n = GD.ns, pv = n.review; if (!pv) return;
    var todo = pv.filter(function (i) { return i.ok; }).map(function (i) { return i.domain; }), chunks = [];
    for (var i = 0; i < todo.length; i += 10) chunks.push(todo.slice(i, i + 10));
    n.loadingCurrent = chunks.length > 0; gdNsRefreshNav(); var stamp = pv;
    (function next(k) {
        if (GD.ns.review !== stamp) return;
        if (k >= chunks.length) { GD.ns.loadingCurrent = false; gdNsRenderRev(); gdNsRefreshNav(); return; }
        google.script.run.withSuccessHandler(function (r) {
            if (GD.ns.review !== stamp) return;
            r.results.forEach(function (x) { var it = pv.filter(function (p) { return p.domain === x.domain; })[0]; if (it) { if (x.ok) { it.currentNs = x.ns; it.live = true; } else it.liveFail = true; } });
            gdNsRenderRev(); next(k + 1);
        }).withFailureHandler(function () { next(k + 1); }).liveGodaddyNs(currentSessionToken, chunks[k]);
    })(0);
}
function gdNsItemStatus(i) {
    var key = gdNsNewKey();
    if (!i.ok) return { k: 'cannot', label: i.reason || 'Cannot be changed', cls: 'text-rose-500' };
    if (i.live && i.currentNs === key) return { k: 'same', label: 'Already set', cls: 'text-subtle' };
    if (!i.live && !i.liveFail) return { k: 'reading', label: 'Reading...', cls: 'text-indigo-500' };
    return { k: 'change', label: 'Will change', cls: 'text-emerald-500' };
}
function gdNsReviewTodo() { var n = GD.ns; return (n.review || []).filter(function (i) { var s = gdNsItemStatus(i); return s.k === 'change' || s.k === 'reading'; }); }
function gdNsStep3() {
    var key = gdNsNewKey();
    return '<div class="flex items-center justify-between flex-wrap gap-3 mb-3"><div id="gdNsRevCounts" class="flex items-center gap-4 text-xs"></div>' +
        '<div class="flex gap-2 flex-wrap"><input id="gdNsRevQ" oninput="GD.ns.reviewQ=this.value;gdNsRenderRev()" value="' + gdEsc(GD.ns.reviewQ) + '" placeholder="Search domain..." class="px-3 py-2 bg-app border border-theme rounded-xl text-xs text-body focus:outline-none w-44">' +
        '<select onchange="GD.ns.revOnly=this.value;gdNsRenderRev()" class="px-2.5 py-2 bg-app border border-theme rounded-xl text-xs text-body"><option value="all">Show all</option><option value="change">Will change</option><option value="same">Already set</option><option value="cannot">Cannot change</option></select></div></div>' +
        '<div class="p-3 rounded-xl bg-app border border-theme mb-3 text-[11px]"><span class="text-subtle">New nameservers:</span> <span class="font-mono text-heading">' + gdEsc(key).replace(/,/g, ' &middot; ') + '</span></div>' +
        '<div id="gdNsRevTable" class="overflow-auto border border-theme rounded-xl" style="max-height:340px"></div>' +
        '<label class="flex items-start gap-2 text-xs text-body mt-4 p-3 rounded-xl border border-amber-500/40 bg-amber-500/5 cursor-pointer"><input type="checkbox" id="gdNsConfirm" ' + (GD.ns.confirmed ? 'checked' : '') + ' onchange="GD.ns.confirmed=this.checked;gdNsRefreshNav()" class="mt-0.5"> <span>I understand this changes the live DNS at GoDaddy right away and is recorded under my name.</span></label>';
}
function gdNsSortRev(k) { var n = GD.ns; if (n.revSort === k) n.revDir *= -1; else { n.revSort = k; n.revDir = 1; } gdNsRenderRev(); }
function gdNsRenderRev() {
    var el = document.getElementById('gdNsRevTable'); if (!el) return;
    var n = GD.ns; if (n.loadingReview) { el.innerHTML = '<p class="text-xs text-subtle p-8 text-center">Checking your domains...</p>'; return; }
    var brandMap = {}; if (GD.data) GD.data.brands.forEach(function (b) { brandMap[gdNormDomain(b.domain)] = b.brand; });
    var all = (n.review || []).map(function (i) { var s = gdNsItemStatus(i); return { i: i, s: s, domain: i.domain, account: (i.account || '').replace(/^Godaddy\s+/i, ''), brand: brandMap[i.domain] || '', ns: i.currentNs || '', st: s.label }; });
    var c = { change: 0, same: 0, cannot: 0 }; all.forEach(function (r) { if (r.s.k === 'change' || r.s.k === 'reading') c.change++; else c[r.s.k]++; });
    var cEl = document.getElementById('gdNsRevCounts'); if (cEl) cEl.innerHTML = '<b class="text-emerald-500">' + c.change + ' will change</b>' + (c.same ? '<span class="text-subtle">' + c.same + ' already set</span>' : '') + (c.cannot ? '<b class="text-rose-500">' + c.cannot + ' cannot change</b>' : '');
    var q = n.reviewQ.trim().toLowerCase();
    var rows = all.filter(function (r) { return (n.revOnly === 'all' || r.s.k === n.revOnly || (n.revOnly === 'change' && r.s.k === 'reading')) && (!q || r.domain.indexOf(q) !== -1 || r.brand.toLowerCase().indexOf(q) !== -1); });
    rows.sort(function (a, b) { return gdNsCmp(a[n.revSort], b[n.revSort], n.revDir) || a.domain.localeCompare(b.domain); });
    el.innerHTML = rows.length ? '<table class="w-full text-xs"><thead class="sticky top-0 bg-panel"><tr class="text-left text-[10px] text-subtle border-b border-theme">' + gdNsSortTh('Domain', 'domain', n.revSort, n.revDir, 'gdNsSortRev') + gdNsSortTh('Brand', 'brand', n.revSort, n.revDir, 'gdNsSortRev') + gdNsSortTh('Account', 'account', n.revSort, n.revDir, 'gdNsSortRev') + gdNsSortTh('Current nameservers', 'ns', n.revSort, n.revDir, 'gdNsSortRev') + gdNsSortTh('Status', 'st', n.revSort, n.revDir, 'gdNsSortRev') + '</tr></thead><tbody>' +
        rows.map(function (r) { return '<tr class="border-b border-theme/60 align-top"><td class="p-2 font-bold text-heading">' + gdEsc(r.domain) + '</td><td class="p-2 text-subtle">' + gdEsc(r.brand || '-') + '</td><td class="p-2">' + gdEsc(r.account || '-') + '</td><td class="p-2 font-mono text-[10px] text-subtle">' + gdEsc(r.ns || (r.s.k === 'reading' ? '...' : '-')).replace(/,/g, '<br>') + '</td><td class="p-2 font-bold ' + r.s.cls + '">' + gdEsc(r.s.label) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="text-xs text-subtle p-8 text-center">Nothing matches this filter.</p>';
    gdNsRefreshNav();
}

// ----- apply + step 4: result -----
function gdNsApply() {
    var n = GD.ns; if (n.running) return;
    var domains = (n.review || []).filter(function (i) { var s = gdNsItemStatus(i); return s.k === 'change' || s.k === 'reading'; }).map(function (i) { return i.domain; });
    if (!domains.length) return;
    n.step = 4; n.results = []; gdNsRun(domains);
}
function gdNsRun(domains) {
    var n = GD.ns, ns = gdNsLines(n.servers), chunks = [];
    for (var i = 0; i < domains.length; i += 8) chunks.push(domains.slice(i, i + 8));
    n.running = true; n.done = 0; n.total = domains.length; n.results = (n.results || []).filter(function (r) { return domains.indexOf(r.domain) === -1; });
    gdNsRender();
    (function next(k) {
        if (k >= chunks.length) {
            n.running = false; gdNsRender();
            if (typeof showPremiumToast === 'function') showPremiumToast('Nameserver change finished', n.results.filter(function (r) { return r.ok; }).length + ' of ' + n.results.length + ' done.', 'success');
            gdLoad(false); return;
        }
        google.script.run.withSuccessHandler(function (r) { n.results = n.results.concat(r.results); n.done += chunks[k].length; gdNsRenderRes(); next(k + 1); })
            .withFailureHandler(function (e) { chunks[k].forEach(function (d) { n.results.push({ domain: d, ok: false, error: (e && e.message) || 'Request failed' }); }); n.done += chunks[k].length; gdNsRenderRes(); next(k + 1); })
            .changeGodaddyNs(currentSessionToken, chunks[k], ns);
    })(0);
}
function gdNsStep4() {
    return '<div id="gdNsResHead"></div><div class="flex items-center justify-between flex-wrap gap-3 my-3"><div class="flex gap-0.5 bg-app border border-theme rounded-xl p-1">' +
        [['all', 'All'], ['ok', 'Done'], ['fail', 'Failed']].map(function (t) { return '<button onclick="GD.ns.resFilter=\'' + t[0] + '\';gdNsRenderRes()" class="px-3 py-1 rounded-lg text-[11px] font-bold ' + (GD.ns.resFilter === t[0] ? 'bg-indigo-600 text-white' : 'text-subtle hover:text-body') + '">' + t[1] + '</button>'; }).join('') +
        '</div><div id="gdNsRetry"></div></div><div id="gdNsResTable" class="overflow-auto border border-theme rounded-xl" style="max-height:340px"></div>';
}
function gdNsSortRes(k) { var n = GD.ns; if (n.resSort === k) n.resDir *= -1; else { n.resSort = k; n.resDir = 1; } gdNsRenderRes(); }
function gdNsRenderRes() {
    var n = GD.ns, head = document.getElementById('gdNsResHead'), tbl = document.getElementById('gdNsResTable'); if (!tbl) return;
    var res = n.results || [], good = res.filter(function (r) { return r.ok; }).length, fail = res.length - good;
    if (head) head.innerHTML = n.running ? '<div class="h-2 rounded bg-app overflow-hidden"><div class="h-2 bg-indigo-600" style="width:' + Math.round(n.done / Math.max(1, n.total) * 100) + '%;transition:width .3s"></div></div><p class="text-[11px] text-subtle mt-1.5">' + n.done + ' of ' + n.total + ' done. Please keep this window open.</p>' :
        '<div class="flex items-center gap-4"><div class="text-3xl font-black ' + (fail ? 'text-amber-500' : 'text-emerald-500') + '">' + good + '<span class="text-sm text-subtle font-bold"> of ' + res.length + ' changed</span></div>' + (fail ? '<b class="text-rose-500 text-xs">' + fail + ' failed</b>' : '<b class="text-emerald-500 text-xs">All done</b>') + '</div><p class="text-[11px] text-subtle mt-1">Saved under GoDaddy &gt; Changes with your name.</p>';
    var rt = document.getElementById('gdNsRetry'); if (rt) rt.innerHTML = (!n.running && fail) ? '<button onclick="gdNsRetry()" class="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-bold hover:bg-indigo-700">Retry the failed ones</button>' : '';
    var rows = res.filter(function (r) { return n.resFilter === 'all' || (n.resFilter === 'ok' ? r.ok : !r.ok); }).map(function (r) { return { r: r, domain: r.domain, account: (r.account || '').replace(/^Godaddy\s+/i, ''), st: r.ok ? (r.skipped ? 'Already set' : 'Changed') : 'Failed' }; });
    rows.sort(function (a, b) { return gdNsCmp(a[n.resSort], b[n.resSort], n.resDir); });
    tbl.innerHTML = rows.length ? '<table class="w-full text-xs"><thead class="sticky top-0 bg-panel"><tr class="text-left text-[10px] text-subtle border-b border-theme">' + gdNsSortTh('Domain', 'domain', n.resSort, n.resDir, 'gdNsSortRes') + gdNsSortTh('Account', 'account', n.resSort, n.resDir, 'gdNsSortRes') + gdNsSortTh('Result', 'st', n.resSort, n.resDir, 'gdNsSortRes') + '<th class="p-2">Details</th></tr></thead><tbody>' +
        rows.map(function (x) { return '<tr class="border-b border-theme/60"><td class="p-2 font-bold text-heading">' + gdEsc(x.domain) + '</td><td class="p-2">' + gdEsc(x.account || '-') + '</td><td class="p-2 font-bold ' + (x.r.ok ? 'text-emerald-500' : 'text-rose-500') + '">' + x.st + '</td><td class="p-2 text-subtle">' + gdEsc(x.r.error || x.r.note || '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="text-xs text-subtle p-8 text-center">' + (n.running ? 'Working...' : 'Nothing here.') + '</p>';
    gdNsRefreshNav();
}
function gdNsRetry() { var n = GD.ns; var failed = (n.results || []).filter(function (r) { return !r.ok; }).map(function (r) { return r.domain; }); if (failed.length && !n.running) { n.confirmed = true; gdNsRun(failed); } }
function gdNsDownload() {
    var n = GD.ns, key = gdNsNewKey();
    var csv = 'Domain,Account,Result,Details,New nameservers\n' + (n.results || []).map(function (r) { return [r.domain, r.account || '', r.ok ? (r.skipped ? 'Already set' : 'Changed') : 'Failed', r.error || r.note || '', key].map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = 'godaddy-ns-change.csv'; document.body.appendChild(a); a.click(); a.remove();
}

// ---- row actions: select domains and edit their nameservers ----
function gdSelCount() { GD.sel = GD.sel || {}; return Object.keys(GD.sel).filter(function (k) { return GD.sel[k]; }).length; }
function gdRenderSelBar() {
    var el = document.getElementById('gdSelBar'); if (!el) return;
    var n = gdSelCount();
    el.innerHTML = n ? '<div class="flex items-center gap-3 flex-wrap mb-3 px-4 py-2.5 rounded-xl bg-indigo-600/10 border border-indigo-500/30"><b class="text-xs text-heading">' + n + ' domain' + (n === 1 ? '' : 's') + ' selected</b><button onclick="gdEditNs(Object.keys(GD.sel).filter(function (k) { return GD.sel[k]; }))" class="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-bold hover:bg-indigo-700">Edit nameservers</button><button onclick="GD.sel={};gdRenderTable();gdRenderSelBar()" class="px-3 py-1.5 bg-panel border border-theme rounded-lg text-[11px] font-bold text-body hover:bg-app">Clear</button></div>' : '';
}
function gdToggleSel(d, on) { GD.sel = GD.sel || {}; if (on) GD.sel[d] = true; else delete GD.sel[d]; gdRenderSelBar(); }
function gdToggleAll(on) { var rows = gdCurrentRows().rows.slice(0, 300); GD.sel = GD.sel || {}; rows.forEach(function (r) { if (r.status === 'ACTIVE') { if (on) GD.sel[r.domain] = true; else delete GD.sel[r.domain]; } }); gdRenderTable(); gdRenderSelBar(); }
// Opens the nameserver wizard with these domains already picked, straight at the nameservers step.
function gdEditNs(domains) {
    if (GD.ns && GD.ns.running) return;
    GD.ns = gdNsFresh(); GD.ns.selected = (domains || []).filter(Boolean).slice(0, GD_NS_MAX); GD.ns.step = GD.ns.selected.length ? 2 : 1;
    gdOpenNs(true);
}

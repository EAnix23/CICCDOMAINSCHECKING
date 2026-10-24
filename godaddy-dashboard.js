// ============================================================
// GODADDY MONITOR — KPI tab for Super Admin and users assigned to a team.
// Data: Worker actions getGodaddyDashboard (reads D1) and syncGodaddy (pulls fresh data from the GoDaddy API).
// The dashboard syncs by itself when the last sync is older than 6 hours.
// ============================================================
var GD = { data: null, tab: 'renewal', range: 30, account: 'all', q: '', evType: 'all', syncing: false, loaded: false };
var GD_LAPSED_LABEL = {
    ACTIVE: 'Past due (still in grace period)',
    CANCELLED_REDEEMABLE: 'In redemption (can still be recovered)',
    HELD_EXPIRED_REDEMPTION_MOCK: 'Held after expiry',
    CANCELLED: 'Expired and cancelled',
    UPDATED_OWNERSHIP: 'Moved to another owner',
    UPDATE_ACCOUNT_AUCTION: 'Going to auction'
};
var GD_EVENT_LABEL = { renewed: 'Renewed', expired: 'Expired', status_changed: 'Status changed', ns_changed: 'Nameserver changed', added: 'New domain', removed: 'Removed' };

function gdEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function gdN(v) { return Number(v || 0).toLocaleString('en-US'); }
function gdTime(s) { return s ? new Date(String(s).replace(' ', 'T') + 'Z') : null; }
function gdDay(s) { var d = gdTime(s); return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'; }
function gdDays(s) { var d = gdTime(s); return d && !isNaN(d) ? Math.floor((d.getTime() - Date.now()) / 86400000) : null; }
function gdAgo(s) { var d = gdTime(s); if (!d) return ''; var m = Math.round((Date.now() - d.getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; }
function gdNormDomain(d) { return String(d || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].replace(/\.$/, ''); }

function renderKpiGodaddyTab() {
    var content = document.getElementById('kpiTabContent');
    if (!content) return;
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
        '<button onclick="gdSync(false)" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 shadow-sm flex items-center gap-1.5 ' + (GD.syncing ? 'opacity-60 pointer-events-none' : '') + '"><i data-lucide="refresh-cw" class="h-3.5 w-3.5 ' + (GD.syncing ? 'animate-spin' : '') + '"></i> ' + (GD.syncing ? 'Syncing...' : 'Sync now') + '</button></div>';
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
    if (GD.tab === 'changes') sub = '<div class="flex items-center gap-2 mb-3 flex-wrap">' + [['all', 'All'], ['ns_changed', 'Nameserver'], ['expired', 'Expired'], ['renewed', 'Renewed'], ['status_changed', 'Status'], ['added', 'New'], ['removed', 'Removed']].map(function (t) { return '<button onclick="GD.evType=\'' + t[0] + '\';gdRenderTable()" class="px-2.5 py-1 rounded-lg border text-[11px] font-bold ' + (GD.evType === t[0] ? 'bg-indigo-600 text-white border-indigo-600' : 'border-theme text-body hover:bg-app') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (GD.tab === 'renewed') sub = '<div class="text-[11px] text-subtle mb-3 p-3 rounded-xl border border-dashed border-theme">Renewals are detected when a domain\'s expiry date moves forward between syncs, so tracking starts from the first sync. <b class="text-body">Receipts and order numbers are not available</b> from the GoDaddy API with the current tokens (GoDaddy refuses the orders endpoint). Receipts stay in the GoDaddy account or its email.</div>';
    el.innerHTML = '<div class="panel-card p-5"><div class="flex items-center justify-between flex-wrap gap-3 mb-4">' + tabs + tools + '</div>' + sub + '<div id="gdTable" class="overflow-x-auto"></div></div>';
    gdRenderTable();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function gdCurrentRows() {
    var m = gdModel(), q = GD.q.trim().toLowerCase(), t = GD.tab, rows, cols;
    function match(r) { return (GD.account === 'all' || (r.account || r.accountShort) === GD.account) && (!q || (r.domain + ' ' + (r.brand || '')).toLowerCase().indexOf(q) !== -1); }
    var auto = function (r) { return r.auto ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap bg-emerald-500/15 text-emerald-500">Auto-renew ON</span>' : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap bg-rose-500/15 text-rose-500">Auto-renew OFF</span>'; };
    var dom = function (r) { return '<span class="font-bold text-heading">' + gdEsc(r.domain) + '</span>'; };
    if (t === 'renewal') {
        rows = m.renewal.filter(function (r) { return r.days <= GD.range && match(r); });
        cols = [['Domain', dom, function (r) { return r.domain; }], ['Brand', function (r) { return gdEsc(r.brand || '-'); }, function (r) { return r.brand; }], ['Account', function (r) { return gdEsc(r.account); }, function (r) { return r.account; }], ['Expires', function (r) { return gdDay(r.expires); }, function (r) { return r.expires; }],
            ['Days left', function (r) { return '<b class="' + (r.days <= 7 ? 'text-rose-500' : r.days <= 15 ? 'text-amber-500' : 'text-body') + '">' + r.days + '</b>'; }, function (r) { return r.days; }], ['Auto-renew', auto, function (r) { return r.auto ? 'ON' : 'OFF'; }]];
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
    var csv = c.cols.map(function (x) { return '"' + x[0] + '"'; }).join(',') + '\n' + c.rows.map(function (r) { return c.cols.map(function (x) { return '"' + String(x[2](r) == null ? '' : x[2](r)).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'godaddy-' + GD.tab + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
}

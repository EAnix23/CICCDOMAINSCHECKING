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

// ---- Change nameservers ----
var GD_NS_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
function gdNsLines(t) { return String(t || '').split(/[\n,;]+/).map(function (x) { return x.trim().toLowerCase().replace(/\.$/, ''); }).filter(Boolean); }
function gdNsProblem() {
    var ns = gdNsLines(GD.ns.servers);
    if (ns.length < 2 || ns.length > 13) return 'Add 2 to 13 nameservers, one per line.';
    var bad = ns.filter(function (n) { return !GD_NS_RE.test(n); });
    return bad.length ? 'Not a valid hostname: ' + bad.join(', ') : '';
}
function gdRenderNs() {
    var el = document.getElementById('gdNs'); if (!el) return;
    var n = GD.ns, pv = n.preview, ok = pv ? pv.filter(function (i) { return i.ok; }) : [], bad = pv ? pv.filter(function (i) { return !i.ok; }) : [];
    var newNs = gdNsLines(n.servers).slice().sort().join(',');
    var chips = (n.recent || []).map(function (r, idx) { return '<button onclick="gdNsUseSet(' + idx + ')" class="px-2.5 py-1 rounded-lg border border-theme text-[10px] font-mono text-body hover:bg-app text-left" title="Used ' + r.c + ' time(s), last ' + gdEsc(gdDay(r.at)) + '">' + gdEsc(r.ns).replace(/,/g, ' &middot; ') + '</button>'; }).join('');
    var html = '<div class="grid grid-cols-1 lg:grid-cols-2 gap-5">' +
        '<div><label class="text-[11px] font-bold text-heading">1. Domains <span class="text-subtle font-normal">one per line, up to 300</span></label><textarea id="gdNsDomains" oninput="GD.ns.domains=this.value;GD.ns.preview=null;GD.ns.results=null;GD.ns.confirmed=false" rows="8" class="mt-1.5 w-full px-3 py-2 bg-app border border-theme rounded-xl text-xs font-mono text-body focus:outline-none" placeholder="example1.com&#10;example2.net">' + gdEsc(n.domains) + '</textarea></div>' +
        '<div><label class="text-[11px] font-bold text-heading">2. New nameservers <span class="text-subtle font-normal">one per line, 2 to 13</span></label><textarea id="gdNsServers" oninput="GD.ns.servers=this.value;GD.ns.confirmed=false;gdNsRefreshApply()" rows="4" class="mt-1.5 w-full px-3 py-2 bg-app border border-theme rounded-xl text-xs font-mono text-body focus:outline-none" placeholder="ns1.example.net&#10;ns2.example.net">' + gdEsc(n.servers) + '</textarea>' +
        (chips ? '<p class="text-[10px] text-subtle mt-2 mb-1.5">Used before. Click to fill in:</p><div class="flex flex-wrap gap-1.5">' + chips + '</div>' : '') + '</div></div>' +
        '<div class="mt-4 flex items-center gap-3 flex-wrap"><button onclick="gdNsPreview()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 shadow-sm ' + (n.running ? 'opacity-50 pointer-events-none' : '') + '">3. Check the domains</button><span class="text-[11px] text-subtle">Nothing changes yet. You see the current nameservers first.</span></div>';
    if (pv) {
        html += '<div class="mt-5"><div class="flex items-center gap-4 mb-2 text-xs"><b class="text-emerald-500">' + ok.length + ' ready</b>' + (bad.length ? '<b class="text-rose-500">' + bad.length + ' cannot be changed</b>' : '') + '</div>' +
            '<div class="overflow-x-auto max-h-80 overflow-y-auto border border-theme rounded-xl"><table class="w-full text-xs"><thead class="sticky top-0 bg-panel"><tr class="text-left text-[10px] uppercase text-subtle border-b border-theme"><th class="p-2">Domain</th><th class="p-2">Account</th><th class="p-2">Current nameservers' + (n.loadingCurrent ? ' <span class="normal-case text-indigo-500">(reading from GoDaddy...)</span>' : '') + '</th><th class="p-2">Result</th></tr></thead><tbody>' +
            pv.map(function (i) {
                var r = n.results && n.results.filter(function (x) { return x.domain === i.domain; })[0];
                var res = r ? (r.ok ? '<span class="text-emerald-500 font-bold">' + (r.skipped ? 'Already set' : 'Changed') + '</span>' : '<span class="text-rose-500 font-bold">Failed: ' + gdEsc(r.error) + '</span>') : (i.ok ? '<span class="text-subtle">Waiting</span>' : '<span class="text-rose-500">' + gdEsc(i.reason) + '</span>');
                return '<tr class="border-b border-theme/60 align-top"><td class="p-2 font-bold text-heading">' + gdEsc(i.domain) + '</td><td class="p-2">' + gdEsc((i.account || '-').replace(/^Godaddy\s+/i, '')) + '</td><td class="p-2 font-mono text-[10px] text-subtle">' + gdEsc(i.currentNs || (n.loadingCurrent ? '...' : '-')).replace(/,/g, '<br>') + '</td><td class="p-2">' + res + '</td></tr>';
            }).join('') + '</tbody></table></div>';
        if (ok.length && !n.results) {
            html += '<div class="mt-4 p-4 rounded-xl border border-amber-500/40 bg-amber-500/5"><p class="text-xs text-body mb-3">Change <b>' + ok.length + ' domain' + (ok.length === 1 ? '' : 's') + '</b> to:<br><span class="font-mono text-[11px] text-heading">' + (newNs ? gdEsc(newNs).replace(/,/g, ' &middot; ') : '(fill in the new nameservers above)') + '</span></p>' +
                '<label class="flex items-start gap-2 text-xs text-body mb-3 cursor-pointer"><input type="checkbox" id="gdNsConfirm" ' + (n.confirmed ? 'checked' : '') + ' onchange="GD.ns.confirmed=this.checked;gdNsRefreshApply()" class="mt-0.5"> <span>I understand this changes the live DNS at GoDaddy right away and is recorded under my name.</span></label>' +
                '<button id="gdNsApply" onclick="gdNsApply()" class="px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700 shadow-sm">4. Change nameservers</button> <span id="gdNsProblem" class="text-[11px] text-rose-500 ml-2"></span></div>';
        } else if (n.results) {
            var good = n.results.filter(function (r) { return r.ok; }).length, fail = n.results.length - good;
            if (n.running) html += '<div class="mt-4"><div class="h-2 rounded bg-app overflow-hidden"><div class="h-2 bg-indigo-600" style="width:' + Math.round(n.done / Math.max(1, n.total) * 100) + '%"></div></div><p class="text-[10px] text-subtle mt-1">' + n.done + ' of ' + n.total + ' done...</p></div>';
            else html += '<p class="mt-4 text-xs"><b class="text-emerald-500">' + good + ' done</b>' + (fail ? ' &middot; <b class="text-rose-500">' + fail + ' failed</b>' : '') + '. Every change is saved under Changes with your name.</p>' +
                '<div class="mt-2 flex gap-2"><button onclick="GD.ns.preview=null;GD.ns.results=null;GD.ns.confirmed=false;GD.ns.domains=\'\';gdRenderNs()" class="px-3 py-1.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Start another</button>' + (fail ? '<button onclick="gdNsRetry()" class="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700">Retry the failed ones</button>' : '') + '</div>';
        }
        html += '</div>';
    }
    el.innerHTML = html;
    gdNsRefreshApply();
}
function gdNsRefreshApply() {
    var b = document.getElementById('gdNsApply'), p = document.getElementById('gdNsProblem'); if (!b) return;
    var problem = gdNsProblem(), can = GD.ns.confirmed && !problem && !GD.ns.running;
    b.style.opacity = can ? '1' : '.45'; b.style.pointerEvents = can ? 'auto' : 'none';
    if (p) p.textContent = problem && GD.ns.servers.trim() ? problem : '';
}
function gdNsUseSet(idx) { var r = GD.ns.recent[idx]; if (!r) return; GD.ns.servers = r.ns.split(',').join('\n'); GD.ns.confirmed = false; gdRenderNs(); }
function gdNsPreview() {
    var text = document.getElementById('gdNsDomains').value; GD.ns.domains = text; GD.ns.servers = document.getElementById('gdNsServers').value;
    if (!text.trim()) { if (typeof showPremiumToast === 'function') showPremiumToast('Add domains', 'Paste at least one domain first.', 'warning'); return; }
    google.script.run.withSuccessHandler(function (r) { GD.ns.preview = r.items; GD.ns.recent = r.recentSets || []; GD.ns.results = null; GD.ns.confirmed = false; gdRenderNs(); gdNsLoadCurrent(); })
        .withFailureHandler(function (e) { if (typeof showPremiumToast === 'function') showPremiumToast('Could not check', (e && e.message) || 'Try again.', 'error'); })
        .previewGodaddyNs(currentSessionToken, text);
}
// Fills in the current nameservers from GoDaddy (the synced list does not carry them), 10 domains per request.
function gdNsLoadCurrent() {
    var pv = GD.ns.preview; if (!pv) return;
    var todo = pv.filter(function (i) { return i.ok; }).map(function (i) { return i.domain; }), chunks = [];
    for (var i = 0; i < todo.length; i += 10) chunks.push(todo.slice(i, i + 10));
    GD.ns.loadingCurrent = true; var stamp = pv;
    (function next(k) {
        if (GD.ns.preview !== stamp) return;
        if (k >= chunks.length) { GD.ns.loadingCurrent = false; gdRenderNs(); return; }
        google.script.run.withSuccessHandler(function (r) {
            if (GD.ns.preview !== stamp) return;
            r.results.forEach(function (x) { var it = pv.filter(function (p) { return p.domain === x.domain; })[0]; if (it && x.ok) it.currentNs = x.ns; });
            gdRenderNs(); next(k + 1);
        }).withFailureHandler(function () { next(k + 1); }).liveGodaddyNs(currentSessionToken, chunks[k]);
    })(0);
}
function gdNsRun(domains) {
    var ns = gdNsLines(GD.ns.servers), chunks = [];
    for (var i = 0; i < domains.length; i += 8) chunks.push(domains.slice(i, i + 8));
    GD.ns.running = true; GD.ns.done = 0; GD.ns.total = domains.length; GD.ns.results = (GD.ns.results || []).filter(function (r) { return domains.indexOf(r.domain) === -1; });
    gdRenderNs();
    (function next(k) {
        if (k >= chunks.length) {
            GD.ns.running = false; gdRenderNs();
            if (typeof showPremiumToast === 'function') showPremiumToast('Nameserver change finished', GD.ns.results.filter(function (r) { return r.ok; }).length + ' of ' + GD.ns.results.length + ' done.', 'success');
            gdLoad(false); return;
        }
        google.script.run.withSuccessHandler(function (r) { GD.ns.results = GD.ns.results.concat(r.results); GD.ns.done += chunks[k].length; gdRenderNs(); next(k + 1); })
            .withFailureHandler(function (e) { chunks[k].forEach(function (d) { GD.ns.results.push({ domain: d, ok: false, error: (e && e.message) || 'Request failed' }); }); GD.ns.done += chunks[k].length; gdRenderNs(); next(k + 1); })
            .changeGodaddyNs(currentSessionToken, chunks[k], ns);
    })(0);
}
function gdNsApply() {
    if (GD.ns.running || !GD.ns.confirmed || gdNsProblem() || !GD.ns.preview) return;
    var domains = GD.ns.preview.filter(function (i) { return i.ok; }).map(function (i) { return i.domain; });
    if (domains.length) gdNsRun(domains);
}
function gdNsRetry() {
    var failed = GD.ns.results.filter(function (r) { return !r.ok; }).map(function (r) { return r.domain; });
    if (failed.length && !GD.ns.running) gdNsRun(failed);
}

// Change nameservers opens as a modal inside the GoDaddy section.
function gdOpenNs() {
    var m = document.getElementById('gdNsModal');
    if (!m) {
        m = document.createElement('div'); m.id = 'gdNsModal';
        m.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(2,6,23,.6);display:flex;align-items:flex-start;justify-content:center;padding:4vh 16px;overflow-y:auto';
        m.onclick = function (e) { if (e.target === m) gdCloseNs(); };
        document.body.appendChild(m);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') gdCloseNs(); });
    }
    m.innerHTML = '<div class="panel-card" style="width:min(980px,100%);padding:22px;box-shadow:0 25px 60px rgba(0,0,0,.4)"><div class="flex items-start justify-between gap-4 mb-4"><div><h3 class="text-base font-black text-heading flex items-center gap-2"><i data-lucide="server-cog" class="h-4 w-4 text-indigo-500"></i> Change Nameservers</h3><p class="text-[11px] text-subtle mt-1">Paste the domains, set the new nameservers, check, then confirm. The change goes straight to the GoDaddy account that owns each domain and is saved under your name in the Changes tab.</p></div><button onclick="gdCloseNs()" aria-label="Close" class="text-subtle hover:text-heading text-2xl leading-none px-2">&times;</button></div><div id="gdNs"></div></div>';
    m.style.display = 'flex';
    gdRenderNs();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}
function gdCloseNs() {
    var m = document.getElementById('gdNsModal');
    if (m && !GD.ns.running) m.style.display = 'none';
}

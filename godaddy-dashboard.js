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
var GD_EVENT_LABEL = { ns_failed: 'NS change failed', brand_assigned: 'Brand assigned', moved_out: 'Moved out of Target Brands', restored: 'Restored to Target Brands', renewed: 'Renewed', expired: 'Expired', status_changed: 'Status changed', ns_changed: 'Nameserver changed', added: 'New domain', removed: 'Removed' };

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
        if (typeof gdUnRefresh === 'function') gdUnRefresh();
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
    var arch = {}; (d.removed || []).forEach(function (r) { if (!arch[r.domain]) arch[r.domain] = r; });
    var rows = d.domains.map(function (r) {
        var days = gdDays(r.expires);
        return { domain: r.domain, account: r.account.replace(/^Godaddy\s+/i, ''), status: r.status, expires: r.expires, days: days, auto: !!r.renewAuto, locked: !!r.locked, ns: r.ns, brand: brandMap[r.domain] || (arch[r.domain] ? arch[r.domain].brand : ''), inBrand: !!brandMap[r.domain], movedOut: !brandMap[r.domain] && !!arch[r.domain] };
    });
    var active = rows.filter(function (r) { return r.status === 'ACTIVE'; });
    var renewal = active.filter(function (r) { return r.days != null && r.days >= 0 && r.days <= 60; }).sort(function (a, b) { return a.days - b.days; });
    var lapsed = rows.filter(function (r) { return r.days != null && r.days < 0 && r.days >= -180 && r.status !== 'UPDATED_OWNERSHIP'; }).sort(function (a, b) { return b.days - a.days; });
    var cut14 = Date.now() - 14 * 86400000;
    var events = d.events.map(function (e) { e.brand = brandMap[e.domain] || ''; e.accountShort = (e.account || '').replace(/^Godaddy\s+/i, ''); return e; });
    var recent = function (t) { return events.filter(function (e) { return e.type === t && gdTime(e.at) && gdTime(e.at).getTime() >= cut14; }); };
    return { unassigned: active.filter(function (r) { return !r.brand && !r.movedOut; }).sort(function (a, b) { return a.domain.localeCompare(b.domain); }), rows: rows, active: active, renewal: renewal, lapsed: lapsed, events: events, renewed14: recent('renewed'), ns14: recent('ns_changed'), lapsedNow: lapsed.filter(function (r) { return r.days >= -90; }) };
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
    function stat(label, val, sub, color, tab) { return '<button onclick="' + (tab.indexOf('(') !== -1 ? tab : 'gdSetTab(\'' + tab + '\')') + '" class="panel-card p-4 text-left hover:border-indigo-400 transition-colors"><p class="text-[10px] font-bold text-subtle uppercase">' + label + '</p><p class="text-2xl font-black mt-1 ' + color + '">' + val + '</p><p class="text-[10px] text-subtle mt-0.5">' + sub + '</p></button>'; }
    var d7 = m.renewal.filter(function (r) { return r.days <= 7; }).length, d30 = m.renewal.filter(function (r) { return r.days <= 30; }).length;
    var autoOff30 = m.renewal.filter(function (r) { return r.days <= 30 && !r.auto; }).length;
    el.innerHTML = '<div class="grid grid-cols-2 lg:grid-cols-7 gap-4 mb-5">' +
        stat('Active domains', gdN(m.active.length), 'in ' + GD.data.accounts.filter(function (a) { return a.ok; }).length + ' working accounts', 'text-heading', 'all') +
        stat('Expiring in 7 days', gdN(d7), 'renew now', 'text-rose-500', 'renewal') +
        stat('Expiring in 30 days', gdN(d30), autoOff30 + ' have auto-renew OFF', 'text-amber-500', 'renewal') +
        stat('Not renewed', gdN(m.lapsedNow.length), 'expired in the last 90 days', 'text-rose-500', 'lapsed') +
        stat('Just renewed', gdN(m.renewed14.length), 'last 14 days', 'text-emerald-500', 'renewed') +
        stat('NS changes', gdN(m.ns14.length), 'last 14 days', 'text-indigo-500', 'changes') +
        stat('No brand yet', gdN(m.unassigned.length), m.unassigned.length ? 'click to assign a brand' : 'all domains have a brand', m.unassigned.length ? 'text-amber-500' : 'text-emerald-500', 'gdUnOpen()') + '</div>';
}

function gdRenderAccounts() {
    var el = document.getElementById('gdAccounts'); if (!el) return;
    el.innerHTML = '<div class="flex flex-wrap gap-2 mb-5">' + GD.data.accounts.map(function (a) {
        var short = a.account.replace(/^Godaddy\s+/i, '');
        return a.ok && a.error ? '<span class="px-3 py-1.5 rounded-lg border border-amber-500/40 text-[11px] bg-amber-500/10 text-amber-600" title="' + gdEsc(a.error) + '"><b>' + gdEsc(short) + '</b> &middot; ' + gdN(a.domains) + ' domains &middot; check: ' + gdEsc(a.error) + '</span>' : a.ok ? '<span class="px-3 py-1.5 rounded-lg border border-theme text-[11px] bg-panel text-body"><b class="text-heading">' + gdEsc(short) + '</b> &middot; ' + gdN(a.domains) + ' domains <span class="text-emerald-500 font-bold">OK</span></span>'
            : '<span class="px-3 py-1.5 rounded-lg border border-rose-500/40 text-[11px] bg-rose-500/10 text-rose-500" title="' + gdEsc(a.error) + '"><b>' + gdEsc(short) + '</b> &middot; token problem: ' + gdEsc(a.error) + '</span>';
    }).join('') + (function () { var u = gdModel().unassigned.length; return u ? '<button onclick="gdSetTab(\'unassigned\')" class="px-3 py-1.5 rounded-lg border border-indigo-500/40 text-[11px] font-bold bg-indigo-600/10 text-indigo-500 hover:bg-indigo-600/20">' + u + ' domain' + (u === 1 ? '' : 's') + ' have no brand yet. Assign them</button>' : ''; })() + '</div>';
}

function gdSetTab(t) { GD.tab = t; GD.q = ''; GD.account = 'all'; gdRenderBody(); }
function gdTabBtn(id, label, n) { var on = GD.tab === id; return '<button onclick="gdSetTab(\'' + id + '\')" class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ' + (on ? 'bg-indigo-600 text-white shadow-sm' : 'text-subtle hover:text-body') + '">' + label + (n != null ? ' <span class="opacity-70">' + n + '</span>' : '') + '</button>'; }

function gdRenderBody() {
    var el = document.getElementById('gdBody'); if (!el) return; var m = gdModel();
    var tabs = '<div class="flex items-center gap-0.5 bg-app border border-theme rounded-xl p-1 shadow-sm flex-wrap">' + gdTabBtn('renewal', 'For renewal', m.renewal.length) + gdTabBtn('lapsed', 'Not renewed', m.lapsed.length) + gdTabBtn('renewed', 'Renewed', m.events.filter(function (e) { return e.type === 'renewed'; }).length) + gdTabBtn('changes', 'Changes', m.events.length) + gdTabBtn('all', 'All domains', m.rows.length) + gdTabBtn('unassigned', 'No brand yet', m.unassigned.length) + gdTabBtn('removed', 'Removed', (GD.data.removed || []).filter(function (r) { return r.source !== 'not_renewed'; }).length) + gdTabBtn('receipts', 'Receipts', GD_RC.rows ? GD_RC.rows.length : null) + '</div>';
    if (GD.tab === 'receipts') { el.innerHTML = '<div class="panel-card p-5"><div class="flex items-center justify-between flex-wrap gap-3 mb-4">' + tabs + '</div><div id="gdRc"></div></div>'; gdRcRender(); if (typeof lucide !== 'undefined') lucide.createIcons(); return; }
    var accounts = GD.data.accounts.map(function (a) { return a.account.replace(/^Godaddy\s+/i, ''); });
    var tools = '<div class="flex items-center gap-2 flex-wrap">' +
        '<select onchange="GD.account=this.value;gdRenderTable()" class="px-2.5 py-2 bg-app border border-theme rounded-xl text-xs text-body"><option value="all">All accounts</option>' + accounts.map(function (a) { return '<option value="' + gdEsc(a) + '"' + (GD.account === a ? ' selected' : '') + '>' + gdEsc(a) + '</option>'; }).join('') + '</select>' +
        '<input id="gdSearch" oninput="GD.q=this.value;gdRenderTable()" value="' + gdEsc(GD.q) + '" placeholder="Search domain or brand..." class="px-3 py-2 bg-app border border-theme rounded-xl text-xs text-body focus:outline-none w-48">' +
        '<button onclick="gdDownload()" class="px-3 py-2 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app shadow-sm flex items-center gap-1.5"><i data-lucide="download" class="h-3.5 w-3.5"></i> CSV</button></div>';
    var sub = '';
    if (GD.tab === 'renewal') sub = '<div class="flex items-center gap-2 mb-3 text-[11px] text-subtle">Show domains expiring within ' + [7, 15, 30, 60].map(function (n) { return '<button onclick="GD.range=' + n + ';gdRenderBody()" class="px-2.5 py-1 rounded-lg border ' + (GD.range === n ? 'bg-indigo-600 text-white border-indigo-600' : 'border-theme text-body hover:bg-app') + ' font-bold">' + n + ' days</button>'; }).join('') + '</div>';
    if (GD.tab === 'changes') sub = '<p class="text-[11px] text-subtle mb-3">Expiry, status and new or removed domains are caught on every sync. Nameserver changes are recorded when made from this portal, and also when anyone changes them directly in GoDaddy: every active domain is re-read in rotation (30 domains every 15 minutes, so each one about every 11 hours).</p><div class="flex items-center gap-2 mb-3 flex-wrap">' + [['all', 'All'], ['ns_changed', 'Nameserver'], ['expired', 'Expired'], ['renewed', 'Renewed'], ['status_changed', 'Status'], ['added', 'New'], ['removed', 'Removed']].map(function (t) { return '<button onclick="GD.evType=\'' + t[0] + '\';gdRenderTable()" class="px-2.5 py-1 rounded-lg border text-[11px] font-bold ' + (GD.evType === t[0] ? 'bg-indigo-600 text-white border-indigo-600' : 'border-theme text-body hover:bg-app') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (GD.tab === 'lapsed') {
        var stale = gdStaleList();
        sub = stale.length ? '<div class="flex items-center justify-between gap-3 flex-wrap mb-3 p-4 rounded-xl border border-amber-500/40 bg-amber-500/5"><p class="text-xs text-body"><b class="text-heading">' + stale.length + ' domain' + (stale.length === 1 ? ' is' : 's are') + ' no longer in GoDaddy (not renewed or moved to another owner) but still listed under Target Brands.</b><br><span class="text-subtle">Move them out so the brand lists only show domains you still hold. Their data is kept and they come back by themselves if renewed.</span></p><button onclick="gdMvOpen()" class="px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 shadow-sm whitespace-nowrap">Review and move out</button></div>' : '<p class="text-[11px] text-subtle mb-3">Every domain that was not renewed is already out of the Target Brand list. Their brand and data are kept in the archive.</p>';
    }
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
            ['Days ago', function (r) { return '<b class="text-rose-500">' + Math.abs(r.days) + '</b>'; }, function (r) { return Math.abs(r.days); }], ['What it means', function (r) { return gdEsc(GD_LAPSED_LABEL[r.status] || r.status); }, function (r) { return r.status; }],
            ['Target Brands', function (r) { return r.inBrand ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap bg-amber-500/15 text-amber-600">Still listed</span>' : (r.movedOut ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap bg-emerald-500/15 text-emerald-500">Moved out</span>' : '<span class="text-subtle">-</span>'); }, function (r) { return r.inBrand ? 'Still listed' : (r.movedOut ? 'Moved out' : ''); }]];
    } else if (t === 'unassigned') {
        var allBrands = gdBrandList();
        rows = m.unassigned.filter(match);
        cols = [selCol, ['Domain', dom, function (r) { return r.domain; }], ['Account', function (r) { return gdEsc(r.account); }, function (r) { return r.account; }], ['Expires', function (r) { return gdDay(r.expires); }, function (r) { return r.expires; }],
            ['Suggested brand', function (r) { var s = gdSuggestBrand(r.domain, allBrands); return s ? '<button onclick="gdAsOpen([this.getAttribute(\'data-d\')],this.getAttribute(\'data-b\'))" data-d="' + gdEsc(r.domain) + '" data-b="' + gdEsc(s) + '" class="px-2.5 py-1 rounded-lg bg-indigo-600/10 text-indigo-500 text-[11px] font-bold hover:bg-indigo-600/20">' + gdEsc(s) + '</button>' : '<span class="text-subtle">-</span>'; }, function (r) { return gdSuggestBrand(r.domain, allBrands); }],
            ['', function (r) { return '<button onclick="gdAsOpen([this.getAttribute(\'data-d\')])" data-d="' + gdEsc(r.domain) + '" class="px-2.5 py-1 rounded-lg border border-theme text-[11px] font-bold text-body hover:bg-app hover:border-indigo-400 whitespace-nowrap">Add to brand</button>'; }, function () { return ''; }, true]];
    } else if (t === 'removed') {
        rows = (GD.data.removed || []).filter(function (r) { return r.source !== 'not_renewed'; }).map(function (r) { return { domain: r.domain, brand: r.brand, account: r.account.replace(/^Godaddy\s+/i, ''), removedAt: r.removedAt, lastStatus: r.lastStatus, lastExpires: r.lastExpires, hadRecord: r.hadRecord }; }).filter(match);
        cols = [['Removed on', function (r) { return gdDay(r.removedAt); }, function (r) { return r.removedAt; }], ['Domain', dom, function (r) { return r.domain; }], ['Brand', function (r) { return gdEsc(r.brand || '-'); }, function (r) { return r.brand; }], ['Account', function (r) { return gdEsc(r.account); }, function (r) { return r.account; }],
            ['Last expiry', function (r) { return gdDay(r.lastExpires); }, function (r) { return r.lastExpires; }], ['Last status', function (r) { return gdEsc(String(r.lastStatus || '-').replace(/_/g, ' ').toLowerCase()); }, function (r) { return r.lastStatus; }], ['Brand record', function (r) { return r.hadRecord ? '<span class="text-emerald-500 font-bold">Archived</span>' : '<span class="text-subtle">None</span>'; }, function (r) { return r.hadRecord ? 'Archived' : 'None'; }]];
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
    var pickedFn = 'Object.keys(GD.sel).filter(function (k) { return GD.sel[k]; })';
    el.innerHTML = n ? '<div class="flex items-center gap-3 flex-wrap mb-3 px-4 py-2.5 rounded-xl bg-indigo-600/10 border border-indigo-500/30"><b class="text-xs text-heading">' + n + ' domain' + (n === 1 ? '' : 's') + ' selected</b>' + (GD.tab === 'unassigned' ? '<button onclick="gdAsOpen(' + pickedFn + ')" class="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-bold hover:bg-indigo-700">Add to brand</button>' : '<button onclick="gdEditNs(' + pickedFn + ')" class="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-bold hover:bg-indigo-700">Edit nameservers</button>') + '<button onclick="GD.sel={};gdRenderTable();gdRenderSelBar()" class="px-3 py-1.5 bg-panel border border-theme rounded-lg text-[11px] font-bold text-body hover:bg-app">Clear</button></div>' : '';
}
function gdToggleSel(d, on) { GD.sel = GD.sel || {}; if (on) GD.sel[d] = true; else delete GD.sel[d]; gdRenderSelBar(); }
function gdToggleAll(on) { var rows = gdCurrentRows().rows.slice(0, 300); GD.sel = GD.sel || {}; rows.forEach(function (r) { if (r.status === 'ACTIVE') { if (on) GD.sel[r.domain] = true; else delete GD.sel[r.domain]; } }); gdRenderTable(); gdRenderSelBar(); }
// Opens the nameserver wizard with these domains already picked, straight at the nameservers step.
function gdEditNs(domains) {
    if (GD.ns && GD.ns.running) return;
    GD.ns = gdNsFresh(); GD.ns.selected = (domains || []).filter(Boolean).slice(0, GD_NS_MAX); GD.ns.step = GD.ns.selected.length ? 2 : 1;
    gdOpenNs(true);
}


// ============================================================
// Target brand link: GoDaddy domains that have no brand yet, assigned to an existing or a new brand.
// ============================================================
function gdBrandList() {
    var c = {};
    (GD.data ? GD.data.brands : []).forEach(function (b) { var k = String(b.brand || '').trim(); if (k) c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).map(function (k) { return { name: k, count: c[k] }; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}
function gdSuggestBrand(domain, brands) {
    var label = String(domain || '').toLowerCase().replace(/^[a-z0-9]{1,3}\./, '').split('.')[0].replace(/[^a-z0-9]/g, ''), best = '';
    brands.forEach(function (b) {
        var n = b.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (n.length >= 4 && (label.indexOf(n) !== -1 || (label.length >= 5 && n.indexOf(label) === 0)) && n.length > best.length) best = b.name;
    });
    return best;
}
function gdNormBrand(s) { return String(s || '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9_-]/g, ''); }

function gdAsOpen(domains, brand) {
    gdInjectFont();
    var m = document.getElementById('gdAsModal');
    if (!m) {
        m = document.createElement('div'); m.id = 'gdAsModal';
        m.style.cssText = 'position:fixed;inset:0;z-index:420;background:rgba(2,6,23,.62);backdrop-filter:blur(3px);display:none;align-items:flex-start;justify-content:center;padding:5vh 16px;overflow-y:auto';
        m.onmousedown = function (e) { if (e.target === m) gdAsClose(); };
        document.body.appendChild(m);
        document.addEventListener('keydown', function (e) { var mm = document.getElementById('gdAsModal'); if (e.key === 'Escape' && mm && mm.style.display !== 'none') gdAsClose(); });
    }
    GD.as = { domains: (domains || []).slice(0, 300), mode: brand ? 'existing' : 'existing', q: '', pick: brand || '', newName: '', sort: 'name', running: false, result: null, discard: false };
    m.style.display = 'flex';
    gdAsRender();
}
function gdAsHide() { var m = document.getElementById('gdAsModal'); if (m) m.style.display = 'none'; }
function gdAsClose() {
    var a = GD.as; if (!a) return gdAsHide();
    if (a.running) return;
    if (!a.result && (a.pick || a.newName)) { a.discard = true; gdAsRender(); return; }
    gdAsHide(); if (a.result) { GD.sel = {}; gdLoad(false); }
}
function gdAsTarget() { var a = GD.as; return a.mode === 'new' ? gdNormBrand(a.newName) : a.pick; }
function gdAsProblem() {
    var a = GD.as, t = gdAsTarget(); if (a.mode === 'existing') return t ? '' : 'Pick a brand from the list.';
    if (!a.newName.trim()) return 'Type the new brand name.';
    if (t.length < 2) return 'Use at least 2 letters or numbers.';
    if (gdBrandList().some(function (b) { return b.name.toUpperCase() === t; })) return t + ' already exists. Switch to Existing brand.';
    return '';
}
function gdAsRender() {
    var m = document.getElementById('gdAsModal'), a = GD.as; if (!m || !a) return;
    var n = a.domains.length;
    var chips = a.domains.slice(0, 8).map(function (d) { return '<span class="px-2 py-1 rounded-lg bg-app border border-theme text-[10px] font-semibold text-body">' + gdEsc(d) + '</span>'; }).join('') + (n > 8 ? '<span class="text-[10px] text-subtle self-center">and ' + (n - 8) + ' more</span>' : '');
    var body;
    if (a.result) {
        var r = a.result;
        body = '<div class="text-center py-4"><div class="text-4xl font-black text-emerald-500">' + r.added.length + '</div><p class="text-xs text-body mt-1">domain' + (r.added.length === 1 ? '' : 's') + ' added to <b class="text-heading">' + gdEsc(r.brand) + '</b></p></div>' +
            (r.skipped.length ? '<div class="mt-2 p-3 rounded-xl border border-amber-500/40 bg-amber-500/5 text-[11px] text-body"><b>' + r.skipped.length + ' skipped</b><br>' + r.skipped.slice(0, 20).map(function (s) { return gdEsc(s.domain) + ' - ' + gdEsc(s.reason); }).join('<br>') + '</div>' : '') +
            '<p class="text-[11px] text-subtle mt-3">They now show under this brand in the Target Brands list. Add them to your Google Sheet if you still keep one.</p>';
    } else {
        var seg = '<div class="inline-flex gap-0.5 bg-app border border-theme rounded-xl p-1 mb-3">' + [['existing', 'Existing brand'], ['new', 'New brand']].map(function (x) { return '<button onclick="GD.as.mode=\'' + x[0] + '\';gdAsRender()" class="px-4 py-1.5 rounded-lg text-xs font-bold ' + (a.mode === x[0] ? 'bg-indigo-600 text-white shadow-sm' : 'text-subtle hover:text-body') + '">' + x[1] + '</button>'; }).join('') + '</div>';
        var inner;
        if (a.mode === 'existing') {
            inner = '<div class="flex gap-2 mb-2"><input id="gdAsQ" oninput="GD.as.q=this.value;gdAsRenderList()" value="' + gdEsc(a.q) + '" placeholder="Search brand..." class="flex-1 px-3 py-2 bg-app border border-theme rounded-xl text-xs text-body focus:outline-none"><select onchange="GD.as.sort=this.value;gdAsRenderList()" class="px-2.5 py-2 bg-app border border-theme rounded-xl text-xs text-body"><option value="name"' + (a.sort === 'name' ? ' selected' : '') + '>Name A-Z</option><option value="count"' + (a.sort === 'count' ? ' selected' : '') + '>Most domains</option></select></div><div id="gdAsList" class="border border-theme rounded-xl overflow-y-auto" style="max-height:260px"></div>';
        } else {
            inner = '<label class="text-[11px] font-bold text-heading">New brand name</label><input id="gdAsNew" oninput="GD.as.newName=this.value;gdAsRefreshNew()" value="' + gdEsc(a.newName) + '" placeholder="e.g. LUCKYWIN88" class="mt-1.5 w-full px-3 py-2.5 bg-app border border-theme rounded-xl text-sm font-bold text-body focus:outline-none"><p id="gdAsNewHint" class="text-[11px] mt-2"></p>';
        }
        body = '<div class="flex flex-wrap gap-1.5 mb-4">' + chips + '</div>' + seg + inner;
    }
    var disc = a.discard ? '<div style="position:absolute;inset:0;background:rgba(2,6,23,.55);border-radius:1rem;display:flex;align-items:center;justify-content:center;padding:20px;z-index:5"><div class="panel-card p-6" style="max-width:380px"><h4 class="text-base font-black text-heading">Discard this?</h4><p class="text-xs text-body mt-2">Your brand choice is not saved yet. Nothing has been added.</p><div class="flex justify-end gap-2 mt-5"><button onclick="GD.as.discard=false;gdAsRender()" class="px-4 py-2 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Keep editing</button><button onclick="gdAsHide()" class="px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-bold">Yes, discard</button></div></div></div>' : '';
    m.innerHTML = '<div class="panel-card" style="position:relative;width:min(560px,100%);padding:0;border-radius:1rem;box-shadow:0 30px 70px rgba(0,0,0,.45)">' +
        '<div style="padding:20px 24px 14px;border-bottom:1px solid var(--border-theme)" class="flex items-start justify-between gap-3"><div><h3 class="text-base font-black text-heading">Add ' + n + ' domain' + (n === 1 ? '' : 's') + ' to a brand</h3><p class="text-[11px] text-subtle mt-1">Links the GoDaddy domains to a Target Brand.</p></div><button onclick="gdAsClose()" aria-label="Close" class="text-subtle hover:text-heading text-2xl leading-none px-2">&times;</button></div>' +
        '<div style="padding:18px 24px">' + body + '</div>' +
        '<div style="padding:12px 24px;border-top:1px solid var(--border-theme)" class="flex items-center justify-between gap-3 flex-wrap">' + (a.result ? '<span></span><button onclick="gdAsClose()" class="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700">Done</button>' : '<button onclick="gdAsClose()" class="px-4 py-2.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Cancel</button><div class="flex items-center gap-3"><span id="gdAsHint" class="text-[11px] text-subtle"></span><button id="gdAsGo" onclick="gdAsApply()" class="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 shadow-sm">Add to brand</button></div>') + '</div>' + disc + '</div>';
    if (!a.result) { if (a.mode === 'existing') gdAsRenderList(); else gdAsRefreshNew(); }
    gdAsRefreshNav();
}
function gdAsRenderList() {
    var el = document.getElementById('gdAsList'); if (!el) return;
    var a = GD.as, q = a.q.trim().toLowerCase();
    var list = gdBrandList().filter(function (b) { return !q || b.name.toLowerCase().indexOf(q) !== -1; });
    list.sort(function (x, y) { return a.sort === 'count' ? (y.count - x.count) || x.name.localeCompare(y.name) : x.name.localeCompare(y.name); });
    var sug = a.domains.length === 1 ? gdSuggestBrand(a.domains[0], gdBrandList()) : '';
    el.innerHTML = list.length ? list.map(function (b) {
        return '<label class="flex items-center gap-3 px-3 py-2 border-b border-theme/60 hover:bg-app cursor-pointer text-xs"><input type="radio" name="gdAsBrand" ' + (a.pick === b.name ? 'checked' : '') + ' onchange="GD.as.pick=this.value;gdAsRefreshNav()" value="' + gdEsc(b.name) + '"><span class="font-bold text-heading flex-1">' + gdEsc(b.name) + (sug === b.name ? ' <span class="ml-1 px-1.5 py-0.5 rounded bg-indigo-600/15 text-indigo-500 text-[9px] font-bold">SUGGESTED</span>' : '') + '</span><span class="text-subtle">' + b.count + ' domain' + (b.count === 1 ? '' : 's') + '</span></label>';
    }).join('') : '<p class="text-xs text-subtle p-6 text-center">No brand matches. Use New brand to create it.</p>';
    gdAsRefreshNav();
}
function gdAsRefreshNew() {
    var h = document.getElementById('gdAsNewHint'); if (!h) return;
    var a = GD.as, t = gdNormBrand(a.newName), p = a.newName.trim() ? gdAsProblem() : '';
    h.className = 'text-[11px] mt-2 ' + (p ? 'text-rose-500' : 'text-subtle');
    h.textContent = p || (t ? 'Will be created as ' + t : 'Letters and numbers only. It is saved in capitals, no spaces.');
    gdAsRefreshNav();
}
function gdAsRefreshNav() {
    var b = document.getElementById('gdAsGo'), h = document.getElementById('gdAsHint'); if (!b) return;
    var a = GD.as, p = gdAsProblem(), can = !p && !a.running && a.domains.length > 0;
    b.style.opacity = can ? '1' : '.45'; b.style.pointerEvents = can ? 'auto' : 'none';
    b.textContent = a.running ? 'Adding...' : (gdAsTarget() ? 'Add to ' + gdAsTarget() : 'Add to brand');
    if (h) h.textContent = a.mode === 'existing' ? '' : '';
}
function gdAsApply() {
    var a = GD.as; if (a.running || gdAsProblem()) return;
    a.running = true; gdAsRefreshNav();
    google.script.run.withSuccessHandler(function (r) { a.running = false; a.result = r; gdAsRender(); gdLoad(false); if (typeof loadSidebarBrands === 'function') loadSidebarBrands(); })
        .withFailureHandler(function (e) { a.running = false; gdAsRefreshNav(); if (typeof showPremiumToast === 'function') showPremiumToast('Could not add', (e && e.message) || 'Try again.', 'error'); })
        .assignGodaddyBrand(currentSessionToken, a.domains, gdAsTarget(), a.mode === 'new' ? 'new' : 'existing');
}
function gdAssignRows(domains) { gdAsOpen(domains); }

// ============================================================
// Receipts: files from GoDaddy, stored in R2 and listed here.
// ============================================================
var GD_RC = { rows: null, q: '', sort: 'paidAt', dir: -1, loading: false };
function gdRcLoad(force) {
    if (GD_RC.loading) return; GD_RC.loading = true;
    google.script.run.withSuccessHandler(function (r) { GD_RC.rows = r.receipts || []; GD_RC.loading = false; if (GD.tab === 'receipts') gdRcRender(); })
        .withFailureHandler(function (e) { GD_RC.loading = false; GD_RC.rows = GD_RC.rows || []; if (typeof showPremiumToast === 'function') showPremiumToast('Could not load receipts', (e && e.message) || '', 'error'); if (GD.tab === 'receipts') gdRcRender(); })
        .listGodaddyReceipts(currentSessionToken);
}
function gdRcUrl(id) { return 'https://bbc-api-gateway.ea-nix.workers.dev/?action=downloadGodaddyReceipt&id=' + id + '&token=' + encodeURIComponent(currentSessionToken); }
function gdRcSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function gdRcSortBy(k) { if (GD_RC.sort === k) GD_RC.dir *= -1; else { GD_RC.sort = k; GD_RC.dir = k === 'paidAt' ? -1 : 1; } gdRcRender(); }
function gdRcRender() {
    var el = document.getElementById('gdRc'); if (!el) return;
    if (GD_RC.rows == null) { el.innerHTML = '<p class="text-sm text-subtle py-8 text-center">Loading receipts...</p>'; gdRcLoad(); return; }
    el.innerHTML = '<div class="flex items-center justify-between flex-wrap gap-3 mb-4"><div id="gdRcCount" class="text-xs text-subtle"></div><div class="flex gap-2"><input oninput="GD_RC.q=this.value;gdRcRenderTable()" id="gdRcQ" value="' + gdEsc(GD_RC.q) + '" placeholder="Search order, domain, note..." class="px-3 py-2 bg-app border border-theme rounded-xl text-xs text-body focus:outline-none w-56"><button onclick="gdRcOpen()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 shadow-sm">Upload receipt</button></div></div><div id="gdRcTable"></div>';
    gdRcRenderTable();
}
function gdRcRenderTable() {
    var el = document.getElementById('gdRcTable'); if (!el) return;
    var q = GD_RC.q.trim().toLowerCase();
    var rows = GD_RC.rows.filter(function (r) { return !q || (r.orderNo + ' ' + r.domains + ' ' + r.account + ' ' + r.note + ' ' + r.filename).toLowerCase().indexOf(q) !== -1; });
    rows.sort(function (a, b) { var x = a[GD_RC.sort], y = b[GD_RC.sort]; return gdNsCmp(x == null ? '' : x, y == null ? '' : y, GD_RC.dir) || (b.id - a.id); });
    var total = rows.reduce(function (s, r) { return s + (r.currency === 'USD' && r.amount ? +r.amount : 0); }, 0);
    var th = function (l, k) { return gdNsSortTh(l, k, GD_RC.sort, GD_RC.dir, 'gdRcSortBy'); };
    var cEl = document.getElementById('gdRcCount'); if (cEl) cEl.innerHTML = '<b class="text-heading">' + rows.length + '</b> receipt' + (rows.length === 1 ? '' : 's') + (total ? ' &middot; USD ' + total.toFixed(2) + ' in total' : '');
    el.innerHTML = (rows.length ? '<div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr class="text-left text-[10px] text-subtle border-b border-theme">' + th('Paid on', 'paidAt') + th('Order no.', 'orderNo') + th('Amount', 'amount') + th('Account', 'account') + '<th class="p-2">Domains</th>' + th('Uploaded', 'uploadedAt') + '<th class="p-2">File</th><th class="p-2"></th></tr></thead><tbody>' +
            rows.map(function (r) {
                var doms = r.domains ? r.domains.split(',') : [];
                return '<tr class="border-b border-theme/60 align-top"><td class="p-2 whitespace-nowrap">' + (r.paidAt ? gdEsc(gdDay(r.paidAt + ' 00:00:00')) : '-') + '</td><td class="p-2 font-bold text-heading">' + gdEsc(r.orderNo || '-') + '</td><td class="p-2 whitespace-nowrap">' + (r.amount != null ? gdEsc(r.currency) + ' ' + Number(r.amount).toFixed(2) : '-') + '</td><td class="p-2">' + gdEsc((r.account || '-').replace(/^Godaddy\s+/i, '')) + '</td>' +
                    '<td class="p-2" title="' + gdEsc(doms.join(', ')) + '">' + (doms.length ? gdEsc(doms.slice(0, 2).join(', ')) + (doms.length > 2 ? ' <span class="text-subtle">+' + (doms.length - 2) + ' more</span>' : '') : '<span class="text-subtle">-</span>') + (r.note ? '<div class="text-subtle text-[10px] mt-0.5">' + gdEsc(r.note) + '</div>' : '') + '</td>' +
                    '<td class="p-2 text-subtle whitespace-nowrap">' + gdEsc(gdDay(r.uploadedAt)) + '<br><span class="text-[10px]">' + gdEsc(r.uploaderName || r.uploadedBy) + '</span></td><td class="p-2 whitespace-nowrap"><a href="' + gdRcUrl(r.id) + '" target="_blank" class="text-indigo-500 font-bold hover:underline">View</a> <span class="text-subtle text-[10px]">' + gdRcSize(r.size) + '</span></td>' +
                    '<td class="p-2 text-right"><button onclick="gdRcDelete(' + r.id + ')" class="text-subtle hover:text-rose-500 text-[11px] font-bold">Delete</button></td></tr>';
            }).join('') + '</tbody></table></div>' : '<div class="text-center py-12"><p class="text-sm font-bold text-heading">No receipts yet</p><p class="text-xs text-subtle mt-1">Upload the receipt PDF or screenshot from GoDaddy, with its order number, so renewals have proof.</p></div>');
}
function gdRcDelete(id) {
    var go = function () {
        google.script.run.withSuccessHandler(function () { GD_RC.rows = (GD_RC.rows || []).filter(function (r) { return r.id !== id; }); gdRcRender(); if (typeof showPremiumToast === 'function') showPremiumToast('Receipt deleted', '', 'success'); })
            .withFailureHandler(function (e) { if (typeof showPremiumToast === 'function') showPremiumToast('Could not delete', (e && e.message) || '', 'error'); }).deleteGodaddyReceipt(currentSessionToken, id);
    };
    if (typeof showPremiumConfirm === 'function') showPremiumConfirm('Delete this receipt?', 'The file is removed for everyone. This cannot be undone.', 'Delete', go); else go();
}
function gdRcOpen(domains) {
    gdInjectFont();
    var m = document.getElementById('gdRcModal');
    if (!m) {
        m = document.createElement('div'); m.id = 'gdRcModal';
        m.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(2,6,23,.62);backdrop-filter:blur(3px);display:none;align-items:flex-start;justify-content:center;padding:4vh 16px;overflow-y:auto';
        m.onmousedown = function (e) { if (e.target === m) gdRcClose(); };
        document.body.appendChild(m);
        document.addEventListener('keydown', function (e) { var mm = document.getElementById('gdRcModal'); if (e.key === 'Escape' && mm && mm.style.display !== 'none') gdRcClose(); });
    }
    GD_RC.form = { file: null, orderNo: '', amount: '', currency: 'USD', paidAt: new Date().toISOString().slice(0, 10), account: '', domains: (domains || []).join('\n'), note: '', busy: false, discard: false };
    m.style.display = 'flex'; gdRcFormRender();
}
function gdRcHide() { var m = document.getElementById('gdRcModal'); if (m) m.style.display = 'none'; }
function gdRcDirty() { var f = GD_RC.form; return f && (f.file || f.orderNo || f.amount || f.domains.trim() || f.note); }
function gdRcClose() { var f = GD_RC.form; if (f && f.busy) return; if (gdRcDirty()) { f.discard = true; gdRcFormRender(); return; } gdRcHide(); }
function gdRcFormRender() {
    var m = document.getElementById('gdRcModal'), f = GD_RC.form; if (!m || !f) return;
    var accts = (GD.data ? GD.data.accounts : []).map(function (a) { return a.account; });
    var inp = 'w-full px-3 py-2.5 bg-app border border-theme rounded-xl text-xs text-body focus:outline-none';
    var disc = f.discard ? '<div style="position:absolute;inset:0;background:rgba(2,6,23,.55);border-radius:1rem;display:flex;align-items:center;justify-content:center;padding:20px;z-index:5"><div class="panel-card p-6" style="max-width:380px"><h4 class="text-base font-black text-heading">Discard this receipt?</h4><p class="text-xs text-body mt-2">The file and details you entered are not saved yet.</p><div class="flex justify-end gap-2 mt-5"><button onclick="GD_RC.form.discard=false;gdRcFormRender()" class="px-4 py-2 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Keep editing</button><button onclick="gdRcHide()" class="px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-bold">Yes, discard</button></div></div></div>' : '';
    m.innerHTML = '<div class="panel-card" style="position:relative;width:min(640px,100%);padding:0;border-radius:1rem;box-shadow:0 30px 70px rgba(0,0,0,.45)">' +
        '<div style="padding:20px 24px 14px;border-bottom:1px solid var(--border-theme)" class="flex items-start justify-between gap-3"><div><h3 class="text-base font-black text-heading">Upload a GoDaddy receipt</h3><p class="text-[11px] text-subtle mt-1">PDF, PNG, JPG or WEBP, up to 8 MB.</p></div><button onclick="gdRcClose()" aria-label="Close" class="text-subtle hover:text-heading text-2xl leading-none px-2">&times;</button></div>' +
        '<div style="padding:18px 24px" class="grid grid-cols-2 gap-4"><div class="col-span-2"><div id="gdRcDrop" ondragover="event.preventDefault()" ondrop="event.preventDefault();gdRcPick(event.dataTransfer.files[0])" onclick="document.getElementById(\'gdRcFile\').click()" class="border-2 border-dashed border-theme rounded-xl p-6 text-center cursor-pointer hover:border-indigo-400 ' + (f.file ? 'bg-emerald-500/5' : '') + '">' +
        (f.file ? '<p class="text-sm font-bold text-heading">' + gdEsc(f.file.name) + '</p><p class="text-[11px] text-subtle mt-1">' + gdRcSize(f.file.size) + ' &middot; click to change</p>' : '<p class="text-sm font-bold text-heading">Drop the receipt here</p><p class="text-[11px] text-subtle mt-1">or click to choose a file</p>') + '</div><input id="gdRcFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" class="hidden" onchange="gdRcPick(this.files[0])"></div>' +
        '<div><label class="text-[11px] font-bold text-heading">Order number</label><input id="gdRcOrder" oninput="GD_RC.form.orderNo=this.value" value="' + gdEsc(f.orderNo) + '" placeholder="e.g. 3456789012" class="mt-1.5 ' + inp + '"></div>' +
        '<div><label class="text-[11px] font-bold text-heading">Paid on</label><input type="date" oninput="GD_RC.form.paidAt=this.value" value="' + gdEsc(f.paidAt) + '" class="mt-1.5 ' + inp + '"></div>' +
        '<div><label class="text-[11px] font-bold text-heading">Amount</label><div class="flex gap-2 mt-1.5"><select onchange="GD_RC.form.currency=this.value" class="px-2 py-2.5 bg-app border border-theme rounded-xl text-xs text-body"><option' + (f.currency === 'USD' ? ' selected' : '') + '>USD</option><option' + (f.currency === 'PHP' ? ' selected' : '') + '>PHP</option></select><input oninput="GD_RC.form.amount=this.value" value="' + gdEsc(f.amount) + '" inputmode="decimal" placeholder="0.00" class="' + inp + '"></div></div>' +
        '<div><label class="text-[11px] font-bold text-heading">GoDaddy account</label><select onchange="GD_RC.form.account=this.value" class="mt-1.5 ' + inp + '"><option value="">Not sure</option>' + accts.map(function (a) { return '<option value="' + gdEsc(a) + '"' + (f.account === a ? ' selected' : '') + '>' + gdEsc(a.replace(/^Godaddy\s+/i, '')) + '</option>'; }).join('') + '</select></div>' +
        '<div class="col-span-2"><label class="text-[11px] font-bold text-heading">Domains on this receipt <span class="text-subtle font-normal">optional, one per line</span></label><textarea oninput="GD_RC.form.domains=this.value" rows="3" class="mt-1.5 ' + inp + ' font-semibold">' + gdEsc(f.domains) + '</textarea></div>' +
        '<div class="col-span-2"><label class="text-[11px] font-bold text-heading">Note <span class="text-subtle font-normal">optional</span></label><input oninput="GD_RC.form.note=this.value" value="' + gdEsc(f.note) + '" maxlength="300" class="mt-1.5 ' + inp + '"></div></div>' +
        '<div style="padding:12px 24px;border-top:1px solid var(--border-theme)" class="flex items-center justify-between gap-3"><button onclick="gdRcClose()" class="px-4 py-2.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Cancel</button><div class="flex items-center gap-3"><span id="gdRcHint" class="text-[11px] text-subtle"></span><button id="gdRcGo" onclick="gdRcSubmit()" class="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 shadow-sm" ' + (f.file && !f.busy ? '' : 'style="opacity:.45;pointer-events:none"') + '>' + (f.busy ? 'Uploading...' : 'Save receipt') + '</button></div></div>' + disc + '</div>';
}
function gdRcPick(file) {
    if (!file) return; var f = GD_RC.form;
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) { if (typeof showPremiumToast === 'function') showPremiumToast('Wrong file type', 'Use a PDF, PNG, JPG or WEBP file.', 'warning'); return; }
    if (file.size > 8 * 1024 * 1024) { if (typeof showPremiumToast === 'function') showPremiumToast('File too large', 'The limit is 8 MB.', 'warning'); return; }
    f.file = file; gdRcFormRender();
}
function gdRcSubmit() {
    var f = GD_RC.form; if (!f || !f.file || f.busy) return;
    f.busy = true; gdRcFormRender();
    var reader = new FileReader();
    reader.onload = function () {
        var b64 = String(reader.result).split(',')[1] || '';
        google.script.run.withSuccessHandler(function () { f.busy = false; f.orderNo = f.amount = f.note = ''; f.domains = ''; f.file = null; gdRcHide(); GD_RC.rows = null; gdRcLoad(true); if (typeof showPremiumToast === 'function') showPremiumToast('Receipt saved', 'It is now listed under Receipts.', 'success'); })
            .withFailureHandler(function (e) { f.busy = false; gdRcFormRender(); if (typeof showPremiumToast === 'function') showPremiumToast('Could not save', (e && e.message) || 'Try again.', 'error'); })
            .uploadGodaddyReceipt(currentSessionToken, { orderNo: f.orderNo, amount: f.amount, currency: f.currency, paidAt: f.paidAt, account: f.account, domains: f.domains, note: f.note }, b64, f.file.name, f.file.type);
    };
    reader.onerror = function () { f.busy = false; gdRcFormRender(); };
    reader.readAsDataURL(f.file);
}

// ============================================================
// Card: "No brand yet" opens a list of every GoDaddy domain without a brand, with the way to assign one.
// ============================================================
function gdUnOpen() {
    gdInjectFont();
    var m = document.getElementById('gdUnModal');
    if (!m) {
        m = document.createElement('div'); m.id = 'gdUnModal';
        m.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(2,6,23,.62);backdrop-filter:blur(3px);display:none;align-items:flex-start;justify-content:center;padding:3vh 16px;overflow-y:auto';
        m.onmousedown = function (e) { if (e.target === m) gdUnClose(); };
        document.body.appendChild(m);
        document.addEventListener('keydown', function (e) { var mm = document.getElementById('gdUnModal'); var as = document.getElementById('gdAsModal'); if (e.key === 'Escape' && mm && mm.style.display !== 'none' && (!as || as.style.display === 'none')) gdUnClose(); });
    }
    GD.un = { q: '', acct: 'all', sort: 'domain', dir: 1, sel: {}, busy: false };
    m.style.display = 'flex'; gdUnRender();
}
function gdUnClose() { var m = document.getElementById('gdUnModal'); if (m && !(GD.un && GD.un.busy)) m.style.display = 'none'; }
function gdUnRows() {
    var u = GD.un, q = u.q.trim().toLowerCase(), brands = gdBrandList();
    var rows = gdModel().unassigned.map(function (r) { return { domain: r.domain, account: r.account, expires: r.expires, days: r.days, sug: gdSuggestBrand(r.domain, brands) }; }).filter(function (r) {
        return (u.acct === 'all' || r.account === u.acct) && (!q || r.domain.indexOf(q) !== -1);
    });
    rows.sort(function (a, b) { return gdNsCmp(a[u.sort], b[u.sort], u.dir) || a.domain.localeCompare(b.domain); });
    return rows;
}
function gdUnRender() {
    var m = document.getElementById('gdUnModal'); if (!m || !GD.un) return;
    var accts = GD.data.accounts.map(function (a) { return a.account.replace(/^Godaddy\s+/i, ''); });
    m.innerHTML = '<div class="panel-card" style="position:relative;width:min(900px,100%);padding:0;border-radius:1rem;box-shadow:0 30px 70px rgba(0,0,0,.45)">' +
        '<div style="padding:20px 24px 14px;border-bottom:1px solid var(--border-theme)" class="flex items-start justify-between gap-3"><div><h3 class="text-lg font-black text-heading flex items-center gap-2"><i data-lucide="tag" class="h-5 w-5 text-amber-500"></i> Domains without a brand</h3><p class="text-[11px] text-subtle mt-1">These GoDaddy domains are not under any Target Brand yet. Pick them, then choose an existing brand or create a new one.</p></div><button onclick="gdUnClose()" aria-label="Close" class="text-subtle hover:text-heading text-2xl leading-none px-2">&times;</button></div>' +
        '<div style="padding:16px 24px"><div class="flex gap-2 flex-wrap mb-3"><input id="gdUnQ" oninput="GD.un.q=this.value;gdUnRenderList()" placeholder="Search domain..." class="flex-1 min-w-[180px] px-3 py-2 bg-app border border-theme rounded-xl text-xs text-body focus:outline-none">' +
        '<select onchange="GD.un.acct=this.value;gdUnRenderList()" class="px-2.5 py-2 bg-app border border-theme rounded-xl text-xs text-body"><option value="all">All accounts</option>' + accts.map(function (a) { return '<option value="' + gdEsc(a) + '">' + gdEsc(a) + '</option>'; }).join('') + '</select>' +
        '<select onchange="var v=this.value.split(\':\');GD.un.sort=v[0];GD.un.dir=+v[1];gdUnRenderList()" class="px-2.5 py-2 bg-app border border-theme rounded-xl text-xs text-body"><option value="domain:1">Name A-Z</option><option value="domain:-1">Name Z-A</option><option value="expires:1">Expires soonest</option><option value="expires:-1">Expires latest</option><option value="account:1">Account</option><option value="sug:-1">Has suggestion first</option></select></div>' +
        '<div class="flex items-center gap-2 mb-2 flex-wrap"><button onclick="gdUnSelectShown()" class="px-3 py-1.5 bg-panel border border-theme rounded-lg text-[11px] font-bold text-body hover:bg-app">Select all shown</button><button onclick="GD.un.sel={};gdUnRenderList()" class="px-3 py-1.5 bg-panel border border-theme rounded-lg text-[11px] font-bold text-body hover:bg-app">Clear</button><span id="gdUnCount" class="text-[11px] text-subtle ml-1"></span></div>' +
        '<div id="gdUnList" class="border border-theme rounded-xl overflow-y-auto" style="max-height:380px"></div></div>' +
        '<div style="padding:12px 24px;border-top:1px solid var(--border-theme)" class="flex items-center justify-between gap-3 flex-wrap"><button onclick="gdUnClose()" class="px-4 py-2.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Close</button><div class="flex items-center gap-2"><button id="gdUnAccept" onclick="gdUnAcceptAll()" class="px-4 py-2.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app"></button><button id="gdUnAssign" onclick="gdUnAssign()" class="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 shadow-sm">Assign brand</button></div></div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    gdUnRenderList();
}
function gdUnRenderList() {
    var el = document.getElementById('gdUnList'); if (!el || !GD.un) return;
    var u = GD.un, rows = gdUnRows(), shown = rows.slice(0, 300);
    var allRows = gdModel().unassigned.length;
    el.innerHTML = shown.length ? shown.map(function (r) {
        var d = r.days;
        return '<div class="flex items-center gap-3 px-3 py-2 border-b border-theme/60 hover:bg-app text-xs"><input type="checkbox" ' + (u.sel[r.domain] ? 'checked' : '') + ' data-d="' + gdEsc(r.domain) + '" onchange="gdUnPick(this.getAttribute(\'data-d\'),this.checked)" aria-label="Select ' + gdEsc(r.domain) + '"><span class="font-bold text-heading flex-1 truncate">' + gdEsc(r.domain) + '</span><span class="text-subtle w-16 text-right">' + gdEsc(r.account) + '</span><span class="text-subtle w-24 text-right">' + gdEsc(gdDay(r.expires)) + '</span>' +
            (r.sug ? '<button onclick="gdAsOpen([this.getAttribute(\'data-d\')],this.getAttribute(\'data-b\'))" data-d="' + gdEsc(r.domain) + '" data-b="' + gdEsc(r.sug) + '" class="px-2.5 py-1 rounded-lg bg-indigo-600/10 text-indigo-500 text-[10px] font-bold hover:bg-indigo-600/20 whitespace-nowrap" title="Suggested brand">' + gdEsc(r.sug) + '</button>' : '<span class="w-24"></span>') +
            '<button onclick="gdAsOpen([this.getAttribute(\'data-d\')])" data-d="' + gdEsc(r.domain) + '" class="px-2.5 py-1 rounded-lg border border-theme text-[10px] font-bold text-body hover:bg-app whitespace-nowrap">Choose brand</button></div>';
    }).join('') + (rows.length > shown.length ? '<p class="text-[10px] text-subtle p-3">Showing the first ' + shown.length + '. Search to narrow down.</p>' : '') :
        '<div class="text-center py-12"><p class="text-sm font-bold ' + (allRows ? 'text-heading' : 'text-emerald-500') + '">' + (allRows ? 'No domain matches this search.' : 'Every GoDaddy domain has a brand.') + '</p></div>';
    gdUnNav();
}
function gdUnNav() {
    var u = GD.un; if (!u) return;
    var n = Object.keys(u.sel).filter(function (k) { return u.sel[k]; }).length, rows = gdUnRows(), withSug = rows.filter(function (r) { return r.sug; }).length;
    var c = document.getElementById('gdUnCount'); if (c) c.textContent = rows.length + ' shown' + (n ? ' / ' + n + ' selected' : '');
    var a = document.getElementById('gdUnAssign'); if (a) { a.textContent = n ? 'Assign brand to ' + n : 'Assign brand'; a.style.opacity = n ? '1' : '.45'; a.style.pointerEvents = n ? 'auto' : 'none'; }
    var b = document.getElementById('gdUnAccept'); if (b) { b.style.display = withSug ? '' : 'none'; b.textContent = 'Accept ' + withSug + ' suggestion' + (withSug === 1 ? '' : 's'); }
}
function gdUnPick(d, on) { if (on) GD.un.sel[d] = true; else delete GD.un.sel[d]; gdUnNav(); }
function gdUnSelectShown() { gdUnRows().slice(0, 300).forEach(function (r) { GD.un.sel[r.domain] = true; }); gdUnRenderList(); }
function gdUnAssign() { var d = Object.keys(GD.un.sel).filter(function (k) { return GD.un.sel[k]; }); if (d.length) gdAsOpen(d); }
// Adds every domain that has a suggested brand to that brand, one brand at a time.
function gdUnAcceptAll() {
    var u = GD.un; if (!u || u.busy) return;
    var groups = {}; gdUnRows().forEach(function (r) { if (r.sug) (groups[r.sug] = groups[r.sug] || []).push(r.domain); });
    var names = Object.keys(groups); if (!names.length) return;
    var go = function () {
        u.busy = true; var done = 0, fail = 0;
        (function next(i) {
            if (i >= names.length) {
                u.busy = false; u.sel = {};
                if (typeof showPremiumToast === 'function') showPremiumToast('Suggestions accepted', done + ' domain' + (done === 1 ? '' : 's') + ' added' + (fail ? ', ' + fail + ' skipped or failed' : '') + '.', fail ? 'warning' : 'success');
                gdLoad(false); if (typeof loadSidebarBrands === 'function') loadSidebarBrands(); return;
            }
            google.script.run.withSuccessHandler(function (r) { done += r.added.length; fail += r.skipped.length; next(i + 1); })
                .withFailureHandler(function () { fail += groups[names[i]].length; next(i + 1); })
                .assignGodaddyBrand(currentSessionToken, groups[names[i]], names[i], 'existing');
        })(0);
    };
    var total = names.reduce(function (s, k) { return s + groups[k].length; }, 0);
    var msg = total + ' domain' + (total === 1 ? '' : 's') + ' will be added to ' + names.length + ' existing brand' + (names.length === 1 ? '' : 's') + ' based on their names.';
    if (typeof showPremiumConfirm === 'function') showPremiumConfirm('Accept all suggestions?', msg, 'Add them', go); else go();
}
// Re-draws the list after data was reloaded (for example right after an assignment).
function gdUnRefresh() {
    var m = document.getElementById('gdUnModal'); if (!m || m.style.display === 'none' || !GD.un) return;
    GD.un.sel = {}; gdUnRenderList();
}

// ============================================================
// Move lapsed domains out of Target Brands (review list, then confirm).
// ============================================================
function gdStaleList() {
    var map = {};
    ((GD.data && GD.data.staleInBrands) || []).forEach(function (r) {
        var x = map[r.domain] || (map[r.domain] = { domain: r.domain, account: r.account.replace(/^Godaddy\s+/i, ''), status: r.status, expires: r.expires, brands: [] });
        if (x.brands.indexOf(r.brand) === -1) x.brands.push(r.brand);
    });
    return Object.keys(map).map(function (k) { var x = map[k]; x.brand = x.brands.join(', '); x.kind = x.status === 'UPDATED_OWNERSHIP' ? 'Moved to another owner' : (GD_LAPSED_LABEL[x.status] || 'Not renewed'); return x; });
}
function gdMvOpen() {
    gdInjectFont();
    var m = document.getElementById('gdMvModal');
    if (!m) {
        m = document.createElement('div'); m.id = 'gdMvModal';
        m.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(2,6,23,.62);backdrop-filter:blur(3px);display:none;align-items:flex-start;justify-content:center;padding:3vh 16px;overflow-y:auto';
        m.onmousedown = function (e) { if (e.target === m) gdMvClose(); };
        document.body.appendChild(m);
        document.addEventListener('keydown', function (e) { var mm = document.getElementById('gdMvModal'); if (e.key === 'Escape' && mm && mm.style.display !== 'none') gdMvClose(); });
    }
    var all = gdStaleList(), sel = {}; all.forEach(function (r) { sel[r.domain] = true; });
    GD.mv = { q: '', sort: 'brand', dir: 1, kind: 'all', sel: sel, busy: false, confirm: false, result: null, done: 0, total: 0 };
    m.style.display = 'flex'; gdMvRender();
}
function gdMvClose() { var m = document.getElementById('gdMvModal'); if (!m || !GD.mv || GD.mv.busy) return; m.style.display = 'none'; if (GD.mv.result) gdLoad(false); }
function gdMvRows() {
    var v = GD.mv, q = v.q.trim().toLowerCase();
    var rows = gdStaleList().filter(function (r) { return (v.kind === 'all' || (v.kind === 'moved' ? r.status === 'UPDATED_OWNERSHIP' : r.status !== 'UPDATED_OWNERSHIP')) && (!q || (r.domain + ' ' + r.brand).toLowerCase().indexOf(q) !== -1); });
    rows.sort(function (a, b) { return gdNsCmp(a[v.sort], b[v.sort], v.dir) || a.domain.localeCompare(b.domain); });
    return rows;
}
function gdMvSortBy(k) { var v = GD.mv; if (v.sort === k) v.dir *= -1; else { v.sort = k; v.dir = 1; } gdMvRenderList(); }
function gdMvRender() {
    var m = document.getElementById('gdMvModal'), v = GD.mv; if (!m || !v) return;
    var disc = v.confirm ? '<div style="position:absolute;inset:0;background:rgba(2,6,23,.55);border-radius:1rem;display:flex;align-items:center;justify-content:center;padding:20px;z-index:5"><div class="panel-card p-6" style="max-width:420px"><h4 class="text-base font-black text-heading">Move ' + gdMvCount() + ' domain' + (gdMvCount() === 1 ? '' : 's') + ' out of Target Brands?</h4><p class="text-xs text-body mt-2">They stop showing under their brands. Each domain is first checked live at GoDaddy: anything that is active again, or that GoDaddy no longer lists, is kept where it is. The rest are saved in the archive with their brand and ISP statuses, and go back to their brand by themselves if renewed later. Nothing is changed at GoDaddy.</p><div class="flex justify-end gap-2 mt-5"><button onclick="GD.mv.confirm=false;gdMvRender()" class="px-4 py-2 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Go back</button><button onclick="gdMvApply()" class="px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700">Yes, move them</button></div></div></div>' : '';
    var body;
    if (v.result) {
        body = '<div class="text-center py-6"><div class="text-4xl font-black text-emerald-500">' + v.result.moved + '</div><p class="text-xs text-body mt-1">domain' + (v.result.moved === 1 ? '' : 's') + ' moved out of Target Brands</p></div>' + (v.result.skipped ? '<div class="mt-2 p-3 rounded-xl border border-amber-500/40 bg-amber-500/5 text-[11px] text-body"><b>' + v.result.skipped + ' kept (checked live at GoDaddy)</b><br>' + (v.result.why || []).slice(0, 25).map(function (w) { return gdEsc(w.domain) + ' - ' + gdEsc(w.reason); }).join('<br>') + '</div>' : '') + '<p class="text-[11px] text-subtle text-center mt-3">They are listed under Not renewed (or Removed). The Target Brands sidebar has been refreshed.</p>';
    } else {
        body = '<div class="flex gap-2 flex-wrap mb-3"><input id="gdMvQ" oninput="GD.mv.q=this.value;gdMvRenderList()" placeholder="Search domain or brand..." class="flex-1 min-w-[180px] px-3 py-2 bg-app border border-theme rounded-xl text-xs text-body focus:outline-none"><select onchange="GD.mv.kind=this.value;gdMvRenderList()" class="px-2.5 py-2 bg-app border border-theme rounded-xl text-xs text-body"><option value="all">All reasons</option><option value="lapsed">Not renewed</option><option value="moved">Moved to another owner</option></select></div>' +
            '<div class="flex items-center gap-2 mb-2"><button onclick="gdMvAll(true)" class="px-3 py-1.5 bg-panel border border-theme rounded-lg text-[11px] font-bold text-body hover:bg-app">Select all shown</button><button onclick="gdMvAll(false)" class="px-3 py-1.5 bg-panel border border-theme rounded-lg text-[11px] font-bold text-body hover:bg-app">Clear</button><span id="gdMvCount" class="text-[11px] text-subtle ml-1"></span></div><div id="gdMvList" class="border border-theme rounded-xl overflow-auto" style="max-height:380px"></div>' + (v.busy ? '<div class="mt-3"><div class="h-2 rounded bg-app overflow-hidden"><div class="h-2 bg-amber-500" style="width:' + Math.round(v.done / Math.max(1, v.total) * 100) + '%"></div></div><p class="text-[11px] text-subtle mt-1">' + v.done + ' of ' + v.total + ' done...</p></div>' : '');
    }
    m.innerHTML = '<div class="panel-card" style="position:relative;width:min(900px,100%);padding:0;border-radius:1rem;box-shadow:0 30px 70px rgba(0,0,0,.45)"><div style="padding:20px 24px 14px;border-bottom:1px solid var(--border-theme)" class="flex items-start justify-between gap-3"><div><h3 class="text-lg font-black text-heading">Domains no longer in GoDaddy</h3><p class="text-[11px] text-subtle mt-1">Still listed under Target Brands. Review them, then move them out.</p></div><button onclick="gdMvClose()" aria-label="Close" class="text-subtle hover:text-heading text-2xl leading-none px-2">&times;</button></div><div style="padding:16px 24px">' + body + '</div>' +
        '<div style="padding:12px 24px;border-top:1px solid var(--border-theme)" class="flex items-center justify-between gap-3">' + (v.result ? '<span></span><button onclick="gdMvClose()" class="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700">Done</button>' : '<button onclick="gdMvClose()" class="px-4 py-2.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Cancel</button><button id="gdMvGo" onclick="GD.mv.confirm=true;gdMvRender()" class="px-5 py-2.5 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 shadow-sm">Move out</button>') + '</div>' + disc + '</div>';
    if (!v.result) gdMvRenderList();
}
function gdMvCount() { return Object.keys(GD.mv.sel).filter(function (k) { return GD.mv.sel[k]; }).length; }
function gdMvRenderList() {
    var el = document.getElementById('gdMvList'); if (!el || !GD.mv) return;
    var v = GD.mv, rows = gdMvRows();
    var th = function (l, k) { return gdNsSortTh(l, k, v.sort, v.dir, 'gdMvSortBy'); };
    el.innerHTML = rows.length ? '<table class="w-full text-xs"><thead class="sticky top-0 bg-panel"><tr class="text-left text-[10px] text-subtle border-b border-theme"><th class="p-2"></th>' + th('Domain', 'domain') + th('Brand', 'brand') + th('Account', 'account') + th('Expired', 'expires') + th('Why', 'kind') + '</tr></thead><tbody>' +
        rows.map(function (r) { return '<tr class="border-b border-theme/60"><td class="p-2"><input type="checkbox" ' + (v.sel[r.domain] ? 'checked' : '') + ' data-d="' + gdEsc(r.domain) + '" onchange="gdMvPick(this.getAttribute(\'data-d\'),this.checked)"></td><td class="p-2 font-bold text-heading">' + gdEsc(r.domain) + '</td><td class="p-2">' + gdEsc(r.brand) + '</td><td class="p-2">' + gdEsc(r.account) + '</td><td class="p-2 whitespace-nowrap">' + gdEsc(gdDay(r.expires)) + '</td><td class="p-2 text-subtle">' + gdEsc(r.kind) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="text-xs text-subtle p-10 text-center">Nothing to move. Every lapsed domain is already out of Target Brands.</p>';
    gdMvNav();
}
function gdMvNav() {
    var c = document.getElementById('gdMvCount'), b = document.getElementById('gdMvGo'), n = gdMvCount(), shown = gdMvRows().length;
    if (c) c.textContent = shown + ' shown / ' + n + ' selected';
    if (b) { b.textContent = n ? 'Move ' + n + ' out' : 'Move out'; b.style.opacity = n && !GD.mv.busy ? '1' : '.45'; b.style.pointerEvents = n && !GD.mv.busy ? 'auto' : 'none'; }
}
function gdMvPick(d, on) { if (on) GD.mv.sel[d] = true; else delete GD.mv.sel[d]; gdMvNav(); }
function gdMvAll(on) { gdMvRows().forEach(function (r) { if (on) GD.mv.sel[r.domain] = true; else delete GD.mv.sel[r.domain]; }); gdMvRenderList(); }
function gdMvApply() {
    var v = GD.mv; if (v.busy) return;
    var list = Object.keys(v.sel).filter(function (k) { return v.sel[k]; }), chunks = [];
    for (var i = 0; i < list.length; i += 10) chunks.push(list.slice(i, i + 10));
    v.confirm = false; v.busy = true; v.done = 0; v.total = list.length; var moved = 0, skipped = 0, why = []; gdMvRender();
    (function next(k) {
        if (k >= chunks.length) { v.busy = false; v.result = { moved: moved, skipped: skipped, why: why }; gdMvRender(); gdLoad(false); if (typeof loadSidebarBrands === 'function') loadSidebarBrands(); return; }
        google.script.run.withSuccessHandler(function (r) { moved += r.moved; skipped += r.skipped.length; why = why.concat(r.skipped); v.done += chunks[k].length; gdMvRender(); next(k + 1); })
            .withFailureHandler(function () { skipped += chunks[k].length; v.done += chunks[k].length; gdMvRender(); next(k + 1); })
            .moveLapsedFromBrands(currentSessionToken, chunks[k]);
    })(0);
}

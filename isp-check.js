// ============================================================
// ISP Check (KPI tab): request domain checks from the portal. The PCs that sit on each ISP (runner.js) pick the jobs up by
// themselves, so nobody opens VS or types a menu. Worker actions: listIspCheck, createIspJobs, cancelIspJob,
// createIspLinkCode, unlinkIspAgent. The PCs talk to the Worker with their own token (ispAgent* actions).
// ============================================================
var ISPC = { data: null, loading: false, timer: null, wiz: null, link: null };
var ISPC_LIST = [['pldt', 'PLDT'], ['globe', 'Globe'], ['converge', 'Converge'], ['dito', 'DITO']];

function ispEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function ispTime(ts) { if (!ts) return null; var d = new Date(String(ts).replace(' ', 'T') + 'Z'); return isNaN(d.getTime()) ? null : d; }
function ispAgo(ts) {
    var d = ispTime(ts); if (!d) return 'never';
    var s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
}
function ispToast(a, b, kind) { if (typeof showPremiumToast === 'function') showPremiumToast(a, b, kind || 'success'); }
function ispIspName(k) { for (var i = 0; i < ISPC_LIST.length; i++) if (ISPC_LIST[i][0] === k) return ISPC_LIST[i][1]; return k || '-'; }

function ispInjectCss() {
    if (document.getElementById('ispStyle')) return;
    var st = document.createElement('style'); st.id = 'ispStyle';
    st.textContent = '#ispRoot, #ispRoot *, #ispModal, #ispModal * { font-family: Montserrat, ui-sans-serif, system-ui, sans-serif; }' +
        '#ispRoot .font-mono, #ispModal .font-mono { font-family: ui-monospace, Menlo, Consolas, monospace; }' +
        '@media (max-width:640px){#ispModal{padding:0!important;align-items:stretch!important}#ispModal>.panel-card{width:100%!important;min-height:100%;border-radius:0!important;box-shadow:none!important}' +
        '#ispModal>.panel-card>div{padding-left:16px!important;padding-right:16px!important}#ispModal>.panel-card>div:last-child{position:sticky;bottom:0;background:var(--bg-panel,#fff);z-index:3}' +
        '#ispModal .isp-lbl-off,#ispModal .isp-line{display:none!important}#ispModal table,#ispRoot table{min-width:560px}#ispModal [style*="max-height"]{max-height:46vh!important}}';
    document.head.appendChild(st);
}

// ---------- the tab ----------
function renderKpiIspTab() {
    var content = document.getElementById('kpiTabContent'); if (!content) return;
    ispInjectCss();
    content.innerHTML = '<div id="ispRoot"></div>';
    ispLoad(true);
    if (ISPC.timer) clearInterval(ISPC.timer);
    ISPC.timer = setInterval(function () { if (!document.getElementById('ispRoot')) { clearInterval(ISPC.timer); ISPC.timer = null; return; } ispLoad(false); }, 10000);
}
function ispLoad(first) {
    if (ISPC.loading) return; ISPC.loading = true;
    google.script.run.withSuccessHandler(function (d) { ISPC.loading = false; ISPC.data = d; ispRender(); if (ISPC.link) ispLinkWatch(); })
        .withFailureHandler(function (e) { ISPC.loading = false; if (first) { var r = document.getElementById('ispRoot'); if (r) r.innerHTML = '<p class="text-sm text-rose-500">' + ispEsc((e && e.message) || 'Could not load.') + '</p>'; } })
        .listIspCheck(currentSessionToken);
}
function ispModel() {
    var d = ISPC.data || { agents: [], jobs: [], brands: [], batches: [] }, per = {};
    ISPC_LIST.forEach(function (x) { per[x[0]] = { online: d.agents.filter(function (a) { return a.online && a.isp === x[0] && a.safe; }), blocked: d.agents.filter(function (a) { return a.online && a.isp === x[0] && !a.safe; }), pending: 0, running: 0, needBrand: 0, needDpv: 0 }; });
    d.jobs.forEach(function (j) { if (per[j.isp]) { if (j.status === 'pending') per[j.isp].pending++; if (j.status === 'running') per[j.isp].running++; } });
    d.brands.forEach(function (b) { ISPC_LIST.forEach(function (x) { per[x[0]].needBrand += +b[x[0]] || 0; }); });
    d.batches.forEach(function (b) { ISPC_LIST.forEach(function (x) { per[x[0]].needDpv += +b[x[0]] || 0; }); });
    return { d: d, per: per };
}
function ispChip(st) {
    var m = { pending: ['Waiting', 'bg-amber-500/15 text-amber-600'], running: ['Running', 'bg-indigo-500/15 text-indigo-500'], done: ['Done', 'bg-emerald-500/15 text-emerald-600'], cancelled: ['Cancelled', 'bg-slate-500/15 text-slate-500'] }[st] || [st, 'bg-slate-500/15 text-slate-500'];
    return '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' + m[1] + '">' + m[0] + '</span>';
}
function ispRender() {
    var root = document.getElementById('ispRoot'); if (!root) return;
    var m = ispModel(), d = m.d;
    var cards = ISPC_LIST.map(function (x) {
        var p = m.per[x[0]], on = p.online.length;
        return '<div class="panel-card p-4"><div class="flex items-center justify-between"><b class="text-sm text-heading">' + x[1] + '</b>' + (on ? '<span class="text-[10px] font-bold text-emerald-600">' + on + ' PC online</span>' : '<span class="text-[10px] font-bold text-amber-600">No PC online</span>') + '</div>' +
            '<p class="text-[11px] text-subtle mt-1" style="min-height:30px">' + (on ? ispEsc(p.online.map(function (a) { return a.username + (a.status === 'working' ? ' (working)' : ''); }).join(', ')) : (p.blocked.length ? 'A PC is online but not allowed: ' + ispEsc(p.blocked[0].unsafeReason) : 'Jobs will wait until a PC on ' + x[1] + ' starts the runner.')) + '</p>' +
            '<div class="grid grid-cols-3 gap-2 mt-3 text-center"><div><div class="text-lg font-black text-heading">' + p.pending + '</div><div class="text-[9px] text-subtle uppercase tracking-wider">Waiting</div></div><div><div class="text-lg font-black text-heading">' + p.running + '</div><div class="text-[9px] text-subtle uppercase tracking-wider">Running</div></div><div><div class="text-lg font-black text-heading">' + (p.needBrand + p.needDpv) + '</div><div class="text-[9px] text-subtle uppercase tracking-wider">To check</div></div></div>' +
            '<button onclick="ispWizOpen(\'' + x[0] + '\')" class="mt-3 w-full px-3 py-2 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Run ' + x[1] + '</button></div>';
    }).join('');
    var jobs = d.jobs.length ? '<table class="w-full text-xs"><thead class="bg-panel"><tr class="text-left text-[10px] text-subtle border-b border-theme"><th class="p-2">Job</th><th class="p-2">What</th><th class="p-2">ISP</th><th class="p-2">Status</th><th class="p-2" style="min-width:150px">Progress</th><th class="p-2">Checked by</th><th class="p-2">Requested</th><th class="p-2"></th></tr></thead><tbody>' +
        d.jobs.map(function (j) {
            var pct = j.total ? Math.min(100, Math.round((j.done + j.failed) / j.total * 100)) : 0;
            return '<tr class="border-b border-theme/60 align-middle"><td class="p-2 text-subtle">#' + j.id + '</td><td class="p-2"><b class="text-heading">' + ispEsc(j.batch) + '</b>' + (j.parts > 1 ? ' <span class="text-[10px] text-subtle">part ' + j.partNo + ' of ' + j.parts + '</span>' : '') + '<div class="text-[10px] text-subtle">' + (j.target === 'brand' ? 'BBC Domain' : 'DPV') + ' &middot; ' + (j.mode === 'retry' ? 'Retry' : 'All domains') + '</div>' + ((j.status === 'pending' || j.status === 'running') && j.note ? '<div class="text-[10px] text-indigo-500 font-bold">' + ispEsc(j.note) + '</div>' : '') + '</td><td class="p-2 font-bold text-body">' + ispIspName(j.isp) + '</td><td class="p-2">' + ispChip(j.status) + '</td>' +
                '<td class="p-2"><div class="h-1.5 rounded bg-app overflow-hidden"><div class="h-1.5 ' + (j.failed ? 'bg-amber-500' : 'bg-emerald-500') + '" style="width:' + pct + '%"></div></div><div class="text-[10px] text-subtle mt-1">' + j.done + ' of ' + j.total + (j.failed ? ' &middot; <b class="text-rose-500">' + j.failed + ' not saved</b>' : '') + '</div></td>' +
                '<td class="p-2 text-body">' + ispEsc(j.agentUser || '-') + (j.note && j.status !== 'pending' && j.status !== 'running' ? '<div class="text-[10px] text-subtle">' + ispEsc(j.note) + '</div>' : '') + '</td><td class="p-2 text-subtle">' + ispEsc(j.createdBy) + '<div class="text-[10px]">' + ispAgo(j.createdAt) + '</div></td>' +
                '<td class="p-2 text-right">' + (j.status === 'pending' || j.status === 'running' ? '<button onclick="ispCancel(' + j.id + ')" class="px-2.5 py-1 bg-panel border border-theme rounded-lg text-[10px] font-bold text-body hover:bg-app">Cancel</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="text-xs text-subtle p-8 text-center">No jobs yet. Press <b>Run check</b> to queue one.</p>';
    var pcs = d.agents.length ? '<table class="w-full text-xs"><thead class="bg-panel"><tr class="text-left text-[10px] text-subtle border-b border-theme"><th class="p-2">PC</th><th class="p-2">Linked to</th><th class="p-2">ISP</th><th class="p-2">Connection</th><th class="p-2">Status</th><th class="p-2">Last seen</th><th class="p-2"></th></tr></thead><tbody>' +
        d.agents.map(function (a) {
            var st = !a.online ? '<span class="text-subtle">Offline</span>' : (!a.safe ? '<span class="text-rose-500 font-bold" title="' + ispEsc(a.unsafeReason) + '">Not allowed</span>' : (a.status === 'working' ? '<span class="text-indigo-500 font-bold">Working (job #' + a.currentJob + ')</span>' : '<span class="text-emerald-600 font-bold">Ready</span>'));
            return '<tr class="border-b border-theme/60 align-middle"><td class="p-2 font-bold text-heading">' + ispEsc(a.label || 'PC') + '</td><td class="p-2 text-body">' + ispEsc(a.username) + '</td><td class="p-2 text-body">' + ispEsc(a.isp ? ispIspName(a.isp) : '-') + '</td><td class="p-2 text-subtle">' + ispEsc(a.netType || '-') + (a.ip ? ' &middot; ' + ispEsc(a.ip) : '') + '<div class="text-[10px] ' + (a.homeConfirmedAt ? 'text-emerald-600' : 'text-amber-600') + '">' + (a.homeConfirmedAt ? 'Home line confirmed by ' + ispEsc(a.username) : 'Home line not confirmed') + '</div></td><td class="p-2">' + st + (a.online && !a.safe ? '<div class="text-[10px] text-subtle" style="max-width:260px">' + ispEsc(a.unsafeReason) + '</div>' : '') + '</td><td class="p-2 text-subtle">' + ispAgo(a.lastSeen) + '</td>' +
                '<td class="p-2 text-right"><button onclick="ispUnlink(' + a.id + ')" class="px-2.5 py-1 bg-panel border border-theme rounded-lg text-[10px] font-bold text-body hover:bg-app">Unlink</button></td></tr>';
        }).join('') + '</tbody></table>' : '<p class="text-xs text-subtle p-8 text-center">No PC is linked yet. Press <b>Link this PC</b> on the computer you use for checking.</p>';
    root.innerHTML = '<div class="flex items-center justify-between flex-wrap gap-3 mb-5"><div><h3 class="text-lg font-black text-heading">ISP Check</h3><p class="text-xs text-subtle mt-0.5">Request a check here. The PC on each ISP picks it up and saves the result under its owner. Refreshes by itself.</p></div>' +
        '<div class="flex items-center gap-2"><button onclick="ispLinkOpen()" class="px-4 py-2 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app shadow-sm">Link this PC</button><button onclick="ispWizOpen()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 shadow-sm">Run check</button></div></div>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">' + cards + '</div>' +
        '<h4 class="text-xs font-black text-heading uppercase tracking-widest mb-2">Jobs</h4><div class="panel-card overflow-auto mb-6" style="max-height:380px">' + jobs + '</div>' +
        '<h4 class="text-xs font-black text-heading uppercase tracking-widest mb-2">PCs</h4><div class="panel-card overflow-auto">' + pcs + '</div>';
}
function ispCancel(id) {
    var go = function () { google.script.run.withSuccessHandler(function () { ispLoad(false); ispToast('Job cancelled', '#' + id + ' will stop.', 'success'); }).withFailureHandler(function (e) { ispToast('Could not cancel', (e && e.message) || '', 'error'); }).cancelIspJob(currentSessionToken, id); };
    if (typeof showPremiumConfirm === 'function') showPremiumConfirm('Cancel this job?', 'If a PC is already running it, it stops after the domain it is on. Results saved so far stay. A batch that was split into parts is cancelled as a whole.', 'Cancel job', go); else go();
}
function ispUnlink(id) {
    var go = function () { google.script.run.withSuccessHandler(function () { ispLoad(false); }).withFailureHandler(function (e) { ispToast('Could not unlink', (e && e.message) || '', 'error'); }).unlinkIspAgent(currentSessionToken, id); };
    if (typeof showPremiumConfirm === 'function') showPremiumConfirm('Unlink this PC?', 'It stops taking jobs. A job it is running goes back in the queue. You can link it again with a new code.', 'Unlink', go); else go();
}

// ---------- modal shell ----------
function ispModalEl() {
    var m = document.getElementById('ispModal');
    if (!m) {
        m = document.createElement('div'); m.id = 'ispModal';
        m.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(2,6,23,.62);backdrop-filter:blur(3px);display:none;align-items:flex-start;justify-content:center;padding:4vh 16px;overflow-y:auto';
        m.onmousedown = function (e) { if (e.target === m) ispModalClose(); };
        document.body.appendChild(m);
        document.addEventListener('keydown', function (e) { var mm = document.getElementById('ispModal'); if (e.key === 'Escape' && mm && mm.style.display !== 'none') ispModalClose(); });
    }
    return m;
}
function ispModalClose() { var m = document.getElementById('ispModal'); if (m) m.style.display = 'none'; if (ISPC.wiz && ISPC.wiz.step < 4) ISPC.wiz = null; ISPC.link = null; ispLoad(false); }
function ispShell(title, sub, stepper, body, footer, width) {
    var m = ispModalEl();
    m.innerHTML = '<div class="panel-card" style="position:relative;width:min(' + (width || 900) + 'px,100%);padding:0;border-radius:1rem;box-shadow:0 30px 70px rgba(0,0,0,.45)">' +
        '<div style="padding:22px 26px 16px;border-bottom:1px solid var(--border-theme)"><div class="flex items-start justify-between gap-4"><div><h3 class="text-lg font-black text-heading">' + title + '</h3><p class="text-[11px] text-subtle mt-1">' + sub + '</p></div><button onclick="ispModalClose()" class="text-subtle hover:text-body text-xl leading-none">&times;</button></div>' + (stepper || '') + '</div>' +
        '<div style="padding:20px 26px">' + body + '</div>' +
        '<div style="padding:14px 26px;border-top:1px solid var(--border-theme);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' + footer + '</div></div>';
    m.style.display = 'flex';
}
function ispStepper(names, cur) {
    return '<div class="flex items-center gap-2 flex-wrap mt-4">' + names.map(function (s, i) {
        var k = i + 1, on = cur === k, done = cur > k;
        return '<div class="flex items-center gap-2"><span class="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black ' + (on ? 'bg-indigo-600 text-white' : done ? 'bg-emerald-500 text-white' : 'bg-app text-subtle border border-theme') + '">' + (done ? '&#10003;' : k) + '</span><span class="text-xs font-bold ' + (on ? 'text-heading' : 'text-subtle isp-lbl-off') + '">' + s + '</span>' + (k < names.length ? '<span class="w-6 h-px bg-current opacity-20 mx-1 isp-line"></span>' : '') + '</div>';
    }).join('') + '</div>';
}

// ---------- Run check wizard ----------
var ISPC_STEPS = ['What to check', 'ISP and mode', 'Review', 'Queued'];
function ispWizOpen(isp) {
    if (!ISPC.data) { ispToast('Please wait', 'Still loading.', 'warning'); return; }
    ISPC.wiz = { step: 1, target: 'brand', picked: {}, q: '', isps: isp ? [isp] : ISPC_LIST.map(function (x) { return x[0]; }), mode: 'all', busy: false, res: null };
    ispWizRender();
}
function ispWizRows() {
    var w = ISPC.wiz, d = ISPC.data, rows = (w.target === 'brand' ? d.brands : d.batches), q = w.q.trim().toLowerCase();
    return rows.filter(function (r) { return !q || String(r.name).toLowerCase().indexOf(q) !== -1; });
}
function ispWizNeed(r) { var w = ISPC.wiz; return w.isps.reduce(function (a, k) { return a + (w.mode === 'retry' ? (+r[k] || 0) : (+r.total || 0)); }, 0); }
function ispWizRender() {
    var w = ISPC.wiz; if (!w) return;
    var body = '', footer = '', cnt = Object.keys(w.picked).length;
    if (w.step === 1) {
        body = '<div class="flex items-center justify-between flex-wrap gap-3 mb-3"><div class="inline-flex gap-0.5 bg-app border border-theme rounded-xl p-1">' + [['brand', 'BBC Domain (brands)'], ['dpv', 'DPV (batches)']].map(function (t) { return '<button onclick="ISPC.wiz.target=\'' + t[0] + '\';ISPC.wiz.picked={};ispWizRender()" class="px-4 py-1.5 rounded-lg text-xs font-bold ' + (w.target === t[0] ? 'bg-indigo-600 text-white shadow-sm' : 'text-subtle hover:text-body') + '">' + t[1] + '</button>'; }).join('') + '</div>' +
            '<input id="ispWizQ" oninput="ISPC.wiz.q=this.value;ispWizList()" value="' + ispEsc(w.q) + '" placeholder="Search..." class="px-3 py-2 bg-app border border-theme rounded-xl text-xs text-body focus:outline-none" style="width:200px;max-width:100%"></div>' +
            '<div id="ispWizList" class="overflow-auto border border-theme rounded-xl" style="max-height:340px"></div><p class="text-[11px] text-subtle mt-2">The numbers under each ISP are the domains that still have no result or a NO_IMAGE.</p>';
        footer = '<div class="flex items-center gap-3"><button onclick="ispModalClose()" class="px-4 py-2.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Cancel</button><span id="ispWizCnt" class="text-[11px] text-subtle">' + cnt + ' selected</span></div><button id="ispWizNext" ' + (cnt ? '' : 'disabled style="opacity:.4"') + ' onclick="ISPC.wiz.step=2;ispWizRender()" class="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700">Next: ISP and mode</button>';
    } else if (w.step === 2) {
        var m = ispModel();
        var fixedRow = w.fixed ? (ISPC.data.brands || []).filter(function (x) { return w.picked[x.name]; })[0] : null;
        body = (fixedRow ? '<div class="mb-4 p-3 rounded-xl bg-app border border-theme text-xs text-body">Checking <b class="text-heading">' + ispEsc(fixedRow.name) + '</b> &middot; ' + fixedRow.total + ' domains</div>' : '') + '<p class="text-xs font-black text-heading mb-2">Which ISPs?</p><div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' + ISPC_LIST.map(function (x) {
            var on = w.isps.indexOf(x[0]) !== -1, p = m.per[x[0]];
            return '<label class="flex items-start gap-3 p-3 rounded-xl border ' + (on ? 'border-indigo-500/60 bg-indigo-500/5' : 'border-theme') + ' cursor-pointer"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="ispWizToggleIsp(\'' + x[0] + '\',this.checked)" class="mt-0.5"><span><b class="text-sm text-heading">' + x[1] + '</b><br><span class="text-[11px] ' + (p.online.length ? 'text-emerald-600' : 'text-amber-600') + '">' + (p.online.length ? p.online.length + ' PC online' : 'No PC online right now') + '</span></span></label>';
        }).join('') + '</div>' +
            '<p class="text-xs font-black text-heading mt-5 mb-2">Which domains?</p><div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' + [['all', 'All domains', 'Check every domain again.'], ['retry', 'Retry only', 'Only the ones with no result or NO_IMAGE for that ISP.']].map(function (t) {
                return '<label class="flex items-start gap-3 p-3 rounded-xl border ' + (w.mode === t[0] ? 'border-indigo-500/60 bg-indigo-500/5' : 'border-theme') + ' cursor-pointer"><input type="radio" name="ispMode" ' + (w.mode === t[0] ? 'checked' : '') + ' onchange="ISPC.wiz.mode=\'' + t[0] + '\';ispWizRender()" class="mt-0.5"><span><b class="text-sm text-heading">' + t[1] + '</b><br><span class="text-[11px] text-subtle">' + t[2] + '</span></span></label>';
            }).join('') + '</div>';
        footer = (w.fixed ? '<button onclick="ispModalClose()" class="px-4 py-2.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Cancel</button>' : '<button onclick="ISPC.wiz.step=1;ispWizRender()" class="px-4 py-2.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Back</button>') + '<button ' + (w.isps.length ? '' : 'disabled style="opacity:.4"') + ' onclick="ISPC.wiz.step=3;ispWizRender()" class="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700">Next: review</button>';
    } else if (w.step === 3) {
        var mm = ispModel(), rowsAll = (w.target === 'brand' ? ISPC.data.brands : ISPC.data.batches).filter(function (r) { return w.picked[r.name]; });
        var jobsN = 0, doms = 0;
        var table = '<table class="w-full text-xs"><thead class="bg-panel"><tr class="text-left text-[10px] text-subtle border-b border-theme"><th class="p-2">' + (w.target === 'brand' ? 'Brand' : 'Batch') + '</th>' + w.isps.map(function (k) { return '<th class="p-2 text-center">' + ispIspName(k) + '</th>'; }).join('') + '</tr></thead><tbody>' + rowsAll.map(function (r) {
            return '<tr class="border-b border-theme/60"><td class="p-2 font-bold text-heading">' + ispEsc(r.name) + '</td>' + w.isps.map(function (k) { var n = w.mode === 'retry' ? (+r[k] || 0) : (+r.total || 0); if (n) { jobsN++; doms += n; } return '<td class="p-2 text-center ' + (n ? 'text-body' : 'text-subtle') + '">' + (n || '-') + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
        var warn = w.isps.filter(function (k) { return !mm.per[k].online.length; });
        body = '<div class="flex items-center gap-4 text-xs mb-3"><b class="text-emerald-600">' + jobsN + ' job' + (jobsN === 1 ? '' : 's') + '</b><span class="text-subtle">' + doms + ' domain checks in total</span><span class="text-subtle">' + (w.mode === 'retry' ? 'Retry only' : 'All domains') + '</span></div>' +
            '<div class="overflow-auto border border-theme rounded-xl" style="max-height:300px">' + table + '</div>' +
            '<p class="text-[11px] text-subtle mt-2">A batch with more than 100 domains is split into parts of 100, so several PCs on the same ISP can share it.</p>' + (warn.length ? '<div class="mt-3 p-3 rounded-xl border border-amber-500/40 bg-amber-500/5 text-xs text-body"><b>No PC is online for ' + warn.map(ispIspName).join(', ') + '.</b> Those jobs will wait in the queue until a PC on that ISP starts the runner.</div>' : '');
        footer = '<button onclick="ISPC.wiz.step=2;ispWizRender()" class="px-4 py-2.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">Back</button><button ' + (jobsN && !w.busy ? '' : 'disabled style="opacity:.4"') + ' onclick="ispWizSubmit()" class="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700">' + (w.busy ? 'Queuing...' : 'Queue ' + jobsN + ' job' + (jobsN === 1 ? '' : 's')) + '</button>';
    } else {
        var r = w.res || { created: [], skipped: [] };
        body = '<div class="flex items-center gap-4"><div class="text-3xl font-black text-emerald-500">' + r.created.length + '<span class="text-sm text-subtle font-bold"> queued</span></div>' + (r.skipped.length ? '<b class="text-amber-600 text-xs">' + r.skipped.length + ' skipped</b>' : '') + '</div>' +
            '<p class="text-[11px] text-subtle mt-1">The PCs pick these up by themselves. Follow the progress in the Jobs list.' + (r.created.some(function (c) { return c.parts > 1; }) ? ' Big batches were split into parts of 100 domains (' + r.created.reduce(function (a, c) { return a + (c.parts || 1); }, 0) + ' jobs in all).' : '') + '</p>' +
            (r.skipped.length ? '<div class="mt-3 overflow-auto border border-theme rounded-xl" style="max-height:240px"><table class="w-full text-xs"><tbody>' + r.skipped.map(function (s) { return '<tr class="border-b border-theme/60"><td class="p-2 font-bold text-heading">' + ispEsc(s.batch) + '</td><td class="p-2 text-body">' + ispIspName(s.isp) + '</td><td class="p-2 text-subtle">' + ispEsc(s.reason) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '');
        footer = '<span></span><button onclick="ISPC.wiz=null;ispModalClose()" class="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700">Done</button>';
    }
    ispShell('<span class="flex items-center gap-2">Run check</span>', 'Queue domain checks. Each PC saves its results under the account it is linked to.', ispStepper(ISPC_STEPS, w.step), body, footer, 900);
    if (w.step === 1) ispWizList();
}
function ispWizList() {
    var w = ISPC.wiz, el = document.getElementById('ispWizList'); if (!el) return;
    var rows = ispWizRows();
    el.innerHTML = rows.length ? '<table class="w-full text-xs"><thead class="sticky top-0 bg-panel"><tr class="text-left text-[10px] text-subtle border-b border-theme"><th class="p-2" style="width:34px"><input type="checkbox" onchange="ispWizAll(this.checked)"></th><th class="p-2">' + (w.target === 'brand' ? 'Brand' : 'Batch') + '</th><th class="p-2 text-center">Domains</th>' + ISPC_LIST.map(function (x) { return '<th class="p-2 text-center">' + x[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r, i) { return '<tr class="border-b border-theme/60"><td class="p-2"><input type="checkbox" ' + (w.picked[r.name] ? 'checked' : '') + ' onchange="ispWizPick(' + i + ',this.checked)"></td><td class="p-2 font-bold text-heading">' + ispEsc(r.name) + '</td><td class="p-2 text-center text-body">' + r.total + '</td>' + ISPC_LIST.map(function (x) { var n = +r[x[0]] || 0; return '<td class="p-2 text-center ' + (n ? 'text-amber-600 font-bold' : 'text-subtle') + '">' + (n || '-') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>' : '<p class="text-xs text-subtle p-8 text-center">Nothing matches.</p>';
    ispWizCounter();
}
function ispWizCounter() {
    var w = ISPC.wiz; if (!w) return; var cnt = Object.keys(w.picked).length;
    var c = document.getElementById('ispWizCnt'); if (c) c.textContent = cnt + ' selected';
    var nb = document.getElementById('ispWizNext'); if (nb) { nb.disabled = !cnt; nb.style.opacity = cnt ? '' : '.4'; }
}
function ispWizPick(i, on) { var r = ispWizRows()[i]; if (!r) return; if (on) ISPC.wiz.picked[r.name] = true; else delete ISPC.wiz.picked[r.name]; ispWizCounter(); }
function ispWizAll(on) { ispWizRows().forEach(function (r) { if (on) ISPC.wiz.picked[r.name] = true; else delete ISPC.wiz.picked[r.name]; }); ispWizList(); }
function ispWizToggleIsp(k, on) { var w = ISPC.wiz, i = w.isps.indexOf(k); if (on && i === -1) w.isps.push(k); if (!on && i !== -1) w.isps.splice(i, 1); ispWizRender(); }
function ispWizSubmit() {
    var w = ISPC.wiz; if (!w || w.busy) return; w.busy = true; ispWizRender();
    google.script.run.withSuccessHandler(function (res) { w.busy = false; w.res = res; w.step = 4; ispWizRender(); ispLoad(false); })
        .withFailureHandler(function (e) { w.busy = false; ispWizRender(); ispToast('Could not queue', (e && e.message) || 'Try again.', 'error'); })
        .createIspJobs(currentSessionToken, { target: w.target, batches: Object.keys(w.picked), isps: w.isps, mode: w.mode });
}

// ---------- Link this PC ----------
function ispLinkOpen() {
    ISPC.link = { code: '', busy: false, before: ISPC.data ? ISPC.data.agents.length : 0, linked: null, expires: 0 };
    ispLinkRender();
}
function ispLinkMake() {
    var l = ISPC.link; if (!l || l.busy) return; l.busy = true; ispLinkRender();
    google.script.run.withSuccessHandler(function (r) { l.busy = false; l.code = r.code; l.expires = Date.now() + r.minutes * 60000; l.before = ISPC.data ? ISPC.data.agents.length : 0; ispLinkRender(); ispLinkWatch(); })
        .withFailureHandler(function (e) { l.busy = false; ispLinkRender(); ispToast('Could not make a code', (e && e.message) || '', 'error'); }).createIspLinkCode(currentSessionToken);
}
// While the code is on screen, look again every 4 seconds until the PC shows up in the list.
function ispLinkWatch() {
    var l = ISPC.link; if (!l || !l.code || l.linked) return;
    var d = ISPC.data; if (!d) return;
    if (d.agents.length > l.before) { l.linked = d.agents.slice().sort(function (a, b) { return b.id - a.id; })[0]; ispLinkRender(); return; }
    setTimeout(function () { if (ISPC.link === l && !l.linked) ispLoad(false); }, 4000);
}
function ispLinkRender() {
    var l = ISPC.link; if (!l) return;
    var me = (typeof currentUser !== 'undefined' && currentUser && currentUser.username) ? currentUser.username : 'your account';
    var body;
    if (l.linked) body = '<div class="text-center py-4"><div class="text-4xl text-emerald-500 font-black">&#10003;</div><p class="text-sm font-bold text-heading mt-2">' + ispEsc(l.linked.label || 'This PC') + ' is linked</p><p class="text-xs text-subtle mt-1">Every check it runs is saved under <b>' + ispEsc(l.linked.username) + '</b>.</p></div>';
    else if (!l.code) body = '<p class="text-xs text-body">Do this on the computer you use for checking, while you are logged in here as yourself. The PC will then work under your account, so the KPI credit goes to you automatically.</p><button onclick="ispLinkMake()" class="mt-4 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700">' + (l.busy ? 'Making...' : 'Make a code') + '</button>';
    else body = '<p class="text-xs text-body">On that PC, open the bot folder (<b>CICC_Playwright_Bot</b>) and <b>double-click <span class="font-mono">setup.bat</span></b>. Paste this code when it asks. It does the rest: link, Google Drive sign-in, and starting by itself at log-in.</p><div class="mt-3 p-4 rounded-xl bg-app border border-theme"><div class="text-[10px] text-subtle uppercase tracking-widest">Code (valid 10 minutes)</div><div class="text-3xl font-black text-heading font-mono tracking-widest mt-1">' + ispEsc(l.code) + '</div></div>' +
        '<p class="text-[11px] text-subtle mt-3">Or by hand, in a terminal in that folder:</p><pre class="mt-1 p-3 rounded-xl bg-app border border-theme text-[11px] font-mono text-body overflow-auto">node runner.js --link ' + ispEsc(l.code) + '\nnode runner.js --drive      (once, signs in to Google Drive)\nstart.bat                  (starts the runner)</pre><p class="text-[11px] text-subtle mt-3">Waiting for the PC to link... this window updates by itself.</p>';
    ispShell('Link this PC', 'Connects a computer to ' + ispEsc(me) + '.', '', body, '<span></span><button onclick="ispModalClose()" class="px-4 py-2.5 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app">' + (l.linked ? 'Done' : 'Close') + '</button>', 620);
}

// ---------- from a brand page: "Run ISP check" (all ISPs) or a click on one ISP column ----------
function ispRunBrand(brand, isp) {
    ispInjectCss();
    var open = function () {
        var b = (ISPC.data.brands || []).filter(function (x) { return String(x.name).toLowerCase() === String(brand).toLowerCase(); })[0];
        if (!b) { ispToast('Nothing to check', 'This brand has no domains yet.', 'warning'); return; }
        var picked = {}; picked[b.name] = true;
        ISPC.wiz = { step: 2, fixed: true, target: 'brand', picked: picked, q: '', isps: isp ? [isp] : ISPC_LIST.map(function (x) { return x[0]; }), mode: 'all', busy: false, res: null };
        ispWizRender();
    };
    if (ISPC.data) { open(); ispLoad(false); return; }
    google.script.run.withSuccessHandler(function (d) { ISPC.data = d; open(); })
        .withFailureHandler(function (e) { ispToast('Could not open', (e && e.message) || 'Try again.', 'error'); }).listIspCheck(currentSessionToken);
}

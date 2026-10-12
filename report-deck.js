// ============================================================
// REPORT DECK — live, auto-updating slide report (Super Admin only), shown as a tab in the KPI module.
// Data comes from the Worker actions getReportDeckData and getReportCompetitors every time the tab opens,
// so the slides are always current. Editorial text (problems, roadmap, priorities) lives in RD_* below.
// ============================================================
var RD = { data: null, comp: null, model: null, charts: [], present: false, idx: 0, loadedAt: null, fitBound: false };

var RD_C = { bg: '#070D1A', card: '#0F1B33', border: '#1E2A44', text: '#F1F5F9', sub: '#94A3B8', teal: '#2DD4BF', sky: '#38BDF8', amber: '#F59E0B', rose: '#FB7185', violet: '#A78BFA' };
var RD_ISPS = ['pldt', 'globe', 'converge', 'dito'];
var RD_ISP_NAME = { pldt: 'PLDT', globe: 'Globe', converge: 'Converge', dito: 'DITO' };
var RD_TACTIC_SHORT = ['Jackpot / raffle', 'Tournament', 'Cashback', 'Welcome', 'VIP / loyalty', 'Reload / boost', 'Referral'];

// ---- editorial content (edit here) ----
var RD_PROBLEMS = [
    ['Cross-team duplicates silently dropped on bulk upload', 'A 136-domain paste saved 116 with no explanation', 'Global duplicate check before upload plus a report of skipped domains', 'Resolved'],
    ['Daily brand status had no proof of work', 'Updates could not be verified', function (m) { return 'Daily Brand Status checklist with required screenshot: ' + m.brandStatus.c + ' updates in ' + m.brandStatus.days + ' days'; }, 'Resolved'],
    ['Competitor promo tracking lived in a separate sheet', 'No KPI credit, no roll-up view', function (m) { return 'Apps Script sync into KPIs plus a date-grouped summary: ' + m.promoSync.c + ' syncs'; }, 'Resolved'],
    ['ISP check results had no owner', 'Could not tell who verified what', function (m) { return 'Per-operator attribution: ' + rdN(m.checks.total) + ' checks logged. Team 001 operator runs not yet logged'; }, 'Partly resolved'],
    ['Attendance and day-off gaps', 'RD, leave and day-offs misreported; deletes did not clear', 'Grid overlays, day-off edit and delete fixes, OT request flow with export', 'Resolved'],
    ['Verification backlog', function (m) { return rdN(m.waiting) + ' domains missing ISP results; DITO ' + m.ispPending.dito + '% pending'; }, 'Roadmap: shared checker coverage, legacy triage, queue alerts', 'Open']
];

function rdRoadmap(m) {
    return [
        { name: 'NOW', span: '0-2 weeks', color: RD_C.rose, items: [
            ['Share checker coverage', 'Team 002 operators already ran ' + rdN(m.t1CrossChecked) + ' Team 001 domains. Add Team 001 operators; ' + rdN(m.T1.waiting) + ' still await a full result.'],
            ['Triage legacy batches', m.oldWaitingBatches + ' waiting batches are older than 7 days (' + rdN(m.oldWaitingDomains) + ' domains). Mark each Verify or Archive.'],
            ['Queue-age alerts', 'Telegram alert when any batch waits over 48 hours with no result.']] },
        { name: 'NEXT', span: '2-6 weeks', color: RD_C.amber, items: [
            ['Check history log', 'Keep every status change to measure time-to-block and catch re-activations.'],
            ['Redirect follow-up queue', rdN(m.tot.anyRedirect) + ' DPV domains redirect on at least one ISP. Add them to the follow-up report.'],
            ['Data hygiene guards', 'Require an agent on every upload (' + rdN(m.unlinkedUploads) + ' are unlinked), standardize the ' + m.brandCount + '-brand list, keep batch IDs unique.']] },
        { name: 'LATER', span: '6+ weeks', color: RD_C.sky, items: [
            ['DITO verification capacity', 'DITO is ' + m.ispPending.dito + '% pending vs ' + m.ispPending.globe + '% for Globe. Add dedicated capacity.'],
            ['One-click executive report', 'This live deck replaces the monthly export: open it any time for current numbers.'],
            ['Security hardening', 'Rotate the shared automation key and move integration secrets out of source scripts.']] }
    ];
}

// ---- small helpers ----
function rdN(v) { return Number(v || 0).toLocaleString('en-US'); }
function rdPct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
function rdPct1(a, b) { return b > 0 ? Math.round((a / b) * 1000) / 10 : 0; }
function rdEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function rdTeamLabel(t) {
    var s = String(t || '').trim(), l = s.toLowerCase();
    if (l === 'team 001') return 'Team 001';
    if (l === 'team 002') return 'Team 002';
    if (l === 'tcg batch') return 'TCG Batch';
    if (l === 'kyle batch') return 'Kyle Batch';
    return s || 'Other';
}
function rdSheetUrl(compName, row) {
    var c = (RD.comp && RD.comp.competitors || []).filter(function (x) { return x.name === compName; })[0];
    if (!c || !RD.comp) return '#';
    return 'https://docs.google.com/spreadsheets/d/' + RD.comp.sheetId + '/edit#gid=' + c.gid + (row ? '&range=D' + row : '');
}
function rdDateLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ---- model: everything derived from the raw Worker data ----
function rdBuildModel(d, comp) {
    var m = {};
    m.tot = d.dpv.totals;
    m.total = +m.tot.total;
    m.waiting = +m.tot.waiting;
    m.verified = m.total - m.waiting;
    m.isp = d.dpv.isp;
    m.ispBlockRate = {}; m.ispPending = {};
    var blockedRes = 0, pendingRes = 0, totalRes = 0;
    m.isp.forEach(function (r) {
        m.ispBlockRate[r.isp] = rdPct(r.blocked, r.total - r.waiting);
        m.ispPending[r.isp] = rdPct(r.waiting, r.total);
        blockedRes += +r.blocked; pendingRes += +r.waiting; totalRes += +r.total;
    });
    m.blockedRes = blockedRes; m.checkedRes = totalRes - pendingRes;
    m.blockRate = rdPct(blockedRes, m.checkedRes);

    // batches
    var cut = new Date(new Date(d.asOf).getTime() - 7 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    m.batches = d.dpv.batches.map(function (b) {
        var waiting = +b.waiting, total = +b.total, untouched = +b.untouched;
        var state = waiting === 0 ? 'verified' : (untouched === total ? 'notstarted' : 'partial');
        return { id: b.batchId, team: rdTeamLabel(b.team), total: total, waiting: waiting, untouched: untouched, first: b.firstUpload || '', state: state };
    });
    m.batchCount = m.batches.length;
    m.batchesWaiting = m.batches.filter(function (b) { return b.waiting > 0; }).length;
    m.batchesNotStarted = m.batches.filter(function (b) { return b.state === 'notstarted'; }).length;
    m.batchesPartial = m.batches.filter(function (b) { return b.state === 'partial'; }).length;
    m.batchesVerified = m.batches.filter(function (b) { return b.state === 'verified'; }).length;
    var old = m.batches.filter(function (b) { return b.waiting > 0 && b.first < cut; });
    m.oldWaitingBatches = old.length;
    m.oldWaitingDomains = old.reduce(function (s, b) { return s + b.waiting; }, 0);
    m.notStartedDomains = m.batches.reduce(function (s, b) { return s + b.untouched; }, 0);
    m.partialDomains = m.waiting - m.notStartedDomains;
    m.topWaiting = m.batches.filter(function (b) { return b.waiting > 0; }).sort(function (a, b) { return b.waiting - a.waiting; }).slice(0, 6);

    // teams
    m.teams = {};
    function team(k) {
        return (m.teams[k] = m.teams[k] || { total: 0, all4: 0, active: 0, waiting: 0, batches: 0, verified: 0, partial: 0, notstarted: 0 });
    }
    ['Team 001', 'Team 002', 'TCG Batch', 'Kyle Batch'].forEach(team);
    d.dpv.byTeam.forEach(function (t) {
        var o = team(rdTeamLabel(t.team));
        o.total += +t.total; o.all4 += +t.all4Blocked; o.active += +t.anyActive; o.waiting += +t.waiting;
    });
    m.batches.forEach(function (b) { var o = team(b.team); o.batches++; o[b.state]++; });
    m.T1 = m.teams['Team 001']; m.T2 = m.teams['Team 002']; m.TCG = m.teams['TCG Batch']; m.KYLE = m.teams['Kyle Batch'];
    m.legacyDomains = m.TCG.total + m.KYLE.total;

    // who checked which team's domains (operators check across teams)
    function crossChecked(domainTeam) {
        return d.checks.domainsByOperatorTeam.filter(function (r) { return rdTeamLabel(r.domainTeam) === domainTeam; })
            .reduce(function (s, r) { return s + (+r.uniq); }, 0);
    }
    m.t1CrossChecked = crossChecked('Team 001');
    m.legacyChecked = crossChecked('TCG Batch') + crossChecked('Kyle Batch');

    m.checks = { total: +d.checks.totals.total, uniq: +d.checks.totals.uniq, first: d.checks.totals.first, last: d.checks.totals.last };
    m.operators = d.checks.byOperator.filter(function (o) { return o.name; });
    m.unlinkedUploads = +d.uploads.unlinked;
    m.brands = d.bbc.brands.map(function (b) { return { brand: b.brand, total: +b.total, activePct: rdPct(b.anyActive, b.total), blockedPct: rdPct(b.all4Blocked, b.total) }; });
    m.brandCount = m.brands.length;
    m.bbcTotal = +d.bbc.totals.total;
    m.brandStatus = d.checklist.filter(function (c) { return c.category === 'brand_status'; })[0] || { c: 0, days: 0 };
    m.promoSync = d.checklist.filter(function (c) { return c.category === 'competitor_promo'; })[0] || { c: 0, days: 0 };

    // uploads
    m.monthTotals = {};
    d.uploads.byMonth.forEach(function (r) { m.monthTotals[r.m] = (m.monthTotals[r.m] || 0) + (+r.c); });
    m.months = Object.keys(m.monthTotals).sort();

    // competitors
    m.comp = null;
    if (comp && comp.competitors) {
        var list = comp.competitors.map(function (c) {
            var t = comp.tactics.map(function () { return []; });
            c.entries.forEach(function (e) { e.tactics.forEach(function (ti) { t[ti].push(e); }); });
            return { name: c.name, gid: c.gid, error: c.error, c: c.entries.length, entries: c.entries, byTactic: t };
        }).sort(function (a, b) { return b.c - a.c; });
        var tactTotals = comp.tactics.map(function (_, ti) { return list.reduce(function (s, c) { return s + c.byTactic[ti].length; }, 0); });
        m.comp = { list: list, tactics: comp.tactics, tactTotals: tactTotals, totalCampaigns: list.reduce(function (s, c) { return s + c.c; }, 0) };
    }
    return m;
}

// ---- slide kit ----
function rdStat(label, val, sub, color) {
    return '<div class="rd-card rd-stat"><div class="rd-val" style="color:' + color + '">' + val + '</div><div class="rd-lab">' + rdEsc(label) + '</div>' + (sub ? '<div class="rd-sub">' + sub + '</div>' : '') + '</div>';
}
function rdFrame(i, total, title, subtitle, body, opts) {
    opts = opts || {};
    return '<div class="rd-head"><div class="rd-title">' + title + '</div>' + (subtitle ? '<div class="rd-subtitle">' + subtitle + '</div>' : '') + '</div>' +
        '<div class="rd-body">' + body + '</div>' +
        '<div class="rd-foot"><span>CYBERGUARD PH &nbsp;|&nbsp; REPORTING</span><span>' + (i + 1) + ' / ' + total + '</span></div>';
}
function rdCanvas(id, w, h) { return '<canvas id="' + id + '" width="' + w + '" height="' + h + '" style="width:' + w + 'px;height:' + h + 'px"></canvas>'; }
function rdAddChart(cfg) { RD.charts.push(cfg); }
function rdTable(headers, rows, colWidths) {
    var h = '<table class="rd-table"><thead><tr>' + headers.map(function (x, i) { return '<th' + (i === 0 ? ' style="text-align:left"' : '') + '>' + rdEsc(x) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) { h += '<tr>' + r.map(function (c, i) { return '<td' + (i === 0 ? ' style="text-align:left;font-weight:700"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; });
    return h + '</tbody></table>';
}

// ---- slides ----
function rdSlides(m, d) {
    var S = []; // each: function(i,total) -> html
    var asOf = rdDateLabel(d.asOf);

    // 1. Title
    S.push(function (i, n) {
        return '<div class="rd-title-slide"><div class="rd-eyebrow">CYBERGUARD PH</div><div class="rd-hero">Domain Protection<br>Performance Report</div>' +
            '<div class="rd-chiplist">Blocking &nbsp;|&nbsp; Backlog &nbsp;|&nbsp; Teams &nbsp;|&nbsp; Competitor strategy &nbsp;|&nbsp; Roadmap</div>' +
            '<div class="rd-asof">Live data as of ' + rdEsc(asOf) + ' ' + rdEsc(new Date(d.asOf).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })) + '</div></div>';
    });

    // 2. Executive summary
    S.push(function (i, n) {
        var body = '<div class="rd-grid4">' +
            rdStat('Domains monitored', rdN(m.total + m.bbcTotal), rdN(m.total) + ' DPV + ' + rdN(m.bbcTotal) + ' BBC', RD_C.sky) +
            rdStat('ISP checks blocked', m.blockRate + '%', 'Completed DPV ISP checks', RD_C.teal) +
            rdStat('DPV domains still waiting', rdN(m.waiting), rdPct(m.waiting, m.total) + '% need at least one more ISP result', RD_C.amber) +
            rdStat('Batches with pending results', m.batchesWaiting + ' / ' + m.batchCount, rdN(m.batchesNotStarted) + ' have no ISP result at all', RD_C.rose) +
            '</div><div class="rd-grid3" style="margin-top:22px">' +
            rdTake('Blocking is effective', 'DPV: ' + rdN(m.tot.all4Blocked) + ' domains are blocked on all 4 ISPs, and ' + m.blockRate + '% of completed ISP checks come back BLOCKED.', RD_C.teal) +
            rdTake('Backlog is the main risk', rdPct(m.oldWaitingDomains, m.waiting) + '% of waiting domains (' + rdN(m.oldWaitingDomains) + ') were uploaded more than 7 days ago. Team 001 holds ' + rdPct(m.T1.waiting, m.waiting) + '% of all pending domains.', RD_C.amber) +
            rdTake('Next: close and automate', 'Add Team 001 checker operators, triage legacy batches, and alert on any batch waiting over 48 hours.', RD_C.sky) + '</div>';
        return rdFrame(i, n, 'Executive Summary', 'Blocking works where we have verified. The risk is the verification backlog.', body);
    });

    // 3. Teams
    S.push(function (i, n) {
        var names = function (t) { return d.members.filter(function (x) { return rdTeamLabel(x.team) === t; }).map(function (x) { return x.name; }); };
        function card(name, color, t) {
            var mem = names(name);
            return '<div class="rd-card" style="padding:26px 30px"><div style="display:flex;align-items:center;gap:16px;margin-bottom:18px"><div class="rd-badge" style="background:' + color + '33;color:' + color + '">&#9679;</div><div><div style="font-size:30px;font-weight:800">' + name + '</div><div class="rd-sub">Cyberguard Admins</div></div></div>' +
                '<div style="min-height:150px">' + (mem.length ? mem.map(function (x) { return '<div class="rd-member"><span class="rd-avatar" style="background:' + color + '33;color:' + color + '">' + rdEsc(x.split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase()) + '</span>' + rdEsc(x) + '</div>'; }).join('') : '<div class="rd-sub">No members assigned</div>') + '</div>' +
                '<div class="rd-row3"><div><div class="rd-val" style="color:' + color + ';font-size:38px">' + rdN(t.total) + '</div><div class="rd-sub">DPV domains</div></div><div><div class="rd-val" style="color:' + color + ';font-size:38px">' + t.batches + '</div><div class="rd-sub">Batches</div></div><div><div class="rd-val" style="color:' + color + ';font-size:38px">' + rdPct(t.total - t.waiting, t.total) + '%</div><div class="rd-sub">Fully verified</div></div></div></div>';
        }
        var body = '<div class="rd-grid2">' + card('Team 001', RD_C.teal, m.T1) + card('Team 002', RD_C.sky, m.T2) + '</div>' +
            '<div class="rd-note">The ' + rdN(m.total) + ' total also includes ' + rdN(m.legacyDomains) + ' domains in the TCG and Kyle batches (uploaded Aug 18). Team 002 operators verified both.</div>';
        return rdFrame(i, n, 'Meet the Cyberguard Teams', (names('Team 001').length + names('Team 002').length) + ' Cyberguard Admins across two teams manage ' + rdN(m.total) + ' DPV domains and the BBC portfolio.', body);
    });

    // 4. ISP status
    S.push(function (i, n) {
        var order = RD_ISPS;
        var cid = 'rdc_isp';
        rdAddChart({
            id: cid, type: 'bar',
            data: { labels: order.map(function (k) { return RD_ISP_NAME[k]; }), datasets: [
                { label: 'Blocked', data: order.map(function (k) { return rdPct1(rdIsp(m, k).blocked, m.total); }), backgroundColor: RD_C.teal },
                { label: 'Active', data: order.map(function (k) { return rdPct1(rdIsp(m, k).active, m.total); }), backgroundColor: RD_C.rose },
                { label: 'Pending', data: order.map(function (k) { return rdPct1(rdIsp(m, k).waiting, m.total); }), backgroundColor: '#94A3B8' },
                { label: 'Redirected', data: order.map(function (k) { return rdPct1(rdIsp(m, k).redirected, m.total); }), backgroundColor: RD_C.sky }] },
            options: rdBarOpts({ indexAxis: 'y', stacked: true, labelMin: 4, pos: 'center', suffix: '%', labelColor: '#0B1220', legend: true, max: 100 })
        });
        var rates = order.slice().sort(function (a, b) { return m.ispBlockRate[b] - m.ispBlockRate[a]; });
        var body = '<div style="display:grid;grid-template-columns:7.7fr 3.9fr;gap:24px"><div class="rd-card" style="padding:20px 24px"><div class="rd-card-h">Status share per ISP (% of all DPV domains)</div>' + rdCanvas(cid, 700, 420) + '</div>' +
            '<div><div class="rd-card-h" style="color:' + RD_C.sub + '">Block rate of completed checks</div>' +
            rates.map(function (k) { return '<div class="rd-card" style="display:flex;align-items:center;gap:22px;padding:14px 22px;margin-bottom:12px"><div class="rd-val" style="color:' + RD_C.teal + ';font-size:44px;min-width:110px">' + m.ispBlockRate[k] + '%</div><div><div style="font-size:21px;font-weight:700">' + RD_ISP_NAME[k] + '</div><div class="rd-sub">' + m.ispPending[k] + '% pending</div></div></div>'; }).join('') + '</div></div>';
        return rdFrame(i, n, m.blockRate + '% of ISP Checks Come Back BLOCKED', 'DPV portfolio, ' + rdN(m.total) + ' domains. ' + rdN(m.blockedRes) + ' of ' + rdN(m.checkedRes) + ' completed ISP results are blocked.', body);
    });

    // 5. DPV blocked on all 4
    S.push(function (i, n) {
        var groups = [['Team 001', m.T1], ['Team 002', m.T2], ['TCG batch', m.TCG], ['Kyle batch', m.KYLE]];
        var cid = 'rdc_all4';
        rdAddChart({
            id: cid, type: 'bar',
            data: { labels: groups.map(function (g) { return g[0]; }), datasets: [
                { label: 'Blocked on all 4 ISPs', data: groups.map(function (g) { return rdPct1(g[1].all4, g[1].total); }), backgroundColor: RD_C.teal },
                { label: 'Still pending on 1+ ISP', data: groups.map(function (g) { return rdPct1(g[1].waiting, g[1].total); }), backgroundColor: RD_C.amber }] },
            options: rdBarOpts({ labelMin: 0, pos: 'end', suffix: '%', labelColor: '#E2E8F0', legend: true, max: 110 })
        });
        var body = '<div style="display:grid;grid-template-columns:3.7fr 8.2fr;gap:24px"><div style="display:flex;flex-direction:column;gap:14px">' +
            rdStat('Blocked on all 4 ISPs', rdN(m.tot.all4Blocked), rdPct(m.tot.all4Blocked, m.total) + '% of all DPV domains', RD_C.teal) +
            rdStat('Of verified domains', rdPct(m.tot.all4Blocked, m.verified) + '%', rdN(m.tot.all4Blocked) + ' of ' + rdN(m.verified) + ' with a result on all 4', RD_C.sky) +
            rdStat('Active on at least 1 ISP', rdN(m.tot.anyActive), rdPct(m.tot.anyActive, m.total) + '% still reachable somewhere', RD_C.rose) +
            '</div><div class="rd-card" style="padding:20px 24px"><div class="rd-card-h">Blocked on all 4 ISPs vs still pending, by group (% of group domains)</div>' + rdCanvas(cid, 760, 440) + '</div></div>';
        return rdFrame(i, n, rdN(m.tot.all4Blocked) + ' DPV Domains Blocked on All 4 ISPs', rdPct(m.tot.all4Blocked, m.total) + '% of DPV domains are blocked on all four ISPs. Groups with more verification show higher rates.', body);
    });

    // 6. Backlog / waiting batches
    S.push(function (i, n) {
        var cid = 'rdc_state';
        rdAddChart({
            id: cid, type: 'doughnut',
            data: { labels: ['Fully verified', 'Partly verified', 'No ISP result yet'], datasets: [{ data: [m.verified, m.partialDomains, m.notStartedDomains], backgroundColor: [RD_C.teal, RD_C.amber, RD_C.rose], borderColor: RD_C.card, borderWidth: 3 }] },
            options: { responsive: false, animation: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { color: '#E2E8F0', font: { size: 14 }, padding: 14 } } } }
        });
        var rows = [['Team 001', m.T1], ['Team 002', m.T2], ['TCG batch', m.TCG], ['Kyle batch', m.KYLE]].map(function (r) {
            var t = r[1], wp = rdPct(t.waiting, t.total);
            return [r[0], t.batches, '<span style="color:' + RD_C.teal + '">' + t.verified + '</span>', '<span style="color:' + RD_C.amber + '">' + t.partial + '</span>', '<span style="color:' + RD_C.rose + '">' + t.notstarted + '</span>', rdN(t.waiting), '<b style="color:' + (wp >= 60 ? RD_C.rose : RD_C.text) + '">' + wp + '%</b>'];
        });
        var body = '<div style="display:grid;grid-template-columns:4.6fr 7.4fr;gap:24px"><div class="rd-card" style="padding:20px 24px"><div class="rd-card-h">Where DPV domains stand</div>' + rdCanvas(cid, 400, 420) + '</div>' +
            '<div class="rd-card" style="padding:20px 24px"><div class="rd-card-h">Batches by verification state</div>' + rdTable(['Group', 'Batches', 'Verified', 'Partial', 'Not started', 'Domains waiting', '% waiting'], rows) +
            '<div class="rd-note" style="margin-top:14px;text-align:left"><b>Waiting</b> = at least one of the four ISPs has no result yet. <b>Not started</b> = no ISP has a result. ' + m.batchCount + ' batches in total, ' + m.batchesVerified + ' fully verified.</div></div></div>';
        return rdFrame(i, n, rdN(m.waiting) + ' Domains Waiting for ISP Results', m.batchesWaiting + ' of ' + m.batchCount + ' batches still have at least one ISP pending; ' + m.batchesNotStarted + ' have no result at all.', body);
    });

    // 7. Team 001
    S.push(function (i, n) {
        var body = '<div class="rd-grid3">' +
            rdStat('DPV domains managed', rdN(m.T1.total), m.T1.batches + ' batches', RD_C.teal) +
            rdStat('Blocked on all 4 / still active', '<span style="font-size:40px">' + rdN(m.T1.all4) + ' / ' + rdN(m.T1.active) + '</span>', 'Domains with a recorded outcome', RD_C.sky) +
            rdStat('Fully verified', rdPct(m.T1.total - m.T1.waiting, m.T1.total) + '%', rdN(m.T1.waiting) + ' domains still waiting', RD_C.amber) + '</div>' +
            rdAccomplishments(d, 'Team 001', RD_C.teal);
        return rdFrame(i, n, 'Team 001 Accomplishments', 'Delivered work logged in KPI > Accomplishments, plus the domain volume the team carries.', body);
    });

    // 8. Team 002
    S.push(function (i, n) {
        var cid = 'rdc_ops';
        var ops = m.operators;
        rdAddChart({
            id: cid, type: 'bar',
            data: { labels: ops.map(function (o) { return o.name; }), datasets: [
                { label: 'ISP checks logged', data: ops.map(function (o) { return +o.checks; }), backgroundColor: RD_C.sky },
                { label: 'Unique domains verified', data: ops.map(function (o) { return +o.uniq; }), backgroundColor: RD_C.teal }] },
            options: rdBarOpts({ labelMin: 0, pos: 'end', suffix: '', labelColor: '#E2E8F0', legend: true, int: true })
        });
        var body = '<div class="rd-grid4">' +
            rdStat('DPV domains managed', rdN(m.T2.total), m.T2.batches + ' batches', RD_C.sky) +
            rdStat('Fully verified', rdPct(m.T2.total - m.T2.waiting, m.T2.total) + '%', 'vs ' + rdPct(m.T1.total - m.T1.waiting, m.T1.total) + '% for Team 001', RD_C.teal) +
            rdStat('Blocked on all 4 ISPs', rdN(m.T2.all4), rdPct(m.T2.all4, m.T2.total) + '% of Team 002 domains', RD_C.rose) +
            rdStat('ISP checks logged', rdN(m.checks.total), rdN(m.checks.uniq) + ' unique domains', RD_C.amber) + '</div>' +
            '<div style="display:grid;grid-template-columns:6.9fr 5.1fr;gap:22px;margin-top:20px"><div class="rd-card" style="padding:18px 24px"><div class="rd-card-h">checker.js output per operator (since ' + rdEsc((m.checks.first || '').slice(0, 10)) + ')</div>' + rdCanvas(cid, 600, 250) + '</div>' +
            '<div class="rd-card" style="padding:18px 26px"><div class="rd-card-h">Highlights</div><ul class="rd-list">' +
            '<li>Ran checks on ' + rdN(m.t1CrossChecked) + ' Team 001 domains (' + rdPct(m.t1CrossChecked, m.T1.total) + '% of its portfolio)</li>' +
            ops.slice(0, 3).map(function (o) { return '<li>' + rdEsc(o.name) + ': ' + rdN(o.checks) + ' checks, ' + rdN(o.uniq) + ' unique domains</li>'; }).join('') +
            '<li>' + m.T2.verified + ' of ' + m.T2.batches + ' batches fully verified on all 4 ISPs</li>' +
            '<li>Also checked the TCG and Kyle batches: ' + rdN(m.legacyChecked) + ' of ' + rdN(m.legacyDomains) + ' domains</li></ul></div></div>';
        return rdFrame(i, n, 'Team 002 Accomplishments', rdPct(m.T2.total - m.T2.waiting, m.T2.total) + '% of Team 002 domains are fully verified, and its operators also run checks for Team 001 and the legacy batches.', body);
    });

    // 9. Uploads
    S.push(function (i, n) {
        var cid = 'rdc_upl';
        var byDay = d.uploads.byDay, days = [];
        var end = new Date(d.asOf.slice(0, 10) + 'T00:00:00Z');
        for (var k = 21; k >= 0; k--) days.push(new Date(end.getTime() - k * 86400000).toISOString().slice(0, 10));
        function series(label) { return days.map(function (day) { return byDay.filter(function (r) { return rdTeamLabel(r.team) === label && r.d === day; }).reduce(function (s, r) { return s + (+r.c); }, 0); }); }
        var sets = [{ label: 'Team 001', data: series('Team 001'), borderColor: RD_C.teal, backgroundColor: RD_C.teal }, { label: 'Team 002', data: series('Team 002'), borderColor: RD_C.sky, backgroundColor: RD_C.sky }];
        rdAddChart({
            id: cid, type: 'line',
            data: { labels: days.map(function (x) { return parseInt(x.slice(5, 7), 10) + '/' + parseInt(x.slice(8), 10); }), datasets: sets.map(function (s) { s.borderWidth = 3; s.pointRadius = 4; s.tension = 0.25; return s; }) },
            options: { responsive: false, animation: false, scales: { x: { ticks: { color: '#94A3B8' }, grid: { color: '#16213A' } }, y: { ticks: { color: '#94A3B8' }, grid: { color: '#16213A' }, beginAtZero: true } }, plugins: { legend: { position: 'bottom', labels: { color: '#E2E8F0', font: { size: 14 } } } } }
        });
        var mname = function (k) { var dt = new Date(k + '-01T00:00:00Z'); return dt.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }); };
        var colors = [RD_C.sky, RD_C.teal, RD_C.amber, RD_C.violet, RD_C.rose];
        var months = m.months.slice(-3);
        var body = '<div style="display:grid;grid-template-columns:3.6fr 8.4fr;gap:24px"><div style="display:flex;flex-direction:column;gap:14px">' +
            months.map(function (k, ix) { return rdStat(mname(k) + (ix === months.length - 1 ? ' (month to date)' : ''), rdN(m.monthTotals[k]), 'Domains uploaded', colors[ix % colors.length]); }).join('') +
            '</div><div class="rd-card" style="padding:20px 24px"><div class="rd-card-h">Domains uploaded per day, last 22 days</div>' + rdCanvas(cid, 780, 440) + '</div></div>';
        return rdFrame(i, n, 'Daily Upload Output by Team', 'Uploads arrive in bursts. ' + rdN(m.unlinkedUploads) + ' of ' + rdN(d.uploads.total) + ' DPV domains are not linked to an agent.', body);
    });

    // competitor slides need the Sheet data
    if (!m.comp) {
        S.push(function (i, n) { return rdFrame(i, n, 'Competitor Intelligence', 'The Daily Competitor Promotions Tracker could not be read right now.', '<div class="rd-card" style="padding:40px;font-size:20px;color:' + RD_C.sub + '">Press Refresh to try again. Make sure the sheet is still shared as "Anyone with the link can view".</div>'); });
    } else {
        // 10. intensity
        S.push(function (i, n) {
            var L = m.comp.list, cid = 'rdc_comp';
            rdAddChart({
                id: cid, type: 'bar',
                data: { labels: L.map(function (c) { return c.name; }), datasets: [{ label: 'Campaigns logged', data: L.map(function (c) { return c.c; }), backgroundColor: RD_C.sky }] },
                options: rdBarOpts({ indexAxis: 'y', labelMin: 0, pos: 'end', suffix: '', labelColor: '#E2E8F0', legend: false, int: true, max: Math.ceil(L[0].c * 1.12) })
            });
            var top = m.comp.tactTotals.indexOf(Math.max.apply(null, m.comp.tactTotals));
            var body = '<div style="display:grid;grid-template-columns:3.7fr 8.2fr;gap:24px"><div style="display:flex;flex-direction:column;gap:14px">' +
                rdStat('Competitors tracked', String(L.length), 'Daily Competitor Promotions Tracker', RD_C.sky) +
                rdStat('Distinct campaigns logged', rdN(m.comp.totalCampaigns), L[0].c + ' from ' + rdEsc(L[0].name) + ' alone', RD_C.teal) +
                rdStat('Most common hook', rdPct(m.comp.tactTotals[top], m.comp.totalCampaigns) + '%', rdEsc(m.comp.tactics[top]) + ' (' + m.comp.tactTotals[top] + ' of ' + m.comp.totalCampaigns + ')', RD_C.amber) +
                '</div><div class="rd-card" style="padding:20px 24px"><div class="rd-card-h">Distinct campaigns logged per competitor</div>' + rdCanvas(cid, 760, 440) + '</div></div>';
            return rdFrame(i, n, L.length + ' Competitors, ' + rdN(m.comp.totalCampaigns) + ' Campaigns Logged', rdEsc(L[0].name) + ' and ' + rdEsc(L[1].name) + ' run the most promotions. Logging windows differ, so counts show activity, not market share.', body);
        });

        // 11. heatmap (clickable)
        S.push(function (i, n) {
            var L = m.comp.list, T = m.comp.tactics;
            function cell(ci, ti) {
                var v = L[ci].byTactic[ti].length;
                if (!v) return '<td class="rd-heat0">-</td>';
                var a = v <= 2 ? 0.22 : v <= 6 ? 0.45 : v <= 12 ? 0.70 : 0.92;
                return '<td class="rd-heat" style="background:rgba(45,212,191,' + a + ')" onclick="rdOpenCell(' + ci + ',' + ti + ')" title="Click to see these ' + v + ' promotions">' + v + '</td>';
            }
            var html = '<table class="rd-table rd-heattable"><thead><tr><th style="text-align:left;width:190px">Competitor</th>' + RD_TACTIC_SHORT.map(function (t) { return '<th>' + t + '</th>'; }).join('') + '</tr></thead><tbody>';
            L.forEach(function (c, ci) {
                html += '<tr><td style="text-align:left;font-weight:700"><a href="' + rdSheetUrl(c.name) + '" target="_blank" rel="noopener" class="rd-link">' + rdEsc(c.name) + '  (' + c.c + ')</a></td>' + T.map(function (_, ti) { return cell(ci, ti); }).join('') + '</tr>';
            });
            html += '<tr class="rd-total"><td style="text-align:left">All competitors</td>' + m.comp.tactTotals.map(function (v) { return '<td>' + v + '</td>'; }).join('') + '</tr></tbody></table>';
            var body = html + '<div class="rd-note" style="text-align:left;margin-top:10px">Click a number to see exactly which promotions it counts, with a link to each one in the Tracker sheet. Click a competitor name to open its tab. A campaign can count under several tactics.</div>';
            return rdFrame(i, n, 'How Competitors Compete: Tactic Heatmap', 'Jackpot and prize-drop hooks and tournaments dominate. Referral plays are rare.', body);
        });

        // 12. latest strategy moves
        S.push(function (i, n) {
            var L = m.comp.list;
            var cards = L.map(function (c) {
                var latest = c.entries.slice().sort(function (a, b) { return (b.lastDate || '').localeCompare(a.lastDate || ''); }).slice(0, 2);
                return '<a class="rd-card rd-comp" href="' + rdSheetUrl(c.name) + '" target="_blank" rel="noopener"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:19px;font-weight:800">' + rdEsc(c.name) + '</span><span class="rd-chip">' + c.c + (c.c === 1 ? ' campaign' : ' campaigns') + '</span></div>' +
                    latest.map(function (e) { return '<div class="rd-latest"><span>' + rdEsc(e.title.slice(0, 64)) + (e.title.length > 64 ? '...' : '') + '</span><em>' + rdEsc(e.lastDate || e.date || '') + '</em></div>'; }).join('') + '</a>';
            }).join('');
            return rdFrame(i, n, 'Latest Competitor Moves', 'The two most recently seen promotions per competitor, straight from the Tracker sheet. Click a card to open the competitor tab.', '<div class="rd-compgrid">' + cards + '</div>');
        });

        // 13. implications (computed)
        S.push(function (i, n) {
            var L = m.comp.list, T = m.comp.tactics;
            function withT(ti) { return L.filter(function (c) { return c.byTactic[ti].length > 0; }).length; }
            var ref = 6, refTot = m.comp.tactTotals[ref];
            var items = [
                ['Retention rebates are table stakes', withT(2) + ' of ' + L.length + ' competitors run cashback or rebates (' + m.comp.tactTotals[2] + ' campaigns).', RD_C.teal],
                ['Leaderboards drive daily play', withT(1) + ' of ' + L.length + ' run tournaments or leaderboards (' + m.comp.tactTotals[1] + ' campaigns).', RD_C.amber],
                ['Prize pools make the headlines', 'Jackpot, raffle and prize-drop hooks appear in ' + rdPct(m.comp.tactTotals[0], m.comp.totalCampaigns) + '% of all campaigns.', RD_C.sky],
                ['Welcome offers fuel acquisition', withT(3) + ' of ' + L.length + ' competitors push welcome or free-credit offers (' + m.comp.tactTotals[3] + ' campaigns).', RD_C.violet],
                ['Referral is the least-used tactic', 'Only ' + refTot + ' of ' + m.comp.totalCampaigns + ' campaigns, across ' + withT(ref) + ' competitors.', RD_C.rose]
            ];
            var body = '<div class="rd-grid3" style="grid-template-rows:auto auto">' + items.map(function (it) { return rdTake(it[0], it[1], it[2]); }).join('') +
                rdTake('Improve the logging', 'Entries with only a title limit the analysis. Require Type, Channel and Offer Details on every Tracker entry.', RD_C.sub) + '</div>';
            return rdFrame(i, n, 'What This Means for Promo Planning', 'Patterns computed live from the competitor set.', body);
        });
    }

    // 14. problems
    S.push(function (i, n) {
        var cols = { 'Resolved': RD_C.teal, 'Partly resolved': RD_C.amber, 'Open': RD_C.rose };
        var rows = RD_PROBLEMS.map(function (p) { return [rdEsc(p[0]), '<span style="color:' + RD_C.sub + ';font-weight:400">' + rdEsc(typeof p[1] === 'function' ? p[1](m) : p[1]) + '</span>', '<span style="font-weight:400">' + rdEsc(typeof p[2] === 'function' ? p[2](m) : p[2]) + '</span>', '<b style="color:' + cols[p[3]] + '">' + p[3] + '</b>']; });
        var html = '<table class="rd-table rd-problems"><thead><tr><th style="text-align:left">Problem</th><th style="text-align:left">Impact</th><th style="text-align:left">Solution</th><th>Status</th></tr></thead><tbody>' +
            rows.map(function (r) { return '<tr><td style="text-align:left;font-weight:700">' + r[0] + '</td><td style="text-align:left">' + r[1] + '</td><td style="text-align:left">' + r[2] + '</td><td>' + r[3] + '</td></tr>'; }).join('') + '</tbody></table>';
        return rdFrame(i, n, 'Problems Encountered and Solutions', 'What slowed us down this period, and what we changed.', html);
    });

    // 15. roadmap
    S.push(function (i, n) {
        var waves = rdRoadmap(m), k = 0;
        var body = '<div class="rd-grid3">' + waves.map(function (w) {
            return '<div class="rd-card" style="padding:22px 26px"><div style="margin-bottom:16px"><span class="rd-wave" style="background:' + w.color + '33;color:' + w.color + '">' + w.name + '</span><span class="rd-sub" style="margin-left:12px">' + w.span + '</span></div>' +
                w.items.map(function (it) { k++; return '<div class="rd-step"><div class="rd-stepnum" style="color:' + w.color + '">' + k + '</div><div><div class="rd-steph">' + rdEsc(it[0]) + '</div><div class="rd-stept">' + rdEsc(it[1]) + '</div></div></div>'; }).join('') + '</div>';
        }).join('') + '</div>';
        return rdFrame(i, n, 'Recommended System Flow Upgrades', 'Nine upgrades in three waves, ordered by impact on the verification backlog.', body);
    });

    // 16. priorities
    S.push(function (i, n) {
        var target = Math.max(0, Math.min(40, rdPct(m.waiting, m.total) - 10));
        var items = [
            ['Clear the verification backlog', 'Move pending DPV domains from ' + rdPct(m.waiting, m.total) + '% to under 40%.', RD_C.amber],
            ['Every upload has an owner', '100% of new uploads linked to an agent, with unique batch IDs (' + rdN(m.unlinkedUploads) + ' unlinked today).', RD_C.teal],
            ['Every batch verified within 48 hours', 'No batch waits longer than two days for its first ISP result.', RD_C.sky]
        ];
        var body = '<div style="display:grid;grid-template-columns:4fr 7.6fr;gap:26px"><div class="rd-card" style="padding:28px;display:flex;align-items:center;font-size:24px;font-weight:700;line-height:1.35;color:' + RD_C.teal + '">Close the gap between uploaded and verified.</div><div style="display:flex;flex-direction:column;gap:16px">' +
            items.map(function (it, ix) { return '<div class="rd-card" style="display:flex;align-items:center;gap:22px;padding:22px 26px"><div class="rd-val" style="color:' + it[2] + ';font-size:44px;min-width:50px">' + (ix + 1) + '</div><div><div style="font-size:22px;font-weight:800">' + rdEsc(it[0]) + '</div><div class="rd-sub" style="font-size:16px;margin-top:4px">' + rdEsc(it[1]) + '</div></div></div>'; }).join('') + '</div></div>';
        return rdFrame(i, n, 'Priorities: Next 30 Days', 'Proposed targets, for discussion', body);
    });

    // 17+. brand appendix (owned brands: active = healthy, blocked = needs attention)
    var perPage = 63;
    for (var bp = 0; bp < Math.max(1, Math.ceil(m.brands.length / perPage)); bp++) {
        (function (bp) {
            S.push(function (i, n) {
                var part = m.brands.slice(bp * perPage, (bp + 1) * perPage), cols = [part.slice(0, 21), part.slice(21, 42), part.slice(42, 63)];
                function aC(v) { return v >= 40 ? RD_C.teal : v >= 20 ? RD_C.amber : RD_C.rose; }
                function bC(v) { return v === 0 ? RD_C.teal : v >= 20 ? RD_C.rose : RD_C.text; }
                var body = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">' + cols.map(function (col) {
                    return '<table class="rd-table rd-brands"><thead><tr><th style="text-align:left">Brand</th><th>Domains</th><th>% Active</th><th>% Blocked</th></tr></thead><tbody>' +
                        col.map(function (b) { return '<tr><td style="text-align:left;font-weight:700">' + rdEsc(b.brand) + '</td><td>' + b.total + '</td><td style="color:' + aC(b.activePct) + ';font-weight:700">' + b.activePct + '%</td><td style="color:' + bC(b.blockedPct) + ';font-weight:700">' + b.blockedPct + '%</td></tr>'; }).join('') + '</tbody></table>';
                }).join('') + '</div><div class="rd-note" style="text-align:left;margin-top:8px">Active = reachable on at least one ISP. Blocked = blocked on all 4 ISPs. Green is healthy, red needs attention.</div>';
                return rdFrame(i, n, 'Appendix: BBC Brand Detail' + (m.brands.length > perPage ? ' (' + (bp + 1) + ')' : ''), 'All ' + m.brands.length + ' owned (BBC) brands. Active is healthy. Blocked on all 4 ISPs needs attention.', body);
            });
        })(bp);
    }

    // last. definitions
    S.push(function (i, n) {
        var defs = [
            ['Waiting (pending)', 'A DPV domain with at least one ISP showing no result yet ("-").'],
            ['Fully verified', 'A domain with a result recorded on all four ISPs: PLDT, Globe, Converge and DITO.'],
            ['Blocked on all 4', 'Every one of the four ISPs reports the domain as blocked.'],
            ['Block rate', 'Blocked results divided by completed (non-pending) results. DPV: ' + rdN(m.blockedRes) + ' / ' + rdN(m.checkedRes) + '.'],
            ['Blocked / Active / Redirected / Spare', 'Status recorded per ISP by checker.js or manual update. Spare = reserve domain not in use.'],
            ['Sources and refresh', 'BBC-SEC Domain_Guard database plus the Daily Competitor Promotions Tracker sheet. This deck reloads live every time it is opened or refreshed. Checker attribution begins ' + rdEsc((m.checks.first || '').slice(0, 10)) + '.']
        ];
        var body = '<div class="rd-grid2" style="grid-template-rows:repeat(3,auto)">' + defs.map(function (x) { return '<div class="rd-card" style="padding:20px 24px"><div style="font-size:19px;font-weight:800;color:' + RD_C.teal + '">' + rdEsc(x[0]) + '</div><div class="rd-sub" style="font-size:16px;margin-top:6px;line-height:1.4">' + x[1] + '</div></div>'; }).join('') + '</div>';
        return rdFrame(i, n, 'Appendix: Definitions and Sources', 'How the numbers in this report are calculated.', body);
    });
    return S;
}

function rdIsp(m, k) { return m.isp.filter(function (r) { return r.isp === k; })[0]; }
function rdTake(h, b, color) {
    return '<div class="rd-card" style="padding:22px 26px;border-top:3px solid ' + color + '"><div style="font-size:21px;font-weight:800;margin-bottom:8px">' + rdEsc(h) + '</div><div class="rd-sub" style="font-size:16px;line-height:1.45">' + rdEsc(b) + '</div></div>';
}
function rdAccomplishments(d, teamName, color) {
    var items = d.achievements.filter(function (a) { return rdTeamLabel(a.team) === teamName; }).slice(0, 4);
    if (!items.length) return '<div class="rd-card" style="padding:26px;margin-top:20px;color:' + RD_C.sub + ';font-size:17px">No accomplishments logged yet for ' + teamName + '. Add them in KPI &gt; Accomplishments and they appear here automatically.</div>';
    return '<div class="rd-grid2" style="margin-top:16px;gap:14px">' + items.map(function (a) {
        return '<div class="rd-card" style="padding:12px 18px;border-left:4px solid ' + color + '"><div style="font-size:16.5px;font-weight:800;line-height:1.25">' + rdEsc(String(a.title).slice(0, 70)) + '</div><div class="rd-sub" style="font-size:13.5px;margin-top:4px;line-height:1.35">' + rdEsc(String(a.description || '').slice(0, 105)) + '</div><div class="rd-sub" style="font-size:12px;margin-top:5px">' + rdEsc(a.category) + ' &middot; ' + rdEsc(a.date) + '</div></div>';
    }).join('') + '</div>';
}

// Shared Chart.js options for bar charts (with value labels drawn by the rdLabels plugin below).
function rdBarOpts(o) {
    var scale = { grid: { color: '#16213A' }, ticks: { color: '#94A3B8', font: { size: 13 } } };
    var cat = { grid: { display: false }, ticks: { color: '#E2E8F0', font: { size: 14 } } };
    var val = { display: false, beginAtZero: true, stacked: !!o.stacked, grid: scale.grid };
    if (o.max) val.max = o.max;
    return {
        responsive: false, animation: false, indexAxis: o.indexAxis || 'x',
        scales: o.indexAxis === 'y' ? { y: Object.assign({ stacked: !!o.stacked }, cat), x: val } : { x: Object.assign({ stacked: !!o.stacked }, cat), y: val },
        plugins: { legend: o.legend ? { position: 'bottom', labels: { color: '#E2E8F0', font: { size: 14 }, padding: 14 } } : { display: false }, rdLabels: { min: o.labelMin || 0, pos: o.pos || 'end', suffix: o.suffix || '', color: o.labelColor || '#E2E8F0', int: !!o.int } }
    };
}
var rdLabelsPlugin = {
    id: 'rdLabels',
    afterDatasetsDraw: function (chart, args, opts) {
        if (!opts || opts.min === undefined) return;
        var ctx = chart.ctx; ctx.save(); ctx.font = '600 13px Calibri, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        chart.data.datasets.forEach(function (ds, di) {
            var meta = chart.getDatasetMeta(di);
            if (meta.hidden) return;
            meta.data.forEach(function (el, i) {
                var v = ds.data[i];
                if (v == null || v < opts.min) return;
                var txt = (opts.int ? Number(v).toLocaleString('en-US') : (opts.suffix === '%' ? Math.round(v) : v)) + opts.suffix;
                ctx.fillStyle = opts.color;
                if (opts.pos === 'center') { var p = el.getCenterPoint(); ctx.fillText(txt, p.x, p.y); }
                else if (chart.options.indexAxis === 'y') { ctx.textAlign = 'left'; ctx.fillText(txt, el.x + 6, el.y); ctx.textAlign = 'center'; }
                else ctx.fillText(txt, el.x, el.y - 12);
            });
        });
        ctx.restore();
    }
};

// ---- heatmap drill-down ----
function rdOpenCell(ci, ti) {
    var c = RD.model.comp.list[ci], list = c.byTactic[ti].slice().sort(function (a, b) { return a.row - b.row; });
    var modal = document.getElementById('rdModal');
    if (!modal) return;
    modal.innerHTML = '<div class="rd-modal-card"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:12px"><div><div style="font-size:20px;font-weight:800">' + rdEsc(c.name) + ' &middot; ' + rdEsc(RD.model.comp.tactics[ti]) + '</div><div class="rd-sub" style="font-size:13px">' + list.length + ' promotions. Click one to jump to its row in the Tracker sheet.</div></div><button onclick="rdCloseModal()" class="rd-x">&times;</button></div>' +
        '<div class="rd-modal-list">' + list.map(function (e) {
            return '<a href="' + rdSheetUrl(c.name, e.row) + '" target="_blank" rel="noopener" class="rd-modal-row"><span class="rd-modal-date">' + rdEsc(e.date || '') + '</span><span class="rd-modal-title">' + rdEsc(e.title) + '</span><span class="rd-modal-type">' + rdEsc(e.type) + '</span><span class="rd-modal-go">row ' + e.row + ' &#8599;</span></a>';
        }).join('') + '</div></div>';
    modal.style.display = 'flex';
}
function rdCloseModal() { var m = document.getElementById('rdModal'); if (m) { m.style.display = 'none'; m.innerHTML = ''; } }

// ---- rendering / layout ----
function rdInjectStyles() {
    if (document.getElementById('rdStyles')) return;
    var st = document.createElement('style'); st.id = 'rdStyles';
    st.textContent =
        '#rdRoot{font-family:Calibri,"Segoe UI",Arial,sans-serif;position:relative}' +
        '#rdRoot .rd-wrap{position:relative;margin:0 auto 22px;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(2,6,23,.35);border:1px solid #1E2A44;background:#070D1A}' +
        '#rdRoot .rd-slide{position:absolute;left:0;top:0;width:1280px;height:720px;transform-origin:top left;color:#F1F5F9;background:radial-gradient(1200px 500px at 100% 0,#0d2a33 0,transparent 55%),#070D1A;overflow:hidden}' +
        '#rdRoot .rd-head{padding:44px 60px 0}.rd-title{font:800 44px Arial,sans-serif;letter-spacing:-.5px}.rd-subtitle{font-size:20px;color:#94A3B8;margin-top:8px}' +
        '#rdRoot .rd-body{position:absolute;left:60px;right:60px;top:150px;bottom:62px}' +
        '#rdRoot .rd-foot{position:absolute;left:60px;right:60px;bottom:24px;display:flex;justify-content:space-between;font-size:12px;letter-spacing:3px;color:#64748B}' +
        '#rdRoot .rd-card{background:#0F1B33;border:1px solid #1E2A44;border-radius:14px}' +
        '#rdRoot .rd-card-h{font-size:17px;font-weight:700;margin-bottom:10px}' +
        '#rdRoot .rd-stat{padding:20px 24px}.rd-val{font:800 54px Arial,sans-serif;line-height:1.05}.rd-lab{font-size:19px;font-weight:700;margin-top:8px}.rd-sub{font-size:14px;color:#94A3B8}' +
        '#rdRoot .rd-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}#rdRoot .rd-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}#rdRoot .rd-grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}' +
        '#rdRoot .rd-note{font-size:14px;color:#94A3B8;margin-top:14px}' +
        '#rdRoot .rd-badge{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:26px}' +
        '#rdRoot .rd-member{display:flex;align-items:center;gap:14px;font-size:20px;margin:8px 0}#rdRoot .rd-avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}' +
        '#rdRoot .rd-row3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:6px}' +
        '#rdRoot .rd-table{width:100%;border-collapse:collapse;font-size:15px}#rdRoot .rd-table th{background:#38BDF8;color:#0B1220;font-weight:800;padding:8px 10px;text-align:center;font-size:14px}#rdRoot .rd-table td{background:#0F1B33;border:1px solid #1E2A44;padding:7px 10px;text-align:center}' +
        '#rdRoot .rd-heattable td{font-size:17px;font-weight:700;padding:5px 6px}#rdRoot .rd-heattable th{padding:6px 8px}#rdRoot .rd-heat{cursor:pointer;color:#F1F5F9;transition:filter .15s}#rdRoot .rd-heat:hover{filter:brightness(1.35);outline:2px solid #F1F5F9;outline-offset:-2px}#rdRoot .rd-heat0{color:#64748B}' +
        '#rdRoot .rd-total td{color:#2DD4BF;font-weight:800}#rdRoot .rd-link{color:#F1F5F9;text-decoration:underline;text-decoration-color:#38BDF8}' +
        '#rdRoot .rd-problems td{font-size:15px;padding:12px 12px;vertical-align:middle}#rdRoot .rd-brands{font-size:12.5px}#rdRoot .rd-brands th{padding:4px 6px;font-size:12px}#rdRoot .rd-brands td{padding:2.5px 6px;border-color:#1A2540}' +
        '#rdRoot .rd-list{margin:6px 0 0 20px;font-size:16px;color:#94A3B8;line-height:1.9}' +
        '#rdRoot .rd-compgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}#rdRoot .rd-comp{padding:11px 14px;display:block;color:#F1F5F9;text-decoration:none;min-height:0}#rdRoot .rd-comp:hover{border-color:#38BDF8}' +
        '#rdRoot .rd-chip{font-size:12px;font-weight:700;color:#38BDF8;background:#38BDF822;border-radius:999px;padding:3px 10px}#rdRoot .rd-latest{font-size:13px;color:#CBD5E1;margin-top:7px;line-height:1.25}#rdRoot .rd-latest em{display:block;color:#64748B;font-style:normal;font-size:11px;margin-top:1px}' +
        '#rdRoot .rd-wave{font-weight:800;font-size:16px;border-radius:8px;padding:5px 14px}#rdRoot .rd-step{display:flex;gap:14px;margin-bottom:18px}#rdRoot .rd-stepnum{font:800 26px Arial,sans-serif;min-width:26px}#rdRoot .rd-steph{font-size:18px;font-weight:800}#rdRoot .rd-stept{font-size:14.5px;color:#94A3B8;margin-top:4px;line-height:1.4}' +
        '#rdRoot .rd-title-slide{position:absolute;left:90px;top:130px}#rdRoot .rd-eyebrow{font-size:18px;letter-spacing:8px;color:#2DD4BF;font-weight:700}#rdRoot .rd-hero{font:800 78px/1.05 Arial,sans-serif;margin-top:22px}#rdRoot .rd-chiplist{font-size:20px;color:#94A3B8;margin-top:34px}#rdRoot .rd-asof{font-size:18px;color:#64748B;margin-top:90px}' +
        '#rdModal{display:none;position:fixed;inset:0;background:rgba(2,6,23,.72);z-index:9000;align-items:center;justify-content:center;padding:24px}' +
        '.rd-modal-card{background:#0F1B33;color:#F1F5F9;border:1px solid #2A3A5E;border-radius:16px;padding:22px 26px;width:min(900px,96vw);max-height:84vh;display:flex;flex-direction:column;font-family:Calibri,"Segoe UI",Arial,sans-serif}' +
        '.rd-modal-list{overflow:auto}.rd-modal-row{display:grid;grid-template-columns:92px 1fr 150px 70px;gap:12px;padding:9px 6px;border-top:1px solid #1E2A44;color:#F1F5F9;text-decoration:none;font-size:14px;align-items:center}.rd-modal-row:hover{background:#16264a}.rd-modal-date{color:#94A3B8;font-size:12px}.rd-modal-type{color:#64748B;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rd-modal-go{color:#38BDF8;font-size:12px;text-align:right}.rd-x{font-size:28px;line-height:1;color:#94A3B8;background:none;border:0;cursor:pointer}' +
        '#rdRoot.rd-present{background:#000;display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;overflow:hidden}#rdRoot.rd-present .rd-wrap{display:none;margin:0;border-radius:0;border:0}#rdRoot.rd-present .rd-wrap.rd-cur{display:block}#rdRoot.rd-present .rd-toolbar{display:none}' +
        '@media print{@page{size:1280px 720px;margin:0}body.rd-printing *{visibility:hidden!important}body.rd-printing #rdRoot,body.rd-printing #rdRoot *{visibility:visible!important}body.rd-printing #rdRoot{position:absolute;left:0;top:0;width:1280px}body.rd-printing .rd-wrap{margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;page-break-after:always;break-after:page}body.rd-printing .rd-toolbar{display:none!important}}';
    document.head.appendChild(st);
}

function renderKpiReportDeckTab() {
    var content = document.getElementById('kpiTabContent');
    if (!content) return;
    if (currentUserRole !== 'Super Admin') { content.innerHTML = '<p class="text-sm text-subtle">The Report Deck is available to Super Admin only.</p>'; return; }
    rdInjectStyles();
    Chart.register(rdLabelsPlugin);
    content.innerHTML = '<div id="rdRoot"><div class="rd-toolbar flex items-center justify-between flex-wrap gap-3 mb-4">' +
        '<div><h3 class="text-sm font-black text-heading flex items-center gap-2"><i data-lucide="presentation" class="h-4 w-4 text-indigo-500"></i> Live Report Deck</h3><p class="text-[11px] text-subtle mt-0.5" id="rdUpdated">Loading live data...</p></div>' +
        '<div class="flex items-center gap-2"><button onclick="rdLoad(true)" class="px-3 py-2 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app shadow-sm flex items-center gap-1.5"><i data-lucide="refresh-cw" class="h-3.5 w-3.5"></i> Refresh</button>' +
        '<button onclick="rdPrint()" class="px-3 py-2 bg-panel border border-theme rounded-lg text-xs font-bold text-body hover:bg-app shadow-sm flex items-center gap-1.5"><i data-lucide="printer" class="h-3.5 w-3.5"></i> Print / Save PDF</button>' +
        '<button onclick="rdPresent()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 shadow-sm flex items-center gap-1.5"><i data-lucide="play" class="h-3.5 w-3.5"></i> Present</button></div></div>' +
        '<div id="rdSlides">' + skeletonScreen('cards') + '</div><div id="rdModal" onclick="if(event.target===this)rdCloseModal()"></div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    rdLoad(false);
}

function rdLoad(force) {
    var pending = 2, data = null, comp = null, failed = false;
    function done() {
        if (--pending > 0) return;
        if (failed || !data) { var el = document.getElementById('rdSlides'); if (el) el.innerHTML = '<p class="text-sm text-subtle">Could not load report data. Press Refresh to try again.</p>'; return; }
        RD.data = data; RD.comp = comp; RD.model = rdBuildModel(data, comp); RD.loadedAt = new Date();
        rdRenderAll();
    }
    google.script.run.withSuccessHandler(function (r) { data = r; done(); }).withFailureHandler(function () { failed = true; done(); }).getReportDeckData(currentSessionToken);
    google.script.run.withSuccessHandler(function (r) { comp = r; done(); }).withFailureHandler(function () { comp = null; done(); }).getReportCompetitors(currentSessionToken);
}

function rdRenderAll() {
    var host = document.getElementById('rdSlides');
    if (!host) return;
    RD.charts.forEach(function (c) { if (c._inst) c._inst.destroy(); });
    RD.charts = [];
    var slides = rdSlides(RD.model, RD.data), total = slides.length;
    host.innerHTML = slides.map(function (fn, i) { return '<div class="rd-wrap" data-i="' + i + '"><div class="rd-slide">' + fn(i, total) + '</div></div>'; }).join('');
    RD.charts.forEach(function (cfg) {
        var cv = document.getElementById(cfg.id);
        if (cv) cfg._inst = new Chart(cv.getContext('2d'), { type: cfg.type, data: cfg.data, options: cfg.options });
    });
    var up = document.getElementById('rdUpdated');
    if (up) up.textContent = 'Live from the portal database and the Competitor Tracker. Loaded ' + RD.loadedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '. Data as of ' + rdDateLabel(RD.data.asOf) + '.';
    rdFit();
    if (!RD.fitBound) { RD.fitBound = true; window.addEventListener('resize', rdFit); document.addEventListener('keydown', rdKey); document.addEventListener('fullscreenchange', rdFsChange); window.addEventListener('beforeprint', rdBeforePrint); window.addEventListener('afterprint', rdAfterPrint); }
}

function rdFit(forceScale) {
    var root = document.getElementById('rdRoot');
    if (!root) return;
    var wraps = root.querySelectorAll('.rd-wrap');
    var s;
    if (typeof forceScale === 'number') s = forceScale;
    else if (RD.present) s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    else s = Math.min(1, (root.clientWidth || 1280) / 1280);
    wraps.forEach(function (w, i) {
        w.style.width = Math.round(1280 * s) + 'px'; w.style.height = Math.round(720 * s) + 'px';
        w.querySelector('.rd-slide').style.transform = 'scale(' + s + ')';
        w.classList.toggle('rd-cur', i === RD.idx);
    });
}

function rdPresent() {
    var root = document.getElementById('rdRoot');
    if (!root) return;
    RD.idx = 0;
    if (root.requestFullscreen) root.requestFullscreen().catch(function () {});
    else { RD.present = true; root.classList.add('rd-present'); rdFit(); }
}
function rdFsChange() {
    var root = document.getElementById('rdRoot');
    if (!root) return;
    RD.present = document.fullscreenElement === root;
    root.classList.toggle('rd-present', RD.present);
    rdFit();
}
function rdKey(e) {
    if (!RD.present) return;
    var n = document.querySelectorAll('#rdRoot .rd-wrap').length;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Enter') { RD.idx = Math.min(n - 1, RD.idx + 1); rdFit(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace') { RD.idx = Math.max(0, RD.idx - 1); rdFit(); e.preventDefault(); }
    else if (e.key === 'Home') { RD.idx = 0; rdFit(); } else if (e.key === 'End') { RD.idx = n - 1; rdFit(); }
    else if (e.key === 'Escape') rdCloseModal();
}
function rdPrint() { window.print(); }
function rdBeforePrint() { if (!document.getElementById('rdRoot')) return; document.body.classList.add('rd-printing'); RD.idx = -1; rdFit(1); }
function rdAfterPrint() { document.body.classList.remove('rd-printing'); RD.idx = 0; rdFit(); }

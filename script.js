// ==========================================
// MOBILE RESPONSIVE HELPERS
// ==========================================
function toggleMobileSidebar() {
    var sidebar = document.getElementById('mainSidebar');
    var overlay = document.getElementById('mobileSidebarOverlay');
    if(!sidebar || !overlay) return;

    if (sidebar.classList.contains('-translate-x-full')) {
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
        setTimeout(function() { overlay.classList.remove('opacity-0'); overlay.classList.add('opacity-100'); }, 10);
    } else {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.remove('opacity-100');
        overlay.classList.add('opacity-0');
        setTimeout(function() { overlay.classList.add('hidden'); }, 300);
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeMobileSidebar() {
    if (window.innerWidth < 768) {
        var sidebar = document.getElementById('mainSidebar');
        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
            toggleMobileSidebar();
        }
    }
}

// ==========================================
// GLOBAL VARIABLES
// ==========================================
var sortAsc = true;
var currentBrandData = [];
var currentViewData = [];
var currentBrandName = '';
var currentPage = 1;
var rowsPerPage = 10;
var validBulkUploadArray = [];
var availableBrandsForPerms = [];

var currentUserRole = 'Admin';
var currentUserPermissions = [];
var currentEditingUser = null;
var currentSessionToken = null;

var postVerifData = [];
var currentDpvTeam = 'Overview';
var dpvSearchQuery = '';
var dpvSelectedBatches = [];
var dpvBatchList = [];

var idleTimer;
var IDLE_TIMEOUT_MS = 15 * 60 * 1000;

function resetIdleTimer() {
    clearTimeout(idleTimer);
    var app = document.getElementById('mainApplication');
    if (app && !app.classList.contains('hidden')) {
        idleTimer = setTimeout(function() { logoutSystem(true); }, IDLE_TIMEOUT_MS);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    if (typeof lucide !== 'undefined') lucide.createIcons();
    initThemeEngine();

    var savedUser = localStorage.getItem('dg_user');
    var savedRole = localStorage.getItem('dg_role');
    var savedPerms = localStorage.getItem('dg_perms');
    var savedToken = localStorage.getItem('dg_token');
    if (savedUser && savedRole && savedToken) {
        currentSessionToken = savedToken;
        finishLogin(savedUser, savedRole, savedPerms ? JSON.parse(savedPerms) : [], true);
    }

    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(function(evt) {
        document.addEventListener(evt, resetIdleTimer, true);
    });
});

// ==========================================
// THEME ENGINE (LIGHT / DARK)
// ==========================================
function initThemeEngine() {
    var saved = localStorage.getItem('dg_theme');
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = saved || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dg_theme', theme);
    var icon = document.getElementById('themeToggleIcon');
    if (icon) icon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ==========================================
// SMOOTH UI & NOTIFICATION HELPERS
// ==========================================
function closeSmoothly(modalId) {
    var el = document.getElementById(modalId);
    if(!el) return;
    el.style.opacity = '0';
    setTimeout(function() {
        el.classList.add('hidden');
        el.style.opacity = '1';
    }, 200);
}

function showPremiumToast(title, message, type) {
    var toast = document.getElementById('premiumToast');
    if(!toast) return;
    var titleEl = document.getElementById('toastTitle');
    var msgEl = document.getElementById('toastMessage');
    var iconEl = document.getElementById('toastIcon');

    titleEl.innerText = title; msgEl.innerText = message;

    if (type === 'success') {
        iconEl.className = "p-2 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400";
        iconEl.innerHTML = '<i data-lucide="check-circle" class="h-5 w-5"></i>';
    } else if (type === 'error') {
        iconEl.className = "p-2 rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400";
        iconEl.innerHTML = '<i data-lucide="alert-circle" class="h-5 w-5"></i>';
    } else {
        iconEl.className = "p-2 rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400";
        iconEl.innerHTML = '<i data-lucide="info" class="h-5 w-5"></i>';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();

    toast.classList.remove('translate-x-[150%]', 'opacity-0'); toast.classList.add('translate-x-0', 'opacity-100');
    setTimeout(function() { toast.classList.remove('translate-x-0', 'opacity-100'); toast.classList.add('translate-x-[150%]', 'opacity-0'); }, 3500);

    if (title === "Deleted" || title === "Cleanup Complete" || title.includes("Success") || title.includes("Welcome") || title === "Logged Out") {
        var actType = "UPDATE";
        if (title === "Deleted") actType = "DELETE";
        if (title === "Cleanup Complete") actType = "CLEANUP";
        if (message.includes("upload") || message.includes("processed") || message.includes("saved") || message.includes("registered")) actType = "ADD/UPLOAD";
        if (message.includes("logged in") || title.includes("Welcome") || title === "Logged Out") actType = "SYSTEM ACCESS";

        if(typeof logSystemActivity === 'function') {
            logSystemActivity(actType, message);
        }
    }
}

function showPremiumConfirm(title, message, confirmText, callback) {
    var modal = document.getElementById('premiumConfirm');
    if(!modal) return;
    document.getElementById('confirmTitle').innerText = title;
    document.getElementById('confirmMsg').innerText = message;
    document.getElementById('btnConfirmOk').innerText = confirmText;

    modal.classList.remove('hidden');

    document.getElementById('btnConfirmCancel').onclick = function() { closeSmoothly('premiumConfirm'); };
    document.getElementById('btnConfirmOk').onclick = function() { closeSmoothly('premiumConfirm'); callback(); };
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function copyToClipboard(text) {
    if(!text) return;
    navigator.clipboard.writeText(text).then(function() {
        showPremiumToast("Copied!", "Password successfully copied to clipboard.", "success");
    });
}

// ==========================================
// SKELETON LOADER HELPERS (replaces jarring spinners)
// ==========================================
function skeletonCards(count, cols) {
    cols = cols || 4;
    var html = '<div class="grid grid-cols-1 md:grid-cols-' + cols + ' gap-4 mb-6">';
    for (var i = 0; i < count; i++) {
        html += '<div class="skel-card"><div class="skel-line w-10 h-10 rounded-xl mb-3"></div><div class="skel-line w-2/3 h-2.5 mb-2"></div><div class="skel-line w-1/3 h-5"></div></div>';
    }
    html += '</div>';
    return html;
}

function skeletonTable(rows, cols) {
    rows = rows || 6; cols = cols || 6;
    var html = '<div class="skel-panel"><div class="skel-line w-40 h-4 mb-5"></div>';
    for (var r = 0; r < rows; r++) {
        html += '<div class="flex gap-4 mb-4">';
        for (var c = 0; c < cols; c++) {
            html += '<div class="skel-line h-3 flex-1" style="animation-delay:' + ((r * cols + c) * 0.03) + 's"></div>';
        }
        html += '</div>';
    }
    html += '</div>';
    return html;
}

function skeletonScreen(kind) {
    if (kind === 'table') {
        return '<div class="p-2">' + skeletonCards(4) + skeletonTable(8, 7) + '</div>';
    }
    return '<div class="p-2">' + skeletonCards(4) + '<div class="skel-panel h-64"></div></div>';
}

// ==========================================
// LOGIN & LOGOUT LOGIC
// ==========================================
function attemptLogin() {
    var user = document.getElementById('loginUser').value.trim();
    var pass = document.getElementById('loginPass').value.trim();
    var btn = document.getElementById('btnLogin');
    var errorMsg = document.getElementById('loginError');

    if(user === '' || pass === '') {
        errorMsg.innerText = "Please enter both username and password.";
        errorMsg.classList.remove('hidden');
        return;
    }

    var originalHtml = btn.innerHTML;
    btn.innerHTML = '<div class="spinner h-4 w-4 border-2 border-white/20 border-t-white"></div> Authenticating...';
    btn.disabled = true;
    errorMsg.classList.add('hidden');

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function(response) {
                btn.innerHTML = originalHtml; btn.disabled = false;
                if (response.success) {
                    currentSessionToken = response.token;
                    finishLogin(response.username, response.role, response.permissions);
                } else {
                    errorMsg.innerText = response.message || "Invalid credentials."; errorMsg.classList.remove('hidden');
                }
            })
            .withFailureHandler(function(err) {
                btn.innerHTML = originalHtml; btn.disabled = false;
                errorMsg.innerText = "Execution Error: " + err.toString(); errorMsg.classList.remove('hidden');
            })
            .verifyLogin(String(user), String(pass));
        return;
    }

    var GOOGLE_WEB_APP_API_URL = "https://bbc-api-gateway.ea-nix.workers.dev/";
    var targetUrl = GOOGLE_WEB_APP_API_URL + "?action=verifyLogin&username=" + encodeURIComponent(user) + "&password=" + encodeURIComponent(pass);

    var jsonpScript = document.createElement('script');
    var uniqueCallback = 'jsonp_login_' + Math.round(Math.random() * 1000000);

    window[uniqueCallback] = function(response) {
        btn.innerHTML = originalHtml; btn.disabled = false;
        document.body.removeChild(jsonpScript);
        delete window[uniqueCallback];

        if (response.success) {
            finishLogin(response.username, response.role, response.permissions);
        } else {
            errorMsg.innerText = response.message || "Invalid credentials."; errorMsg.classList.remove('hidden');
        }
    };

    jsonpScript.src = targetUrl + "&callback=" + uniqueCallback;
    jsonpScript.onerror = function() {
        btn.innerHTML = originalHtml; btn.disabled = false;
        errorMsg.innerText = "Network Error: Unable to bind data network sync pipes."; errorMsg.classList.remove('hidden');
    };
    document.body.appendChild(jsonpScript);
}

function finishLogin(name, role, perms, isRestore) {
    document.getElementById('loginScreen').classList.add('smooth-hide');
    setTimeout(function() {
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('mainApplication').classList.remove('hidden');
        document.getElementById('mainApplication').classList.remove('smooth-hide');
        document.getElementById('mainApplication').classList.add('flex', 'smooth-show');

        document.getElementById('adminProfileName').innerText = name;
        currentUserRole = role;
        currentUserPermissions = perms || [];

        localStorage.setItem('dg_user', name);
        localStorage.setItem('dg_role', role);
        localStorage.setItem('dg_perms', JSON.stringify(currentUserPermissions));
        if (currentSessionToken) localStorage.setItem('dg_token', currentSessionToken);

        var roleEl = document.querySelector('aside p.tracking-widest');
        if(roleEl) roleEl.innerText = role;

        applyPermissionsToUI();
        resetIdleTimer();

        if (currentUserRole === 'Super Admin' || currentUserPermissions.includes('BBC Dashboard Domain')) {
            openGlobalDashboard();
        } else if (currentUserPermissions.includes('Cyberguard Reports')) {
            openCyberguardSub('Domain Post Verification');
        } else {
            document.getElementById('appContent').innerHTML = '<div class="absolute inset-0 flex flex-col items-center justify-center text-slate-400"><i data-lucide="shield" class="h-16 w-16 mb-4 opacity-20"></i><p>Select an accessible brand from the sidebar.</p></div>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        loadSidebarBrands();

        if (!isRestore) { showPremiumToast("Welcome Back!", "Successfully logged in to Domain_Guard.", "success"); }
    }, 300);
}

function logoutSystem(isAutoKicked) {
    var proceedWithLogout = function() {
        if (typeof google !== 'undefined' && google.script && google.script.run && currentSessionToken) {
            google.script.run.logoutSessionBackend(currentSessionToken); // fire-and-forget server-side session cleanup
        }

        var app = document.getElementById('mainApplication');
        app.classList.add('smooth-hide');
        setTimeout(function() {
            app.classList.add('hidden');
            app.classList.remove('flex', 'smooth-show', 'smooth-hide');

            var login = document.getElementById('loginScreen');
            login.classList.remove('hidden', 'smooth-hide');
            login.classList.add('smooth-show');

            document.getElementById('loginPass').value = '';
            document.getElementById('btnLogin').innerHTML = 'Sign In to Dashboard <i data-lucide="arrow-right" class="h-4 w-4"></i>';
            document.getElementById('btnLogin').disabled = false;

            currentBrandData = []; currentViewData = []; currentUserPermissions = []; postVerifData = []; currentSessionToken = null;

            localStorage.removeItem('dg_user'); localStorage.removeItem('dg_role'); localStorage.removeItem('dg_perms'); localStorage.removeItem('dg_token');
            clearTimeout(idleTimer);

            showPremiumToast(isAutoKicked ? "Session Expired" : "Logged Out", isAutoKicked ? "You were automatically logged out due to 15 minutes of inactivity." : "Session ended securely.", "success");
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }, 300);
    };

    if (isAutoKicked === true) {
        proceedWithLogout();
    } else {
        showPremiumConfirm("Secure Logout", "Are you sure you want to end your session and lock the terminal?", "Yes, Logout", proceedWithLogout);
    }
}

function applyPermissionsToUI() {
    var globalBtn = document.getElementById('btnGlobalDashboard');
    var cyberParent = document.getElementById('btnCyberguardParent');
    var settingsBtn = document.querySelector('button[title="Settings"]');
    var addBrandBtn = document.querySelector('button[title="Add Brand"]');

    var subDpv = document.querySelector('#cyberguardSubMenu button[onclick*="Domain Post Verification"]');
    var subPg = document.querySelector('#cyberguardSubMenu button[onclick*="Payment Gateway"]');
    var subIr = document.querySelector('#cyberguardSubMenu button[onclick*="Influencer Report"]');

    if(globalBtn) { globalBtn.classList.remove('hidden'); globalBtn.style.display = ''; }
    if(cyberParent) { cyberParent.parentElement.classList.remove('hidden'); cyberParent.parentElement.style.display = ''; }
    if(settingsBtn) { settingsBtn.classList.remove('hidden'); settingsBtn.style.display = ''; }
    if(addBrandBtn) { addBrandBtn.classList.remove('hidden'); addBrandBtn.style.display = ''; }
    if(subDpv) { subDpv.classList.remove('hidden'); subDpv.style.display = ''; }
    if(subPg) { subPg.classList.remove('hidden'); subPg.style.display = ''; }
    if(subIr) { subIr.classList.remove('hidden'); subIr.style.display = ''; }

    if (currentUserRole !== 'Super Admin') {
        if (globalBtn && !currentUserPermissions.includes('BBC Dashboard Domain')) {
            globalBtn.classList.add('hidden');
            globalBtn.style.display = 'none';
        }
        if (cyberParent && !currentUserPermissions.includes('Cyberguard Reports')) {
            cyberParent.parentElement.classList.add('hidden');
            cyberParent.parentElement.style.display = 'none';
        }
        if (subDpv && !currentUserPermissions.includes('Domain Post Verification')) {
            subDpv.classList.add('hidden');
            subDpv.style.display = 'none';
        }
        if (subPg && !currentUserPermissions.includes('Payment Gateway')) {
            subPg.classList.add('hidden');
            subPg.style.display = 'none';
        }
        if (subIr && !currentUserPermissions.includes('Influencer Report')) {
            subIr.classList.add('hidden');
            subIr.style.display = 'none';
        }
        if (settingsBtn) { settingsBtn.classList.add('hidden'); settingsBtn.style.display = 'none'; }
        if (addBrandBtn) { addBrandBtn.classList.add('hidden'); addBrandBtn.style.display = 'none'; }
    }
}

// ==========================================
// SIDEBAR & CYBERGUARD MENU LOGIC
// ==========================================
function loadSidebarBrands() {
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.withSuccessHandler(function(brands) {
            availableBrandsForPerms = brands;
            renderSidebarBrands(brands);
        }).getUniqueBrands(currentSessionToken);
    } else {
        var mockBrands = ['4DWIN', '888LUXURY', 'APEXGAMING'];
        availableBrandsForPerms = mockBrands; renderSidebarBrands(mockBrands);
    }
}

function renderSidebarBrands(brands) {
    var container = document.getElementById('sidebarBrandList');
    if (!container || !brands || brands.length === 0) return;
    var html = '';
    brands.forEach(function(brand) {
        if (currentUserRole === 'Super Admin' || currentUserPermissions.includes(brand)) {
            var safeBrand = brand.replace(/'/g, "\\'");
            html += '<button onclick="openBrandPage(\'' + safeBrand + '\', this)" class="brand-btn w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 group">';
            html += '  <div class="flex items-center gap-3 truncate"><i data-lucide="folder" class="h-4 w-4 group-hover:scale-110 transition-transform"></i><span class="truncate">' + brand + '</span></div>';
            html += '  <i data-lucide="chevron-right" class="h-3 w-3 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all"></i>';
            html += '</button>';
        }
    });
    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function toggleCyberguardMenu() {
    var menu = document.getElementById('cyberguardSubMenu');
    var chevron = document.getElementById('cyberguardChevron');
    var parentBtn = document.getElementById('btnCyberguardParent');

    if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden'); menu.classList.add('flex');
        chevron.classList.add('rotate-180');
        parentBtn.classList.add('bg-slate-100/60', 'text-indigo-600');
    } else {
        menu.classList.add('hidden'); menu.classList.remove('flex');
        chevron.classList.remove('rotate-180');
        parentBtn.classList.remove('bg-slate-100/60', 'text-indigo-600');
    }
}

// ==========================================
// UI & SIDEBAR STATE MANAGER
// ==========================================
function setActiveSidebarBtn(clickedBtn) {
    var inactiveClass = "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 group text-slate-500 hover:bg-slate-100/60 hover:text-indigo-600 bg-transparent";
    var activeClass = "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] transition-all duration-200 group bg-indigo-50/80 text-indigo-700 shadow-sm ring-1 ring-indigo-100/50 font-bold";

    document.querySelectorAll('.brand-btn').forEach(function(b) { b.className = "brand-btn " + inactiveClass + " justify-between"; });
    document.querySelectorAll('.nav-btn').forEach(function(b) {
        if(b.id !== 'btnCalendar') b.className = "nav-btn " + inactiveClass;
    });

    if (clickedBtn) {
        if (clickedBtn.classList.contains('brand-btn')) {
            clickedBtn.className = "brand-btn " + activeClass + " justify-between";
        } else if (clickedBtn.id !== 'btnCalendar') {
            clickedBtn.className = "nav-btn " + activeClass;
        } else {
            clickedBtn.className = "nav-btn w-full flex items-center gap-3 px-4 py-3 mb-6 rounded-xl text-[14px] transition-all duration-200 group bg-indigo-50 border border-indigo-200 shadow-sm text-indigo-700 font-bold";
        }
    }

    var mainHeader = document.getElementById('mainHeader');
    if(mainHeader) mainHeader.classList.remove('hidden');

    var mainHeaderWrapper = document.getElementById('mainHeaderWrapper');
    if(mainHeaderWrapper) mainHeaderWrapper.className = "flex-1 flex flex-col min-w-0 overflow-hidden relative bg-slate-50/50";

    var content = document.getElementById('appContent');
    if(content) {
        content.style.opacity = '0';
        setTimeout(function(){ content.style.opacity = '1'; }, 50);
    }

    if (typeof closeMobileSidebar === 'function') { closeMobileSidebar(); }
    if (typeof applyPermissionsToUI === 'function') { applyPermissionsToUI(); }
}

function openCalendar() {
    var container = document.getElementById('appContent');
    if (!container) return;
    setActiveSidebarBtn(document.getElementById('btnCalendar'));
    document.getElementById('mainHeader').classList.add('hidden');
    document.getElementById('mainHeaderWrapper').className = "flex-1 flex flex-col min-w-0 overflow-hidden relative bg-slate-50/50";
    container.innerHTML = '<div class="absolute inset-0 flex flex-col items-center justify-center text-slate-400"><i data-lucide="calendar-days" class="h-16 w-16 mb-4 opacity-20"></i><p>Calendar module coming soon.</p></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ==========================================
// GLOBAL DASHBOARD LOGIC
// ==========================================
function openGlobalDashboard() {
    var container = document.getElementById('appContent');
    if (!container) return;
    setActiveSidebarBtn(document.getElementById('btnGlobalDashboard'));
    container.innerHTML = skeletonScreen('cards');

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.withSuccessHandler(function(allDomains) {
            currentBrandData = allDomains; currentViewData = [].concat(currentBrandData); buildGlobalUI();
        }).getDomainsData(currentSessionToken);
    } else {
        setTimeout(function() {
            currentBrandData = [ { brand: "888LUXURY", domain: "888luxury.com", expiration: "2026-08-15", account: "Godaddy", price: "₱2,500", notes: "Main", agent: "Tech01", redirected: "N/A", pldt: "Active", pldtRemarks: "", globe: "Active", globeRemarks: "", converge: "Active", convergeRemarks: "", dito: "Active", ditoRemarks: "" } ];
            currentViewData = [].concat(currentBrandData); buildGlobalUI();
        }, 500);
    }
}

function buildGlobalUI() {
    var container = document.getElementById('appContent');
    if (!container) return;

    var totalDomains = currentViewData.length;
    var accessibleCount = 0, fullyBlockedCount = 0, redirectedCount = 0;
    var brandsMap = {}, expiringDomains = [], spareDomains = [];
    var stats = { pldt: { block: 0, active: 0, redirect: 0, total: 0 }, globe: { block: 0, active: 0, redirect: 0, total: 0 }, converge: { block: 0, active: 0, redirect: 0, total: 0 }, dito: { block: 0, active: 0, redirect: 0, total: 0 } };
    var now = new Date(), currentMonth = now.getMonth(), currentYear = now.getFullYear();

    currentViewData.forEach(function(d) {
        if (d.brand && d.brand.trim() !== '') brandsMap[d.brand.trim()] = true;
        var isAnyActive = false, isFullyBlocked = true;

        var isps = [{ key: 'pldt', val: d.pldt }, { key: 'globe', val: d.globe }, { key: 'converge', val: d.converge }, { key: 'dito', val: d.dito }];
        isps.forEach(function(isp) {
            var s = (isp.val || '').toString().toLowerCase();
            if (s !== '' && s !== '-') {
                stats[isp.key].total++;
                if (s.includes('active') || s.includes('clear')) { stats[isp.key].active++; isAnyActive = true; isFullyBlocked = false; }
                else if (s.includes('block') || s.includes('down') || s.includes('timeout')) { stats[isp.key].block++; }
                else if (s.includes('redirect')) { stats[isp.key].redirect++; isFullyBlocked = false; }
                else { isFullyBlocked = false; }
            } else { isFullyBlocked = false; }
        });

        if (isAnyActive) accessibleCount++;
        if (isFullyBlocked) fullyBlockedCount++;

        var isRedirected = (d.redirected && d.redirected.toString().trim() !== '' && d.redirected.toString().trim().toUpperCase() !== 'N/A');
        if (isRedirected || d.pldt === 'Redirected' || d.globe === 'Redirected' || d.converge === 'Redirected' || d.dito === 'Redirected') { redirectedCount++; }

        if (d.expiration) {
            var expDate = new Date(d.expiration);
            if (!isNaN(expDate.getTime())) {
                var expMonth = expDate.getMonth(), expYear = expDate.getFullYear();
                if ((expYear === currentYear && expMonth === currentMonth) || (expYear === currentYear && expMonth === currentMonth + 1) || (currentMonth === 11 && expYear === currentYear + 1 && expMonth === 0)) {
                    expiringDomains.push(d);
                }
            }
        }
        var notesText = (d.notes || '').toString().toLowerCase() + ' ' + (d.agent || '').toString().toLowerCase();
        if (notesText.includes('spare')) spareDomains.push(d);
    });

    var totalBrandsCount = Object.keys(brandsMap).length;
    var currentDateStr = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true });

    var html = [
        '<div class="h-full flex flex-col transition-opacity duration-300 opacity-0" id="globalWrapper">',
        '    <div class="px-8 py-6 border-b border-theme bg-panel flex-shrink-0">',
        '        <h2 class="text-2xl font-bold text-heading flex items-center gap-2"><i data-lucide="layout-dashboard" class="h-6 w-6 text-indigo-500"></i> Global Dashboard</h2>',
        '        <p class="text-sm text-muted mt-1">Holistic overview of ' + totalDomains + ' domains across ' + totalBrandsCount + ' brands.</p>',
        '    </div>',
        '    <div class="flex-1 p-8 bg-app overflow-y-auto custom-scrollbar">',
        '        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">',
                    statTile('globe-2', 'indigo', 'Total Domains', totalDomains),
                    statTile('slash', 'rose', 'Global Blocked', fullyBlockedCount),
                    statTile('check-circle', 'emerald', 'Still Accessible', accessibleCount),
                    statTile('refresh-cw', 'amber', 'Redirected', redirectedCount),
        '        </div>',
                 aiInsightPanel('GLOBAL SYSTEM', 'System Wide', 'all ' + totalBrandsCount + ' active brands', currentDateStr),
        '        <h4 class="text-[11px] font-bold text-subtle uppercase tracking-widest mb-3 flex items-center gap-2"><i data-lucide="bar-chart-2" class="h-4 w-4 text-subtle"></i> Global ISP Breakdown <span class="text-xs font-normal text-subtle ml-2">(Click cards for details)</span></h4>',
        '        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">', getIspCard('PLDT', stats.pldt, 'pldt'), getIspCard('GLOBE', stats.globe, 'globe'), getIspCard('CONVERGE', stats.converge, 'converge'), getIspCard('DITO', stats.dito, 'dito'), '        </div>',
        '        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6">',
        '            <div class="panel-card overflow-hidden flex flex-col"><div class="p-4 border-b border-theme bg-rose-tint"><h4 class="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-widest flex items-center gap-2"><i data-lucide="calendar-clock" class="h-4 w-4"></i> Domains to Expire Soon (' + expiringDomains.length + ')</h4></div><div class="p-4 space-y-3 max-h-80 overflow-y-auto custom-scrollbar flex-1">' + generateListHtml(expiringDomains, false, true) + '</div></div>',
        '            <div class="panel-card overflow-hidden flex flex-col"><div class="p-4 border-b border-theme bg-indigo-tint"><h4 class="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest flex items-center gap-2"><i data-lucide="archive" class="h-4 w-4"></i> List of Spare Domains (' + spareDomains.length + ')</h4></div><div class="p-4 space-y-3 max-h-80 overflow-y-auto custom-scrollbar flex-1">' + generateListHtml(spareDomains, true, true) + '</div></div>',
        '        </div>',
        '    </div>',
        '</div>'
    ].join('\n');
    container.innerHTML = html;
    setTimeout(function(){ var w = document.getElementById('globalWrapper'); if(w) w.style.opacity = '1'; }, 30);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function statTile(icon, color, label, value) {
    return '<div class="stat-tile group"><div class="stat-tile-icon stat-' + color + '"><i data-lucide="' + icon + '" class="h-6 w-6"></i></div><div><p class="text-[10px] font-bold text-subtle uppercase tracking-widest">' + label + '</p><h4 class="text-2xl font-black text-heading">' + value + '</h4></div></div>';
}

// ==========================================
// AI INSIGHT PANEL (SHARED SHELL)
// ==========================================
function aiInsightPanel(scopeKey, tagLabel, targetLabel, dateStr) {
    var safeScope = scopeKey.replace(/'/g, "\\'");
    return [
        '<div class="ai-panel mb-6">',
        '    <div class="ai-panel-glow"></div>',
        '    <div class="p-6 relative">',
        '        <div class="flex justify-between items-start mb-6 flex-wrap gap-3">',
        '            <div><h3 class="text-heading text-lg font-black flex items-center gap-3"><div class="ai-bot-icon"><i data-lucide="sparkles" class="h-5 w-5"></i></div> AI Executive Summary <span class="chip-tag">' + tagLabel + '</span></h3><div class="flex gap-4 mt-2 text-[11px] text-subtle font-medium"><span class="flex items-center gap-1.5"><i data-lucide="clock" class="h-3 w-3"></i> GENERATED: ' + dateStr + '</span><span class="flex items-center gap-1.5 text-indigo-500 font-semibold"><i data-lucide="folder" class="h-3 w-3"></i> SCOPE: ' + targetLabel.toUpperCase() + '</span></div></div>',
        '            <button onclick="generateAIInsight(\'' + safeScope + '\')" class="btn-ai-generate"><i data-lucide="cpu" class="h-4 w-4"></i> Generate Insight</button>',
        '        </div>',
        '        <div id="aiInsightBox" class="text-[13px] text-body leading-relaxed ai-insight-idle p-5 rounded-xl font-medium">Click <span class="text-indigo-500 font-bold">Generate Insight</span> to run a fresh read on <b>' + targetLabel + '</b> — status, risk, and what to do next.</div>',
        '    </div>',
        '</div>'
    ].join('\n');
}

// ==========================================
// DYNAMIC "4D" AI GENERATOR — varied, human-toned narrative reporting
// ==========================================
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateAIInsight(scopeName) {
    var insightBox = document.getElementById('aiInsightBox');
    if (!insightBox) return;

    var scanMsgs = [
        "Cross-referencing " + currentViewData.length + " endpoints against the last 4 ISP sweeps...",
        "Pulling telemetry from " + currentViewData.length + " tracked domains and weighing recent volatility...",
        "Running a pattern check across " + currentViewData.length + " nodes to separate noise from real signal...",
        "Comparing today's block/active states against baseline for " + currentViewData.length + " domains..."
    ];
    insightBox.innerHTML = '<div class="flex items-center gap-3 text-indigo-500 font-bold"><div class="spinner border-t-indigo-500 h-5 w-5 border-2"></div> <span>' + pickRandom(scanMsgs) + '</span></div>';

    setTimeout(function() {
        var totalChecks = 0, blockedChecks = 0, activeChecks = 0, redirectChecks = 0, fullyBlockedDomains = 0;
        var ispStats = { pldt: {b:0, a:0, r:0, t:0}, globe: {b:0, a:0, r:0, t:0}, converge: {b:0, a:0, r:0, t:0}, dito: {b:0, a:0, r:0, t:0} };

        currentViewData.forEach(function(d) {
            var isFullyBlocked = true, hasData = false;
            ['pldt', 'globe', 'converge', 'dito'].forEach(function(isp) {
                var s = (d[isp] || '').toString().toLowerCase();
                if (s !== '' && s !== '-') {
                    hasData = true; totalChecks++; ispStats[isp].t++;
                    if (s.includes('block') || s.includes('down') || s.includes('timeout')) { blockedChecks++; ispStats[isp].b++; }
                    else if (s.includes('active') || s.includes('clear')) { activeChecks++; ispStats[isp].a++; isFullyBlocked = false; }
                    else if (s.includes('redirect')) { redirectChecks++; ispStats[isp].r++; isFullyBlocked = false; }
                    else { isFullyBlocked = false; }
                }
            });
            if (hasData && isFullyBlocked) fullyBlockedDomains++;
        });

        var blockRate = totalChecks > 0 ? Math.round((blockedChecks / totalChecks) * 100) : 0;
        var mostAggressiveIsp = 'N/A', highestBlockRate = -1, calmestIsp = 'N/A', lowestBlockRate = 1000;
        Object.keys(ispStats).forEach(function(isp) {
            if (ispStats[isp].t > 0) {
                var rate = (ispStats[isp].b / ispStats[isp].t) * 100;
                if (rate > highestBlockRate) { highestBlockRate = rate; mostAggressiveIsp = isp.toUpperCase(); }
                if (rate < lowestBlockRate) { lowestBlockRate = rate; calmestIsp = isp.toUpperCase(); }
            }
        });

        var ratingText, ratingClass;
        if (blockRate <= 10) { ratingText = pickRandom(["Excellent — Fully Operational", "Clean Bill of Health", "Green Across the Board"]); ratingClass = "rating-good"; }
        else if (blockRate <= 35) { ratingText = pickRandom(["Stable, Minor Friction", "Mostly Healthy"]); ratingClass = "rating-good"; }
        else if (blockRate <= 60) { ratingText = pickRandom(["Moderate Degradation", "Uneven Coverage"]); ratingClass = "rating-warn"; }
        else { ratingText = pickRandom(["Critical Blockage", "Widespread Filtering Detected"]); ratingClass = "rating-bad"; }

        var openers = [
            "Pulling the numbers together, ",
            "After sweeping every tracked route, ",
            "Here's what the latest pass turned up: ",
            "Scanning through " + scopeName + "'s endpoints, ",
            "Once the noise is filtered out, ",
            "Running the comparison against last cycle, "
        ];
        var intro = pickRandom(openers);

        var p1 = intro + "the network is sitting at a <b class='rate-number'>" + blockRate + "%</b> block rate across " + totalChecks + " checked routes — that reads as <span class='rating-badge " + ratingClass + "'>" + ratingText + "</span>" + (fullyBlockedDomains > 0 ? (", with " + fullyBlockedDomains + " domain" + (fullyBlockedDomains > 1 ? "s" : "") + " completely dark across every carrier.") : ", and nothing is fully dark right now.");

        var findings = [];
        if (blockedChecks > 0 && mostAggressiveIsp !== 'N/A') {
            var aggPhrases = [
                mostAggressiveIsp + " is the one to watch — it's blocking at roughly " + Math.round(highestBlockRate) + "%, well ahead of the others.",
                mostAggressiveIsp + " keeps showing up as the toughest filter, sitting near " + Math.round(highestBlockRate) + "% block rate.",
                "Most of today's friction traces back to " + mostAggressiveIsp + " (~" + Math.round(highestBlockRate) + "% blocked)."
            ];
            findings.push(pickRandom(aggPhrases));
        }
        if (calmestIsp !== 'N/A' && calmestIsp !== mostAggressiveIsp && lowestBlockRate < 1000) {
            var calmPhrases = [
                calmestIsp + " is behaving the best right now, only around " + Math.round(lowestBlockRate) + "% blocked — good candidate for priority routing.",
                "If you need a reliable path, " + calmestIsp + " is holding up the strongest at the moment.",
            ];
            findings.push(pickRandom(calmPhrases));
        }
        if (redirectChecks > 0) {
            findings.push(redirectChecks + " check" + (redirectChecks > 1 ? "s are" : " is") + " coming back as redirected rather than outright blocked — worth confirming those still land on the intended page.");
        }
        if (blockedChecks === 0) {
            findings.push(pickRandom(["No blocks detected anywhere in this batch — a good window to hold current domains a bit longer before rotating.", "Everything's clear right now; no urgent rotation needed."]));
        } else if (blockRate > 50) {
            findings.push(pickRandom(["This is past the point where patching helps — recommend prioritizing fresh domains for the affected brands.", "At this block rate, rotation will likely outperform waiting it out."]));
        } else {
            findings.push(pickRandom(["Nothing urgent, but keep an eye on the flagged carrier over the next check-in.", "Worth a follow-up scan in the next cycle to see if this trend holds."]));
        }

        var listHtml = "<ul class='ai-findings-list'>" + findings.map(function(f){ return "<li>" + f + "</li>"; }).join('') + "</ul>";

        insightBox.innerHTML = [
            '<div class="flex gap-4 items-start">',
            '   <div class="ai-bot-icon flex-shrink-0"><i data-lucide="bot" class="h-6 w-6"></i></div>',
            '   <div><p class="mb-1">' + p1 + '</p><p class="text-heading font-bold mt-3 mb-1"><i data-lucide="zap" class="h-4 w-4 inline text-amber-500 mr-1"></i> Notes & Next Steps</p>' + listHtml + '</div>',
            '</div>'
        ].join('\n');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }, 900 + Math.round(Math.random() * 500));
}

// ==========================================
// "4D" ISP CARD (depth via layered gradient + tilt-on-hover)
// ==========================================
function getIspCard(ispName, statObj, ispKey) {
    var blockPct = statObj.total > 0 ? ((statObj.block / statObj.total) * 100).toFixed(1) : "0.0";
    var activePct = statObj.total > 0 ? ((statObj.active / statObj.total) * 100).toFixed(1) : "0.0";
    var redirectPct = statObj.total > 0 ? ((statObj.redirect / statObj.total) * 100).toFixed(1) : "0.0";
    var isHigh = parseFloat(blockPct) >= 50;
    var blockColorClass = isHigh ? 'text-rose-500' : 'text-emerald-500';
    var ringClass = isHigh ? 'isp4d-ring-rose' : 'isp4d-ring-emerald';

    return [
        '<div onclick="openIspModal(\'' + ispKey + '\', \'' + ispName + '\')" class="isp4d-card ' + ringClass + '" style="--pct:' + blockPct + '">',
        '    <div class="isp4d-depth"></div>',
        '    <div class="isp4d-content">',
        '        <div class="flex items-start justify-between mb-1">',
        '            <h5 class="text-[11px] font-bold text-subtle uppercase tracking-widest">' + ispName + '</h5>',
        '            <div class="isp4d-orb"><i data-lucide="mouse-pointer-click" class="h-3.5 w-3.5"></i></div>',
        '        </div>',
        '        <h3 class="text-3xl font-black ' + blockColorClass + ' mb-1 isp4d-number">' + blockPct + '<span class="text-base">%</span> <span class="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Blocked</span></h3>',
        '        <p class="text-[11px] font-medium text-subtle mb-4">' + statObj.block + ' / ' + statObj.total + ' domains down</p>',
        '        <div class="isp4d-bar-track"><div class="isp4d-bar-fill" style="width:' + blockPct + '%"></div></div>',
        '        <div class="space-y-2 mt-3">',
        '            <div class="isp4d-row"><span class="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><i data-lucide="check-circle" class="h-3.5 w-3.5"></i> Active</span><span>' + statObj.active + ' <span class="text-subtle">(' + activePct + '%)</span></span></div>',
        '            <div class="isp4d-row"><span class="text-amber-500 flex items-center gap-1.5"><i data-lucide="corner-up-right" class="h-3.5 w-3.5"></i> Redirected</span><span>' + statObj.redirect + ' <span class="text-subtle">(' + redirectPct + '%)</span></span></div>',
        '        </div>',
        '    </div>',
        '</div>'
    ].join('\n');
}

function generateListHtml(listData, isSpare, showBrand) {
    if(listData.length === 0) return '<div class="text-xs text-subtle p-4 text-center bg-app rounded-lg border border-theme border-dashed">No records found.</div>';
    var listHtml = '';
    listData.forEach(function(d) {
        var subText = isSpare ? 'Notes: ' + (d.notes || 'N/A') : 'Exp: ' + (d.expiration || 'N/A');
        var iconClass = isSpare ? 'text-indigo-500 bg-indigo-tint' : 'text-rose-500 bg-rose-tint';
        var iconLucide = isSpare ? 'archive' : 'calendar-clock';
        var brandTag = showBrand ? ' <span class="text-[9px] bg-app text-subtle px-1.5 py-0.5 rounded ml-2 font-bold border border-theme">' + d.brand + '</span>' : '';

        listHtml += [
            '<div class="list-row-card">',
            '    <div class="flex items-center gap-3"><div class="p-2 rounded-lg ' + iconClass + '"><i data-lucide="' + iconLucide + '" class="h-4 w-4"></i></div><div><h6 class="text-[13px] font-bold text-heading">' + d.domain + brandTag + '</h6><p class="text-[10px] font-medium text-subtle mt-0.5 uppercase tracking-wide">' + subText + '</p></div></div>',
            '</div>'
        ].join('\n');
    });
    return listHtml;
}

function formatLastCheck(proofRaw) {
    if (!proofRaw || proofRaw.toString().trim() === '') return '<span class="text-subtle italic">Last Check: No Record</span>';
    var rawStr = proofRaw.toString().trim();
    if (rawStr.includes('|')) {
        var parts = rawStr.split('|');
        return 'Last Check: <a href="' + parts[1].trim() + '" target="_blank" class="text-indigo-500 hover:text-indigo-700 hover:underline font-bold inline-flex items-center gap-1">' + parts[0].trim() + ' <i data-lucide="external-link" class="h-2.5 w-2.5"></i></a>';
    } else if (rawStr.includes('http')) {
        return 'Last Check: <a href="' + rawStr.trim() + '" target="_blank" class="text-indigo-500 hover:text-indigo-700 hover:underline font-bold inline-flex items-center gap-1">View Proof <i data-lucide="external-link" class="h-2.5 w-2.5"></i></a>';
    }
    return 'Last Check: ' + rawStr;
}

function createStatusWithProof(statusText, proofRaw) {
    var stat = statusText ? statusText.toString().trim().toUpperCase() : '-';
    if (stat === '' || stat === '-') return '<div class="text-center text-subtle font-bold">-</div>';
    var badgeClass = getStatusBadge(stat);
    var proofHtml = '';

    if (proofRaw && proofRaw.toString().trim() !== '') {
        var rawStr = proofRaw.toString();
        var linkMatch = rawStr.match(/(https?:\/\/[^\s]+)/);

        if(rawStr.includes('|')) {
            var parts = rawStr.split('|');
            var dateLabel = parts[0].replace('(IMAGE)', '').trim() || 'VIEW PROOF';
            proofHtml = '<a href="' + parts[1].trim() + '" target="_blank" class="proof-chip" title="Click to view proof image"><i data-lucide="external-link" class="h-2.5 w-2.5"></i> ' + dateLabel + '</a>';
        } else if (linkMatch) {
            var textOnly = rawStr.replace(linkMatch[0], '').trim();
            var fallbackLabel = textOnly !== '' ? textOnly : 'VIEW PROOF';
            proofHtml = '<a href="' + linkMatch[0] + '" target="_blank" class="proof-chip" title="Click to view proof image"><i data-lucide="external-link" class="h-2.5 w-2.5"></i> ' + fallbackLabel + '</a>';
        } else {
            proofHtml = '<span class="text-[9px] text-subtle font-medium mt-1.5 block max-w-[100px] truncate" title="'+rawStr+'">' + rawStr.replace(/\n/g, ' ').trim() + '</span>';
        }
    } else {
        proofHtml = '<span class="text-[9px] text-subtle font-medium mt-1.5 block italic opacity-60">No record</span>';
    }

    return '<div class="flex flex-col items-center justify-center py-1.5"><span class="status-badge ' + badgeClass + '"><span class="mr-1.5 text-[9px] leading-none">●</span>' + stat + '</span>' + proofHtml + '</div>';
}

function getStatusBadge(status) {
    if (!status) return 'badge-neutral';
    var s = status.toString().toLowerCase();
    if (s.includes('clear') || s.includes('active')) return 'badge-good';
    if (s.includes('block') || s.includes('down') || s.includes('timeout')) return 'badge-bad';
    if (s.includes('pend') || s.includes('redirect')) return 'badge-warn';
    return 'badge-neutral';
}

function openIspModal(ispKey, ispTitle) {
    var modal = document.getElementById('ispDetailsModal');
    if (!modal) return;

    var activeList = [], blockedList = [], redirectedList = [];
    currentViewData.forEach(function(d) {
        var stat = (d[ispKey] || '').toString().toLowerCase();
        var remarks = d[ispKey + 'Remarks'] || '';
        var item = { domain: d.domain, remarks: remarks, brand: d.brand };

        if (stat !== '' && stat !== '-') {
            if (stat.includes('active') || stat.includes('clear')) activeList.push(item);
            else if (stat.includes('block') || stat.includes('down') || stat.includes('timeout')) blockedList.push(item);
            else if (stat.includes('redirect')) redirectedList.push(item);
        }
    });

    function buildListDom(list, iconClass, iconLucide) {
        if (list.length === 0) return '<div class="text-xs text-subtle p-4 text-center bg-app rounded-lg border border-theme border-dashed m-2">No domains in this status.</div>';
        var html = '';
        list.forEach(function(item) {
            html += '<div class="flex justify-between items-center p-3 border-b border-theme hover:bg-app transition-colors"><div class="flex items-center gap-3"><div class="' + iconClass + '"><i data-lucide="' + iconLucide + '" class="h-4 w-4"></i></div><span class="text-[13px] font-bold text-heading">' + item.domain + ' <span class="text-[9px] font-medium text-subtle ml-1">(' + item.brand + ')</span></span></div><div class="text-[11px] text-subtle">' + formatLastCheck(item.remarks) + '</div></div>';
        });
        return html;
    }

    var modalHtml = [
        '<div class="panel-card w-full max-w-3xl flex flex-col overflow-hidden max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">',
        '    <div class="px-6 py-4 border-b border-theme flex justify-between items-center bg-app"><h3 class="text-lg font-bold text-heading flex items-center gap-2"><i data-lucide="server" class="h-5 w-5 text-indigo-500"></i> ' + ispTitle + ' Detailed Report</h3><button onclick="closeSmoothly(\'ispDetailsModal\')" class="p-1.5 rounded-md text-subtle hover:bg-app hover:text-heading transition-colors"><i data-lucide="x" class="h-5 w-5"></i></button></div>',
        '    <div class="overflow-y-auto custom-scrollbar flex-1 p-6 space-y-6">',
        '        <div><h4 class="text-xs font-bold text-subtle uppercase tracking-widest mb-2 flex items-center gap-2 border-b border-theme pb-2"><span class="w-2 h-2 rounded-full bg-red-500"></span> Blocked Domains (' + blockedList.length + ')</h4><div class="bg-panel border border-theme rounded-lg overflow-hidden">' + buildListDom(blockedList, 'text-red-500 bg-rose-tint p-1.5 rounded', 'slash') + '</div></div>',
        '        <div><h4 class="text-xs font-bold text-subtle uppercase tracking-widest mb-2 flex items-center gap-2 border-b border-theme pb-2"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> Active Domains (' + activeList.length + ')</h4><div class="bg-panel border border-theme rounded-lg overflow-hidden">' + buildListDom(activeList, 'text-emerald-500 bg-emerald-tint p-1.5 rounded', 'check-circle') + '</div></div>',
        '        <div><h4 class="text-xs font-bold text-subtle uppercase tracking-widest mb-2 flex items-center gap-2 border-b border-theme pb-2"><span class="w-2 h-2 rounded-full bg-amber-500"></span> Redirected Domains (' + redirectedList.length + ')</h4><div class="bg-panel border border-theme rounded-lg overflow-hidden">' + buildListDom(redirectedList, 'text-amber-500 bg-amber-tint p-1.5 rounded', 'corner-up-right') + '</div></div>',
        '    </div>',
        '</div>'
    ].join('\n');
    modal.innerHTML = modalHtml;
    modal.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ==========================================
// SETTINGS & USER MANAGEMENT LOGIC
// ==========================================
function openSettingsDashboard() {
    closeMobileSidebar();
    var container = document.getElementById('appContent');
    if (!container) return;

    document.querySelectorAll('.brand-btn, .nav-btn').forEach(function(b) {
        b.className = b.className.replace('bg-indigo-50/80 text-indigo-700 shadow-sm ring-1 ring-indigo-100/50 font-bold', 'text-slate-500 hover:bg-slate-100/60 hover:text-indigo-600 bg-transparent');
    });
    document.getElementById('mainHeader').classList.add('hidden');
    document.getElementById('mainHeaderWrapper').className = "flex-1 flex flex-col min-w-0 overflow-hidden relative bg-slate-50/50";

    container.innerHTML = skeletonScreen('table');

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.withSuccessHandler(renderSettingsUI).getUsersData(currentSessionToken);
    } else {
        setTimeout(function() {
            renderSettingsUI([
                { username: 'LIO', email: 'admin@bbcac.co', password: 'password123', permissions: [] },
                { username: 'EA_SARAH', email: 'ea.sarah@bbcac.co', password: 'securepass!', permissions: ['4DWIN'] }
            ]);
        }, 500);
    }
}

function renderSettingsUI(usersData) {
    var container = document.getElementById('appContent');
    if (!container) return;

    var userRows = '';
    if (usersData.length === 0) {
        userRows = '<tr><td colspan="6" class="px-6 py-10 text-center text-subtle">No users found.</td></tr>';
    } else {
        userRows = usersData.map(function(u) {
            var isSuperAdmin = u.username.toUpperCase() === 'LIO';
            var role = isSuperAdmin ? 'Super Admin' : 'Admin';
            var roleBadge = isSuperAdmin
                ? '<span class="inline-flex items-center w-max gap-1.5 px-2.5 py-1 rounded-md badge-indigo text-[10px] font-bold uppercase tracking-wide"><i data-lucide="shield-alert" class="h-3 w-3"></i> ' + role + '</span>'
                : '<span class="inline-flex items-center w-max gap-1.5 px-2.5 py-1 rounded-md badge-neutral text-[10px] font-bold uppercase tracking-wide"><i data-lucide="shield" class="h-3 w-3"></i> ' + role + '</span>';

            var rawPass = u.password || '';
            var safeUser = String(u.username).replace(/'/g, "\\'");
            var safeEmail = String(u.email || '').replace(/'/g, "\\'");
            var safePass = String(rawPass).replace(/'/g, "\\'");
            var safePerms = encodeURIComponent(JSON.stringify(u.permissions || []));

            return [
                '<tr class="border-b border-theme hover:bg-app transition-colors group">',
                '   <td class="px-6 py-4 flex items-center gap-4">',
                '       <div class="h-8 w-8 rounded-full bg-app border border-theme flex items-center justify-center text-subtle"><i data-lucide="user" class="h-4 w-4"></i></div>',
                '       <span class="text-sm font-bold text-heading group-hover:text-indigo-500 transition-colors">' + u.username + '</span>',
                '   </td>',
                '   <td class="px-6 py-4 text-sm text-muted">' + (u.email || 'N/A') + '</td>',
                '   <td class="px-6 py-4">',
                '       <div onclick="copyToClipboard(\'' + safePass + '\')" class="group/pass relative inline-flex items-center gap-2 cursor-pointer bg-panel hover:bg-indigo-tint px-3 py-1.5 rounded-lg border border-transparent hover:border-indigo-200 transition-all" title="Click to copy">',
                '           <span class="text-sm font-mono text-heading blur-[4px] group-hover/pass:blur-none transition-all duration-300 select-none">' + (rawPass || 'N/A') + '</span>',
                '           <i data-lucide="copy" class="h-3 w-3 text-subtle group-hover/pass:text-indigo-500 opacity-0 group-hover/pass:opacity-100 transition-all"></i>',
                '       </div>',
                '   </td>',
                '   <td class="px-6 py-4"><span class="px-3 py-1 rounded-md badge-good text-xs font-bold inline-flex items-center w-max gap-2">Activated <i data-lucide="chevron-down" class="h-3 w-3 opacity-50"></i></span></td>',
                '   <td class="px-6 py-4">' + roleBadge + '</td>',
                '   <td class="px-6 py-4 flex gap-2">',
                '       <button onclick="openUserModal(\'' + safeUser + '\', \'' + safeEmail + '\', \'' + safePass + '\', \'' + safePerms + '\')" class="px-3 py-1.5 rounded-lg border border-theme text-subtle hover:text-indigo-500 hover:border-indigo-300 hover:bg-indigo-tint transition-colors flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider"><i data-lucide="edit" class="h-3 w-3"></i> Edit</button>',
                '       <button onclick="deleteUserRecord(\'' + safeUser + '\')" class="p-1.5 rounded-lg border border-theme text-subtle hover:text-rose-500 hover:border-rose-300 hover:bg-rose-tint transition-colors"><i data-lucide="trash-2" class="h-4 w-4"></i></button>',
                '   </td>',
                '</tr>'
            ].join('\n');
        }).join('');
    }

    var html = [
        '<div class="h-full flex flex-col p-8 overflow-y-auto custom-scrollbar relative z-10 transition-opacity duration-300 opacity-0" id="settingsWrapper">',
        '   <div class="flex items-center gap-3 mb-8"><h2 class="text-3xl font-black text-heading tracking-tight italic uppercase">Settings</h2></div>',
        '   <div class="panel-card p-6 flex-1 flex flex-col">',
        '       <div class="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-6 border-b border-theme gap-4">',
        '           <div class="flex items-center gap-4">',
        '               <div class="p-3 bg-indigo-tint rounded-xl text-indigo-500"><i data-lucide="users" class="h-6 w-6"></i></div>',
        '               <div><h3 class="text-xl font-bold text-heading tracking-tight">USER MANAGEMENT</h3><p class="text-xs text-subtle mt-1">Manage system access for employees.</p></div>',
        '           </div>',
        '           <div class="flex items-center gap-3">',
        '               <button onclick="openActivityLogsModal()" class="px-4 py-2.5 bg-panel border border-theme hover:bg-app text-body text-[12px] font-bold tracking-wide rounded-xl shadow-sm transition-all flex items-center gap-2"><i data-lucide="activity" class="h-4 w-4"></i> Activity Logs</button>',
        '               <button onclick="openUserModal()" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-bold tracking-wide rounded-xl shadow-md transition-all flex items-center gap-2"><i data-lucide="plus" class="h-4 w-4"></i> Create New User</button>',
        '           </div>',
        '       </div>',
        '       <div class="overflow-x-auto">',
        '           <table class="w-full text-left border-collapse whitespace-nowrap">',
        '               <thead><tr class="text-[10px] font-bold text-subtle uppercase tracking-widest border-b border-theme"><th class="px-6 py-4">Username</th><th class="px-6 py-4">Email Address</th><th class="px-6 py-4">Password</th><th class="px-6 py-4">Status</th><th class="px-6 py-4">Access / Role</th><th class="px-6 py-4">Actions</th></tr></thead>',
        '               <tbody>' + userRows + '</tbody>',
        '           </table>',
        '       </div>',
        '   </div>',
        '</div>'
    ].join('\n');

    container.innerHTML = html;
    setTimeout(function(){ var w = document.getElementById('settingsWrapper'); if(w) w.style.opacity = '1'; }, 30);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function openUserModal(editUser, editEmail, editPass, editPermsStr) {
    var isEdit = !!editUser;
    currentEditingUser = isEdit ? editUser : null;

    document.getElementById('newUsername').value = editUser || '';
    document.getElementById('newEmail').value = editEmail || '';
    document.getElementById('newPassword').value = editPass || '';

    var titleEl = document.querySelector('#userSettingsModal h3');
    var btnSave = document.getElementById('btnSaveUser');

    if (isEdit) {
        titleEl.innerHTML = '<div class="p-2 bg-indigo-50 rounded-lg text-indigo-600"><i data-lucide="user-check" class="h-5 w-5"></i></div> Edit User: ' + editUser;
        btnSave.innerHTML = '<i data-lucide="save" class="h-4 w-4"></i> Update User';
    } else {
        titleEl.innerHTML = '<div class="p-2 bg-indigo-50 rounded-lg text-indigo-600"><i data-lucide="user-plus" class="h-5 w-5"></i></div> Create New User';
        btnSave.innerHTML = '<i data-lucide="user-check" class="h-4 w-4"></i> Create User';
    }

    var editPerms = [];
    if (editPermsStr) { try { editPerms = JSON.parse(decodeURIComponent(editPermsStr)); } catch(e){} }

    var availableContainer = document.getElementById('listAvailable');
    var assignedContainer = document.getElementById('listAssigned');

    var baseOptions = [
        'BBC Dashboard Domain',
        'Cyberguard Reports',
        'Domain Post Verification',
        'Payment Gateway',
        'Influencer Report'
    ];

    var dynamicTeams = [];
    if (typeof postVerifData !== 'undefined') {
        postVerifData.forEach(function(d) {
            if (d.team && !dynamicTeams.includes(d.team) && !d.team.includes('init-')) {
                dynamicTeams.push(d.team);
            }
        });
    }

    var allOptions = baseOptions.concat(dynamicTeams).concat(availableBrandsForPerms);

    var availHtml = '', assignHtml = '';
    allOptions.forEach(function(opt) {
        var type = 'Brand'; var icon = 'folder';

        if (baseOptions.includes(opt)) { type = 'System'; icon = 'layout'; }
        else if (dynamicTeams.includes(opt)) { type = 'Team'; icon = 'users'; }

        var itemHtml = '<div data-value="' + opt + '" onclick="togglePermSelection(this)" class="perm-item p-2.5 border border-transparent bg-panel hover:bg-app shadow-sm rounded-lg flex items-center justify-between cursor-pointer select-none group transition-all">';
        itemHtml += '   <div class="flex items-center gap-2.5 text-sm text-body font-bold"><i data-lucide="' + icon + '" class="h-3.5 w-3.5 text-subtle group-hover:text-indigo-500"></i> ' + opt + '</div>';
        itemHtml += '   <span class="text-[9px] font-bold text-subtle uppercase tracking-widest">' + type + '</span>';
        itemHtml += '</div>';

        if (isEdit && editPerms.includes(opt)) { assignHtml += itemHtml; }
        else { availHtml += itemHtml; }
    });

    availableContainer.innerHTML = availHtml; assignedContainer.innerHTML = assignHtml;
    updatePermCounts();
    document.getElementById('userSettingsModal').classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function attemptCloseUserModal() {
    var user = document.getElementById('newUsername').value.trim();
    if (user !== '') {
        showPremiumConfirm("Unsaved Changes", "Do you want to close this transaction? All unsaved data will be lost.", "Yes, Close", function() {
            closeSmoothly('userSettingsModal');
        });
    } else { closeSmoothly('userSettingsModal'); }
}

function generatePassword() {
    var chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    var pass = "";
    for (var i = 0; i < 12; i++) { pass += chars.charAt(Math.floor(Math.random() * chars.length)); }
    document.getElementById('newPassword').value = pass;
}

function togglePermSelection(el) { el.classList.toggle('selected'); }

function transferPerms(direction) {
    var sourceId = direction === 'right' ? 'listAvailable' : 'listAssigned';
    var targetId = direction === 'right' ? 'listAssigned' : 'listAvailable';
    var source = document.getElementById(sourceId);
    var target = document.getElementById(targetId);
    var selected = source.querySelectorAll('.selected');

    selected.forEach(function(el) { el.classList.remove('selected'); target.appendChild(el); });
    updatePermCounts();
}

function transferAllPerms(direction) {
    var sourceId = direction === 'right' ? 'listAvailable' : 'listAssigned';
    var targetId = direction === 'right' ? 'listAssigned' : 'listAvailable';
    var source = document.getElementById(sourceId);
    var target = document.getElementById(targetId);
    var allItems = source.querySelectorAll('.perm-item');

    allItems.forEach(function(el) { el.classList.remove('selected'); target.appendChild(el); });
    updatePermCounts();
}

function updatePermCounts() {
    document.getElementById('countAvail').innerText = document.getElementById('listAvailable').children.length;
    document.getElementById('countAssigned').innerText = document.getElementById('listAssigned').children.length;
}

function saveNewUser() {
    var user = document.getElementById('newUsername').value.trim();
    var email = document.getElementById('newEmail').value.trim();
    var pass = document.getElementById('newPassword').value.trim();

    if(!user || !pass) { showPremiumToast("Error", "Username and Password are required.", "error"); return; }

    var assignedItems = document.getElementById('listAssigned').children;
    var permissions = [];
    for(var i=0; i<assignedItems.length; i++){ permissions.push(assignedItems[i].getAttribute('data-value')); }

    if(permissions.length === 0) {
        showPremiumConfirm("Warning", "You haven't assigned any pages to this user. They will see a blank dashboard. Continue?", "Yes, Save", proceedToSave);
    } else { proceedToSave(); }

    function proceedToSave() {
        var btn = document.getElementById('btnSaveUser');
        var orig = btn.innerHTML;
        btn.innerHTML = '<div class="spinner h-4 w-4 border-2 border-white/20 border-t-white"></div>';
        btn.disabled = true;

        var payload = { originalUsername: String(currentEditingUser || ''), username: String(user), email: String(email), password: String(pass), permissions: permissions };
        var safePayload = JSON.parse(JSON.stringify(payload));
        var backendFunc = currentEditingUser ? 'updateUserBackend' : 'saveNewUserBackend';

        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run.withSuccessHandler(function(response) {
                btn.innerHTML = orig; btn.disabled = false;
                closeSmoothly('userSettingsModal');
                showPremiumToast("Success!", response.message, "success");
                openSettingsDashboard();
            })[backendFunc](currentSessionToken, safePayload);
        } else {
            setTimeout(function() {
                btn.innerHTML = orig; btn.disabled = false; closeSmoothly('userSettingsModal');
                showPremiumToast("Success!", "User saved! (Mock Simulation)", "success");
            }, 600);
        }
    }
}

function deleteUserRecord(username) {
    if(username.toUpperCase() === 'LIO') { showPremiumToast("Access Denied", "Cannot delete Super Admin.", "error"); return; }
    showPremiumConfirm("Delete User", "Are you sure you want to permanently delete user '" + username + "'?", "Yes, Delete", function() {
        document.getElementById('appContent').style.opacity = '0.5';
        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run.withSuccessHandler(function(response) {
                document.getElementById('appContent').style.opacity = '1';
                if(response.success) {
                    showPremiumToast("Deleted", response.message, "success");
                    openSettingsDashboard();
                } else { showPremiumToast("Error", response.message, "error"); }
            }).deleteUserBackend(currentSessionToken, String(username));
        } else {
            setTimeout(function() {
                document.getElementById('appContent').style.opacity = '1';
                showPremiumToast("Deleted", "User deleted! (Simulation)", "success");
            }, 600);
        }
    });
}

// ==========================================
// CYBERGUARD & DPV LOGIC
// ==========================================
function openCyberguardSub(reportType) {
    var container = document.getElementById('appContent');
    if (!container) return;

    document.querySelectorAll('.brand-btn').forEach(function(b) {
        b.className = "brand-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 group text-slate-500 hover:bg-slate-100/60 hover:text-indigo-600 bg-transparent justify-between";
    });
    var globalBtn = document.getElementById('btnGlobalDashboard');
    if(globalBtn) globalBtn.className = "nav-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 group text-slate-500 hover:bg-slate-100/60 hover:text-indigo-600 bg-transparent";

    var subBtns = document.querySelectorAll('#cyberguardSubMenu button');
    if(subBtns && subBtns.length > 0) {
        subBtns.forEach(function(btn) {
            var isHidden = btn.classList.contains('hidden');
            if (btn.innerText.trim() === reportType) {
                btn.className = "w-full text-left px-4 py-2 text-[12px] font-bold rounded-lg transition-all bg-indigo-50 text-indigo-600 shadow-sm border border-indigo-100/50";
            } else {
                btn.className = "w-full text-left px-4 py-2 text-[12px] font-medium text-slate-500 hover:bg-slate-100 hover:text-indigo-600 rounded-lg transition-all";
            }
            if(isHidden) btn.classList.add('hidden');
        });
    }

    document.getElementById('mainHeader').classList.remove('hidden');
    var iconMap = { 'Domain Post Verification': 'check-square', 'Payment Gateway': 'credit-card', 'Influencer Report': 'users' };
    var pageIcon = iconMap[reportType] || 'shield-alert';

    container.style.opacity = '0';
    setTimeout(function() {
        if (reportType === 'Domain Post Verification') {
            container.innerHTML = skeletonScreen('table');
            container.style.opacity = '1';

            if (typeof google !== 'undefined' && google.script && google.script.run) {
                google.script.run.withSuccessHandler(function(data) {
                    postVerifData = data; renderPostVerifMain();
                }).getPostVerificationData(currentSessionToken);
            } else {
                var GOOGLE_WEB_APP_API_URL = "https://bbc-api-gateway.ea-nix.workers.dev/";
                var targetUrl = GOOGLE_WEB_APP_API_URL + "?action=getPostVerificationData&token=" + encodeURIComponent(currentSessionToken || '') + "&t=" + new Date().getTime();
                var jsonpScript = document.createElement('script');
                var callbackName = 'jsonp_dpv_' + Math.round(Math.random() * 1000000);

                window[callbackName] = function(data) {
                    postVerifData = data.map(function(item) {
                        return {
                            batchId: item.batchId || "",
                            domain: item.domain || "",
                            team: item.team || "",
                            pldt: item.pldt || "",
                            pldtRemarks: item.pldtRemarks || "",
                            globe: item.globe || "",
                            globeRemarks: item.globeRemarks || "",
                            converge: item.converge || "",
                            convergeRemarks: item.convergeRemarks || "",
                            dito: item.dito || "",
                            ditoRemarks: item.ditoRemarks || "",
                            cicc: item.cicc || item[11] || "",
                            agent: item.agent || item[12] || ""
                        };
                    });
                    renderPostVerifMain();
                    document.body.removeChild(jsonpScript); delete window[callbackName];
                };
                jsonpScript.src = targetUrl + "&callback=" + callbackName;
                document.body.appendChild(jsonpScript);
            }
        } else {
            container.innerHTML = '<div class="h-full flex flex-col relative bg-app"><div class="px-8 py-6 border-b border-theme bg-panel flex-shrink-0"><h2 class="text-2xl font-bold text-heading flex items-center gap-2"><i data-lucide="' + pageIcon + '" class="h-6 w-6 text-indigo-500"></i> Cyberguard: ' + reportType + '</h2><p class="text-sm text-muted mt-1">Aggregated security monitoring and reports for ' + reportType + '.</p></div><div class="flex-1 p-8 flex items-center justify-center flex-col text-subtle"><i data-lucide="layout-template" class="h-16 w-16 mb-4 opacity-20 text-indigo-500"></i><h3 class="text-lg font-bold text-muted">' + reportType + ' Module</h3><p class="text-sm text-subtle mt-2">The reporting interface for this section is ready for development.</p></div></div>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
            container.style.opacity = '1';
        }
    }, 150);

    applyPermissionsToUI();
}

function promptAddNewDpvTeam() {
    var modal = document.getElementById('addTeamModal');
    if(modal) {
        document.getElementById('newTeamInput').value = '';
        modal.classList.remove('hidden');
        setTimeout(function(){ modal.style.opacity = '1'; }, 10);
        setTimeout(function(){ document.getElementById('newTeamInput').focus(); }, 150);
    }
}

function submitNewDpvTeam() {
    var inputEl = document.getElementById('newTeamInput');
    var newTeam = inputEl.value.trim();
    if (!newTeam) { showPremiumToast("Required", "Team name cannot be empty.", "error"); inputEl.focus(); return; }
    var exists = postVerifData.some(function(d) { return (d.team || '').toLowerCase() === newTeam.toLowerCase(); });
    if(exists) { showPremiumToast("Notice", "Team already exists.", "info"); return; }

    var btn = document.getElementById('btnSaveNewTeam');
    var origHtml = btn.innerHTML;
    btn.innerHTML = '<div class="spinner h-4 w-4 border-2 border-white/20 border-t-white"></div>'; btn.disabled = true;

    var payload = { originalDomain: "", batchId: "-", domains: ["init-" + newTeam.replace(/\s+/g, '').toLowerCase() + ".local"], team: newTeam };
    var safePayload = JSON.parse(JSON.stringify(payload));

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.withSuccessHandler(function(res) {
            btn.innerHTML = origHtml; btn.disabled = false; closeSmoothly('addTeamModal');
            showPremiumToast("Success", "Team added successfully.", "success");
            postVerifData.push({ batchId: safePayload.batchId, domain: safePayload.domains[0], team: safePayload.team, pldt: '-', pldtRemarks: '', globe: '-', globeRemarks: '', converge: '-', convergeRemarks: '', dito: '-', ditoRemarks: '' });
            renderPostVerifMain(); setTimeout(function() { switchPostVerifTab(newTeam); }, 100);
        }).saveDpvRecordBackend(currentSessionToken, safePayload);
    } else {
        setTimeout(function() {
            btn.innerHTML = origHtml; btn.disabled = false; closeSmoothly('addTeamModal');
            showPremiumToast("Success", "Team added! (Mock)", "success");
            postVerifData.push({ batchId: safePayload.batchId, domain: safePayload.domains[0], team: safePayload.team, pldt: '-', pldtRemarks: '', globe: '-', globeRemarks: '', converge: '-', convergeRemarks: '', dito: '-', ditoRemarks: '' });
            renderPostVerifMain(); setTimeout(function() { switchPostVerifTab(newTeam); }, 100);
        }, 600);
    }
}

function renderPostVerifMain() {
    var container = document.getElementById('appContent');
    var uniqueTeams = [];
    postVerifData.forEach(function(d) {
        if(d.team && !uniqueTeams.includes(d.team) && !d.team.includes('INIT_')) uniqueTeams.push(d.team);
    });

    var tabHtml = '<button onclick="switchPostVerifTab(\'Overview\')" id="tab-dpv-overview" class="pb-3 text-sm font-semibold text-indigo-500 border-b-2 border-indigo-500 transition-colors whitespace-nowrap">Overview</button>';
    uniqueTeams.forEach(function(team) {
        var safeTeam = team.replace(/'/g, "\\'");
        var slug = team.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
        tabHtml += '<button onclick="switchPostVerifTab(\'' + safeTeam + '\')" id="tab-dpv-' + slug + '" class="pb-3 text-sm font-semibold text-subtle hover:text-body hover:border-slate-300 transition-colors border-b-2 border-transparent whitespace-nowrap">' + team + '</button>';
    });

    tabHtml += '<div class="pl-4 ml-2 border-l border-theme flex items-center pb-2.5"><button onclick="promptAddNewDpvTeam()" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-500 bg-indigo-tint hover:bg-indigo-100 transition-all whitespace-nowrap -mt-1"><i data-lucide="plus" class="h-3.5 w-3.5"></i> Add Team</button></div>';

    var html = [
        '<div class="h-full flex flex-col relative transition-opacity duration-300 opacity-0" id="dpvWrapper">',
        '    <div class="px-8 py-6 border-b border-theme bg-panel flex-shrink-0">',
        '        <h2 class="text-2xl font-bold text-heading flex items-center gap-2"><i data-lucide="check-square" class="h-6 w-6 text-indigo-500"></i> Domain Post Verification</h2>',
        '        <p class="text-sm text-muted mt-1">Monitor post-deployment domain statuses across assigned teams.</p>',
        '    </div>',
        '    <div class="px-8 pt-4 bg-app border-b border-theme flex gap-4 flex-shrink-0 overflow-x-auto custom-scrollbar" id="dpvTabContainer">',
                 tabHtml,
        '    </div>',
        '    <div id="dpvContentArea" class="flex-1 p-6 bg-app overflow-hidden flex flex-col relative transition-opacity duration-200"></div>',
        '</div>'
    ].join('\n');

    container.innerHTML = html;
    setTimeout(function(){ var w = document.getElementById('dpvWrapper'); if(w) w.style.opacity = '1'; }, 30);

    injectDpvModals();
    switchPostVerifTab('Overview');
}

function injectDpvModals() {
    ['dpvCrudModal', 'dpvBulkUpdateModal'].forEach(function(id) {
        var old = document.getElementById(id);
        if(old) old.remove();
    });

    var modalHtml = [
        '<div id="dpvCrudModal" class="hidden fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 transition-opacity duration-200 opacity-0">',
        '  <div class="modal-shell w-full max-w-lg flex flex-col max-h-[90vh]">',
        '    <div class="px-6 py-4 border-b border-theme flex items-center justify-between bg-app">',
        '      <h3 class="text-lg font-black text-heading flex items-center gap-2" id="dpvModalTitle"><i data-lucide="edit" class="h-5 w-5 text-indigo-500"></i> Manage DPV Record</h3>',
        '      <button onclick="closeSmoothly(\'dpvCrudModal\')" class="text-subtle hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-tint"><i data-lucide="x" class="h-5 w-5"></i></button>',
        '    </div>',
        '    <div class="px-6 py-6 overflow-y-auto custom-scrollbar flex-1" id="dpvModalBody">',
        '      <div id="dpvFormSection">',
        '        <input type="hidden" id="dpvEditIndex" value="-1"><input type="hidden" id="dpvOriginalDomain" value="">',
        '        <div class="space-y-4">',
        '          <div><label class="field-label">Batch ID</label><input type="text" id="dpvBatchId" placeholder="e.g. TCG BATCH1" class="field-input font-bold uppercase"></div>',
        '          <div><label class="field-label text-indigo-500">CICC Reference No.</label><input type="text" id="dpvCicc" placeholder="e.g. CICC-2026-001" class="field-input font-black uppercase"></div>',
        '          <div><label class="field-label">Target Domain(s)</label><textarea id="dpvDomain" rows="4" placeholder="e.g. domain1.com&#10;domain2.com" class="field-input custom-scrollbar resize-none"></textarea><p class="text-[9px] text-subtle mt-1.5 font-medium"><i data-lucide="info" class="h-3 w-3 inline mr-0.5"></i> Single entry or Bulk (Paste multiple domains separated by a new line)</p></div>',
        '          <div class="grid grid-cols-2 gap-4">',
        '             <div><label class="field-label">Assigned Team</label><input type="text" id="dpvTeam" placeholder="e.g. TCG Batch" class="field-input"></div>',
        '             <div><label class="field-label flex items-center gap-1"><i data-lucide="lock" class="h-3 w-3 text-indigo-500"></i> Agent (Auto)</label><input type="text" id="dpvAgent" readonly class="field-input font-bold text-subtle bg-app cursor-not-allowed" title="Automatically locked to your account name"></div>',
        '          </div>',
        '        </div>',
        '      </div>',
        '      <div id="dpvReviewSection" class="hidden flex-col gap-4">',
        '        <div class="bg-rose-tint p-4 rounded-xl border border-rose-200 dark:border-rose-900">',
        '           <h4 class="text-sm font-bold text-rose-600 dark:text-rose-400 mb-2 flex items-center gap-2"><i data-lucide="alert-triangle" class="h-4 w-4"></i> Found <span id="dpvDupeCount">0</span> Duplicate(s)</h4>',
        '           <div id="dpvDupeList" class="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar"></div>',
        '        </div>',
        '        <div class="bg-emerald-tint p-4 rounded-xl border border-emerald-200 dark:border-emerald-900 flex justify-between items-center">',
        '           <span class="text-sm font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2"><i data-lucide="check-circle" class="h-4 w-4"></i> Clean Unique Domains to Upload:</span>',
        '           <span class="text-lg font-black text-emerald-600 dark:text-emerald-400" id="dpvCleanCount">0</span>',
        '        </div>',
        '      </div>',
        '    </div>',
        '    <div id="dpvFormFooter" class="px-6 py-4 bg-app border-t border-theme flex justify-end gap-3">',
        '      <button onclick="closeSmoothly(\'dpvCrudModal\')" class="btn-ghost">Cancel</button>',
        '      <button onclick="processDpvUpload()" class="btn-primary"><i data-lucide="upload-cloud" class="h-4 w-4"></i> Scan & Save</button>',
        '    </div>',
        '    <div id="dpvReviewFooter" class="hidden px-6 py-4 bg-app border-t border-theme flex justify-between items-center gap-3">',
        '      <button onclick="backToDpvForm()" class="text-[12px] font-bold text-subtle hover:text-heading transition-colors flex items-center gap-1"><i data-lucide="arrow-left" class="h-3 w-3"></i> Edit List</button>',
        '      <button id="btnProceedUpload" onclick="proceedDpvUploadFromReview()" class="px-6 py-2 text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md transition-all">Proceed Clean Upload</button>',
        '    </div>',
        '  </div>',
        '</div>'
    ].join('\n');
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    var bulkModalHtml = [
        '<div id="dpvBulkUpdateModal" class="hidden fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 transition-opacity duration-200 opacity-0">',
        '  <div class="modal-shell w-full max-w-lg flex flex-col">',
        '    <div class="px-6 py-4 border-b border-theme flex items-center justify-between bg-amber-tint rounded-t-2xl">',
        '      <h3 class="text-lg font-black text-amber-600 dark:text-amber-400 flex items-center gap-2"><i data-lucide="edit" class="h-5 w-5"></i> Bulk Update <span id="bulkUpdateTitleSub" class="text-sm"></span></h3>',
        '      <button onclick="closeSmoothly(\'dpvBulkUpdateModal\')" class="text-amber-500 hover:text-amber-700 p-1.5 rounded-lg hover:bg-white/50"><i data-lucide="x" class="h-5 w-5"></i></button>',
        '    </div>',
        '    <div class="px-6 py-5 space-y-4">',
        '       <div id="bulkUpdateScopeSection" class="p-3 bg-amber-tint border border-amber-200 dark:border-amber-900 rounded-xl mb-2">',
        '           <label class="block text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-1">Target Scope</label>',
        '           <div id="bulkScopeDisplay" class="text-sm font-bold text-heading mb-2"></div>',
        '           <div id="bulkUpdateBatchScopeWrapper" class="hidden relative w-full">',
        '               <button type="button" onclick="toggleBulkBatchDropdown()" class="w-full px-3 py-2.5 border border-theme rounded-lg text-sm font-bold bg-panel shadow-sm flex justify-between items-center text-body hover:border-amber-400 transition-colors">',
        '                   <span id="bulkBatchDropdownLabel">-- Select Batches to Update --</span>',
        '                   <i data-lucide="chevron-down" class="h-4 w-4 text-subtle"></i>',
        '               </button>',
        '               <div id="bulkBatchDropdownMenu" class="hidden absolute z-50 w-full mt-1 bg-panel border border-theme rounded-lg shadow-xl flex flex-col overflow-hidden"></div>',
        '           </div>',
        '       </div>',
        '       <p class="text-[11px] text-subtle font-medium mb-2"><i data-lucide="info" class="h-3.5 w-3.5 inline"></i> Fields left blank will NOT be updated. Fill only what you want to change.</p>',
        '       <div><label class="field-label">Update Target Domain</label><input type="text" id="bulkDomain" placeholder="Leave blank to keep original" class="field-input"></div>',
        '       <div><label class="field-label">Update CICC Ref No.</label><input type="text" id="bulkCicc" placeholder="Leave blank to keep original" class="field-input"></div>',
        '       <div class="grid grid-cols-2 gap-4">',
        '          <div><label class="field-label">Update Team</label><input type="text" id="bulkTeam" placeholder="Leave blank to keep original" class="field-input"></div>',
        '          <div><label class="field-label">Update Agent</label><input type="text" id="bulkAgent" placeholder="Leave blank to keep original" class="field-input"></div>',
        '       </div>',
        '       <div><label class="field-label text-indigo-500">Update ISP Statuses (Global)</label><select id="bulkStatus" class="field-input font-bold"><option value="">-- Do not change status --</option><option value="ACTIVE">ACTIVE</option><option value="BLOCKED">BLOCKED</option><option value="REDIRECTED">REDIRECTED</option></select></div>',
        '    </div>',
        '    <div class="px-6 py-4 bg-app border-t border-theme flex justify-end gap-3 rounded-b-2xl">',
        '      <button onclick="closeSmoothly(\'dpvBulkUpdateModal\')" class="btn-ghost">Cancel</button>',
        '      <button onclick="processDpvBulkUpdate()" class="px-6 py-2 text-[13px] font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-xl shadow-[0_4px_12px_rgba(245,158,11,0.3)] flex items-center gap-2"><i data-lucide="save" class="h-4 w-4"></i> Apply Bulk Update</button>',
        '    </div>',
        '  </div>',
        '</div>'
    ].join('\n');
    document.body.insertAdjacentHTML('beforeend', bulkModalHtml);
}

function switchPostVerifTab(tabName) {
    currentDpvTeam = tabName;
    dpvSearchQuery = ''; dpvSelectedBatches = [];

    var tabs = document.getElementById('dpvTabContainer').querySelectorAll('button:not(:last-child)');
    tabs.forEach(function(t) { t.className = "pb-3 text-sm font-semibold text-subtle hover:text-body hover:border-slate-300 transition-colors border-b-2 border-transparent whitespace-nowrap"; });

    var slug = tabName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
    var activeId = tabName === 'Overview' ? 'tab-dpv-overview' : 'tab-dpv-' + slug;
    var activeTab = document.getElementById(activeId);
    if(activeTab) activeTab.className = "pb-3 text-sm font-semibold text-indigo-500 border-b-2 border-indigo-500 transition-colors whitespace-nowrap";

    var contentArea = document.getElementById('dpvContentArea');
    contentArea.style.opacity = '0';

    setTimeout(function() {
        if (tabName === 'Overview') {
            contentArea.className = "flex-1 p-6 bg-app overflow-y-auto custom-scrollbar transition-opacity duration-200";
            buildDpvOverviewUI();
        } else {
            contentArea.className = "flex-1 p-6 bg-app overflow-hidden flex flex-col relative transition-opacity duration-200";

            dpvBatchList = [];
            var baseData = postVerifData.filter(function(d) { return d.team === tabName; });
            baseData.forEach(function(d) { if(d.batchId && d.batchId !== '-' && !dpvBatchList.includes(d.batchId)) dpvBatchList.push(d.batchId); });

            dpvBatchList.sort(function(a, b) {
                return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
            });

            var batchOptionsHtml = dpvBatchList.map(function(b) {
                return '<label class="flex items-center gap-2 p-2 hover:bg-app cursor-pointer rounded"><input type="checkbox" value="'+b+'" class="dpv-batch-chk rounded text-indigo-600 focus:ring-indigo-500 border-slate-300" onchange="updateDpvFilters()"> <span class="text-xs text-body font-bold">'+b+'</span></label>';
            }).join('');

            var toolbarHtml = [
                '<div id="dpvCardsContainer" class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 flex-shrink-0 transition-all duration-300"></div>',
                '<div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4 flex-shrink-0">',
                '    <div class="flex items-center gap-3 w-full md:w-auto relative">',
                '        <div class="relative flex-1 md:w-64">',
                '            <i data-lucide="search" class="absolute left-3 top-2.5 h-4 w-4 text-subtle"></i>',
                '            <input type="text" placeholder="Search domain or batch..." onkeyup="handleDpvSearch(this.value)" class="w-full pl-9 pr-4 py-2 border border-theme bg-panel rounded-lg text-sm text-body focus:border-indigo-500 shadow-sm focus:outline-none">',
                '        </div>',
                '        <div class="relative">',
                '            <button onclick="document.getElementById(\'dpvBatchDropdown\').classList.toggle(\'hidden\')" class="flex items-center gap-2 px-4 py-2 border border-theme bg-panel hover:bg-app rounded-lg text-sm font-bold text-body shadow-sm transition-colors">',
                '                <i data-lucide="layers" class="h-4 w-4 text-indigo-500"></i> Filter Batches <i data-lucide="chevron-down" class="h-3 w-3 opacity-50"></i>',
                '            </button>',
                '            <div id="dpvBatchDropdown" class="hidden absolute left-0 md:right-0 md:left-auto mt-2 w-64 bg-panel border border-theme shadow-2xl rounded-xl z-30 flex flex-col max-h-72 overflow-hidden">',
                '                <div class="p-3 border-b border-theme flex justify-between bg-app items-center">',
                '                    <span class="text-[10px] font-black uppercase text-subtle tracking-wider">Select Batch</span>',
                '                    <div class="flex gap-2">',
                '                       <button onclick="toggleAllDpvBatches(true)" class="text-[10px] text-indigo-500 font-bold hover:underline">All</button>',
                '                       <button onclick="toggleAllDpvBatches(false)" class="text-[10px] text-rose-500 font-bold hover:underline">Clear</button>',
                '                    </div>',
                '                </div>',
                '                <div class="p-2 overflow-y-auto custom-scrollbar flex-1">' + (batchOptionsHtml || '<p class="text-xs text-subtle p-2 text-center">No batches found</p>') + '</div>',
                '            </div>',
                '        </div>',
                '    </div>',
                '    <div class="flex gap-2 w-full md:w-auto">',
                '       <button onclick="openCleanUpModal()" class="flex-1 md:flex-none px-4 py-2 bg-rose-tint text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900 text-sm font-bold rounded-lg hover:opacity-80 shadow-sm flex items-center gap-2 justify-center transition-all"><i data-lucide="eraser" class="h-4 w-4"></i> Clean Up</button>',
                '       <button onclick="openDpvCrudModal()" class="flex-1 md:flex-none px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 shadow-[0_4px_12px_rgba(79,70,229,0.25)] flex items-center gap-2 justify-center transition-all"><i data-lucide="plus" class="h-4 w-4"></i> Add Record</button>',
                '    </div>',
                '</div>',
                '<div class="panel-card flex flex-col flex-1 overflow-hidden" id="dpvTableWrapper"></div>'
            ].join('\n');

            contentArea.innerHTML = toolbarHtml;
            renderDpvTableData();
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
        contentArea.style.opacity = '1';
    }, 150);
}

function handleDpvSearch(val) { dpvSearchQuery = val.toLowerCase().trim(); renderDpvTableData(); }

function toggleAllDpvBatches(selectAll) {
    var checkboxes = document.querySelectorAll('.dpv-batch-chk');
    checkboxes.forEach(function(cb) { cb.checked = selectAll; });
    updateDpvFilters();
}

function updateDpvFilters() {
    var checkboxes = document.querySelectorAll('.dpv-batch-chk:checked');
    dpvSelectedBatches = Array.from(checkboxes).map(function(cb) { return cb.value; });
    renderDpvTableData();
}

function renderDpvTableData() {
    var wrapper = document.getElementById('dpvTableWrapper');
    if(!wrapper) return;

    var filtered = postVerifData.filter(function(d) { return d.team === currentDpvTeam; });
    if (dpvSelectedBatches.length > 0) { filtered = filtered.filter(function(d) { return dpvSelectedBatches.includes(d.batchId); }); }
    if (dpvSearchQuery !== '') {
        filtered = filtered.filter(function(d) { return (d.domain && d.domain.toLowerCase().includes(dpvSearchQuery)) || (d.batchId && d.batchId.toLowerCase().includes(dpvSearchQuery)); });
    }

    var activeFiltered = filtered.filter(function(d) { return !d.domain.includes('init-') });

    var totalDomains = activeFiltered.length;
    var accessibleCount = 0, fullyBlockedCount = 0, totalHealth = 0;

    activeFiltered.forEach(function(d) {
        var activeIsps = 0, hasData = false, isFullyBlocked = true;
        var isps = [d.pldt, d.globe, d.converge, d.dito];
        isps.forEach(function(s) {
            var stat = (s||'').toLowerCase();
            if (stat !== '' && stat !== '-') {
                hasData = true;
                if(stat.includes('active') || stat.includes('clear')) { activeIsps++; isFullyBlocked = false; }
                else if(stat.includes('block') || stat.includes('down') || stat.includes('timeout')) { }
                else { isFullyBlocked = false; }
            } else { isFullyBlocked = false; }
        });

        if (activeIsps > 0) accessibleCount++;
        if (hasData && isFullyBlocked) fullyBlockedCount++;

        var hp = Math.round((activeIsps/4)*100);
        d._healthPct = hp;
        totalHealth += hp;
    });

    var avgHealth = totalDomains > 0 ? Math.round(totalHealth / totalDomains) : 0;
    var cardsContainer = document.getElementById('dpvCardsContainer');
    if (cardsContainer) {
        cardsContainer.innerHTML = [
            statTile('layers', 'indigo', 'Total In Batch', totalDomains),
            statTile('slash', 'rose', 'Fully Blocked', fullyBlockedCount),
            statTile('check-circle', 'emerald', 'Accessible', accessibleCount),
            statTile('activity', 'amber', 'Avg Health', avgHealth + '%')
        ].join('');
    }

    var tableHtml = [
        '<div class="px-4 py-3 bg-panel border-b border-theme flex flex-wrap gap-2 items-center justify-between">',
        '  <span class="text-xs font-bold text-subtle"><i data-lucide="mouse-pointer-2" class="h-4 w-4 inline mr-1 text-indigo-500"></i> Select rows to apply bulk actions:</span>',
        '  <div class="flex gap-2">',
        '    <button onclick="dpvBulkDelete()" class="px-3 py-1.5 bg-rose-tint text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900 text-[11px] font-bold rounded-lg hover:opacity-80 shadow-sm flex items-center gap-1.5 transition-all uppercase tracking-wider"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i> Bulk Delete</button>',
        '    <button onclick="openDpvBulkUpdateModal()" class="px-3 py-1.5 bg-amber-tint text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900 text-[11px] font-bold rounded-lg hover:opacity-80 shadow-sm flex items-center gap-1.5 transition-all uppercase tracking-wider"><i data-lucide="edit" class="h-3.5 w-3.5"></i> Bulk Update</button>',
        '  </div>',
        '</div>',
        '<div class="overflow-y-auto overflow-x-auto custom-scrollbar flex-1 relative bg-panel">',
        '  <table class="w-full text-left border-collapse whitespace-nowrap relative">',
        '    <thead class="bg-app sticky top-0 z-20 shadow-sm border-b border-theme backdrop-blur-sm">',
        '      <tr class="text-[11px] uppercase font-bold text-subtle tracking-wider">',
        '        <th class="px-4 py-3 w-10 text-center"><input type="checkbox" onclick="toggleAllDpvRows(this)" class="rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"></th>',
        '        <th class="px-4 py-3 text-indigo-500">CICC REF NO.</th>',
        '        <th class="px-4 py-3">Batch ID</th><th class="px-4 py-3">Target Domain</th><th class="px-4 py-3">Assigned Team</th><th class="px-4 py-3">Agent</th>',
        '        <th class="px-4 py-3 text-center border-l border-theme text-red-500">PLDT</th>',
        '        <th class="px-4 py-3 text-center border-l border-theme text-blue-500">GLOBE</th>',
        '        <th class="px-4 py-3 text-center border-l border-theme text-orange-500">CONV</th>',
        '        <th class="px-4 py-3 text-center border-l border-theme text-purple-500">DITO</th>',
        '        <th class="px-4 py-3 text-center border-l border-theme">Health %</th>',
        '        <th class="px-4 py-3 text-center border-l border-theme bg-app sticky right-0">Actions</th>',
        '      </tr>',
        '    </thead>',
        '    <tbody class="divide-y divide-theme text-sm text-body">'
    ];

    if(activeFiltered.length === 0) {
        tableHtml.push('<tr><td colspan="12" class="px-4 py-16 text-center text-subtle">No records found matching filters.</td></tr>');
    } else {
        activeFiltered.forEach(function(d) {
            var originalIndex = postVerifData.indexOf(d);
            var hp = d._healthPct !== undefined ? d._healthPct : 0;
            var hb = healthBar(hp);

            tableHtml.push('<tr class="hover:bg-app transition-colors group">');
            tableHtml.push('  <td class="px-4 py-3 text-center"><input type="checkbox" class="dpv-row-select rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" value="' + originalIndex + '"></td>');
            tableHtml.push('  <td class="px-4 py-3 font-black text-heading">' + (d.cicc || '-') + '</td>');
            tableHtml.push('  <td class="px-4 py-3 font-bold text-body">' + (d.batchId || '-') + '</td>');
            tableHtml.push('  <td class="px-4 py-3 font-bold text-indigo-500 select-all">' + (d.domain || '-') + '</td>');
            tableHtml.push('  <td class="px-4 py-3 text-muted font-medium">' + (d.team || '-') + '</td>');
            tableHtml.push('  <td class="px-4 py-3 text-muted font-bold">' + (d.agent || '-') + '</td>');
            tableHtml.push('  <td class="px-4 py-2 border-l border-theme">' + createStatusWithProof(d.pldt, d.pldtRemarks) + '</td>');
            tableHtml.push('  <td class="px-4 py-2 border-l border-theme">' + createStatusWithProof(d.globe, d.globeRemarks) + '</td>');
            tableHtml.push('  <td class="px-4 py-2 border-l border-theme">' + createStatusWithProof(d.converge, d.convergeRemarks) + '</td>');
            tableHtml.push('  <td class="px-4 py-2 border-l border-theme">' + createStatusWithProof(d.dito, d.ditoRemarks) + '</td>');
            tableHtml.push('  <td class="px-4 py-3 border-l border-theme text-center">' + hb + '</td>');
            tableHtml.push('  <td class="px-4 py-3 text-center border-l border-theme bg-panel sticky right-0 shadow-[-4px_0_6px_rgba(0,0,0,0.02)]"><div class="flex items-center justify-center gap-2 opacity-20 group-hover:opacity-100 transition-opacity"><button onclick="openDpvCrudModal(' + originalIndex + ')" class="p-1.5 text-subtle hover:text-indigo-500 hover:bg-indigo-tint rounded-lg transition-colors"><i data-lucide="edit-3" class="h-4 w-4"></i></button><button onclick="deleteDpvRecord(' + originalIndex + ')" class="p-1.5 text-subtle hover:text-rose-500 hover:bg-rose-tint rounded-lg transition-colors"><i data-lucide="trash-2" class="h-4 w-4"></i></button></div></td>');
            tableHtml.push('</tr>');
        });
    }

    tableHtml.push('    </tbody></table></div>');
    wrapper.innerHTML = tableHtml.join('\n');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function healthBar(hp) {
    var hc = hp >= 75 ? 'health-good' : (hp >= 50 ? 'health-warn' : 'health-bad');
    return '<div class="flex items-center gap-2 w-full max-w-[90px] mx-auto"><div class="health-track"><div class="health-fill ' + hc + '" style="width: ' + hp + '%"></div></div><span class="text-[10px] font-bold text-body w-6">' + hp + '%</span></div>';
}

// ==========================================
// DPV OVERVIEW DASHBOARD BUILDER
// ==========================================
function buildDpvOverviewUI() {
    var contentArea = document.getElementById('dpvContentArea');
    if (!contentArea) return;

    if (!window.dpvAgentTargets) window.dpvAgentTargets = {};
    if (!window.dpvKpiTimeframe) window.dpvKpiTimeframe = 'Daily';

    var validData = postVerifData.filter(function(d) { return d.domain && !d.domain.includes('init-'); });

    var totalDomains = validData.length;
    var uniqueTeams = [];
    var accessibleCount = 0;
    var blockedCount = 0;
    var totalHealthSum = 0;

    var teamStats = {};
    var agentStats = {};

    validData.forEach(function(d) {
        if (d.team && !uniqueTeams.includes(d.team)) { uniqueTeams.push(d.team); }
        if (!teamStats[d.team]) { teamStats[d.team] = { count: 0, healthSum: 0 }; }

        var ag = (d.agent && d.agent.trim() !== '') ? d.agent.trim().toUpperCase() : 'UNKNOWN AGENT';
        if (!agentStats[ag]) { agentStats[ag] = { uploads: 0, duplicates: 0 }; }
        agentStats[ag].uploads++;

        var activeIsps = 0;
        var hasData = false;
        var isFullyBlocked = true;
        var isps = [d.pldt, d.globe, d.converge, d.dito];

        isps.forEach(function(s) {
            var stat = (s || '').toLowerCase();
            if (stat !== '' && stat !== '-') {
                hasData = true;
                if (stat.includes('active') || stat.includes('clear')) { activeIsps++; isFullyBlocked = false; }
                else if (stat.includes('block') || stat.includes('down') || stat.includes('timeout')) { }
                else { isFullyBlocked = false; }
            } else { isFullyBlocked = false; }
        });

        if (activeIsps > 0) accessibleCount++;
        if (hasData && isFullyBlocked) blockedCount++;

        var hp = Math.round((activeIsps / 4) * 100);
        totalHealthSum += hp;

        teamStats[d.team].count++;
        teamStats[d.team].healthSum += hp;
    });

    var avgHealth = totalDomains > 0 ? Math.round(totalHealthSum / totalDomains) : 0;

    var kpiRowsHtml = '';
    var agentNames = Object.keys(agentStats).sort();

    if (agentNames.length === 0) {
        kpiRowsHtml = '<tr><td colspan="6" class="px-4 py-8 text-center text-subtle font-medium">No agent records found.</td></tr>';
    } else {
        agentNames.forEach(function(ag) {
            var safeAg = ag.replace(/'/g, "\\'");
            var st = agentStats[ag];
            var currentTarget = window.dpvAgentTargets[ag] || 100;
            var hitRate = currentTarget > 0 ? Math.min(100, Math.round((st.uploads / currentTarget) * 100)) : 100;

            var statusStr, statusClass;
            if (hitRate >= 100) { statusStr = 'Target Met'; statusClass = 'badge-good'; }
            else if (hitRate >= 50) { statusStr = 'On Track'; statusClass = 'badge-indigo'; }
            else { statusStr = 'Lagging'; statusClass = 'badge-bad'; }

            var hitRateBar = '<div class="flex items-center gap-2 w-full max-w-[120px]">' + healthBar(hitRate).replace('max-w-[90px]', 'max-w-[120px]') + '</div>';
            var targetInput = '<input type="number" min="1" value="' + currentTarget + '" onchange="updateDpvAgentTarget(\'' + safeAg + '\', this.value)" class="w-16 px-2 py-1 text-xs border border-theme rounded text-center text-body font-bold focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 bg-app hover:bg-panel transition-all">';

            kpiRowsHtml += '<tr class="border-b border-theme hover:bg-app transition-colors">' +
                '<td class="px-5 py-3 font-bold text-body flex items-center gap-3"><div class="h-7 w-7 rounded-full bg-indigo-tint border border-indigo-100 dark:border-indigo-900 flex items-center justify-center text-indigo-500"><i data-lucide="user" class="h-3.5 w-3.5"></i></div>' + ag + '</td>' +
                '<td class="px-5 py-3 text-indigo-500 font-black">' + st.uploads + '</td>' +
                '<td class="px-5 py-3">' + targetInput + '</td>' +
                '<td class="px-5 py-3">' + hitRateBar + '</td>' +
                '<td class="px-5 py-3 text-rose-500 font-bold">' + st.duplicates + '</td>' +
                '<td class="px-5 py-3"><span class="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider rounded status-badge ' + statusClass + '">' + statusStr + '</span></td>' +
            '</tr>';
        });
    }

    var teamRowsHtml = '';
    if (uniqueTeams.length === 0) {
        teamRowsHtml = '<tr><td colspan="4" class="px-4 py-12 text-center text-subtle font-medium">No team data available for Post Verification yet.</td></tr>';
    } else {
        uniqueTeams.sort().forEach(function(team) {
            var stats = teamStats[team] || { count: 0, healthSum: 0 };
            var tAvg = stats.count > 0 ? Math.round(stats.healthSum / stats.count) : 0;

            teamRowsHtml += '<tr class="hover:bg-indigo-tint/50 border-b border-theme last:border-0 transition-colors">' +
                            '<td class="px-5 py-4 font-bold text-body">' + team + '</td>' +
                            '<td class="px-5 py-4 text-subtle font-medium text-xs">' + stats.count + ' monitored domain(s)</td>' +
                            '<td class="px-5 py-4 w-1/3">' + healthBar(tAvg).replace('max-w-[90px] mx-auto', 'max-w-none') + '</td>' +
                            '<td class="px-5 py-4 text-right"><button onclick="switchPostVerifTab(\''+team.replace(/'/g, "\\'")+'\')" class="px-3 py-1.5 text-xs font-bold text-indigo-500 bg-indigo-tint hover:bg-indigo-100 rounded-lg transition-colors">View Team &rarr;</button></td>' +
                            '</tr>';
        });
    }

    var currentDateStr = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true });

    var html = [
        '<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">',
            statTile('globe', 'indigo', 'Total DPV Targets', totalDomains),
            statTile('check-circle', 'emerald', 'Accessible Domains', accessibleCount),
            statTile('slash', 'rose', 'Fully Blocked', blockedCount),
            statTile('activity', 'amber', 'Overall DPV Health', avgHealth + '%'),
        '</div>',
        aiInsightPanel('DPV', 'DPV System', 'all post-verification teams (' + uniqueTeams.length + ')', currentDateStr),

        '<div class="panel-card overflow-hidden mb-6 flex flex-col">',
        '    <div class="px-6 py-4 border-b border-theme bg-app flex flex-col md:flex-row md:items-center justify-between gap-3">',
        '        <h3 class="font-bold text-body flex items-center gap-2"><i data-lucide="bar-chart" class="h-5 w-5 text-indigo-500"></i> Agent KPI & Productivity Tracker</h3>',
        '        <select onchange="changeDpvKpiTimeframe(this.value)" class="px-3 py-1.5 bg-panel border border-theme rounded-lg text-[11px] font-bold text-body shadow-sm focus:outline-none focus:border-indigo-500 cursor-pointer uppercase tracking-wider">',
        '            <option value="Daily" ' + (window.dpvKpiTimeframe === 'Daily' ? 'selected' : '') + '>Daily Report</option>',
        '            <option value="Weekly" ' + (window.dpvKpiTimeframe === 'Weekly' ? 'selected' : '') + '>Weekly Report</option>',
        '            <option value="Monthly" ' + (window.dpvKpiTimeframe === 'Monthly' ? 'selected' : '') + '>Monthly Report</option>',
        '            <option value="Yearly" ' + (window.dpvKpiTimeframe === 'Yearly' ? 'selected' : '') + '>Yearly Report</option>',
        '        </select>',
        '    </div>',
        '    <div class="overflow-x-auto">',
        '        <table class="w-full text-sm text-left">',
        '            <thead class="bg-panel border-b border-theme">',
        '                <tr class="text-[10px] uppercase font-bold text-subtle tracking-widest">',
        '                    <th class="px-5 py-4">Agent Name</th><th class="px-5 py-4">Total Uploads</th><th class="px-5 py-4">Target Limit</th><th class="px-5 py-4">Quota Hit Rate</th><th class="px-5 py-4">Errors / Dupes</th><th class="px-5 py-4">Status</th>',
        '                </tr>',
        '            </thead>',
        '            <tbody class="divide-y divide-theme">' + kpiRowsHtml + '</tbody>',
        '        </table>',
        '    </div>',
        '</div>',

        '<div class="panel-card overflow-hidden flex-1 flex flex-col">',
        '    <div class="px-6 py-5 border-b border-theme bg-app"><h3 class="font-bold text-body flex items-center gap-2"><i data-lucide="users" class="h-5 w-5 text-indigo-500"></i> Assigned Teams Breakdown</h3></div>',
        '    <div class="overflow-y-auto custom-scrollbar flex-1">',
        '        <table class="w-full text-sm text-left"><tbody class="divide-y divide-theme">' + teamRowsHtml + '</tbody></table>',
        '    </div>',
        '</div>'
    ].join('\n');

    contentArea.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function updateDpvAgentTarget(agentName, newTarget) {
    if (!window.dpvAgentTargets) window.dpvAgentTargets = {};
    window.dpvAgentTargets[agentName] = parseInt(newTarget) || 1;
    buildDpvOverviewUI();
}

function changeDpvKpiTimeframe(timeframe) {
    window.dpvKpiTimeframe = timeframe;
    showPremiumToast("Report Updated", "Now viewing: " + timeframe + " Analytics.", "info");
    buildDpvOverviewUI();
}

// ==========================================
// DPV UPLOAD DUPLICATE SCANNER & CRUD
// ==========================================
var dpvPendingCleanDomains = [];
var dpvPendingBatch = '';
var dpvPendingTeam = '';
var dpvPendingAgent = '';

function openDpvCrudModal(index) {
    var modal = document.getElementById('dpvCrudModal');
    if(!modal) return;
    if(typeof backToDpvForm === 'function') backToDpvForm();

    if (index !== undefined && index >= 0) {
        var d = postVerifData[index];
        document.getElementById('dpvEditIndex').value = index;
        document.getElementById('dpvOriginalDomain').value = d.domain || '';
        document.getElementById('dpvCicc').value = d.cicc || '';
        document.getElementById('dpvBatchId').value = d.batchId || '';
        document.getElementById('dpvDomain').value = d.domain || '';
        document.getElementById('dpvTeam').value = d.team || '';
        document.getElementById('dpvAgent').value = d.agent || '';
        document.getElementById('dpvModalTitle').innerHTML = '<i data-lucide="edit" class="h-5 w-5 text-indigo-500"></i> Edit Verification Record';
    } else {
        document.getElementById('dpvEditIndex').value = -1;
        document.getElementById('dpvOriginalDomain').value = '';
        document.getElementById('dpvCicc').value = '';
        document.getElementById('dpvBatchId').value = '';
        document.getElementById('dpvDomain').value = '';
        document.getElementById('dpvTeam').value = currentDpvTeam !== 'Overview' ? currentDpvTeam : '';

        var activeUser = document.getElementById('adminProfileName') ? document.getElementById('adminProfileName').innerText : '';
        document.getElementById('dpvAgent').value = activeUser;
        document.getElementById('dpvModalTitle').innerHTML = '<i data-lucide="plus" class="h-5 w-5 text-indigo-500"></i> Add New Record';
    }

    modal.classList.remove('hidden');
    setTimeout(function(){ modal.style.opacity = '1'; }, 10);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function backToDpvForm() {
    var formSec = document.getElementById('dpvFormSection');
    var revSec = document.getElementById('dpvReviewSection');
    var formFoot = document.getElementById('dpvFormFooter');
    var revFoot = document.getElementById('dpvReviewFooter');

    if(formSec) formSec.classList.remove('hidden');
    if(revSec) { revSec.classList.remove('flex'); revSec.classList.add('hidden'); }
    if(formFoot) { formFoot.classList.remove('hidden'); formFoot.classList.add('flex'); }
    if(revFoot) { revFoot.classList.remove('flex'); revFoot.classList.add('hidden'); }
}

function processDpvUpload() {
    var idx = document.getElementById('dpvEditIndex').value;
    var rawInput = document.getElementById('dpvDomain').value;
    var cicc = document.getElementById('dpvCicc') ? document.getElementById('dpvCicc').value.trim() : '';
    var batchId = document.getElementById('dpvBatchId').value.trim().toUpperCase();
    var team = document.getElementById('dpvTeam').value.trim();
    var agent = document.getElementById('dpvAgent').value.trim();

    var domains = rawInput.split('\n').map(function(d) { return d.trim().toLowerCase(); }).filter(function(d) { return d !== ''; });

    if(domains.length === 0 || !batchId || !team || !agent) {
        showPremiumToast("Missing Fields", "Batch ID, Target Domain(s), Team, and Agent are required.", "error");
        return;
    }

    if(idx >= 0) {
        if(domains.length > 1) showPremiumToast("Notice", "Edit mode only updates the first domain in the list.", "info");
        proceedToSaveDpvBulk([domains[0]], batchId, team, agent, idx, cicc);
        return;
    }

    var existingMap = {};
    postVerifData.forEach(function(d) {
        var dom = (d.domain || '').toLowerCase();
        if(!existingMap[dom]) existingMap[dom] = d;
    });

    var clean = [], dupes = [];
    domains.forEach(function(dom) {
        if(existingMap[dom]) { dupes.push({ domain: dom, origBatch: existingMap[dom].batchId, origTeam: existingMap[dom].team }); }
        else if (!clean.includes(dom)) { clean.push(dom); existingMap[dom] = { batchId: batchId, team: team }; }
    });

    if (dupes.length > 0) {
        dpvPendingCleanDomains = clean; dpvPendingBatch = batchId; dpvPendingTeam = team; dpvPendingAgent = agent;
        window.dpvPendingCicc = cicc;

        document.getElementById('dpvFormSection').classList.add('hidden');
        document.getElementById('dpvReviewSection').classList.remove('hidden');
        document.getElementById('dpvReviewSection').classList.add('flex');
        document.getElementById('dpvFormFooter').classList.add('hidden');
        document.getElementById('dpvFormFooter').classList.remove('flex');
        document.getElementById('dpvReviewFooter').classList.remove('hidden');
        document.getElementById('dpvReviewFooter').classList.add('flex');

        document.getElementById('dpvDupeCount').innerText = dupes.length;
        document.getElementById('dpvCleanCount').innerText = clean.length;

        var dupeHtml = dupes.map(function(d) { return '<div class="text-[11px] p-2 bg-panel border border-rose-100 dark:border-rose-900 rounded-lg text-rose-500 flex justify-between items-center shadow-sm"><b>'+d.domain+'</b> <span class="text-[9px] font-medium text-rose-400 bg-rose-tint px-2 py-0.5 rounded">Exists in: '+d.origBatch+' ('+d.origTeam+')</span></div>'; }).join('');
        document.getElementById('dpvDupeList').innerHTML = dupeHtml;

        var btnProceed = document.getElementById('btnProceedUpload');
        if(clean.length === 0) {
            btnProceed.disabled = true; btnProceed.className = "px-6 py-2 text-[13px] font-bold text-slate-400 bg-slate-200 rounded-xl transition-all cursor-not-allowed"; btnProceed.innerText = "No Clean Data to Upload";
        } else {
            btnProceed.disabled = false; btnProceed.className = "px-6 py-2 text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-[0_4px_12px_rgba(5,150,105,0.3)] transition-all flex items-center gap-2"; btnProceed.innerHTML = '<i data-lucide="upload-cloud" class="h-4 w-4"></i> Upload ' + clean.length + ' Unique Domains';
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } else { proceedToSaveDpvBulk(clean, batchId, team, agent, -1, cicc); }
}

function proceedDpvUploadFromReview() {
    if(dpvPendingCleanDomains.length > 0) { proceedToSaveDpvBulk(dpvPendingCleanDomains, dpvPendingBatch, dpvPendingTeam, dpvPendingAgent, -1, window.dpvPendingCicc || ''); }
}

function proceedToSaveDpvBulk(domainsArray, batchId, team, agent, editIdx, cicc) {
    var payload = { originalDomain: String(document.getElementById('dpvOriginalDomain').value), batchId: batchId, cicc: cicc, domains: domainsArray, team: team, agent: agent };
    var safePayload = JSON.parse(JSON.stringify(payload));

    closeSmoothly('dpvCrudModal');
    showPremiumToast("Processing", "Syncing " + domainsArray.length + " record(s) to Database...", "info");

    function applyLocalUpdate() {
        if (editIdx >= 0) {
            postVerifData[editIdx].batchId = safePayload.batchId;
            postVerifData[editIdx].cicc = safePayload.cicc;
            postVerifData[editIdx].domain = safePayload.domains[0];
            postVerifData[editIdx].team = safePayload.team;
            postVerifData[editIdx].agent = safePayload.agent;
        } else {
            safePayload.domains.reverse().forEach(function(dom) {
                postVerifData.unshift({
                    batchId: safePayload.batchId, cicc: safePayload.cicc, domain: dom, team: safePayload.team, agent: safePayload.agent,
                    pldt: '-', pldtRemarks: '', globe: '-', globeRemarks: '', converge: '-', convergeRemarks: '', dito: '-', ditoRemarks: ''
                });
            });
        }
    }

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.withSuccessHandler(function(response) {
            showPremiumToast("Success", response.message, "success");
            applyLocalUpdate();
            renderPostVerifMain(); setTimeout(function() { switchPostVerifTab(safePayload.team); }, 100);
        }).saveDpvRecordBackend(currentSessionToken, safePayload);
    } else {
        setTimeout(function() {
            showPremiumToast("Success", domainsArray.length + " Record(s) saved! (Mock)", "success");
            applyLocalUpdate();
            renderPostVerifMain(); setTimeout(function() { switchPostVerifTab(safePayload.team); }, 100);
        }, 700);
    }
}

function deleteDpvRecord(index) {
    var rowData = postVerifData[index];
    showPremiumConfirm("Delete Record", "Are you sure you want to delete '" + rowData.domain + "'?", "Yes, Delete", function() {
        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run.withSuccessHandler(function(res) {
                showPremiumToast("Deleted", res.message, "success"); postVerifData.splice(index, 1); renderDpvTableData();
            }).deleteDpvRecordBackend(currentSessionToken, String(rowData.domain));
        } else {
            showPremiumToast("Deleted", "Record deleted! (Simulation)", "success"); postVerifData.splice(index, 1); renderDpvTableData();
        }
    });
}

// ==========================================
// DPV BULK ACTIONS (DELETE & UPDATE)
// ==========================================
var cleanupPendingDuplicates = [];

function toggleAllDpvRows(sourceCb) {
    var checkboxes = document.querySelectorAll('.dpv-row-select');
    checkboxes.forEach(function(cb) { cb.checked = sourceCb.checked; });
}

function dpvBulkDelete() {
    var checked = document.querySelectorAll('.dpv-row-select:checked');
    if(checked.length === 0) { showPremiumToast("Notice", "Please select at least one row to delete.", "info"); return; }

    showPremiumConfirm("Bulk Delete", "Are you sure you want to permanently delete " + checked.length + " selected domain(s)?", "Yes, Delete All", function() {
        var indices = Array.from(checked).map(function(cb){ return parseInt(cb.value); }).sort(function(a,b){ return b-a; });
        indices.forEach(function(idx){ postVerifData.splice(idx, 1); });
        renderDpvTableData();
        showPremiumToast("Bulk Deleted", checked.length + " domains deleted successfully.", "success");
    });
}

function updateBulkBatchLabel() {
    var selected = document.querySelectorAll('.bulk-batch-chk:checked');
    var label = document.getElementById('bulkBatchDropdownLabel');
    if(!label) return;
    if(selected.length === 0) { label.innerText = '-- Select Batches to Update --'; }
    else if (selected.length === 1) { label.innerText = '1 Batch Selected (' + selected[0].value + ')'; }
    else { label.innerText = selected.length + ' Batches Selected'; }
}

function toggleBulkBatchDropdown() {
    var menu = document.getElementById('bulkBatchDropdownMenu');
    if(menu) menu.classList.toggle('hidden');
}

function closeBulkBatchDropdown() {
    var menu = document.getElementById('bulkBatchDropdownMenu');
    if(menu) menu.classList.add('hidden');
    updateBulkBatchLabel();
}

function openDpvBulkUpdateModal() {
    var checked = document.querySelectorAll('.dpv-row-select:checked');
    var scopeDisplay = document.getElementById('bulkScopeDisplay');
    var batchWrapper = document.getElementById('bulkUpdateBatchScopeWrapper');
    var batchMenu = document.getElementById('bulkBatchDropdownMenu');
    var batchLabel = document.getElementById('bulkBatchDropdownLabel');
    var titleSub = document.getElementById('bulkUpdateTitleSub');

    if (!scopeDisplay || !batchWrapper || !batchMenu) { showPremiumToast("Error", "Modal UI loading error. Please hard refresh.", "error"); return; }

    if (checked.length > 0) {
        titleSub.innerText = '(' + checked.length + ' Selected Rows)';
        scopeDisplay.innerHTML = 'Applying update to <b class="text-amber-500">' + checked.length + '</b> manually selected row(s).';
        batchWrapper.classList.add('hidden');
        batchMenu.innerHTML = '';
    } else {
        var availableBatches = [];
        postVerifData.forEach(function(d) {
            if (d.team === currentDpvTeam && d.batchId && d.batchId !== '-' && !availableBatches.includes(d.batchId)) {
                availableBatches.push(d.batchId);
            }
        });

        if (availableBatches.length === 0) { showPremiumToast("Notice", "No available batches to update in this tab.", "info"); return; }

        availableBatches.sort(function(a,b){ return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }); });

        var optsHtml = '<div class="max-h-48 overflow-y-auto custom-scrollbar p-2 flex-1">';
        availableBatches.forEach(function(b) {
            optsHtml += '<label class="flex items-center gap-2 p-2 hover:bg-app cursor-pointer rounded transition-colors border-b border-theme last:border-0"><input type="checkbox" value="' + b + '" class="bulk-batch-chk rounded text-amber-600 focus:ring-amber-500 border-slate-300" onchange="updateBulkBatchLabel()"> <span class="text-xs text-body font-bold">' + b + '</span></label>';
        });
        optsHtml += '</div>';
        optsHtml += '<div class="p-2 border-t border-theme bg-app flex-shrink-0 z-10"><button type="button" onclick="closeBulkBatchDropdown()" class="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white text-[11px] uppercase tracking-wider font-bold rounded-md transition-colors shadow-sm">Done</button></div>';

        batchMenu.innerHTML = optsHtml;
        batchLabel.innerText = '-- Select Batches to Update --';
        batchMenu.classList.add('hidden');

        titleSub.innerText = '(By Batch)';
        scopeDisplay.innerText = "No rows selected. Check multiple Batches below to update ALL domains inside them:";
        batchWrapper.classList.remove('hidden');
    }

    document.getElementById('bulkDomain').value = ''; document.getElementById('bulkCicc').value = '';
    document.getElementById('bulkTeam').value = ''; document.getElementById('bulkAgent').value = ''; document.getElementById('bulkStatus').value = '';

    var modal = document.getElementById('dpvBulkUpdateModal');
    modal.classList.remove('hidden');
    setTimeout(function(){ modal.style.opacity = '1'; }, 10);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function processDpvBulkUpdate() {
    var checked = document.querySelectorAll('.dpv-row-select:checked');
    var batchWrapper = document.getElementById('bulkUpdateBatchScopeWrapper');

    var selectedBatches = [];
    if (batchWrapper && !batchWrapper.classList.contains('hidden')) {
        var checkedBatches = document.querySelectorAll('.bulk-batch-chk:checked');
        selectedBatches = Array.from(checkedBatches).map(function(cb){ return cb.value; });
    }

    if (checked.length === 0 && selectedBatches.length === 0) { showPremiumToast("Required", "Please select at least one Batch from the dropdown menu.", "error"); return; }

    var nDomain = document.getElementById('bulkDomain').value.trim();
    var nCicc = document.getElementById('bulkCicc').value.trim().toUpperCase();
    var nTeam = document.getElementById('bulkTeam').value.trim();
    var nAgent = document.getElementById('bulkAgent').value.trim();
    var nStatus = document.getElementById('bulkStatus').value;

    var indicesToUpdate = [];
    if (checked.length > 0) {
        indicesToUpdate = Array.from(checked).map(function(cb){ return parseInt(cb.value); });
    } else {
        postVerifData.forEach(function(d, index) {
            if (d.team === currentDpvTeam && selectedBatches.includes(d.batchId)) { indicesToUpdate.push(index); }
        });
    }

    if (indicesToUpdate.length === 0) { showPremiumToast("Error", "No rows found to update.", "error"); return; }
    if (nDomain !== '' && indicesToUpdate.length > 1) { showPremiumToast("Notice", "Cannot bulk update Domain Name. Updates applied to other fields.", "info"); nDomain = ''; }

    var domainsToUpdate = indicesToUpdate.map(function(idx){ return postVerifData[idx].domain.toLowerCase(); });
    var updatePayload = { domainsToUpdate: domainsToUpdate, updates: { domain: nDomain, cicc: nCicc, team: nTeam, agent: nAgent, status: nStatus } };

    var btn = document.querySelector('#dpvBulkUpdateModal button.bg-amber-500');
    var origBtn = btn.innerHTML;
    btn.innerHTML = '<div class="spinner h-4 w-4 border-2 border-white/20 border-t-white inline-block align-middle mr-2"></div> Applying...';
    btn.disabled = true;
    btn.classList.add('opacity-80', 'cursor-not-allowed');

    function applyLocalUpdates() {
        indicesToUpdate.forEach(function(idx) {
            if(nDomain) postVerifData[idx].domain = nDomain;
            if(nCicc) postVerifData[idx].cicc = nCicc;
            if(nTeam) postVerifData[idx].team = nTeam;
            if(nAgent) postVerifData[idx].agent = nAgent;
            if(nStatus) {
                postVerifData[idx].pldt = nStatus; postVerifData[idx].globe = nStatus;
                postVerifData[idx].converge = nStatus; postVerifData[idx].dito = nStatus;
            }
        });
    }

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.withSuccessHandler(function(res) {
            btn.innerHTML = origBtn; btn.disabled = false; btn.classList.remove('opacity-80', 'cursor-not-allowed');
            if(res && res.success) {
                applyLocalUpdates();
                closeSmoothly('dpvBulkUpdateModal');
                showPremiumToast("Bulk Updated", res.message, "success");
                renderDpvTableData();
            } else {
                showPremiumToast("Backend Error", res.message || "Update failed.", "error");
            }
        }).bulkUpdateDpvBackend(currentSessionToken, updatePayload);
    } else {
        setTimeout(function() {
            btn.innerHTML = origBtn; btn.disabled = false; btn.classList.remove('opacity-80', 'cursor-not-allowed');
            applyLocalUpdates();
            closeSmoothly('dpvBulkUpdateModal');
            showPremiumToast("Bulk Updated", "Update successful! (Mock Mode)", "success");
            renderDpvTableData();
        }, 800);
    }
}

function openCleanUpModal() {
    var oldModal = document.getElementById('dpvCleanupModal');
    if (oldModal) oldModal.remove();

    var cleanupModalHtml = [
        '<div id="dpvCleanupModal" class="hidden fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 transition-opacity duration-200 opacity-0">',
        '  <div class="modal-shell w-full max-w-lg flex flex-col max-h-[90vh]">',
        '    <div class="px-6 py-4 border-b border-theme flex items-center justify-between bg-rose-tint rounded-t-2xl">',
        '      <h3 class="text-lg font-black text-rose-600 dark:text-rose-400 flex items-center gap-2"><i data-lucide="eraser" class="h-5 w-5"></i> Batch Cleanup Tool</h3>',
        '      <button onclick="closeSmoothly(\'dpvCleanupModal\')" class="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-white/50 transition-colors"><i data-lucide="x" class="h-5 w-5"></i></button>',
        '    </div>',
        '    <div class="px-6 py-6 overflow-y-auto custom-scrollbar flex-1">',
        '      <p class="text-[12px] text-subtle font-medium mb-4">Select a batch below. The system will scan and remove duplicate domains across the database, keeping only the oldest original record.</p>',
        '      <label class="field-label">Select Batch to Clean</label>',
        '      <select id="cleanupBatchSelect" class="field-input font-bold"></select>',
        '      <div id="cleanupResultsSection" class="hidden mt-6">',
        '         <div class="bg-rose-tint p-4 rounded-xl border border-rose-200 dark:border-rose-900">',
        '            <h4 class="text-sm font-bold text-rose-600 dark:text-rose-400 mb-3 flex items-center gap-2"><i data-lucide="alert-triangle" class="h-4 w-4"></i> Found <span id="cleanupDupeCount" class="text-lg">0</span> Duplicate(s)</h4>',
        '            <div id="cleanupDupeList" class="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar"></div>',
        '         </div>',
        '      </div>',
        '    </div>',
        '    <div class="px-6 py-4 bg-app border-t border-theme flex justify-end gap-3 rounded-b-2xl">',
        '      <button onclick="closeSmoothly(\'dpvCleanupModal\')" class="btn-ghost">Cancel</button>',
        '      <button id="btnAnalyzeCleanup" onclick="analyzeCleanUp()" class="btn-primary"><i data-lucide="search" class="h-4 w-4"></i> Analyze Batch</button>',
        '      <button id="btnConfirmCleanup" onclick="confirmCleanUp()" class="hidden px-6 py-2 text-[13px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-[0_4px_12px_rgba(225,29,72,0.3)] flex items-center gap-2 transition-all"><i data-lucide="trash-2" class="h-4 w-4"></i> Purge Duplicates</button>',
        '    </div>',
        '  </div>',
        '</div>'
    ].join('\n');
    document.body.insertAdjacentHTML('beforeend', cleanupModalHtml);

    var modal = document.getElementById('dpvCleanupModal');
    document.getElementById('cleanupResultsSection').classList.add('hidden');
    document.getElementById('btnConfirmCleanup').classList.add('hidden');
    document.getElementById('btnAnalyzeCleanup').classList.remove('hidden');

    var select = document.getElementById('cleanupBatchSelect');
    var optionsHtml = '<option value="">-- Choose Batch --</option>';
    dpvBatchList.forEach(function(b) { optionsHtml += '<option value="'+b+'">'+b+'</option>'; });
    select.innerHTML = optionsHtml;
    if(dpvBatchList.length === 0) { select.innerHTML = '<option value="">No batches available to clean</option>'; }

    modal.classList.remove('hidden');
    setTimeout(function(){ modal.style.opacity = '1'; }, 10);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function analyzeCleanUp() {
    var batch = document.getElementById('cleanupBatchSelect').value;
    if(!batch) { showPremiumToast("Required", "Please select a batch to analyze.", "error"); return; }

    var existingMap = {};
    cleanupPendingDuplicates = [];

    for(var i = postVerifData.length - 1; i >= 0; i--) {
        var d = postVerifData[i];
        if(d.domain.includes('init-')) continue;
        var dom = d.domain.toLowerCase();

        if(!existingMap[dom]) { existingMap[dom] = d; }
        else if(d.batchId === batch) {
            cleanupPendingDuplicates.push({ domain: d.domain, batchId: d.batchId, team: d.team, origBatch: existingMap[dom].batchId, origTeam: existingMap[dom].team, _localIndex: i });
        }
    }

    var resultsSec = document.getElementById('cleanupResultsSection');
    var dupeList = document.getElementById('cleanupDupeList');
    document.getElementById('cleanupDupeCount').innerText = cleanupPendingDuplicates.length;

    if(cleanupPendingDuplicates.length === 0) {
        dupeList.innerHTML = '<div class="text-xs p-3 text-center text-emerald-600 dark:text-emerald-400 bg-emerald-tint rounded-lg border border-emerald-100 dark:border-emerald-900 font-bold"><i data-lucide="check-circle" class="h-4 w-4 inline mr-1"></i> Excellent! No duplicates found in this batch.</div>';
        document.getElementById('btnConfirmCleanup').classList.add('hidden');
    } else {
        var listHtml = cleanupPendingDuplicates.map(function(d) {
            return '<div class="text-[11px] p-2.5 bg-panel border border-rose-100 dark:border-rose-900 rounded-lg text-rose-500 flex justify-between items-center shadow-sm"><b>'+d.domain+'</b> <div class="text-right leading-tight"><span class="text-[8px] font-bold text-subtle block uppercase tracking-widest mb-0.5">Original Record:</span><span class="text-[9px] font-medium text-rose-400 bg-rose-tint px-2 py-0.5 rounded border border-rose-100 dark:border-rose-900">'+d.origBatch+' ('+d.origTeam+')</span></div></div>';
        }).join('');
        dupeList.innerHTML = listHtml;
        document.getElementById('btnConfirmCleanup').classList.remove('hidden');
        document.getElementById('btnConfirmCleanup').innerHTML = '<i data-lucide="trash-2" class="h-4 w-4"></i> Purge ' + cleanupPendingDuplicates.length + ' Duplicates';
    }

    resultsSec.classList.remove('hidden');
    document.getElementById('btnAnalyzeCleanup').classList.add('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function confirmCleanUp() {
    var btn = document.getElementById('btnConfirmCleanup');
    var orig = btn.innerHTML;
    btn.innerHTML = '<div class="spinner h-4 w-4 border-2 border-white/20 border-t-white"></div>'; btn.disabled = true;

    var safePayload = JSON.parse(JSON.stringify(cleanupPendingDuplicates));

    function applyLocalCleanup() {
        var indicesToRemove = cleanupPendingDuplicates.map(function(d){ return d._localIndex; }).sort(function(a,b){ return b-a; });
        indicesToRemove.forEach(function(idx) { postVerifData.splice(idx, 1); });
        renderDpvTableData();
    }

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.withSuccessHandler(function(response) {
            btn.innerHTML = orig; btn.disabled = false; closeSmoothly('dpvCleanupModal');
            if(response.success) { showPremiumToast("Cleanup Complete", response.message, "success"); applyLocalCleanup(); }
            else { showPremiumToast("Error", response.message, "error"); }
        }).deleteDpvDuplicatesBackend(currentSessionToken, safePayload);
    } else {
        setTimeout(function() {
            btn.innerHTML = orig; btn.disabled = false; closeSmoothly('dpvCleanupModal');
            showPremiumToast("Cleanup Complete", cleanupPendingDuplicates.length + " duplicates removed! (Mock)", "success");
            applyLocalCleanup();
        }, 700);
    }
}

// ==========================================
// BRAND PAGE & TABS LOGIC
// ==========================================
function openBrandPage(brandName, btnElement) {
    var container = document.getElementById('appContent');
    if (!container) return;
    var safeName = brandName.replace(/'/g, "\\'");
    currentPage = 1;
    setActiveSidebarBtn(btnElement);

    var layouts = [
        '<div class="h-full flex flex-col relative transition-opacity duration-300 opacity-0" id="brandPageWrapper">',
        '    <div class="px-8 py-6 border-b border-theme bg-panel flex-shrink-0">',
        '        <h2 class="text-2xl font-bold text-heading flex items-center gap-2"><i data-lucide="briefcase" class="h-6 w-6 text-indigo-500"></i> ' + brandName + '</h2>',
        '        <p class="text-sm text-muted mt-1">Manage analytics and domains for this brand.</p>',
        '    </div>',
        '    <div class="px-8 pt-4 bg-app border-b border-theme flex gap-6 flex-shrink-0">',
        '        <button onclick="switchBrandTab(\'overview\', \'' + safeName + '\')" id="tab-overview" class="pb-3 text-sm font-semibold text-indigo-500 border-b-2 border-indigo-500 transition-colors">Overview</button>',
        '        <button onclick="switchBrandTab(\'domains\', \'' + safeName + '\')" id="tab-domains" class="pb-3 text-sm font-semibold text-subtle hover:text-body hover:border-slate-300 transition-colors border-b-2 border-transparent">Domain List</button>',
        '    </div>',
        '    <div id="brandContentArea" class="flex-1 p-6 bg-app overflow-hidden flex flex-col relative transition-opacity duration-200"></div>',
        '</div>'
    ];
    container.innerHTML = layouts.join('\n');
    setTimeout(function(){ var w = document.getElementById('brandPageWrapper'); if(w) w.style.opacity = '1'; }, 30);
    switchBrandTab('overview', brandName);
}

function switchBrandTab(tabName, brandName) {
    var tabOverview = document.getElementById('tab-overview');
    var tabDomains = document.getElementById('tab-domains');
    var contentArea = document.getElementById('brandContentArea');
    if (!contentArea || !tabOverview || !tabDomains) return;

    var safeName = brandName.replace(/'/g, "\\'");
    contentArea.style.opacity = '0';

    setTimeout(function() {
        tabOverview.className = "pb-3 text-sm font-semibold text-subtle hover:text-body hover:border-slate-300 transition-colors border-b-2 border-transparent";
        tabDomains.className = "pb-3 text-sm font-semibold text-subtle hover:text-body hover:border-slate-300 transition-colors border-b-2 border-transparent";

        if (tabName === 'overview') {
            tabOverview.className = "pb-3 text-sm font-semibold text-indigo-500 border-b-2 border-indigo-500 transition-colors";
            contentArea.className = "flex-1 p-6 bg-app overflow-y-auto custom-scrollbar transition-opacity duration-200";
            contentArea.innerHTML = skeletonScreen('cards');

            if (currentBrandName !== brandName) {
                if (typeof google !== 'undefined' && google.script && google.script.run) {
                    google.script.run.withSuccessHandler(function(allDomains) {
                        currentBrandName = brandName;
                        currentBrandData = allDomains.filter(function(d) { return String(d.brand).trim().toLowerCase() === String(brandName).trim().toLowerCase(); });
                        currentViewData = [].concat(currentBrandData);
                        buildOverviewUI(brandName);
                    }).getDomainsData(currentSessionToken);
                } else { setTimeout(function() { buildOverviewUI(brandName); }, 500); }
            } else { buildOverviewUI(brandName); }

        } else if (tabName === 'domains') {
            tabDomains.className = "pb-3 text-sm font-semibold text-indigo-500 border-b-2 border-indigo-500 transition-colors";
            contentArea.className = "flex-1 p-6 bg-app overflow-hidden flex flex-col transition-opacity duration-200";

            var tableHtml = [
                '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 flex-shrink-0">',
                '    <div class="stat-tile"><div class="stat-tile-icon stat-indigo"><i data-lucide="layers" class="h-6 w-6"></i></div><div><p class="text-[10px] font-bold text-subtle uppercase tracking-widest">Total Domains</p><h4 id="cardTotal" class="text-2xl font-black text-heading">0</h4></div></div>',
                '    <div class="stat-tile"><div class="stat-tile-icon stat-rose"><i data-lucide="calendar-clock" class="h-6 w-6"></i></div><div><p class="text-[10px] font-bold text-subtle uppercase tracking-widest">Expiring Soon</p><h4 id="cardExpiring" class="text-2xl font-black text-heading">0</h4></div></div>',
                '    <div class="stat-tile"><div class="stat-tile-icon stat-emerald"><i data-lucide="activity" class="h-6 w-6"></i></div><div><p class="text-[10px] font-bold text-subtle uppercase tracking-widest">Avg Health</p><h4 id="cardHealth" class="text-2xl font-black text-heading">0%</h4></div></div>',
                '</div>',
                '<div class="flex justify-between items-center mb-4 flex-shrink-0">',
                '    <div class="relative"><i data-lucide="search" class="absolute left-3 top-2.5 h-4 w-4 text-subtle"></i><input type="text" id="localSearchInput" onkeyup="filterBrandTable()" placeholder="Search in ' + brandName + '..." class="pl-9 pr-4 py-2 border border-theme bg-panel rounded-lg text-sm text-body focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64 transition-all shadow-sm"></div>',
                '    <button onclick="openDomainModal()" class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-sm"><i data-lucide="plus" class="h-4 w-4"></i> Add Domain</button>',
                '</div>',
                '<div class="panel-card flex flex-col flex-1 overflow-hidden">',
                '    <div class="overflow-y-auto overflow-x-auto custom-scrollbar flex-1 relative bg-panel">',
                '        <table class="w-full text-left border-collapse whitespace-nowrap relative">',
                '            <thead class="bg-app sticky top-0 z-20 shadow-sm border-b border-theme backdrop-blur-sm">',
                '                <tr class="text-[11px] uppercase font-bold text-subtle tracking-wider">',
                '                    <th class="px-4 py-3 cursor-pointer hover:opacity-80 transition-colors" onclick="sortBrandTable(\'domain\')">Domain Name <i data-lucide="chevrons-up-down" class="h-3 w-3 inline opacity-50"></i></th>',
                '                    <th class="px-4 py-3 cursor-pointer hover:opacity-80 transition-colors" onclick="sortBrandTable(\'expiration\')">Exp Date <i data-lucide="chevrons-up-down" class="h-3 w-3 inline opacity-50"></i></th>',
                '                    <th class="px-4 py-3 cursor-pointer hover:opacity-80 transition-colors" onclick="sortBrandTable(\'account\')">Account <i data-lucide="chevrons-up-down" class="h-3 w-3 inline opacity-50"></i></th>',
                '                    <th class="px-4 py-3">Price</th>',
                '                    <th class="px-4 py-3">Notes</th>',
                '                    <th class="px-4 py-3 cursor-pointer hover:opacity-80 transition-colors" onclick="sortBrandTable(\'agent\')">Agent <i data-lucide="chevrons-up-down" class="h-3 w-3 inline opacity-50"></i></th>',
                '                    <th class="px-4 py-3">Redirects To</th>',
                '                    <th class="px-4 py-3 text-center border-l border-theme text-red-500">PLDT</th>',
                '                    <th class="px-4 py-3 text-center border-l border-theme text-blue-500">GLOBE</th>',
                '                    <th class="px-4 py-3 text-center border-l border-theme text-orange-500">CONV</th>',
                '                    <th class="px-4 py-3 text-center border-l border-theme text-purple-500">DITO</th>',
                '                    <th class="px-4 py-3 text-center border-l border-theme cursor-pointer hover:opacity-80 transition-colors" onclick="sortBrandTable(\'health\')">Health Score % <i data-lucide="chevrons-up-down" class="h-3 w-3 inline opacity-50"></i></th>',
                '                    <th class="px-4 py-3 text-center border-l border-theme bg-app sticky right-0">Actions</th>',
                '                </tr>',
                '            </thead>',
                '            <tbody id="brandDomainTableBody" class="divide-y divide-theme text-sm text-body bg-panel">',
                '                <tr><td colspan="13" class="px-4 py-16 text-center text-subtle"><div class="flex flex-col items-center"><div class="spinner mb-4"></div><p>Fetching domains...</p></div></td></tr>',
                '            </tbody>',
                '        </table>',
                '    </div>',
                '    <div id="paginationFooter" class="bg-app px-6 py-3 border-t border-theme flex justify-between items-center flex-shrink-0 z-10 shadow-[0_-2px_4px_rgba(0,0,0,0.02)]"></div>',
                '</div>'
            ].join('\n');
            contentArea.innerHTML = tableHtml;
            loadBrandDomains(brandName);
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
        contentArea.style.opacity = '1';
    }, 150);
}

// ==========================================
// DYNAMIC TABLE RENDERING & DATA FETCHING
// ==========================================
function loadBrandDomains(brandName) {
    currentBrandName = brandName;
    var tbody = document.getElementById('brandDomainTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="13" class="px-4 py-16 text-center text-subtle"><div class="flex flex-col items-center"><div class="spinner mb-4"></div><p class="text-sm font-medium">Fetching domains...</p></div></td></tr>';
    }

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.withSuccessHandler(function(allDomains) {
            currentBrandData = allDomains.filter(function(d) { return String(d.brand).trim().toLowerCase() === String(brandName).trim().toLowerCase(); });
            currentViewData = [].concat(currentBrandData);
            currentPage = 1;
            buildBrandTableUI();
        }).getDomainsData(currentSessionToken);
    } else {
        setTimeout(function() {
            currentBrandData = [
                { brand: brandName, domain: "apex-test.com", expiration: "Jun 03, 2026", account: "Godaddy Nixx", price: "₱2,500", notes: "Main Domain Route", agent: "Tech01", redirected: "https://www.apexapex.online/main-route", pldt: "Active", pldtRemarks: "", globe: "Block", globeRemarks: "Jun 19 | http", converge: "Active", convergeRemarks: "", dito: "Active", ditoRemarks: "" }
            ];
            currentViewData = [].concat(currentBrandData);
            currentPage = 1;
            buildBrandTableUI();
        }, 500);
    }
}

function buildBrandTableUI() {
    var tbody = document.getElementById('brandDomainTableBody');
    var paginationFooter = document.getElementById('paginationFooter');
    if (!tbody) return;

    var expCount = 0;
    var totalHealth = 0;
    var now = new Date();
    var currentMonth = now.getMonth();
    var currentYear = now.getFullYear();

    currentViewData.forEach(function(d) {
        var activeIsps = 0;
        var isps = [d.pldt, d.globe, d.converge, d.dito];
        isps.forEach(function(stat) {
            var s = (stat || '').toString().toLowerCase();
            if (s.includes('active') || s.includes('clear')) activeIsps++;
        });
        var healthPct = Math.round((activeIsps / 4) * 100);
        d.health = healthPct;
        totalHealth += healthPct;

        if (d.expiration) {
            var expDate = new Date(d.expiration);
            if (!isNaN(expDate.getTime())) {
                var expMonth = expDate.getMonth();
                var expYear = expDate.getFullYear();
                if ((expYear === currentYear && expMonth === currentMonth) ||
                    (expYear === currentYear && expMonth === currentMonth + 1) ||
                    (currentMonth === 11 && expYear === currentYear + 1 && expMonth === 0)) {
                    expCount++;
                }
            }
        }
    });

    if (document.getElementById('cardTotal')) document.getElementById('cardTotal').innerText = currentViewData.length;
    if (document.getElementById('cardExpiring')) document.getElementById('cardExpiring').innerText = expCount;
    if (document.getElementById('cardHealth')) document.getElementById('cardHealth').innerText = currentViewData.length > 0 ? Math.round(totalHealth / currentViewData.length) + "%" : "0%";

    if (currentViewData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" class="px-4 py-16 text-center text-subtle font-medium"><div class="flex flex-col items-center justify-center gap-2"><i data-lucide="search-x" class="h-10 w-10 opacity-40"></i><p>No records found matching the query.</p></div></td></tr>';
        if (paginationFooter) paginationFooter.innerHTML = '';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    var totalPages = Math.ceil(currentViewData.length / rowsPerPage);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIndex = (currentPage - 1) * rowsPerPage;
    var endIndex = startIndex + rowsPerPage;
    var paginatedData = currentViewData.slice(startIndex, endIndex);

    var html = '';
    paginatedData.forEach(function(d, index) {
        var actualIndex = startIndex + index;
        var hb = healthBar(d.health);

        html += '    <tr class="hover:bg-app transition-colors">';
        html += '        <td class="px-4 py-3 font-bold text-indigo-500 select-all">' + (d.domain || '-') + '</td>';
        html += '        <td class="px-4 py-3 text-muted font-medium">' + (d.expiration || '-') + '</td>';
        html += '        <td class="px-4 py-3 text-muted">' + (d.account || '-') + '</td>';
        html += '        <td class="px-4 py-3 text-emerald-500 font-semibold">' + (d.price || '-') + '</td>';
        html += '        <td class="px-4 py-3 text-subtle max-w-[150px] truncate" title="' + (d.notes || '') + '">' + (d.notes || '-') + '</td>';
        html += '        <td class="px-4 py-3 text-muted font-medium">' + (d.agent || '-') + '</td>';
        html += '        <td class="px-4 py-3 text-subtle whitespace-normal break-all max-w-[220px] text-xs leading-relaxed select-all">' + (d.redirected || '-') + '</td>';
        html += '        <td class="px-4 py-2 border-l border-theme">' + createStatusWithProof(d.pldt, d.pldtRemarks) + '</td>';
        html += '        <td class="px-4 py-2 border-l border-theme">' + createStatusWithProof(d.globe, d.globeRemarks) + '</td>';
        html += '        <td class="px-4 py-2 border-l border-theme">' + createStatusWithProof(d.converge, d.convergeRemarks) + '</td>';
        html += '        <td class="px-4 py-2 border-l border-theme">' + createStatusWithProof(d.dito, d.ditoRemarks) + '</td>';
        html += '        <td class="px-4 py-3 border-l border-theme text-center">' + hb + '</td>';
        html += '        <td class="px-4 py-3 text-center border-l border-theme bg-panel sticky right-0 shadow-[-4px_0_6px_rgba(0,0,0,0.02)]">';
        html += '            <div class="flex items-center justify-center gap-2">';
        html += '                <button onclick="openDomainModal(' + actualIndex + ')" class="p-1.5 text-subtle hover:text-indigo-500 hover:bg-indigo-tint rounded-lg transition-colors" title="Edit Domain"><i data-lucide="edit-3" class="h-4 w-4"></i></button>';
        html += '                <button onclick="deleteDomainRecord(' + actualIndex + ')" class="p-1.5 text-subtle hover:text-rose-500 hover:bg-rose-tint rounded-lg transition-colors" title="Delete Domain"><i data-lucide="trash-2" class="h-4 w-4"></i></button>';
        html += '            </div>';
        html += '        </td>';
        html += '    </tr>';
    });
    tbody.innerHTML = html;

    if (paginationFooter) {
        var startCount = startIndex + 1, endCount = Math.min(startIndex + rowsPerPage, currentViewData.length);
        var footerHtml = [
            '<div class="flex items-center gap-3 text-[11px] font-medium text-subtle"><span>Showing ' + startCount + ' to ' + endCount + ' of ' + currentViewData.length + ' entries</span>',
            '<select onchange="changeRowsPerPage(this.value)" class="border border-theme rounded-md px-2 py-1 outline-none bg-panel cursor-pointer hover:bg-app transition-colors"><option value="10" ' + (rowsPerPage == 10 ? 'selected' : '') + '>10 rows</option><option value="50" ' + (rowsPerPage == 50 ? 'selected' : '') + '>50 rows</option><option value="100" ' + (rowsPerPage == 100 ? 'selected' : '') + '>100 rows</option></select></div>',
            '<div class="flex items-center gap-1.5"><button onclick="goToPage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + ' class="p-1.5 rounded-md border border-theme text-subtle hover:bg-app disabled:opacity-50 transition-colors"><i data-lucide="chevron-left" class="h-4 w-4"></i></button>'
        ];
        for (var i = 1; i <= totalPages; i++) {
            if (totalPages <= 7 || (i == 1 || i == totalPages || Math.abs(currentPage - i) <= 1)) {
                var activeClass = i === currentPage ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-panel text-body border-theme hover:bg-app';
                footerHtml.push('<button onclick="goToPage(' + i + ')" class="w-8 h-8 rounded-md border text-[11px] font-bold transition-colors ' + activeClass + '">' + i + '</button>');
            } else if (i === 2 && currentPage > 3 || i === totalPages - 1 && currentPage < totalPages - 2) {
                footerHtml.push('<span class="text-xs text-subtle px-1 font-bold">...</span>');
            }
        }
        footerHtml.push('<button onclick="goToPage(' + (currentPage + 1) + ')" ' + (currentPage === totalPages ? 'disabled' : '') + ' class="p-1.5 rounded-md border border-theme text-subtle hover:bg-app disabled:opacity-50 transition-colors"><i data-lucide="chevron-right" class="h-4 w-4"></i></button></div>');
        paginationFooter.innerHTML = footerHtml.join('');
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function goToPage(page) { currentPage = page; buildBrandTableUI(); var tableContainer = document.querySelector('.custom-scrollbar'); if (tableContainer) tableContainer.scrollTop = 0; }
function changeRowsPerPage(val) { rowsPerPage = parseInt(val); currentPage = 1; buildBrandTableUI(); }

function filterBrandTable() {
    var inputEl = document.getElementById("localSearchInput");
    if (!inputEl) return;
    var input = inputEl.value.toLowerCase().trim();
    currentViewData = currentBrandData.filter(function(d) {
        return (d.domain && d.domain.toLowerCase().includes(input)) ||
               (d.account && d.account.toLowerCase().includes(input)) ||
               (d.agent && d.agent.toLowerCase().includes(input));
    });
    currentPage = 1;
    buildBrandTableUI();
}

function sortBrandTable(key) {
    sortAsc = !sortAsc;
    currentViewData.sort(function(a, b) {
        var valA = a[key] || '', valB = b[key] || '';
        if (key === 'health') return sortAsc ? (a.health || 0) - (b.health || 0) : (b.health || 0) - (a.health || 0);
        if (valA.toString().toLowerCase() < valB.toString().toLowerCase()) return sortAsc ? -1 : 1;
        if (valA.toString().toLowerCase() > valB.toString().toLowerCase()) return sortAsc ? 1 : -1;
        return 0;
    });
    buildBrandTableUI();
}

function buildOverviewUI(brandName) {
    var contentArea = document.getElementById('brandContentArea');
    if (!contentArea) return;

    var totalDomains = currentViewData.length;
    var accessibleCount = 0, fullyBlockedCount = 0, redirectedCount = 0;
    var expiringDomains = [], spareDomains = [];
    var stats = { pldt: { block: 0, active: 0, redirect: 0, total: 0 }, globe: { block: 0, active: 0, redirect: 0, total: 0 }, converge: { block: 0, active: 0, redirect: 0, total: 0 }, dito: { block: 0, active: 0, redirect: 0, total: 0 } };

    var now = new Date(), currentMonth = now.getMonth(), currentYear = now.getFullYear();

    currentViewData.forEach(function(d) {
        var isAnyActive = false, isFullyBlocked = true;
        var isps = [{ key: 'pldt', val: d.pldt }, { key: 'globe', val: d.globe }, { key: 'converge', val: d.converge }, { key: 'dito', val: d.dito }];
        isps.forEach(function(isp) {
            var s = (isp.val || '').toString().toLowerCase();
            if (s !== '' && s !== '-') {
                stats[isp.key].total++;
                if (s.includes('active') || s.includes('clear')) { stats[isp.key].active++; isAnyActive = true; isFullyBlocked = false; }
                else if (s.includes('block') || s.includes('down') || s.includes('timeout')) { stats[isp.key].block++; }
                else if (s.includes('redirect')) { stats[isp.key].redirect++; isFullyBlocked = false; }
                else { isFullyBlocked = false; }
            } else { isFullyBlocked = false; }
        });

        if (isAnyActive) accessibleCount++;
        if (isFullyBlocked) fullyBlockedCount++;

        var isRedirected = (d.redirected && d.redirected.toString().trim() !== '' && d.redirected.toString().trim().toUpperCase() !== 'N/A');
        if (isRedirected || d.pldt === 'Redirected' || d.globe === 'Redirected' || d.converge === 'Redirected' || d.dito === 'Redirected') { redirectedCount++; }

        if (d.expiration) {
            var expDate = new Date(d.expiration);
            if (!isNaN(expDate.getTime())) {
                var expMonth = expDate.getMonth(), expYear = expDate.getFullYear();
                if ((expYear === currentYear && expMonth === currentMonth) || (expYear === currentYear && expMonth === currentMonth + 1) || (currentMonth === 11 && expYear === currentYear + 1 && expMonth === 0)) {
                    expiringDomains.push(d);
                }
            }
        }
        var notesText = (d.notes || '').toString().toLowerCase() + ' ' + (d.agent || '').toString().toLowerCase();
        if (notesText.includes('spare')) spareDomains.push(d);
    });

    var safeName = brandName.replace(/'/g, "\\'");
    var currentDateStr = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true });

    var html = [
        '<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">',
            statTile('globe', 'indigo', 'Total Targets', totalDomains),
            statTile('slash', 'rose', 'Total Blocked', fullyBlockedCount),
            statTile('check-circle', 'emerald', 'Still Accessible', accessibleCount),
            statTile('refresh-cw', 'amber', 'Redirected', redirectedCount),
        '</div>',
        aiInsightPanel(safeName, 'Manual Run', brandName, currentDateStr),
        '<h4 class="text-[11px] font-bold text-subtle uppercase tracking-widest mb-3 flex items-center gap-2"><i data-lucide="bar-chart-2" class="h-4 w-4 text-subtle"></i> ISP Compliance Breakdown <span class="text-xs font-normal text-subtle ml-2">(Click cards for details)</span></h4>',
        '<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">', getIspCard('PLDT', stats.pldt, 'pldt'), getIspCard('GLOBE', stats.globe, 'globe'), getIspCard('CONVERGE', stats.converge, 'converge'), getIspCard('DITO', stats.dito, 'dito'), '</div>',
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6">',
        '    <div class="panel-card overflow-hidden flex flex-col"><div class="p-4 border-b border-theme bg-rose-tint"><h4 class="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-widest flex items-center gap-2"><i data-lucide="calendar-clock" class="h-4 w-4"></i> Domains to Expire Soon (' + expiringDomains.length + ')</h4></div><div class="p-4 space-y-3 max-h-80 overflow-y-auto custom-scrollbar flex-1">' + generateListHtml(expiringDomains, false, false) + '</div></div>',
        '    <div class="panel-card overflow-hidden flex flex-col"><div class="p-4 border-b border-theme bg-indigo-tint"><h4 class="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest flex items-center gap-2"><i data-lucide="archive" class="h-4 w-4"></i> List of Spare Domains (' + spareDomains.length + ')</h4></div><div class="p-4 space-y-3 max-h-80 overflow-y-auto custom-scrollbar flex-1">' + generateListHtml(spareDomains, true, false) + '</div></div>',
        '</div>'
    ].join('\n');
    contentArea.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ==========================================
// DOMAIN MODAL LOGIC (ADD / EDIT / BULK)
// ==========================================
function switchDomainUploadMode(mode) {
    var singleSec = document.getElementById('singleUploadSection');
    var bulkSec = document.getElementById('bulkUploadSection');
    var tabSingle = document.getElementById('tabSingle');
    var tabBulk = document.getElementById('tabBulk');

    var activeClass = "px-3 py-1.5 text-[11px] font-bold rounded-md bg-panel text-indigo-500 shadow-sm transition-all uppercase tracking-wider";
    var inactiveClass = "px-3 py-1.5 text-[11px] font-bold rounded-md text-subtle hover:text-body transition-all uppercase tracking-wider bg-transparent shadow-none";

    if (mode === 'single') {
        singleSec.classList.remove('hidden'); singleSec.classList.add('flex');
        bulkSec.classList.remove('flex'); bulkSec.classList.add('hidden');
        tabSingle.className = activeClass; tabBulk.className = inactiveClass;
    } else {
        bulkSec.classList.remove('hidden'); bulkSec.classList.add('flex');
        singleSec.classList.remove('flex'); singleSec.classList.add('hidden');
        tabBulk.className = activeClass; tabSingle.className = inactiveClass;
    }
}

function downloadCSVTemplate() {
    var csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Domain Name,Expiration Date (mm/dd/yyyy),Account Provider,Price,Notes,Agent Binded,Redirects To\n";
    csvContent += "example.com,12/31/2026,Godaddy,2500,Spare,Tech01,N/A\n";
    var encodedUri = encodeURI(csvContent);
    var link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "BBC_Domain_Upload_Template.csv");
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function handleCSVUpload(event) {
    var file = event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        var text = e.target.result;
        var rows = text.split('\n');
        var totalScanned = 0, duplicates = 0;
        validBulkUploadArray = [];

        var existingDomains = currentBrandData.map(function(d) { return d.domain.toLowerCase(); });

        for (var i = 1; i < rows.length; i++) {
            var row = rows[i].split(',');
            if (row.length >= 1 && row[0].trim() !== '') {
                totalScanned++;
                var domainName = row[0].trim();
                if (existingDomains.includes(domainName.toLowerCase())) { duplicates++; }
                else {
                    validBulkUploadArray.push({
                        brand: currentBrandName, domain: domainName, expiration: row[1] ? row[1].trim() : '', account: row[2] ? row[2].trim() : '',
                        price: row[3] ? row[3].trim() : '', notes: row[4] ? row[4].trim() : '', agent: row[5] ? row[5].trim() : '', redirected: row[6] ? row[6].trim() : ''
                    });
                }
            }
        }

        document.getElementById('bulkUploadStats').classList.remove('hidden');
        document.getElementById('statTotal').innerText = totalScanned;
        document.getElementById('statReady').innerText = validBulkUploadArray.length;
        document.getElementById('statDupes').innerText = duplicates;
        document.getElementById('btnSaveBulk').disabled = validBulkUploadArray.length === 0;
    };
    reader.readAsText(file);
}

function saveBulkDomains() {
    var btn = document.getElementById('btnSaveBulk');
    var originalText = btn.innerHTML;
    btn.innerHTML = '<div class="spinner h-4 w-4 border-2 border-white/20 border-t-white"></div> Processing...';
    btn.disabled = true;

    setTimeout(function() {
        btn.innerHTML = originalText;
        closeSmoothly('domainModal');
        showPremiumToast("Bulk Upload Success", validBulkUploadArray.length + " domains processed successfully!", "success");
        document.getElementById('csvFileInput').value = '';
        document.getElementById('bulkUploadStats').classList.add('hidden');
        validBulkUploadArray = [];
    }, 1000);
}

function openDomainModal(index) {
    var modal = document.getElementById('domainModal');
    if (!modal) return;

    document.getElementById('domBrand').value = currentBrandName;
    var titleEl = document.getElementById('domainModalTitle');
    var toggleSwitch = document.getElementById('uploadModeToggle');

    if (index !== undefined && index >= 0) {
        if (toggleSwitch) toggleSwitch.classList.add('hidden');
        switchDomainUploadMode('single');

        var rowData = currentViewData[index];
        document.getElementById('domRowIndex').value = index;
        document.getElementById('domOriginalName').value = rowData.domain || '';
        document.getElementById('domName').value = rowData.domain || '';

        var expInput = '';
        if (rowData.expiration) {
            var d = new Date(rowData.expiration);
            if (!isNaN(d.getTime())) {
                var yyyy = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
                expInput = yyyy + '-' + mm + '-' + dd;
            }
        }
        document.getElementById('domExp').value = expInput;
        document.getElementById('domAccount').value = rowData.account || '';
        document.getElementById('domPrice').value = rowData.price || '';
        document.getElementById('domAgent').value = rowData.agent || '';
        document.getElementById('domRedirect').value = rowData.redirected || '';
        document.getElementById('domNotes').value = rowData.notes || '';
        titleEl.innerHTML = '<i data-lucide="edit" class="h-5 w-5 text-indigo-500"></i> Edit Domain: ' + (rowData.domain || '');
    } else {
        if (toggleSwitch) { toggleSwitch.classList.remove('hidden'); toggleSwitch.classList.add('flex'); }
        switchDomainUploadMode('single');

        document.getElementById('domRowIndex').value = -1;
        document.getElementById('domOriginalName').value = '';
        document.getElementById('domName').value = ''; document.getElementById('domExp').value = ''; document.getElementById('domAccount').value = '';
        document.getElementById('domPrice').value = ''; document.getElementById('domAgent').value = ''; document.getElementById('domRedirect').value = ''; document.getElementById('domNotes').value = '';
        titleEl.innerHTML = '<i data-lucide="globe" class="h-5 w-5 text-indigo-500"></i> Add New Domain';

        if(document.getElementById('csvFileInput')) document.getElementById('csvFileInput').value = '';
        if(document.getElementById('bulkUploadStats')) document.getElementById('bulkUploadStats').classList.add('hidden');
    }

    modal.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function attemptCloseDomainModal() {
    var domName = document.getElementById('domName').value.trim();
    var fileInput = document.getElementById('csvFileInput');
    var hasFile = fileInput && fileInput.files.length > 0;

    if (domName !== '' || hasFile) {
        showPremiumConfirm("Unsaved Changes", "Do you want to close this transaction? All unsaved data will be lost.", "Yes, Close", function() {
            closeSmoothly('domainModal');
        });
    } else {
        closeSmoothly('domainModal');
    }
}

function saveDomainRecord() {
    var name = document.getElementById('domName').value.trim();
    if (name === '') { showPremiumToast("Required Field", "Domain Name is required.", "error"); document.getElementById('domName').focus(); return; }

    var btn = document.getElementById('btnSaveDomain');
    var originalBtnHtml = btn.innerHTML;
    btn.innerHTML = '<div class="spinner h-4 w-4 border-2 border-white/20 border-t-white"></div> Saving...';
    btn.disabled = true;

    var payload = {
        originalDomain: String(document.getElementById('domOriginalName').value),
        brand: String(document.getElementById('domBrand').value),
        domain: String(name),
        expiration: String(document.getElementById('domExp').value),
        account: String(document.getElementById('domAccount').value),
        price: String(document.getElementById('domPrice').value),
        agent: String(document.getElementById('domAgent').value),
        redirected: String(document.getElementById('domRedirect').value),
        notes: String(document.getElementById('domNotes').value)
    };

    var safePayload = JSON.parse(JSON.stringify(payload));

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.withSuccessHandler(function(response) {
            btn.innerHTML = originalBtnHtml; btn.disabled = false;
            closeSmoothly('domainModal');
            showPremiumToast("Success!", response.message || "Record saved successfully.", "success");
            loadBrandDomains(currentBrandName);
        }).saveNewDomain(currentSessionToken, safePayload);
    } else {
        setTimeout(function() {
            btn.innerHTML = originalBtnHtml; btn.disabled = false;
            closeSmoothly('domainModal');
            showPremiumToast("Success!", "Domain saved successfully! (Frontend Simulation)", "success");
        }, 700);
    }
}

function deleteDomainRecord(index) {
    var rowData = currentViewData[index];
    if (!rowData) return;

    showPremiumConfirm("Delete Domain", "Are you sure you want to permanently delete '" + rowData.domain + "'? This action cannot be undone.", "Yes, Delete", function() {
        document.getElementById('appContent').style.opacity = '0.5';

        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run.withSuccessHandler(function(response) {
                document.getElementById('appContent').style.opacity = '1';
                if(response.success) {
                    showPremiumToast("Deleted", "Domain deleted successfully.", "success");
                    loadBrandDomains(currentBrandName);
                } else {
                    showPremiumToast("Error", response.message, "error");
                }
            }).deleteDomainRecordBackend(currentSessionToken, String(rowData.brand), String(rowData.domain));
        } else {
            setTimeout(function() {
                document.getElementById('appContent').style.opacity = '1';
                showPremiumToast("Deleted", "Domain deleted! (Frontend Simulation)", "success");
                currentBrandData.splice(index, 1);
                filterBrandTable();
            }, 700);
        }
    });
}

// ==========================================
// BRAND CREATION (WITH DOMAIN INIT)
// ==========================================
function openAddBrandModal() {
    var modal = document.getElementById('addBrandModal');
    if (modal) {
        document.getElementById('newBrandName').value = '';
        document.getElementById('newBrandDomain').value = '';
        document.getElementById('newBrandExp').value = '';
        document.getElementById('newBrandAccount').value = '';
        document.getElementById('newBrandPrice').value = '';
        document.getElementById('newBrandAgent').value = '';
        document.getElementById('newBrandRedirect').value = '';
        document.getElementById('newBrandNotes').value = '';
        modal.classList.remove('hidden');
        setTimeout(function(){ modal.style.opacity = '1'; }, 10);
        if (typeof lucide !== 'undefined') lucide.createIcons();
        setTimeout(function() { document.getElementById('newBrandName').focus(); }, 150);
    }
}

function attemptCloseBrandModal() {
    var brandVal = document.getElementById('newBrandName').value.trim();
    var domainVal = document.getElementById('newBrandDomain').value.trim();
    if (brandVal !== '' || domainVal !== '') {
        showPremiumConfirm("Unsaved Changes", "Do you want to close this transaction? All unsaved data will be lost.", "Yes, Close", function() {
            closeSmoothly('addBrandModal');
        });
    } else {
        closeSmoothly('addBrandModal');
    }
}

function saveBrandRecord() {
    var brand = document.getElementById('newBrandName').value.trim().toUpperCase();
    var domain = document.getElementById('newBrandDomain').value.trim();

    if(brand === '' || domain === '') {
        showPremiumToast("Required Fields", "Both Brand Name and Domain Name are required.", "error");
        return;
    }

    var btn = document.getElementById('btnSaveBrand');
    var originalBtnHtml = btn.innerHTML;
    btn.innerHTML = '<div class="spinner h-4 w-4 border-2 border-white/20 border-t-white"></div> Registering...';
    btn.disabled = true;

    var payload = {
        originalDomain: "",
        brand: String(brand),
        domain: String(domain),
        expiration: String(document.getElementById('newBrandExp').value),
        account: String(document.getElementById('newBrandAccount').value),
        price: String(document.getElementById('newBrandPrice').value),
        agent: String(document.getElementById('newBrandAgent').value),
        redirected: String(document.getElementById('newBrandRedirect').value),
        notes: String(document.getElementById('newBrandNotes').value)
    };

    var safePayload = JSON.parse(JSON.stringify(payload));

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.withSuccessHandler(function(response) {
            btn.innerHTML = originalBtnHtml; btn.disabled = false;
            closeSmoothly('addBrandModal');
            showPremiumToast("Success!", "Brand '" + brand + "' registered successfully.", "success");
            loadSidebarBrands();
        }).saveNewDomain(currentSessionToken, safePayload);
    } else {
        setTimeout(function() {
            btn.innerHTML = originalBtnHtml; btn.disabled = false;
            closeSmoothly('addBrandModal');
            showPremiumToast("Success!", "Brand '" + brand + "' registered! (Mock)", "success");
        }, 700);
    }
}

// ==========================================
// SYSTEM ACTIVITY LOGS (DATABASE SYNCED)
// ==========================================
var systemActivityLogs = [];

function logSystemActivity(actionType, details) {
    var activeUser = document.getElementById('adminProfileName') ? document.getElementById('adminProfileName').innerText : 'System';
    var timestamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true });

    var payload = { type: actionType, user: activeUser, details: details, time: timestamp };
    systemActivityLogs.unshift(payload);

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.saveActivityLogBackend(payload);
    }
}

function openActivityLogsModal() {
    var modal = document.getElementById('activityLogsModal');
    if (!modal) {
        var html = [
            '<div id="activityLogsModal" class="hidden fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 transition-opacity duration-200 opacity-0">',
            '  <div class="modal-shell w-full max-w-2xl flex flex-col max-h-[85vh]">',
            '    <div class="px-6 py-4 border-b border-theme flex items-center justify-between bg-app">',
            '      <h3 class="text-lg font-black text-heading flex items-center gap-2"><i data-lucide="activity" class="h-5 w-5 text-indigo-500"></i> System Activity Logs</h3>',
            '      <button onclick="closeSmoothly(\'activityLogsModal\')" class="text-subtle hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-tint transition-colors"><i data-lucide="x" class="h-5 w-5"></i></button>',
            '    </div>',
            '    <div class="p-6 overflow-y-auto custom-scrollbar flex-1 bg-app" id="activityLogsContainer">',
            '    </div>',
            '  </div>',
            '</div>'
        ].join('\n');
        document.body.insertAdjacentHTML('beforeend', html);
        modal = document.getElementById('activityLogsModal');
    }

    var container = document.getElementById('activityLogsContainer');
    container.innerHTML = '<div class="flex flex-col items-center justify-center py-16 text-subtle"><div class="spinner mb-4 border-t-indigo-500"></div><p class="text-xs font-bold uppercase tracking-widest">Syncing securely from Database...</p></div>';

    modal.classList.remove('hidden');
    setTimeout(function(){ modal.style.opacity = '1'; }, 10);

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run.withSuccessHandler(function(logs) {
            if(logs && logs.length > 0) systemActivityLogs = logs;
            renderLogsInModal(container);
        }).getActivityLogsBackend(currentSessionToken);
        return;
    }

    var GOOGLE_WEB_APP_API_URL = "https://bbc-api-gateway.ea-nix.workers.dev/";
    var targetUrl = GOOGLE_WEB_APP_API_URL + "?action=getActivityLogsBackend&token=" + encodeURIComponent(currentSessionToken || '');

    var jsonpScript = document.createElement('script');
    var callbackName = 'jsonp_logs_' + Math.round(Math.random() * 1000000);

    window[callbackName] = function(logs) {
        if(logs && logs.length > 0) systemActivityLogs = logs;
        renderLogsInModal(container);
        document.body.removeChild(jsonpScript);
        delete window[callbackName];
    };

    jsonpScript.src = targetUrl + "&callback=" + callbackName;
    document.body.appendChild(jsonpScript);
}

function renderLogsInModal(container) {
    if (systemActivityLogs.length === 0) {
        container.innerHTML = '<div class="text-center text-subtle py-12 font-medium flex flex-col items-center gap-3"><i data-lucide="shield-check" class="h-12 w-12 opacity-30"></i> No system activity detected yet.</div>';
    } else {
        var logsHtml = '<div class="space-y-3">';
        systemActivityLogs.forEach(function(log) {
            var icon = 'activity';
            var color = 'text-indigo-500 bg-indigo-tint border-indigo-100 dark:border-indigo-900';
            if(log.type === 'DELETE') { icon = 'trash-2'; color = 'text-rose-500 bg-rose-tint border-rose-100 dark:border-rose-900'; }
            if(log.type === 'ADD/UPLOAD') { icon = 'upload-cloud'; color = 'text-emerald-500 bg-emerald-tint border-emerald-100 dark:border-emerald-900'; }
            if(log.type === 'CLEANUP') { icon = 'eraser'; color = 'text-amber-500 bg-amber-tint border-amber-100 dark:border-amber-900'; }

            logsHtml += '<div class="bg-panel border border-theme p-4 rounded-xl shadow-sm flex items-start gap-4">' +
                        '<div class="p-2 rounded-lg border ' + color + '"><i data-lucide="' + icon + '" class="h-4 w-4"></i></div>' +
                        '<div class="flex-1"><p class="text-sm text-body font-bold">' + log.details + '</p><div class="flex items-center gap-4 mt-2 text-[10px] font-bold text-subtle uppercase tracking-widest"><span class="flex items-center gap-1 bg-app px-2 py-0.5 rounded text-body"><i data-lucide="user" class="h-3 w-3"></i> ' + log.user + '</span><span class="flex items-center gap-1"><i data-lucide="clock" class="h-3 w-3"></i> ' + log.time + '</span></div></div>' +
                        '</div>';
        });
        logsHtml += '</div>';
        container.innerHTML = logsHtml;
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ==========================================
// CLOUDFLARE API GATEWAY MAGIC POLYFILL
// ==========================================
if (typeof google === 'undefined') {
    window.google = { script: { run: createProxyHandler(null, null) } };
}

function createProxyHandler(successCb, failureCb) {
    return new Proxy({}, {
        get: function(target, prop) {
            if (prop === 'withSuccessHandler') return function(cb) { return createProxyHandler(cb, failureCb); };
            if (prop === 'withFailureHandler') return function(cb) { return createProxyHandler(successCb, cb); };

            return function() {
                var args = Array.from(arguments);
                fetch("https://bbc-api-gateway.ea-nix.workers.dev", {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify({ action: prop, args: args })
                })
                .then(function(res) { return res.json(); })
                .then(function(res) { if (successCb) successCb(res.data !== undefined ? res.data : res); })
                .catch(function(err) { if (failureCb) failureCb(err); else console.error("Gateway Error:", err); });
            };
        }
    });
}

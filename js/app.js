/**
 * MIND'S CRAFT Parent Portal — Main Application
 * All screen renderers and app initialization.
 */

// ============================
// DEV TOOL: AUTH TEST SCREEN
// Accessible via: Router.navigate('auth-test')
// or type authTest() in console
// ============================
Router.register('auth-test', async () => {
  const el = document.getElementById('screen-auth-test');

  // Use the currently-logged-in parent token directly
  const currentToken  = AuthService.getToken();
  const currentUserId = AuthService.getUserId();
  const session       = AuthService.getSession();

  el.innerHTML = `
  <div style="min-height:100vh;background:#0f172a;padding:16px 16px 120px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow-y:auto;">

    <!-- Header -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-top:8px;">
      <button onclick="Router.navigate('more')" style="background:rgba(255,255,255,0.1);border:none;color:white;width:36px;height:36px;border-radius:10px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">←</button>
      <div>
        <div style="color:white;font-weight:700;font-size:16px;">🔧 Data Diagnostic Tool</div>
        <div style="color:rgba(255,255,255,0.4);font-size:12px;">Uses your current login — no admin needed</div>
      </div>
    </div>

    <!-- Current session info -->
    <div style="background:white;border-radius:20px;padding:20px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;margin-bottom:10px;">Current Session</div>
      <div style="font-size:13px;font-family:monospace;line-height:2;color:#1e293b;">
        <div>👤 <strong>${session?.fullName || '—'}</strong> (${session?.email || '—'})</div>
        <div>🔑 Token: ${currentToken ? currentToken.substring(0,25)+'…' : '❌ No token'}</div>
        <div>🆔 User ID: ${currentUserId || '❌ None'}</div>
      </div>
    </div>

    <!-- Quick lookup by student name -->
    <div style="background:white;border-radius:20px;padding:20px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;margin-bottom:10px;">Step 1 — See All Students &amp; Their Allocations</div>
      <button onclick="runQuickDiag()"
        style="width:100%;padding:14px;background:#6c3ae8;color:white;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;">
        🔍 Run Diagnostic Now
      </button>
      <div id="at-quickresult" style="margin-top:12px;"></div>
    </div>

    <!-- Manual student ID lookup -->
    <div style="background:white;border-radius:20px;padding:20px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;margin-bottom:10px;">Step 2 — Lookup Allocations for a Specific Student ID</div>
      <input id="at-studentid" type="text" placeholder="Paste student UUID here"
        style="width:100%;padding:12px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;font-family:monospace;margin-bottom:10px;">
      <button onclick="runStudentLookup()"
        style="width:100%;padding:12px;background:#0369a1;color:white;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;">
        🔎 Lookup Allocations
      </button>
      <div id="at-lookupresult" style="margin-top:12px;"></div>
    </div>

  </div>`;
});

// Store token for diagnostic functions
window._diagToken = null;
window._diagUserId = null;

// ── Diagnostic helpers ────────────────────────────────────────
let _atJwt = null;
let _atUid  = null;

function atShow(id, html, type) {
  const el = document.getElementById(id);
  if (!el) return;
  const bg = type==='err'?'#fef2f2':type==='warn'?'#fff7ed':type==='info'?'#eff6ff':'#f8fafc';
  const br = type==='err'?'#f87171':type==='warn'?'#fed7aa':type==='info'?'#93c5fd':'#e2e8f0';
  const co = type==='err'?'#991b1b':type==='warn'?'#92400e':type==='info'?'#1e40af':'#1e293b';
  el.style.cssText = 'display:block;padding:14px;border-radius:12px;font-size:13px;background:' + bg + ';border:1px solid ' + br + ';color:' + co + ';line-height:1.8;word-break:break-all;';
  el.innerHTML = html;
}

// Run full diagnostic using currently-logged-in parent token
window.runQuickDiag = async function() {
  const token = AuthService.getToken();
  if (!token) { atShow('at-quickresult', '❌ Not logged in — please log in first.', 'err'); return; }

  atShow('at-quickresult', '⏳ Running diagnostic…', 'info');
  const base = SUPABASE_URL + '/rest/v1/';
  const hdr  = { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + token };

  // Also get kids via DataService (what the app actually uses)
  const appKids = await DataService.getKids().catch(() => []);
  let appKidsHtml = '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">📱 Kids visible in APP (getKids): ' + appKids.length + '</div>';
  appKids.forEach(k => {
    appKidsHtml += '<div style="font-size:11px;font-family:monospace;background:#f0fdf4;padding:4px 8px;border-radius:6px;margin-bottom:3px;">'
      + k.name + ' → <strong>' + k.id + '</strong></div>';
  });

  try {
    // 1. Fetch all visible students
    const rStudents = await fetch(base + 'users?user_type=eq.student&select=id,full_name,email&limit=20', { headers: hdr });
    const students  = rStudents.ok ? await rStudents.json() : [];

    // 2. Fetch all visible allocations (no filter = see everything RLS allows)
    const rAllocs    = await fetch(base + 'student_allocations?select=id,student_id,package_id,start_date,end_date,status&order=created_at.desc&limit=50', { headers: hdr });
    const allocsBody = await rAllocs.json();
    const allocs     = rAllocs.ok && Array.isArray(allocsBody) ? allocsBody : [];
    const allocsErr  = !rAllocs.ok ? (allocsBody?.message || 'HTTP ' + rAllocs.status) : null;

    // 3. Fetch packages for names
    const pkgIds = [...new Set(allocs.map(a => a.package_id).filter(Boolean))];
    let pkgMap = {};
    if (pkgIds.length) {
      const rPkgs = await fetch(base + 'packages?id=in.(' + pkgIds.join(',') + ')&select=id,name', { headers: hdr });
      if (rPkgs.ok) { const pkgs = await rPkgs.json(); pkgs.forEach(p => pkgMap[p.id] = p.name); }
    }

    let html = appKidsHtml + '<hr style="margin:10px 0;border:none;border-top:1px solid #e2e8f0;">';

    // Students section
    html += '<div style="font-weight:700;font-size:13px;margin-bottom:8px;">👥 Students visible via Supabase (' + students.length + ')</div>';
    students.forEach(s => {
      const myAllocs = allocs.filter(a => a.student_id === s.id);
      const hasPkg   = myAllocs.length > 0;
      html += '<div style="background:' + (hasPkg?'#f0fdf4':'#fef2f2') + ';border:1px solid ' + (hasPkg?'#86efac':'#fca5a5') + ';border-radius:8px;padding:8px 10px;margin-bottom:6px;">'
        + (hasPkg ? '✅' : '❌') + ' <strong>' + (s.full_name||'—') + '</strong>'
        + '<div style="font-size:11px;font-family:monospace;color:#64748b;">' + s.id + '</div>'
        + '<div style="font-size:11px;margin-top:4px;">'
        + (hasPkg
          ? myAllocs.map(a => '📦 ' + (pkgMap[a.package_id]||'pkg?') + ' | ' + (a.start_date||'?') + '→' + (a.end_date||'?') + ' | ' + (a.status||'?')).join('<br>')
          : '⚠️ No allocation matched this student_id')
        + '</div></div>';
    });

    // Allocations raw result
    html += '<div style="font-weight:700;font-size:13px;margin:12px 0 6px;">📦 student_allocations table — HTTP ' + rAllocs.status + ' — ' + allocs.length + ' row(s)</div>';
    if (allocsErr) {
      html += '<div style="color:#dc2626;background:#fef2f2;padding:8px;border-radius:8px;font-size:12px;">'
        + '❌ Error: ' + allocsErr + '<br><br>'
        + '<strong>→ RLS is blocking reads on student_allocations.</strong><br>'
        + 'Fix: Supabase Dashboard → Table Editor → student_allocations → RLS Policies → Add SELECT policy for authenticated role.'
        + '</div>';
    } else if (allocs.length === 0) {
      html += '<div style="color:#92400e;background:#fff7ed;padding:8px;border-radius:8px;font-size:12px;">'
        + '⚠️ Table readable but 0 rows returned.<br>'
        + 'Either no allocations exist yet, or RLS filters them all out (200 with empty array).<br><br>'
        + '<strong>→ Go to Supabase Dashboard → Table Editor → student_allocations and check if rows exist for Peter\'s student_id.</strong>'
        + '</div>';
    } else {
      allocs.forEach(a => {
        const sName = (students.find(s => s.id === a.student_id)||{}).full_name || a.student_id;
        html += '<div style="font-size:11px;font-family:monospace;background:#f8fafc;padding:4px 8px;border-radius:6px;margin-bottom:3px;">'
          + (pkgMap[a.package_id]||'pkg?') + ' | ' + sName + ' | ' + (a.start_date||'?') + '→' + (a.end_date||'?') + ' | ' + (a.status||'?')
          + '</div>';
      });
    }

    atShow('at-quickresult', html, allocs.length > 0 ? 'info' : 'warn');

    // Pre-fill Peter's ID (or first kid from app) for quick lookup
    const peterKid = appKids.find(k => k.name && k.name.toLowerCase().includes('peter'));
    const firstStudent = peterKid || appKids[0] || students[0];
    if (firstStudent) {
      const inp = document.getElementById('at-studentid');
      if (inp && !inp.value) inp.value = firstStudent.id || firstStudent.id;
    }

  } catch(e) {
    atShow('at-quickresult', '❌ Error: ' + e.message, 'err');
  }
};

// Lookup allocations for a manually-entered student ID
window.runStudentLookup = async function() {
  const token = AuthService.getToken();
  const sid   = (document.getElementById('at-studentid')?.value || '').trim();
  if (!token) { atShow('at-lookupresult', '❌ Not logged in.', 'err'); return; }
  if (!sid)   { atShow('at-lookupresult', '⚠️ Paste a student UUID above.', 'warn'); return; }

  atShow('at-lookupresult', '⏳ Looking up…', 'info');
  const base = SUPABASE_URL + '/rest/v1/';
  const hdr  = { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + token };

  try {
    // Student info
    const rU = await fetch(base + 'users?id=eq.' + sid + '&select=id,full_name,email,user_type', { headers: hdr });
    const us  = rU.ok ? await rU.json() : [];

    // Allocations for this student — fetch ALL columns to see the full schema
    const rA = await fetch(base + 'student_allocations?student_id=eq.' + sid + '&select=*&order=created_at.desc', { headers: hdr });
    const allocs = rA.ok ? await rA.json() : [];

    // Package names
    const pkgIds = [...new Set(allocs.map(a => a.package_id).filter(Boolean))];
    let pkgMap = {};
    if (pkgIds.length) {
      const rP = await fetch(base + 'packages?id=in.(' + pkgIds.join(',') + ')&select=id,name', { headers: hdr });
      if (rP.ok) { const pkgs = await rP.json(); pkgs.forEach(p => pkgMap[p.id] = p.name); }
    }

    let html = '';
    const student = us[0];
    html += '<div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:8px 10px;margin-bottom:10px;">'
      + '<strong>' + (student ? student.full_name : 'Student not visible (RLS)') + '</strong>'
      + (student ? '<div style="font-size:11px;font-family:monospace;">' + student.id + ' | type: ' + student.user_type + '</div>' : '')
      + '</div>';

    if (allocs.length === 0) {
      html += '<div style="color:#dc2626;padding:10px;background:#fef2f2;border-radius:8px;">'
        + '❌ <strong>No allocations found for this student ID.</strong><br><br>'
        + 'HTTP status for student_allocations: ' + rA.status + '<br><br>'
        + 'Possible causes:<br>'
        + '• The allocation was saved with a <em>different</em> student_id (not matching this UUID)<br>'
        + '• RLS is blocking the read for this parent token<br>'
        + '• No packages allocated yet in the database'
        + '</div>';
    } else {
      html += '<div style="font-weight:700;margin-bottom:6px;">✅ Found ' + allocs.length + ' allocation(s):</div>';
      allocs.forEach(a => {
        const expired = a.end_date && new Date(a.end_date + 'T00:00:00') < new Date();
        html += '<div style="background:' + (expired?'#fef2f2':'#f0fdf4') + ';border:1px solid ' + (expired?'#fca5a5':'#86efac') + ';border-radius:8px;padding:8px 10px;margin-bottom:6px;font-size:12px;">'
          + '📦 <strong>' + (pkgMap[a.package_id]||a.package_id||'Unknown Package') + '</strong>'
          + (expired ? ' <span style="color:#dc2626;">(EXPIRED)</span>' : ' <span style="color:#16a34a;">(ACTIVE/FUTURE)</span>')
          + '<div style="font-family:monospace;margin-top:4px;font-size:11px;">'
          + 'Start: ' + (a.start_date||'—') + '<br>'
          + 'End: ' + (a.end_date||'—') + '<br>'
          + 'Status: ' + (a.status||'—') + '<br>'
          + '<hr style="border:none;border-top:1px solid #e2e8f0;margin:4px 0;">'
          + '<strong>ALL COLUMNS:</strong><br>'
          + Object.entries(a).map(([k,v]) => k + ': <em>' + (v===null?'NULL':v) + '</em>').join('<br>')
          + '</div></div>';
      });
    }

    atShow('at-lookupresult', html, allocs.length > 0 ? 'info' : 'err');
  } catch(e) {
    atShow('at-lookupresult', '❌ Error: ' + e.message, 'err');
  }
};

// Quick console access
window.authTest = function() { Router.navigate('auth-test'); };

// ============================
// SCREEN: SPLASH
// ============================
Router.register('splash', async () => {
  const el = document.getElementById('screen-splash');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:linear-gradient(160deg,#0F172A 0%,#1E0A4A 100%);">
      <div style="text-align:center;padding:var(--space-6);">
        <!-- Full logo on white pill card so it shows clearly on dark background -->
        <div style="background:white;border-radius:24px;padding:20px 28px;margin:0 auto var(--space-5);box-shadow:0 16px 48px rgba(0,0,0,0.4);display:inline-block;">
          <img src="icons/logo.png" alt="Minds' Craft" style="width:220px;height:auto;display:block;">
        </div>
        <p style="color:rgba(255,255,255,0.6);font-size:14px;font-weight:500;letter-spacing:0.5px;">Parent Portal</p>
        <div style="margin-top:48px;">
          <div class="spinner" style="margin:0 auto;border-color:rgba(108,58,232,0.2);border-top-color:#A855F7;"></div>
        </div>
      </div>
    </div>`;
});

// ============================
// SCREEN: LOGIN
// ============================
Router.register('login', async () => {
  const el = document.getElementById('screen-login');
  el.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;background:linear-gradient(160deg,#0F172A 0%,#1E0A4A 100%);">
      <!-- Install Banner -->
      <div id="install-banner" class="install-banner hidden">
        <div style="font-size:32px;">📱</div>
        <div class="install-banner__text">
          <div class="install-banner__title">Install the App</div>
          Add to your home screen for the best experience
        </div>
        <button id="install-btn" class="btn btn--secondary btn--sm" style="flex-shrink:0;background:rgba(255,255,255,0.15);color:white;border-color:rgba(255,255,255,0.3);">Install</button>
        <button class="install-banner__close" onclick="document.getElementById('install-banner').classList.add('hidden')">✕</button>
      </div>

      <!-- Header -->
      <div style="padding:48px var(--space-6) var(--space-5);text-align:center;">
        <div style="background:white;border-radius:18px;padding:14px 22px;margin:0 auto var(--space-4);display:inline-block;box-shadow:0 8px 28px rgba(0,0,0,0.35);">
          <img src="icons/logo.png" alt="Minds' Craft" style="width:180px;height:auto;display:block;">
        </div>
        <h1 style="font-size:24px;font-weight:800;color:white;margin-bottom:4px;">Welcome Back</h1>
        <p style="color:rgba(255,255,255,0.5);font-size:14px;">Sign in to your parent account</p>
      </div>

      <!-- Form Card -->
      <div style="flex:1;background:white;border-radius:28px 28px 0 0;padding:var(--space-6) var(--space-5);box-shadow:0 -4px 24px rgba(0,0,0,0.15);">
        <div id="login-error" class="alert alert--danger hidden" style="margin-bottom:var(--space-4);">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span id="login-error-text">Invalid credentials</span>
        </div>

        <form onsubmit="event.preventDefault();doLogin();" autocomplete="on">
        <div class="form-group">
          <label class="form-label">Username or Email</label>
          <div class="input-wrap">
            <span class="input-icon">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2"/></svg>
            </span>
            <input type="text" id="login-username" name="username" class="form-control has-icon" placeholder="your.username" autocomplete="username" autocapitalize="none">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Password</label>
          <div class="input-wrap">
            <span class="input-icon">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </span>
            <input type="password" id="login-password" name="password" class="form-control has-icon has-icon-right" placeholder="••••••••" autocomplete="current-password">
            <button class="input-icon-right" type="button" onclick="togglePassword()" style="cursor:pointer;">
              <svg id="pwd-eye" width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>
            </button>
          </div>
        </div>

        <button type="submit" class="btn btn--primary btn--block" id="login-btn" style="margin-top:var(--space-4);margin-bottom:var(--space-4);height:54px;font-size:16px;">
          Sign In
        </button>
        </form>

        <div style="text-align:center;">
          <button onclick="Router.navigate('forgot-password')" class="btn btn--ghost btn--sm">Forgot password?</button>
        </div>

        <div style="margin-top:var(--space-8);padding:var(--space-4);background:var(--color-bg);border-radius:var(--radius-lg);">
          <p style="font-size:12px;color:var(--color-text-muted);text-align:center;margin-bottom:6px;font-weight:600;">HOW TO LOG IN</p>
          <p style="font-size:13px;color:var(--color-text-secondary);text-align:center;line-height:1.6;">Enter the <strong>email address</strong> registered by your academy administrator.<br>Your password is your <strong>mobile number</strong>.</p>
        </div>

        <div style="text-align:center;margin-top:var(--space-5);">
          <button onclick="Router.navigate('auth-test')" style="background:none;border:none;font-size:11px;color:rgba(0,0,0,0.2);cursor:pointer;padding:4px 8px;">🔧 Admin test tool</button>
        </div>
      </div>
    </div>`;

  // Form handles Enter key via onsubmit

  // Show install banner if applicable
  if (window._deferredInstallPrompt) {
    document.getElementById('install-banner')?.classList.remove('hidden');
  }
});

function togglePassword() {
  const inp = document.getElementById('login-password');
  if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function doLogin() {
  const username = document.getElementById('login-username')?.value?.trim();
  const password = document.getElementById('login-password')?.value;
  const btn = document.getElementById('login-btn');
  const errorDiv = document.getElementById('login-error');
  const errorText = document.getElementById('login-error-text');

  if (!username || !password) {
    errorText.textContent = 'Please enter your username and password.';
    errorDiv.classList.remove('hidden');
    return;
  }

  if (btn) btn.disabled = true;
  if (btn) btn.innerHTML = '<div class="spinner" style="width:22px;height:22px;border-width:2px;margin:0;"></div>';

  const result = await AuthService.login(username, password);

  if (result.success) {
    errorDiv.classList.add('hidden');
    startRealtimeForCurrentUser();           // 🔔 start live notifications after login
    try {
      await Router.navigate('home');
    } catch(e) {
      console.error('[Login] Navigate home failed:', e);
      if (btn) btn.disabled = false;
      if (btn) btn.innerHTML = 'Sign In';
      errorText.textContent = 'Login successful but could not load dashboard. Please refresh.';
      errorDiv.classList.remove('hidden');
    }
  } else {
    errorText.textContent = result.error;
    errorDiv.classList.remove('hidden');
    if (btn) btn.disabled = false;
    if (btn) btn.innerHTML = 'Sign In';
  }
}

// ============================
// SCREEN: RESET PASSWORD
// (landed here after clicking the email link — token is in window._resetToken)
// ============================
Router.register('reset-password', async ({ token, refreshToken } = {}) => {
  const accessToken  = token        || window._resetToken        || '';
  const refreshTok   = refreshToken || window._resetRefreshToken || null;
  const el = document.getElementById('screen-reset-password');

  if (!accessToken) {
    // No token — show error and redirect to forgot-password
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;min-height:100vh;background:var(--color-bg);align-items:center;justify-content:center;padding:var(--space-6);">
        <div style="text-align:center;">
          <div style="font-size:48px;margin-bottom:var(--space-4);">⚠️</div>
          <h2 style="font-size:20px;font-weight:700;margin-bottom:8px;">Invalid or expired link</h2>
          <p style="color:var(--color-text-secondary);font-size:14px;line-height:1.6;margin-bottom:var(--space-5);">
            This reset link is no longer valid. Please request a new one.
          </p>
          <button onclick="Router.navigate('forgot-password')" class="btn btn--primary">
            Request New Link
          </button>
        </div>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;min-height:100vh;background:var(--color-bg);">
      <div style="background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));padding:calc(var(--safe-top,0px) + 20px) var(--space-5) var(--space-6);text-align:center;">
        <div style="width:64px;height:64px;border-radius:var(--radius-full);background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-3);">
          <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2" stroke="white" stroke-width="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="white" stroke-width="2"/>
          </svg>
        </div>
        <h2 style="color:white;font-size:22px;font-weight:800;margin-bottom:6px;">Set New Password</h2>
        <p style="color:rgba(255,255,255,0.8);font-size:13px;">Choose a strong password for your account.</p>
      </div>

      <div style="flex:1;padding:var(--space-6) var(--space-5);">

        <!-- New password -->
        <div class="form-group" style="margin-bottom:var(--space-4);">
          <label class="form-label">New Password</label>
          <div class="input-wrap">
            <span class="input-icon">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="2"/></svg>
            </span>
            <input type="password" id="rp-new" class="form-control has-icon"
              placeholder="Minimum 8 characters"
              onkeydown="if(event.key==='Enter') document.getElementById('rp-confirm').focus()">
            <button class="input-icon-right" type="button"
              onclick="this.previousElementSibling.type=this.previousElementSibling.type==='password'?'text':'password';this.innerHTML=this.previousElementSibling.type==='password'?'<svg width=18 height=18 fill=none viewBox=&quot;0 0 24 24&quot;><path d=&quot;M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z&quot; stroke=currentColor stroke-width=2/><circle cx=12 cy=12 r=3 stroke=currentColor stroke-width=2/></svg>':'<svg width=18 height=18 fill=none viewBox=&quot;0 0 24 24&quot;><path d=&quot;M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24&quot; stroke=currentColor stroke-width=2/><line x1=1 y1=1 x2=23 y2=23 stroke=currentColor stroke-width=2/></svg>'">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>
            </button>
          </div>
        </div>

        <!-- Confirm password -->
        <div class="form-group" style="margin-bottom:var(--space-4);">
          <label class="form-label">Confirm New Password</label>
          <div class="input-wrap">
            <span class="input-icon">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="2"/></svg>
            </span>
            <input type="password" id="rp-confirm" class="form-control has-icon"
              placeholder="Repeat your password"
              onkeydown="if(event.key==='Enter') doResetPassword('${accessToken}','${refreshTok||''}')">
          </div>
        </div>

        <!-- Password strength hints -->
        <ul style="font-size:12px;color:var(--color-text-muted);margin-bottom:var(--space-4);padding-left:16px;line-height:1.8;">
          <li>At least 8 characters</li>
          <li>Mix of letters and numbers recommended</li>
        </ul>

        <!-- Error -->
        <div id="rp-error" class="hidden" style="background:var(--color-danger-bg);color:var(--color-danger);padding:10px 14px;border-radius:var(--radius-md);font-size:13px;margin-bottom:var(--space-3);"></div>

        <button id="rp-btn" class="btn btn--primary btn--block" onclick="doResetPassword('${accessToken}','${refreshTok||''}')" style="height:54px;font-size:16px;">
          Update Password
        </button>
      </div>
    </div>`;
});

async function doResetPassword(accessToken, refreshToken) {
  const newPwd     = document.getElementById('rp-new')?.value || '';
  const confirmPwd = document.getElementById('rp-confirm')?.value || '';
  const btn        = document.getElementById('rp-btn');
  const errorDiv   = document.getElementById('rp-error');

  // Validate
  if (newPwd.length < 8) {
    errorDiv.textContent = 'Password must be at least 8 characters.';
    errorDiv.classList.remove('hidden'); return;
  }
  if (newPwd !== confirmPwd) {
    errorDiv.textContent = 'Passwords do not match.';
    errorDiv.classList.remove('hidden'); return;
  }
  errorDiv.classList.add('hidden');

  // Loading
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:22px;height:22px;border-width:2px;margin:0;"></div>';

  const result = await AuthService.updatePassword(accessToken, newPwd, refreshToken || window._resetRefreshToken || null);

  btn.disabled = false;
  btn.innerHTML = 'Update Password';

  if (!result.success) {
    errorDiv.textContent = result.error || 'Failed to update password. The link may have expired.';
    errorDiv.classList.remove('hidden');
    return;
  }

  // Success — clear token + show confirmation
  window._resetToken = null;
  document.getElementById('screen-reset-password').innerHTML = `
    <div style="display:flex;flex-direction:column;min-height:100vh;background:var(--color-bg);align-items:center;justify-content:center;padding:var(--space-6);">
      <div style="text-align:center;max-width:320px;">
        <div style="width:80px;height:80px;border-radius:var(--radius-full);background:#D1FAE5;display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-5);">
          <svg width="36" height="36" fill="none" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <h2 style="font-size:22px;font-weight:800;color:var(--color-text);margin-bottom:10px;">Password updated!</h2>
        <p style="color:var(--color-text-secondary);font-size:14px;line-height:1.7;">
          Your password has been changed successfully. You can now sign in with your new password.
        </p>
        <button onclick="Router.navigate('login')" class="btn btn--primary btn--block" style="margin-top:var(--space-6);">
          Sign In
        </button>
      </div>
    </div>`;
}

// ============================
// SCREEN: FORGOT PASSWORD
// ============================
Router.register('forgot-password', async () => {
  const el = document.getElementById('screen-forgot-password');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;min-height:100vh;background:var(--color-bg);">
      ${UI.appBar('Reset Password', true)}
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:var(--space-8) var(--space-5);">

        <!-- Icon + heading -->
        <div style="text-align:center;margin-bottom:var(--space-6);">
          <div style="width:72px;height:72px;border-radius:var(--radius-full);background:var(--color-primary-bg);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-4);">
            <svg width="32" height="32" fill="none" viewBox="0 0 24 24">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="var(--color-primary)" stroke-width="2"/>
              <polyline points="22,6 12,13 2,6" stroke="var(--color-primary)" stroke-width="2"/>
            </svg>
          </div>
          <h2 style="font-size:22px;font-weight:800;color:var(--color-text);margin-bottom:8px;">Forgot your password?</h2>
          <p style="color:var(--color-text-secondary);font-size:14px;line-height:1.7;max-width:300px;margin:0 auto;">
            Enter your email address and we'll send you a secure reset link.
          </p>
        </div>

        <!-- Form -->
        <div class="form-group" style="margin-bottom:var(--space-4);">
          <label class="form-label">Email Address</label>
          <div class="input-wrap">
            <span class="input-icon">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" stroke-width="2"/><polyline points="22,6 12,13 2,6" stroke="currentColor" stroke-width="2"/></svg>
            </span>
            <input type="email" id="fp-email" class="form-control has-icon"
              placeholder="your@email.com"
              onkeydown="if(event.key==='Enter') doForgotPwd()">
          </div>
        </div>

        <!-- Error message (hidden by default) -->
        <div id="fp-error" class="hidden" style="background:var(--color-danger-bg);color:var(--color-danger);padding:10px 14px;border-radius:var(--radius-md);font-size:13px;margin-bottom:var(--space-3);"></div>

        <button id="fp-btn" class="btn btn--primary btn--block" onclick="doForgotPwd()" style="height:54px;font-size:16px;">
          Send Reset Link
        </button>

        <div style="text-align:center;margin-top:var(--space-5);">
          <button onclick="Router.back()" class="btn btn--ghost btn--sm">← Back to Sign In</button>
        </div>
      </div>
    </div>`;
});

async function doForgotPwd() {
  const emailInput = document.getElementById('fp-email');
  const btn        = document.getElementById('fp-btn');
  const errorDiv   = document.getElementById('fp-error');
  const email      = emailInput?.value?.trim();

  // Validate
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorDiv.textContent = 'Please enter a valid email address.';
    errorDiv.classList.remove('hidden');
    return;
  }
  errorDiv.classList.add('hidden');

  // Loading state
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:22px;height:22px;border-width:2px;margin:0;"></div>';

  const result = await AuthService.forgotPassword(email);

  btn.disabled = false;
  btn.innerHTML = 'Send Reset Link';

  // Always show success (security best practice — don't reveal if email exists)
  document.getElementById('screen-forgot-password').innerHTML = `
    <div style="display:flex;flex-direction:column;min-height:100vh;background:var(--color-bg);">
      ${UI.appBar('Reset Password', true)}
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-8) var(--space-5);text-align:center;">
        <div style="width:80px;height:80px;border-radius:var(--radius-full);background:#D1FAE5;display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-5);">
          <svg width="36" height="36" fill="none" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <h2 style="font-size:22px;font-weight:800;color:var(--color-text);margin-bottom:12px;">Check your email</h2>
        <p style="color:var(--color-text-secondary);font-size:14px;line-height:1.7;max-width:320px;">
          If <strong>${email}</strong> is registered, you'll receive a password reset link within a few minutes.
        </p>
        <p style="color:var(--color-text-muted);font-size:12px;margin-top:var(--space-3);line-height:1.6;">
          Check your spam folder if you don't see it.<br>The link expires in <strong>60 minutes</strong>.
        </p>
        <button onclick="Router.navigate('login')" class="btn btn--primary" style="margin-top:var(--space-6);padding:14px 32px;">
          Back to Sign In
        </button>
      </div>
    </div>`;
}

// ============================
// SCREEN: HOME DASHBOARD
// ============================
Router.register('home', async () => {

  // Safe load — never crash the screen
  let parent = {}, kids = [], notifications = [], events = [];
  try {
    const results = await Promise.allSettled([
      DataService.getParent(),
      DataService.getKids(),
      DataService.getNotifications(),
      DataService.getEvents('upcoming')
    ]);
    parent        = results[0].status === 'fulfilled' ? results[0].value : {};
    kids          = results[1].status === 'fulfilled' ? results[1].value : [];
    notifications = results[2].status === 'fulfilled' ? results[2].value : [];
    events        = results[3].status === 'fulfilled' ? results[3].value : [];
  } catch(e) {
    console.warn('[Home] Data load error:', e);
  }

  const unread = notifications.filter(n => n.unread).length;

  // Build kid cards — per-course stats, each course matched to its own allocation
  const kidCardsHTML = await Promise.all(kids.map(async kid => {
    const [classes, attendanceRaw, levelInfo, allSubs] = await Promise.all([
      DataService.getKidClasses(kid.id).catch(() => []),
      DataService.getAttendance(kid.id).catch(() => []),
      DataService.getLevelInfo(kid.id).catch(() => null),
      DataService.getKidSubscriptions(kid.id).catch(() => [])
    ]);
    if (levelInfo) { kid.level = levelInfo.current; kid.accomplishmentPct = levelInfo.pct; }
    const attendance = attendanceRaw || [];
    const hasLevelIds = attendance.some(r => r.levelId);

    // Header badge: use first active sub, or first sub overall
    const sub = allSubs.find(s => s.status === 'active') || allSubs[0]
      || { status: 'none', packageName: 'No Package', daysLeft: 0, expiryDate: null };

    const courseRowsHTML = classes.length === 0
      ? `<div style="font-size:12px;color:var(--color-text-muted);padding:var(--space-2) 0;">No courses enrolled</div>`
      : classes.map(cls => buildCourseRow(cls, attendance, allSubs, hasLevelIds)).join('');


    return `
      <div class="kid-summary-card" onclick="Router.navigate('kid-detail', {kidId:'${kid.id}'})">
        <div class="kid-card-header" style="margin-bottom:var(--space-3);">
          ${UI.avatar(kid.avatar, kid.initials, 'lg')}
          <div class="kid-info" style="flex:1;">
            <div class="kid-name">${kid.name}</div>
            ${kid.age ? `<div class="kid-meta">${kid.age} yrs</div>` : ''}
          </div>
        </div>
        ${courseRowsHTML}
      </div>`;
  }));

  // Events preview
  const eventsHTML = events.slice(0, 2).map(ev => `
    <div class="h-scroll-card" onclick="Router.navigate('event-detail',{eventId:'${ev.id}'})" style="width:220px;cursor:pointer;">
      <div style="width:100%;height:70px;border-radius:var(--radius-md);background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));margin-bottom:var(--space-2);display:flex;align-items:center;justify-content:center;">
        ${UI.badge(ev.category, 'neutral')}
      </div>
      <div style="font-size:13px;font-weight:600;color:var(--color-text);margin-bottom:4px;">${ev.title}</div>
      <div style="font-size:12px;color:var(--color-text-secondary);">${UI.formatDateShort(ev.date)} • ${ev.time}</div>
    </div>`).join('');

  // Notification preview
  const notifHTML = notifications.filter(n => n.unread).slice(0, 3).map(n => `
    <div class="notif-item" onclick="Router.navigate('notifications')" style="border-radius:var(--radius-lg);">
      <div class="notif-icon notif-icon--${n.type}">
        ${getNotifIcon(n.type)}
      </div>
      <div class="notif-content">
        <div class="notif-title">${n.title}</div>
        <div class="notif-body">${n.body.length > 60 ? n.body.substring(0,60) + '...' : n.body}</div>
        <div class="notif-time">${n.time}</div>
      </div>
      ${n.unread ? '<div class="notif-dot"></div>' : ''}
    </div>`).join('');

  const el = document.getElementById('screen-home');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      <!-- Hero Header -->
      <div class="hero-header">
        <div class="hero-header__content">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4);">
            <div>
              <p style="color:rgba(255,255,255,0.65);font-size:12px;font-weight:500;letter-spacing:0.5px;">GOOD ${getTimeOfDay()}</p>
              <h1 style="color:white;font-size:22px;font-weight:800;">${parent.name.split(' ')[0]} 👋</h1>
            </div>
            <div style="display:flex;align-items:center;gap:var(--space-2);">
              <button class="icon-btn" onclick="Router.navigate('notifications')" style="background:rgba(255,255,255,0.15);color:white;" aria-label="Notifications">
                <div class="nav-icon-wrap" style="color:white;">
                  <svg width="22" height="22" fill="none" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                  ${unread > 0 ? `<span class="nav-badge">${unread}</span>` : ''}
                </div>
              </button>
              <button onclick="Router.navigate('profile')" style="background:rgba(255,255,255,0.15);border-radius:var(--radius-full);border:none;cursor:pointer;padding:0;width:40px;height:40px;display:flex;align-items:center;justify-content:center;">
                <div class="avatar-placeholder avatar-placeholder--sm" style="width:36px;height:36px;font-size:14px;background:rgba(255,255,255,0.2);">${parent.initials}</div>
              </button>
            </div>
          </div>

          <!-- Quick stats -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-2);">
            <div style="background:rgba(255,255,255,0.12);border-radius:var(--radius-lg);padding:var(--space-3);text-align:center;border:1px solid rgba(255,255,255,0.1);">
              <div style="font-size:22px;font-weight:800;color:white;">${kids.length}</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.65);font-weight:500;">My Kids</div>
            </div>
            <div style="background:rgba(255,255,255,0.12);border-radius:var(--radius-lg);padding:var(--space-3);text-align:center;border:1px solid rgba(255,255,255,0.1);">
              <div style="font-size:22px;font-weight:800;color:white;">${events.length}</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.65);font-weight:500;">Events</div>
            </div>
            <div style="background:rgba(255,255,255,0.12);border-radius:var(--radius-lg);padding:var(--space-3);text-align:center;border:1px solid rgba(255,255,255,0.1);">
              <div style="font-size:22px;font-weight:800;color:white;">${unread}</div><div style="font-size:10px;color:rgba(255,255,255,0.65);font-weight:500;">${unread > 0 ? 'Alerts' : 'Notifications'}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Scrollable Content -->
      <div class="scroll-content" style="margin-top:-20px;">
        <div style="background:var(--color-bg);border-radius:24px 24px 0 0;padding:var(--space-5) var(--space-4) calc(var(--nav-height) + var(--safe-bottom) + var(--space-6));">

          <!-- Kids Section -->
          <div class="section-header">
            <h2 class="section-title">My Kids</h2>
            <button onclick="Router.navigate('kids')" class="section-action">View all</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-4);">
            ${kidCardsHTML.join('')}
          </div>

          <!-- Notifications Preview -->
          ${unread > 0 ? `
            <div class="section-header">
              <h2 class="section-title">Unread Alerts</h2>
              <button onclick="Router.navigate('notifications')" class="section-action">View all</button>
            </div>
            <div class="card" style="padding:0;overflow:hidden;margin-bottom:var(--space-4);">
              ${notifHTML}
            </div>` : ''}

          <!-- Events Preview -->
          ${events.length > 0 ? `
            <div class="section-header">
              <h2 class="section-title">Upcoming Events</h2>
              <button onclick="Router.navigate('events')" class="section-action">View all</button>
            </div>
            <div class="h-scroll" style="margin-bottom:var(--space-4);">
              ${eventsHTML}
            </div>` : ''}

          <!-- Quick Links -->
          <div class="section-header">
            <h2 class="section-title">Quick Access</h2>
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-3);">
            ${[
              ['classes', 'Classes', 'var(--color-primary-bg)', 'var(--color-primary)', `<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" stroke="currentColor" stroke-width="2"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" stroke="currentColor" stroke-width="2"/>`],
              ['trainers', 'Trainers', '#D1FAE5', 'var(--color-success)', `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" stroke-width="2"/>`],
              ['subscriptions', 'Packages', '#DBEAFE', 'var(--color-info)', `<rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`],
              ['about', 'About Us', '#FEF3C7', '#92400E', `<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2"/><line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" stroke-width="2"/>`]
            ].map(([screen, label, bg, color, icon]) => `
              <button onclick="Router.navigate('${screen}')" style="background:${bg};border:1px solid rgba(0,0,0,0.04);border-radius:var(--radius-xl);padding:var(--space-4);display:flex;flex-direction:column;align-items:center;gap:var(--space-2);text-align:center;cursor:pointer;transition:transform 0.15s ease;" onactive="this.style.transform='scale(0.97)'">
                <div style="width:44px;height:44px;border-radius:var(--radius-full);background:rgba(255,255,255,0.7);display:flex;align-items:center;justify-content:center;">
                  <svg width="22" height="22" fill="none" viewBox="0 0 24 24" style="color:${color};">${icon}</svg>
                </div>
                <span style="font-size:13px;font-weight:600;color:var(--color-text);">${label}</span>
              </button>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
});

// ============================
// SCREEN: KIDS LIST
// ============================
Router.register('kids', async () => {
  const kids = await DataService.getKids().catch(() => []);

  const kidsHTML = await Promise.all(kids.map(async kid => {
    const [classes, attendanceRaw, levelInfo, allSubs] = await Promise.all([
      DataService.getKidClasses(kid.id).catch(() => []),
      DataService.getAttendance(kid.id).catch(() => []),
      DataService.getLevelInfo(kid.id).catch(() => null),
      DataService.getKidSubscriptions(kid.id).catch(() => [])
    ]);
    if (levelInfo) { kid.level = levelInfo.current; kid.accomplishmentPct = levelInfo.pct; }
    const attendance = attendanceRaw || [];
    const hasLevelIds = attendance.some(r => r.levelId);

    // Header badge: first active sub, or first sub overall
    const sub = allSubs.find(s => s.status === 'active') || allSubs[0]
      || { status: 'none', packageName: 'No Package', daysLeft: 0, expiryDate: null };

    const courseRowsHTML = classes.length === 0
      ? `<div style="font-size:12px;color:var(--color-text-muted);padding:var(--space-2) 0;">No courses enrolled</div>`
      : classes.map(cls => buildCourseRow(cls, attendance, allSubs, hasLevelIds)).join('');

    return `
      <div class="kid-summary-card" onclick="Router.navigate('kid-detail',{kidId:'${kid.id}'})">
        <div class="kid-card-header" style="margin-bottom:var(--space-3);">
          ${UI.avatar(kid.avatar, kid.initials, 'xl')}
          <div class="kid-info" style="flex:1;">
            <div class="kid-name">${kid.name}</div>
            ${kid.age ? `<div class="kid-meta">${kid.age} years old</div>` : ''}
          </div>
        </div>
        ${courseRowsHTML}
      </div>`;
  }));

  const el = document.getElementById('screen-kids');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      ${UI.appBar('My Kids', false, UI.notifBellBtn())}
      <div class="scroll-content">
        <div class="page-content">
          ${kidsHTML.join('')}
        </div>
      </div>
    </div>`;
});

// ============================
// SCREEN: KID DETAIL
// ============================
Router.register('kid-detail', async ({ kidId } = {}) => {
  // Get first kid from parent's list if no kidId given
  let id = kidId;
  if (!id) {
    const kids = await DataService.getKids();
    id = kids[0]?.id;
    if (!id) { Router.navigate('kids'); return; }
  }

  const [kid, attSummaryRaw, assessmentsRaw, classes, levelInfo, attendanceRaw] = await Promise.all([
    DataService.getKid(id).catch(() => null),
    DataService.getAttendanceSummary(id).catch(() => null),
    DataService.getAssessments(id).catch(() => []),
    DataService.getKidClasses(id).catch(() => []),
    DataService.getLevelInfo(id).catch(() => null),
    DataService.getAttendance(id).catch(() => [])
  ]);
  const attSummary = attSummaryRaw || { rate: 0, present: 0, absent: 0, late: 0, total: 0 };
  const assessments = assessmentsRaw || [];
  const attendance = attendanceRaw || [];

  if (!kid) { Router.navigate('kids'); return; }

  // Update kid with real level info
  if (levelInfo) {
    kid.level = levelInfo.current;
    kid.accomplishmentPct = levelInfo.pct;
    kid.levelNumber = levelInfo.number;
    kid.totalLevels = levelInfo.total;
  }
  if (classes.length > 0) {
    kid.trainerId = classes[0].trainerId;
  }

  // Collect unique trainer IDs across ALL enrolled classes
  const uniqueTrainerIds = [...new Set(
    classes.map(c => c.trainerId).filter(Boolean)
  )];

  // Fetch all subscriptions for this kid + all trainers in parallel
  const [allSubsRaw, ...trainerResults] = await Promise.all([
    DataService.getKidSubscriptions(kid.id).catch(() => []),
    ...uniqueTrainerIds.map(tid => DataService.getTrainer(tid).catch(() => null))
  ]);
  const allSubs  = allSubsRaw || [];
  // allTrainers_ = array of trainer objects for all courses (de-duped, nulls removed)
  const allTrainers_ = trainerResults.filter(Boolean);
  // For backward-compat keep trainer_ as the first one
  const trainer_ = allTrainers_[0] || null;
  // Latest allocation = first in list (ordered newest first)
  const sub_ = allSubs[0] || { sessionsLeft: 0, sessionsUsed: 0, sessionsTotal: 0, status: 'none', daysLeft: 0, packageName: 'No Package', plan: '—', startDate: null, expiryDate: null, autoRenew: false };
  const latestAssess = (assessments.length > 0) ? assessments[0] : null;

  const el = document.getElementById('screen-kid-detail');

  const renderTab = (tabId) => {
    switch(tabId) {
      case 'overview':     return renderOverviewTab(kid, classes, allSubs, attendance, latestAssess, allTrainers_);
      case 'attendance':   return renderAttendanceTab(attendance, classes, allSubs);
      case 'assessments':  return renderAssessmentsTab(assessments, kid);
      case 'classes':      return renderClassesTab(classes);
      case 'level':        return renderLevelTab(levelInfo, classes, kid);
      case 'subscription': return renderSubscriptionTab(allSubs, kid);
      default: return '';
    }
  };

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      <!-- Hero -->
      <div class="detail-hero" style="position:relative;">
        <button onclick="Router.back()" style="position:absolute;top:var(--safe-top);top:calc(var(--safe-top) + 8px);left:12px;width:38px;height:38px;background:rgba(255,255,255,0.15);border:none;border-radius:var(--radius-full);display:flex;align-items:center;justify-content:center;cursor:pointer;color:white;">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        ${UI.avatar(kid.avatar, kid.initials, '2xl')}
        <h2 style="color:white;font-size:22px;font-weight:800;margin-top:var(--space-3);">${kid.name}</h2>
        <div style="display:flex;align-items:center;justify-content:center;gap:var(--space-2);margin-top:6px;flex-wrap:wrap;">
          ${allSubs.length > 0
            ? allSubs.filter(s => s.status !== 'none').map(s =>
                `<span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px;background:rgba(255,255,255,0.18);color:white;border:1px solid rgba(255,255,255,0.3);">${s.packageName} · Exp ${UI.formatDateShort(s.expiryDate)}</span>`
              ).join('')
            : `<span style="font-size:11px;color:rgba(255,255,255,0.6);">No active package</span>`}
        </div>
      </div>

      <!-- Tabs -->
      <div style="background:white;border-bottom:1px solid var(--color-border);position:sticky;top:0;z-index:50;">
        <div class="tabs" style="border-radius:0;background:white;padding:0;gap:0;border-bottom:none;" id="kid-tabs">
          ${[
            ['overview', 'Overview'],
            ['attendance', 'Attendance'],
            ['assessments', 'Assessments'],
            ['classes', 'Classes'],
            ['level', 'Level'],
            ['subscription', 'Package']
          ].map(([tab, label], i) => `
            <button class="tab ${i === 0 ? 'active' : ''}" data-tab="${tab}" onclick="switchKidTab('${tab}',this)" style="border-bottom:2px solid ${i === 0 ? 'var(--color-primary)' : 'transparent'};border-radius:0;padding:14px 16px;">
              ${label}
            </button>`).join('')}
        </div>
      </div>

      <!-- Tab Content -->
      <div class="scroll-content">
        <div id="kid-tab-content" class="page-content">
          ${renderTab('overview')}
        </div>
      </div>
    </div>`;

  // Store data for tab switching
  window._kidTabData = { kid, attSummary, assessments, classes, levelInfo, sub_, trainer_, allTrainers_, attendance, allSubs };
});

function switchKidTab(tabId, btn) {
  document.querySelectorAll('#kid-tabs .tab').forEach(t => {
    t.classList.remove('active');
    t.style.borderBottomColor = 'transparent';
  });
  btn.classList.add('active');
  btn.style.borderBottomColor = 'var(--color-primary)';

  const { kid, assessments, classes, levelInfo, trainer_, allTrainers_, attendance, allSubs } = window._kidTabData;
  const content = document.getElementById('kid-tab-content');
  const latestAssess = (assessments && assessments.length > 0) ? assessments[0] : null;

  switch(tabId) {
    case 'overview':     content.innerHTML = renderOverviewTab(kid, classes, allSubs, attendance, latestAssess, allTrainers_ || (trainer_ ? [trainer_] : [])); break;
    case 'attendance':   content.innerHTML = renderAttendanceTab(attendance, classes, allSubs); break;
    case 'assessments':  content.innerHTML = renderAssessmentsTab(assessments, kid); break;
    case 'classes':      content.innerHTML = renderClassesTab(classes); break;
    case 'level':        content.innerHTML = renderLevelTab(levelInfo, classes, kid); break;
    case 'subscription': content.innerHTML = renderSubscriptionTab(allSubs, kid); break;
  }

  document.querySelector('.scroll-content')?.scrollTo(0, 0);
  initProgressRings();
}

function renderOverviewTab(kid, classes, allSubs, attendance, latestAssess, trainersArg) {
  // trainersArg can be an array of trainers or a single trainer object
  const trainers = Array.isArray(trainersArg)
    ? trainersArg
    : (trainersArg ? [trainersArg] : []);
  const trainer = trainers[0] || null; // kept for backward-compat
  // Each course is matched to its own allocation via findAllocForCourse
  const hasLevelIds = (attendance || []).some(r => r.levelId);

  const courseRowsHTML = (!classes || classes.length === 0)
    ? `<div style="color:var(--color-text-muted);font-size:13px;text-align:center;padding:var(--space-3);">No courses enrolled</div>`
    : classes.map(cls => buildCourseRow(cls, attendance || [], allSubs || [], hasLevelIds)).join('');

  return `
    <!-- Per-course stats -->
    <div class="card" style="margin-bottom:var(--space-3);">
      <div class="card-header">
        <span class="card-title">My Courses</span>
        <button onclick="switchKidTab('classes', document.querySelector('[data-tab=classes]'))" class="card-link">All Classes</button>
      </div>
      ${courseRowsHTML}
    </div>

    <!-- Trainers (one card per unique trainer across all courses) -->
    ${trainers.length > 0 ? `
    <div class="card" style="margin-bottom:var(--space-3);">
      <div class="card-header">
        <span class="card-title">Trainer${trainers.length > 1 ? 's' : ''}</span>
        ${trainers.length === 1 ? `<button onclick="Router.navigate('trainer-detail',{trainerId:'${trainers[0].id}'})" class="card-link">Profile</button>` : ''}
      </div>
      ${trainers.map(t => `
      <div class="flex items-center gap-3" style="margin-bottom:${trainers.length > 1 ? 'var(--space-3)' : '0'};">
        ${UI.avatar(t.avatar, t.initials, 'md')}
        <div style="flex:1;">
          <div style="font-size:15px;font-weight:600;color:var(--color-text);">${t.name}</div>
          <div style="font-size:13px;color:var(--color-text-secondary);">${t.specialty}</div>
        </div>
        ${trainers.length > 1 ? `<button onclick="Router.navigate('trainer-detail',{trainerId:'${t.id}'})" style="font-size:11px;padding:4px 10px;border:1px solid var(--color-border);border-radius:99px;background:transparent;color:var(--color-text-secondary);cursor:pointer;">Profile</button>` : ''}
      </div>`).join('')}
    </div>` : ''}

    <!-- Latest Assessment -->
    ${latestAssess ? `
    <div class="card" style="margin-bottom:var(--space-3);">
      <div class="card-header">
        <span class="card-title">Latest Assessment</span>
        <button onclick="switchKidTab('assessments', document.querySelector('[data-tab=assessments]'))" class="card-link">All</button>
      </div>
      <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);">
        <div class="assessment-score assessment-score--${UI.scoreType(latestAssess.score)}">${latestAssess.score}</div>
        <div>
          <div style="font-weight:600;color:var(--color-text);">${latestAssess.title}</div>
          <div style="font-size:12px;color:var(--color-text-secondary);">${UI.formatDate(latestAssess.date)} · ${latestAssess.trainer}</div>
          <div style="margin-top:4px;">${UI.badge(latestAssess.grade, 'primary')}</div>
        </div>
      </div>
      <div style="font-size:13px;color:var(--color-text-secondary);font-style:italic;">"${latestAssess.remarks}"</div>
    </div>` : ''}

    <!-- All Packages summary REMOVED from overview — visible in Subscription tab -->
    ${false ? `
    <div onclick="switchKidTab('subscription', document.querySelector('[data-tab=subscription]'))" style="cursor:pointer;">
      ${(allSubs||[]).filter(s => s.status !== 'none').map(s => `
      <div class="${UI.subCardClass(s)}" style="margin-bottom:var(--space-2);">
        <div style="position:relative;">
          <div class="sub-card__name">${s.packageName}</div>
          <div class="sub-card__plan">${s.plan}</div>
          <div class="sub-card__stats">
            <div>
              <span class="sub-card__stat-val">${s.daysLeft > 0 ? s.daysLeft : '—'}</span>
              <span class="sub-card__stat-label">Days Left</span>
            </div>
            <div>
              <span class="sub-card__stat-val">${UI.formatDate(s.expiryDate) || '—'}</span>
              <span class="sub-card__stat-label">Expires</span>
            </div>
          </div>
          ${(s.status === 'expired') ? `
          <div style="margin-top:8px;padding:6px 10px;background:var(--color-warning);border-radius:var(--radius-sm);text-align:center;">
            <span style="font-size:11px;font-weight:700;color:white;">🔄 Renew Subscription</span>
          </div>` : ''}
        </div>
      </div>`).join('')}
    </div>` : ''}`;
}

function renderAttendanceTab(attendance, classes, allSubs) {
  const safeAtt     = attendance || [];
  const safeClasses = classes    || [];
  const hasLevelIds = safeAtt.some(r => r.levelId);

  // If no classes enrolled but we still have raw attendance records, show them all
  if (safeClasses.length === 0) {
    if (safeAtt.length === 0) {
      return `<div class="empty-state"><div class="empty-state__title">No attendance records found</div></div>`;
    }
    // Fallback: show all records ungrouped
    return _renderAttRows(safeAtt, null);
  }

  // One card per enrolled course — always show attendance regardless of package
  return safeClasses.map(cls => {
    // Get ALL attendance records for this course (no date filtering by package)
    const clsAtt = safeAtt.filter(r =>
      hasLevelIds ? r.levelId === cls.id : r.className === cls.name
    );

    // Optional: look up the matched package just for the label/status badge
    const matchedSub = findAllocForCourse(cls, allSubs || []);

    // Stats over ALL records
    const present    = clsAtt.filter(r => r.status === 'present' || r.status === 'late').length;
    const absent     = clsAtt.filter(r => r.status === 'absent').length;
    const late       = clsAtt.filter(r => r.status === 'late').length;
    const total      = clsAtt.length;
    const rate       = total > 0 ? Math.round((present / total) * 100) : 0;

    // Package info banner (optional, purely informational)
    let pkgBanner = '';
    if (matchedSub && matchedSub.status !== 'none') {
      const statusColor = matchedSub.status === 'expired'
        ? 'var(--color-danger)' : matchedSub.status === 'warning'
        ? 'var(--color-warning)' : 'var(--color-success)';
      const statusIcon  = matchedSub.status === 'expired' ? '🔴'
        : matchedSub.status === 'warning' ? '⚠️' : '✅';
      pkgBanner = `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:var(--radius-sm);background:var(--color-bg-secondary);border:1px solid var(--color-border);margin-bottom:var(--space-3);">
          <span style="font-size:13px;">${statusIcon}</span>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:600;color:var(--color-text);">${matchedSub.packageName}</div>
            ${matchedSub.startDate ? `<div style="font-size:11px;color:var(--color-text-muted);">${UI.formatDate(matchedSub.startDate)} – ${UI.formatDate(matchedSub.expiryDate)}</div>` : ''}
          </div>
          <span style="font-size:11px;font-weight:700;color:${statusColor};text-transform:uppercase;">${matchedSub.status}</span>
        </div>`;
    }

    const rows = clsAtt.map(r => `
      <div class="att-row">
        <div class="att-row__date">
          <div class="att-row__day">${r.day}</div>
          <div class="att-row__num">${new Date(r.date).getDate()}</div>
        </div>
        <div class="att-row__info">
          <div class="att-row__class">${r.className}</div>
          <div class="att-row__time">${UI.formatDateShort(r.date)} · ${r.time}</div>
        </div>
        ${UI.attendanceBadge(r.status)}
      </div>`).join('');

    const statsHtml = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center;margin-bottom:${total > 0 ? 'var(--space-3)' : '0'};">
        <div><div style="font-size:15px;font-weight:800;color:${total > 0 ? (rate >= 80 ? 'var(--color-success)' : 'var(--color-warning)') : 'var(--color-text-muted)'};">${total > 0 ? rate + '%' : '—'}</div><div style="font-size:10px;color:var(--color-text-muted);">Rate</div></div>
        <div><div style="font-size:15px;font-weight:800;color:var(--color-success);">${present}</div><div style="font-size:10px;color:var(--color-text-muted);">Present</div></div>
        <div><div style="font-size:15px;font-weight:800;color:var(--color-danger);">${absent}</div><div style="font-size:10px;color:var(--color-text-muted);">Absent</div></div>
        <div><div style="font-size:15px;font-weight:800;color:var(--color-warning);">${late}</div><div style="font-size:10px;color:var(--color-text-muted);">Late</div></div>
      </div>`;

    return `
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card-header" style="margin-bottom:var(--space-3);">
          <span class="card-title">${cls.courseName || cls.name}</span>
          <span style="font-size:12px;color:var(--color-text-muted);">${(cls.days || [])[0] || ''} · ${cls.time}</span>
        </div>
        ${pkgBanner}
        ${statsHtml}
        ${rows.length
          ? rows
          : `<div style="font-size:13px;color:var(--color-text-muted);text-align:center;padding:var(--space-3);">No attendance records yet</div>`
        }
      </div>`;
  }).join('');
}

// Helper: render a flat list of attendance rows (used when no classes context)
function _renderAttRows(attRows, title) {
  const present = attRows.filter(r => r.status === 'present' || r.status === 'late').length;
  const absent  = attRows.filter(r => r.status === 'absent').length;
  const late    = attRows.filter(r => r.status === 'late').length;
  const total   = attRows.length;
  const rate    = total > 0 ? Math.round((present / total) * 100) : 0;
  const rows    = attRows.map(r => `
    <div class="att-row">
      <div class="att-row__date">
        <div class="att-row__day">${r.day}</div>
        <div class="att-row__num">${new Date(r.date).getDate()}</div>
      </div>
      <div class="att-row__info">
        <div class="att-row__class">${r.className}</div>
        <div class="att-row__time">${UI.formatDateShort(r.date)} · ${r.time}</div>
      </div>
      ${UI.attendanceBadge(r.status)}
    </div>`).join('');
  return `
    <div class="card" style="margin-bottom:var(--space-4);">
      ${title ? `<div class="card-header" style="margin-bottom:var(--space-3);"><span class="card-title">${title}</span></div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center;margin-bottom:var(--space-3);">
        <div><div style="font-size:15px;font-weight:800;color:${rate>=80?'var(--color-success)':'var(--color-warning)'};">${rate}%</div><div style="font-size:10px;color:var(--color-text-muted);">Rate</div></div>
        <div><div style="font-size:15px;font-weight:800;color:var(--color-success);">${present}</div><div style="font-size:10px;color:var(--color-text-muted);">Present</div></div>
        <div><div style="font-size:15px;font-weight:800;color:var(--color-danger);">${absent}</div><div style="font-size:10px;color:var(--color-text-muted);">Absent</div></div>
        <div><div style="font-size:15px;font-weight:800;color:var(--color-warning);">${late}</div><div style="font-size:10px;color:var(--color-text-muted);">Late</div></div>
      </div>
      ${rows || `<div style="font-size:13px;color:var(--color-text-muted);text-align:center;padding:var(--space-3);">No attendance records yet</div>`}
    </div>`;
}

function renderAssessmentsTab(assessments, kid) {
  if (!assessments.length) {
    return `<div class="empty-state"><div class="empty-state__icon"><svg width="32" height="32" fill="none" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4" stroke="currentColor" stroke-width="2"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke="currentColor" stroke-width="2"/></svg></div><div class="empty-state__title">No Assessments Yet</div><div class="empty-state__body">Assessments will appear here once your trainer completes an evaluation.</div></div>`;
  }
  return assessments.map(a => `
    <div class="assessment-card" onclick="Router.navigate('assessment-detail',{kidId:'${kid.id}',assessId:'${a.id}'})">
      <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);">
        <div class="assessment-score assessment-score--${UI.scoreType(a.score)}">${a.score}</div>
        <div style="flex:1;">
          <div style="font-weight:600;color:var(--color-text);font-size:15px;">${a.title}</div>
          <div style="font-size:12px;color:var(--color-text-secondary);">${UI.formatDate(a.date)} · ${a.trainer}</div>
          <div style="margin-top:4px;display:flex;gap:6px;">${UI.badge(a.grade, 'primary')}${UI.badge(a.category, 'neutral')}</div>
        </div>
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="var(--color-text-muted)" stroke-width="2" stroke-linecap="round"/></svg>
      </div>
      <div style="font-size:13px;color:var(--color-text-secondary);font-style:italic;margin-bottom:var(--space-3);">"${a.remarks}"</div>
      <div style="display:flex;flex-direction:column;gap:var(--space-2);">
        ${a.skills.map(s => `
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
              <span style="color:var(--color-text-secondary);">${s.name}</span>
              <span style="font-weight:600;color:var(--color-text);">${s.score}</span>
            </div>
            <div class="progress-track" style="height:5px;">
              <div class="progress-fill" style="width:${s.score}%;"></div>
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

function renderClassesTab(classes) {
  if (!classes.length) {
    return `<div class="empty-state"><div class="empty-state__title">No Classes Assigned</div></div>`;
  }
  return classes.map(c => `
    <div class="class-card" onclick="Router.navigate('class-detail',{classId:'${c.id}'})">
      <div class="class-card__date-badge">
        <span class="class-card__date-day">${c.days[0]?.substring(0,3).toUpperCase()}</span>
        <span class="class-card__date-num" style="font-size:13px;letter-spacing:-0.5px;">${c.time || 'TBD'}</span>
      </div>
      <div class="class-card__info">
        <div class="class-card__name">${c.name}</div>
        <div class="class-card__meta" style="margin-top:4px;">
          ${c.days.join(' · ')} · ${c.duration}
        </div>
        ${(() => {
          const n = (c.trainerNames && c.trainerNames !== '—') ? c.trainerNames
                  : (c.trainerName && c.trainerName !== '—') ? c.trainerName : '';
          return n ? `<div class="class-card__meta" style="margin-top:3px;">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" style="flex-shrink:0;margin-top:1px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/></svg>
            ${n}
          </div>` : '';
        })()}
        <div class="class-card__meta" style="margin-top:3px;">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="2"/></svg>
          ${c.location}
        </div>
      </div>
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="var(--color-text-muted)" stroke-width="2" stroke-linecap="round"/></svg>
    </div>`).join('');
}

function renderLevelTab(levelInfo, classes, kid) {
  const safeClasses = classes || [];
  if (safeClasses.length === 0) {
    return `<div class="empty-state"><div class="empty-state__title">No courses enrolled</div></div>`;
  }

  // Each cls already carries its own level name (cls.name) and course name (cls.courseName).
  // levelInfo holds milestones from the first enrollment; we show them only for
  // the class whose level name matches levelInfo.current.
  const sharedMilestones = (levelInfo && levelInfo.milestones) ? levelInfo.milestones : [];

  return safeClasses.map(cls => {
    const courseName  = cls.courseName || cls.name;
    // The level name IS cls.name (e.g. "Robotics Level 1", "Speed Math Level 2")
    // The course name is cls.courseName (e.g. "Robotics & STEM", "Speed Math")
    const levelLabel  = cls.name || 'Active Student';
    // Build clickable trainer links for the Level tab
    const trainerList = (cls.trainers && cls.trainers.filter(t => t && t.id && t.full_name && t.full_name.trim() !== '' && t.full_name !== '—').length > 0)
      ? cls.trainers.filter(t => t && t.id && t.full_name && t.full_name.trim() !== '' && t.full_name !== '—')
      : (cls.trainerId && cls.trainerName && cls.trainerName !== '—' ? [{ id: cls.trainerId, full_name: cls.trainerName }] : []);
    const days        = (cls.days || []).join(', ') || '—';
    const time        = cls.time || '—';
    const duration    = cls.duration || '—';

    // Show milestones only for the class whose level matches levelInfo
    const isMatchingLevel = levelInfo && levelInfo.current &&
      levelLabel.toLowerCase() === (levelInfo.current || '').toLowerCase();
    const milestones = isMatchingLevel ? sharedMilestones : [];

    // Try to derive level number from the class name (e.g. "Level 2" → 2)
    const levelNumMatch = levelLabel.match(/\b(\d+)\b/);
    const levelNum = levelNumMatch ? levelNumMatch[1] : (levelInfo && levelInfo.number ? levelInfo.number : '—');

    return `
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card-header" style="margin-bottom:var(--space-3);">
          <span class="card-title">${courseName}</span>
        </div>

        <div class="info-row"><span class="info-row__key">Level</span><span class="info-row__val" style="font-weight:600;color:var(--color-primary);">${levelLabel}</span></div>
        ${trainerList.length > 0 ? `
        <div class="info-row" style="align-items:flex-start;">
          <span class="info-row__key" style="padding-top:3px;">Trainer${trainerList.length > 1 ? 's' : ''}</span>
          <span class="info-row__val" style="text-align:right;display:flex;flex-direction:column;gap:5px;">
            ${trainerList.map(t =>
              `<a onclick="Router.navigate('trainer-detail',{trainerId:'${t.id}'})" style="display:block;color:var(--color-primary);font-size:14px;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:3px;text-decoration-color:rgba(108,58,232,0.35);">${t.full_name.trim()}</a>`
            ).join('')}
          </span>
        </div>` : ''}
        <div class="info-row"><span class="info-row__key">Day(s)</span><span class="info-row__val">${days}</span></div>
        <div class="info-row"><span class="info-row__key">Time</span><span class="info-row__val">${time}</span></div>
        <div class="info-row"><span class="info-row__key">Duration</span><span class="info-row__val">${duration}</span></div>

        <!-- Current Level visual -->
        <div style="margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--color-border);">
          <div style="font-size:13px;font-weight:600;color:var(--color-text-secondary);margin-bottom:var(--space-2);">Current Level</div>
          <div style="display:flex;align-items:center;gap:var(--space-3);">
            <div style="width:48px;height:48px;border-radius:var(--radius-full);background:var(--color-primary-bg);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <span style="font-size:18px;font-weight:800;color:var(--color-primary);">${levelNum}</span>
            </div>
            <div>
              <div style="font-size:16px;font-weight:700;color:var(--color-text);">${levelLabel}</div>
              <div style="font-size:12px;color:var(--color-text-secondary);">${courseName}</div>
            </div>
          </div>
        </div>

        ${milestones.length > 0 ? `
        <div style="margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--color-border);">
          <div style="font-size:13px;font-weight:600;color:var(--color-text-secondary);margin-bottom:var(--space-3);">Milestones</div>
          ${milestones.map(m => `
            <div class="milestone-item">
              <div class="milestone-dot ${m.done ? 'milestone-dot--done' : ''}">
                ${m.done ? '<svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>' : ''}
              </div>
              <div class="milestone-content">
                <div class="milestone-title ${m.done ? 'done' : ''}">${m.title}</div>
                <div class="milestone-date">${m.done ? 'Completed · ' + m.date : 'Pending'}</div>
              </div>
            </div>`).join('')}
        </div>` : ''}
      </div>`;
  }).join('');
}

function renderSubscriptionTab(allSubs, kid) {
  const safeSubs = allSubs || [];
  const kidName  = kid?.name || 'your child';

  // ── No subscription at all ──────────────────────────────────────
  if (safeSubs.length === 0) {
    return `
      <div class="card" style="border-left:4px solid var(--color-danger);margin-bottom:var(--space-4);">
        <div style="text-align:center;padding:var(--space-4) 0;">
          <div style="font-size:40px;margin-bottom:var(--space-2);">📦</div>
          <div style="font-size:16px;font-weight:700;color:var(--color-danger);margin-bottom:6px;">No Subscription Found</div>
          <div style="font-size:13px;color:var(--color-text-secondary);line-height:1.6;">
            No package has been assigned to <strong>${kidName}</strong> yet.<br>
            Contact Minds' Craft Center to get started.
          </div>
        </div>
      </div>
      <button class="btn btn--primary btn--block" onclick="UI.toast('Request sent for ${kidName}. Our team will contact you shortly.','✅')">
        📋 Request a Package
      </button>
      <button class="btn btn--secondary btn--block" style="margin-top:var(--space-3);" onclick="Router.navigate('subscriptions')">
        View Available Packages
      </button>`;
  }

  // ── Sort: active first, then warning, then expired ──────────────
  const sorted = [...safeSubs].sort((a, b) => {
    const order = { active:0, warning:1, expired:2, none:3 };
    return (order[a.status] ?? 4) - (order[b.status] ?? 4);
  });

  const pkgCards = sorted.map(sub => {
    const isActive   = sub.status === 'active';
    const isExpiring = sub.status === 'warning';
    const isExpired  = sub.status === 'expired' || sub.status === 'none';
    const borderColor = isActive   ? 'var(--color-success)'
                      : isExpiring ? 'var(--color-warning)'
                      : 'var(--color-danger)';

    const statusBadge = isExpired  ? UI.badge('Expired', 'danger')
                      : isExpiring ? UI.badge('Expiring Soon', 'warning')
                      : UI.badge('Active', 'success');

    // Expired banner
    if (isExpired) {
      return `
      <div class="card" style="margin-bottom:var(--space-3);border-left:4px solid var(--color-danger);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-2);">
          <div style="font-size:15px;font-weight:700;">${sub.packageName}</div>
          ${statusBadge}
        </div>
        <div style="background:rgba(239,68,68,0.07);border-radius:var(--radius-md);padding:var(--space-3);text-align:center;margin-bottom:var(--space-3);">
          <div style="font-size:13px;font-weight:600;color:var(--color-danger);">
            Subscription expired${sub.expiryDate ? ' on ' + UI.formatDate(sub.expiryDate) : ''}
          </div>
          <div style="font-size:12px;color:var(--color-text-secondary);margin-top:4px;">Please contact Minds' Craft Center to renew.</div>
        </div>
        <div class="info-row"><span class="info-row__key">Start Date</span><span class="info-row__val">${UI.formatDate(sub.startDate) || '—'}</span></div>
        <div class="info-row"><span class="info-row__key">Expired On</span><span class="info-row__val" style="color:var(--color-danger);font-weight:700;">${UI.formatDate(sub.expiryDate) || '—'}</span></div>
        <button class="btn btn--primary btn--block btn--sm" style="margin-top:var(--space-3);" onclick="UI.toast('Renewal request sent. Our team will contact you shortly.','✅')">
          🔄 Renew Now
        </button>
      </div>`;
    }

    // Active / expiring card
    const hasSessionData = sub.sessionsTotal > 0;
    const sessBarWidth   = hasSessionData
      ? Math.min(100, Math.round((sub.sessionsLeft / sub.sessionsTotal) * 100)) : 0;

    return `
    <div class="card" style="margin-bottom:var(--space-3);border-left:4px solid ${borderColor};">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);">
        <div>
          <div style="font-size:16px;font-weight:700;color:var(--color-text);">${sub.packageName}</div>
          ${sub.plan && sub.plan !== '—' && sub.plan !== sub.packageName
            ? `<div style="font-size:13px;color:var(--color-text-secondary);">${sub.plan}</div>` : ''}
        </div>
        ${statusBadge}
      </div>

      <div class="info-row"><span class="info-row__key">Start Date</span><span class="info-row__val">${UI.formatDate(sub.startDate) || '—'}</span></div>
      <div class="info-row"><span class="info-row__key">Expiry Date</span><span class="info-row__val">${UI.formatDate(sub.expiryDate) || '—'}</span></div>
      <div class="info-row"><span class="info-row__key">Days Left</span>
        <span class="info-row__val" style="font-weight:700;color:${sub.daysLeft > 7 ? 'var(--color-success)' : sub.daysLeft > 0 ? 'var(--color-warning)' : 'var(--color-danger)'}">
          ${sub.daysLeft > 0 ? sub.daysLeft + ' days' : 'Expires today'}
        </span>
      </div>
      ${hasSessionData ? `
      <div class="info-row"><span class="info-row__key">Sessions</span>
        <span class="info-row__val" style="font-weight:700;color:${sub.sessionsLeft <= 2 ? 'var(--color-warning)' : 'var(--color-primary)'}">
          ${sub.sessionsLeft} / ${sub.sessionsTotal} remaining
        </span>
      </div>
      <div class="progress-bar-wrap" style="margin:var(--space-2) 0;">
        <div class="progress-bar-fill" style="width:${sessBarWidth}%"></div>
      </div>` : ''}
      ${sub.price != null ? `<div class="info-row"><span class="info-row__key">Price</span><span class="info-row__val" style="font-weight:700;color:var(--color-primary);">${typeof sub.price === 'number' ? '$' + sub.price.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) : sub.price}</span></div>` : ''}
      <div class="info-row"><span class="info-row__key">Auto-Renew</span><span class="info-row__val">${sub.autoRenew ? '✓ Enabled' : '✗ Disabled'}</span></div>

      ${isExpiring ? `
      <div style="margin-top:var(--space-2);padding:8px 12px;background:#92400E;border-radius:var(--radius-md);border:1px solid #D97706;text-align:center;">
        <span style="font-size:12px;font-weight:600;color:#FDE68A;">⏰ Expiring in ${sub.daysLeft} day${sub.daysLeft !== 1 ? 's' : ''} — renew soon!</span>
      </div>` : ''}
    </div>`;
  }).join('');

  const hasExpired = sorted.some(s => s.status === 'expired' || s.status === 'none');

  return `
    ${pkgCards}
    ${hasExpired ? `
    <button class="btn btn--primary btn--block" onclick="UI.toast('Renewal request sent. Our team will contact you shortly.','✅')">
      🔄 Request Renewal
    </button>` : ''}
    <button class="btn btn--secondary btn--block" style="margin-top:var(--space-3);" onclick="Router.navigate('subscriptions')">
      📋 View All Packages
    </button>`;
}

// ============================
// SCREEN: ASSESSMENT DETAIL
// ============================
Router.register('assessment-detail', async ({ kidId, assessId } = {}) => {
  const assess = await DataService.getAssessment(kidId, assessId).catch(() => null);
  if (!assess) return;

  const el = document.getElementById('screen-assessment-detail');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      ${UI.appBar(assess.title, true)}
      <div class="scroll-content">
        <div class="page-content">
          <div style="text-align:center;margin-bottom:var(--space-5);">
            <div class="assessment-score assessment-score--${UI.scoreType(assess.score)}" style="width:80px;height:80px;font-size:28px;margin:0 auto var(--space-3);">${assess.score}</div>
            <h2 style="font-size:20px;font-weight:700;">${assess.title}</h2>
            <div style="color:var(--color-text-secondary);font-size:13px;margin-top:4px;">${UI.formatDate(assess.date)} · ${assess.trainer}</div>
            <div style="display:flex;justify-content:center;gap:8px;margin-top:8px;">${UI.badge(assess.grade, 'primary')}${UI.badge(assess.category, 'neutral')}</div>
          </div>

          <div class="card" style="margin-bottom:var(--space-3);">
            <div class="card-title" style="margin-bottom:var(--space-3);">Trainer Remarks</div>
            <p style="color:var(--color-text-secondary);font-size:14px;line-height:1.7;font-style:italic;">"${assess.remarks}"</p>
          </div>

          <div class="card">
            <div class="card-title" style="margin-bottom:var(--space-4);">Skill Breakdown</div>
            ${assess.skills.map(s => `
              <div style="margin-bottom:var(--space-3);">
                <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                  <span style="font-size:14px;font-weight:500;">${s.name}</span>
                  <span style="font-size:14px;font-weight:700;color:var(--color-primary);">${s.score}/100</span>
                </div>
                <div class="progress-track">
                  <div class="progress-fill" style="width:${s.score}%;"></div>
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
});

// ============================
// SCREEN: CLASSES
// ============================
Router.register('classes', async () => {
  const kids = await DataService.getKids().catch(() => []);
  const allClasses = await DataService.getAllClasses().catch(() => []);

  // Group classes by course name
  const courseGroups = {};
  allClasses.forEach(c => {
    const courseName = c.courseName || c.type || 'General';
    if (!courseGroups[courseName]) courseGroups[courseName] = [];
    courseGroups[courseName].push(c);
  });

  const groupedHTML = Object.entries(courseGroups).map(([courseName, classes]) => {
    const cardsHTML = classes.map(c => {
      const kidForClass = kids.find(k => k.classIds && k.classIds.includes(c.id));
      // Build trainer display — show all names, never show TBD
      const trainerDisplay = (c.trainerNames && c.trainerNames !== '—')
        ? c.trainerNames
        : (c.trainerName && c.trainerName !== '—') ? c.trainerName : '';
      // Display date badge: day abbr, date number, full time
      const nextDate = c.nextSession ? new Date(c.nextSession) : null;
      const dayAbbr = c.days[0] ? c.days[0].substring(0,3).toUpperCase() : '—';
      const dateNum = nextDate ? nextDate.getDate() : '—';
      return `
      <div class="class-card" onclick="Router.navigate('class-detail',{classId:'${c.id}'})">
        <div class="class-card__date-badge">
          <span class="class-card__date-day">${dayAbbr}</span>
          <span class="class-card__date-num">${dateNum}</span>
          <span class="class-card__date-time">${c.time || '—'}</span>
        </div>
        <div class="class-card__info">
          <div class="class-card__name">${c.name}</div>
          ${kidForClass ? `<div style="margin-bottom:4px;">${UI.badge(kidForClass.firstName, 'primary')}</div>` : ''}
          <div class="class-card__meta">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><polyline points="12 6 12 12 16 14" stroke="currentColor" stroke-width="2"/></svg>
            ${c.days.join(' · ')} · ${c.time} · ${c.duration}
          </div>
          ${trainerDisplay ? `
          <div class="class-card__meta" style="margin-top:3px;">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/></svg>
            ${trainerDisplay}
          </div>` : ''}
          <div class="class-card__meta" style="margin-top:3px;">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="2"/></svg>
            Minds' Craft Center
          </div>
        </div>
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="var(--color-text-muted)" stroke-width="2" stroke-linecap="round"/></svg>
      </div>`;
    }).join('');
    return `
      <div style="margin-bottom:var(--space-5);">
        <div style="font-size:11px;font-weight:700;color:var(--color-text-muted);letter-spacing:0.8px;text-transform:uppercase;margin-bottom:var(--space-2);padding:0 2px;">${courseName}</div>
        ${cardsHTML}
      </div>`;
  }).join('');

  const el = document.getElementById('screen-classes');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      ${UI.appBar('Classes', false, UI.notifBellBtn())}
      <div class="scroll-content">
        <div class="page-content">
          <div class="alert alert--info" style="margin-bottom:var(--space-4);">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2"/></svg>
            <span>Showing all classes for your linked kids.</span>
          </div>
          ${groupedHTML || '<div class="empty-state"><div class="empty-state__title">No Classes</div><div class="empty-state__body">No active classes found.</div></div>'}
        </div>
      </div>
    </div>`;
});

// ============================
// SCREEN: CLASS DETAIL
// ============================
Router.register('class-detail', async ({ classId } = {}) => {
  const c = await DataService.getClass(classId).catch(() => null);
  if (!c) return;

  // Fetch enrolled count for this level
  let enrolledCount = 0;
  try {
    enrolledCount = await DataService.getLevelEnrolledCount(classId);
  } catch(_) {}

  const el = document.getElementById('screen-class-detail');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      <!-- Hero -->
      <div style="background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));padding:var(--space-8) var(--space-4) var(--space-6);position:relative;">
        <button onclick="Router.back()" style="position:absolute;top:var(--space-3);left:var(--space-3);width:36px;height:36px;background:rgba(255,255,255,0.15);border:none;border-radius:var(--radius-full);display:flex;align-items:center;justify-content:center;cursor:pointer;color:white;">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <div style="text-align:center;color:white;">
          <div style="font-size:13px;opacity:0.7;margin-bottom:8px;">${UI.badge(c.type, 'neutral')}</div>
          <h2 style="font-size:22px;font-weight:800;">${c.name}</h2>
          <p style="opacity:0.75;margin-top:6px;">${c.days.join(' · ')} · ${c.time}</p>
        </div>
      </div>

      <div class="scroll-content">
        <div class="page-content">
          <div class="card" style="margin-bottom:var(--space-3);">
            <div class="card-title" style="margin-bottom:var(--space-3);">Class Details</div>
            <div class="info-row"><span class="info-row__key">Schedule</span><span class="info-row__val">${c.days.join(', ')}</span></div>
            <div class="info-row"><span class="info-row__key">Time</span><span class="info-row__val">${c.time}</span></div>
            <div class="info-row"><span class="info-row__key">Duration</span><span class="info-row__val">${c.duration}</span></div>
            <div class="info-row"><span class="info-row__key">Center</span><span class="info-row__val">Minds' Craft Center</span></div>
            ${(() => {
              // Build the definitive trainer list: prefer trainers[], fall back to trainerId
              const list = (c.trainers && c.trainers.filter(t => t && t.id).length > 0)
                ? c.trainers.filter(t => t && t.id)
                : (c.trainerId ? [{ id: c.trainerId, full_name: c.trainerName }] : []);

              // Filter out any entry with blank name AND no id
              const validList = list.filter(t => t.id && t.full_name && t.full_name.trim() !== '' && t.full_name !== '—');

              if (validList.length === 0) return '';   // hide row entirely if no trainer data

              const label = validList.length > 1 ? 'Trainers' : 'Trainer';
              const links = validList.map(t =>
                `<a onclick="Router.navigate('trainer-detail',{trainerId:'${t.id}'})" style="display:block;color:var(--color-primary);font-size:14px;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:3px;text-decoration-color:rgba(108,58,232,0.35);">${t.full_name.trim()}</a>`
              ).join('');

              return `<div class="info-row" style="align-items:flex-start;">
                <span class="info-row__key" style="padding-top:3px;">${label}</span>
                <span class="info-row__val" style="text-align:right;display:flex;flex-direction:column;gap:5px;">${links}</span>
              </div>`;
            })()}
            <div class="info-row"><span class="info-row__key">Enrolled</span><span class="info-row__val">${enrolledCount}${c.capacity ? ' / ' + c.capacity + ' spots' : ' students'}</span></div>
            <div class="info-row"><span class="info-row__key">Status</span><span class="info-row__val">${UI.badge('Active', 'success')}</span></div>
          </div>

          <div class="card" style="margin-bottom:var(--space-3);">
            <div class="card-title" style="margin-bottom:var(--space-2);">About This Class</div>
            <p style="color:var(--color-text-secondary);font-size:14px;line-height:1.7;">${c.description}</p>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Next Session</span>
              ${UI.badge('Upcoming', 'info')}
            </div>
            <div style="display:flex;align-items:center;gap:var(--space-3);">
              <div style="background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));color:white;border-radius:var(--radius-lg);padding:var(--space-3) var(--space-4);text-align:center;min-width:60px;">
                <div style="font-size:11px;opacity:0.8;">${c.nextSessionDay?.substring(0,3).toUpperCase()}</div>
                <div style="font-size:24px;font-weight:800;">${new Date(c.nextSession).getDate()}</div>
              </div>
              <div>
                <div style="font-weight:600;font-size:15px;">${UI.formatDate(c.nextSession)}</div>
                <div style="color:var(--color-text-secondary);font-size:13px;">at ${c.time} · ${c.duration}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
});

// ============================
// SCREEN: EVENTS
// ============================
Router.register('events', async () => {
  const events = await DataService.getEvents();
  let filter = 'upcoming';

  const renderEvents = async (f) => {
    const filtered = events.filter(e => f === 'all' || e.status === f);
    return filtered.map(ev => `
      <div class="event-card" onclick="Router.navigate('event-detail',{eventId:'${ev.id}'})">
        <div class="event-card__image-placeholder">
          <svg width="40" height="40" fill="none" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" stroke="rgba(255,255,255,0.4)" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="6" stroke="rgba(255,255,255,0.4)" stroke-width="2"/><line x1="8" y1="2" x2="8" y2="6" stroke="rgba(255,255,255,0.4)" stroke-width="2"/><line x1="3" y1="10" x2="21" y2="10" stroke="rgba(255,255,255,0.4)" stroke-width="2"/></svg>
        </div>
        <div class="event-card__body">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-2);">
            <div class="event-card__title" style="margin-bottom:0;">${ev.title}</div>
            ${UI.badge(ev.category, 'primary')}
          </div>
          <div class="event-card__meta">
            <div class="event-card__meta-item">
              <svg width="13" height="13" fill="none" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="2"/></svg>
              ${UI.formatDate(ev.date)}
            </div>
            <div class="event-card__meta-item">
              <svg width="13" height="13" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><polyline points="12 6 12 12 16 14" stroke="currentColor" stroke-width="2"/></svg>
              ${ev.time}
            </div>
            <div class="event-card__meta-item">
              <svg width="13" height="13" fill="none" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="2"/></svg>
              ${ev.location}
            </div>
          </div>
        </div>
      </div>`).join('') || '<div class="empty-state"><div class="empty-state__icon"><svg width="32" height="32" fill="none" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="2"/></svg></div><div class="empty-state__title">No Events</div><div class="empty-state__body">Check back later for upcoming events and activities.</div></div>';
  };

  const upcomingHTML = await renderEvents('upcoming');

  const el = document.getElementById('screen-events');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      ${UI.appBar('Events', false, UI.notifBellBtn())}
      <div class="pill-header">
        <div class="pill active" data-filter="upcoming" onclick="filterEvents('upcoming',this)">Upcoming</div>
        <div class="pill" data-filter="past" onclick="filterEvents('past',this)">Past</div>
        <div class="pill" data-filter="all" onclick="filterEvents('all',this)">All</div>
      </div>
      <div class="scroll-content">
        <div class="page-content" id="events-content">
          ${upcomingHTML}
        </div>
      </div>
    </div>`;

  window._allEvents = events;
});

async function filterEvents(filter, btn) {
  document.querySelectorAll('.pill-header .pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  const events = window._allEvents || [];
  const filtered = events.filter(e => filter === 'all' || e.status === filter);
  document.getElementById('events-content').innerHTML = filtered.map(ev => `
    <div class="event-card" onclick="Router.navigate('event-detail',{eventId:'${ev.id}'})">
      <div class="event-card__image-placeholder">
        <svg width="40" height="40" fill="none" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" stroke="rgba(255,255,255,0.4)" stroke-width="2"/></svg>
      </div>
      <div class="event-card__body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-2);">
          <div class="event-card__title" style="margin-bottom:0;">${ev.title}</div>
          ${UI.badge(ev.category, ev.status === 'past' ? 'neutral' : 'primary')}
        </div>
        <div class="event-card__meta">
          <div class="event-card__meta-item">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/></svg>
            ${UI.formatDate(ev.date)}
          </div>
          <div class="event-card__meta-item">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="2"/></svg>
            ${ev.location}
          </div>
        </div>
      </div>
    </div>`).join('') || '<div class="empty-state"><div class="empty-state__title">No events</div></div>';
}

// ============================
// SCREEN: EVENT DETAIL
// ============================
Router.register('event-detail', async ({ eventId } = {}) => {
  const ev = await DataService.getEvent(eventId);
  if (!ev) return;

  const el = document.getElementById('screen-event-detail');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      <div style="background:linear-gradient(135deg,var(--color-primary),var(--color-secondary));height:180px;position:relative;display:flex;align-items:center;justify-content:center;">
        <button onclick="Router.back()" style="position:absolute;top:var(--space-3);left:var(--space-3);width:36px;height:36px;background:rgba(255,255,255,0.15);border:none;border-radius:var(--radius-full);display:flex;align-items:center;justify-content:center;cursor:pointer;color:white;">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <svg width="60" height="60" fill="none" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" stroke="rgba(255,255,255,0.4)" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="6" stroke="rgba(255,255,255,0.4)" stroke-width="2"/><line x1="8" y1="2" x2="8" y2="6" stroke="rgba(255,255,255,0.4)" stroke-width="2"/><line x1="3" y1="10" x2="21" y2="10" stroke="rgba(255,255,255,0.4)" stroke-width="2"/></svg>
      </div>
      <div class="scroll-content">
        <div class="page-content">
          <div style="margin-bottom:var(--space-4);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-2);">
              <h2 style="font-size:22px;font-weight:800;flex:1;">${ev.title}</h2>
              ${UI.badge(ev.category, 'primary')}
            </div>
            ${UI.badge(ev.status === 'upcoming' ? 'Upcoming' : 'Past', ev.status === 'upcoming' ? 'success' : 'neutral')}
          </div>

          <div class="card" style="margin-bottom:var(--space-3);">
            <div class="info-row">
              <span class="info-row__key">Date</span>
              <span class="info-row__val">${UI.formatDate(ev.date)}</span>
            </div>
            <div class="info-row">
              <span class="info-row__key">Time</span>
              <span class="info-row__val">${ev.time}</span>
            </div>
            <div class="info-row">
              <span class="info-row__key">Location</span>
              <span class="info-row__val">${ev.location}</span>
            </div>
          </div>

          <div class="card" style="margin-bottom:var(--space-4);">
            <div class="card-title" style="margin-bottom:var(--space-2);">About This Event</div>
            <p style="color:var(--color-text-secondary);font-size:14px;line-height:1.7;">${ev.description}</p>
          </div>

          ${ev.status === 'upcoming' ? `
          <button class="btn btn--primary btn--block" onclick="window.open('tel:+96170123456');UI.toast('Calling Minds\' Craft Center to reserve your spot!','📞')">
            📞 Call to Reserve
          </button>` : ''}
        </div>
      </div>
    </div>`;
});

// ============================
// SCREEN: TRAINERS
// ============================
Router.register('trainers', async () => {
  const trainers = await DataService.getAllTrainers();

  const trainersHTML = trainers.map(t => `
    <div class="trainer-card" onclick="Router.navigate('trainer-detail',{trainerId:'${t.id}'})">
      ${UI.avatar(t.avatar, t.initials, 'lg')}
      <div class="trainer-card__info">
        <div class="trainer-card__name">${t.name}</div>
        <div class="trainer-card__spec">${t.specialty}</div>
        <div class="trainer-card__stats">
          <div class="trainer-card__stat">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/></svg>
            ${t.studentCount} student${t.studentCount !== 1 ? 's' : ''}
          </div>
          ${t.sinceDate ? `
          <div class="trainer-card__stat">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" stroke-width="2"/><line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="2"/></svg>
            Since ${UI.formatDateShort(t.sinceDate)}
          </div>` : ''}
        </div>
      </div>
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="var(--color-text-muted)" stroke-width="2"/></svg>
    </div>`).join('');

  const el = document.getElementById('screen-trainers');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      ${UI.appBar('Trainers', true, UI.notifBellBtn())}
      <div class="scroll-content">
        <div class="page-content">${trainersHTML}</div>
      </div>
    </div>`;
});

// ============================
// SCREEN: TRAINER DETAIL
// ============================
Router.register('trainer-detail', async ({ trainerId } = {}) => {
  const t = await DataService.getTrainer(trainerId);
  if (!t) return;

  const el = document.getElementById('screen-trainer-detail');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">

      <!-- Hero -->
      <div class="detail-hero" style="position:relative;text-align:center;">
        <button onclick="Router.back()" style="position:absolute;top:calc(var(--safe-top,0px) + 8px);left:12px;width:38px;height:38px;background:rgba(255,255,255,0.15);border:none;border-radius:var(--radius-full);display:flex;align-items:center;justify-content:center;cursor:pointer;color:white;">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        ${UI.avatar(t.avatar, t.initials, '2xl')}
        <h2 style="color:white;font-size:22px;font-weight:800;margin-top:var(--space-3);">${t.name}</h2>
        <p style="color:rgba(255,255,255,0.8);margin-top:4px;font-size:14px;font-weight:500;">${t.specialty}</p>

        <!-- Stats row: Students only (no rating, no yrs exp) -->
        <div style="display:flex;justify-content:center;gap:var(--space-4);margin-top:var(--space-4);">
          <div style="text-align:center;">
            <div style="font-size:26px;font-weight:800;color:white;">${t.studentCount}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.65);text-transform:uppercase;letter-spacing:0.5px;">Students</div>
          </div>
          ${t.sinceDate ? `
          <div style="width:1px;background:rgba(255,255,255,0.2);"></div>
          <div style="text-align:center;">
            <div style="font-size:18px;font-weight:800;color:white;">${UI.formatDateShort(t.sinceDate)}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.65);text-transform:uppercase;letter-spacing:0.5px;">Since</div>
          </div>` : ''}
        </div>
      </div>

      <div class="scroll-content">
        <div class="page-content">

          <!-- About (linked to description field) -->
          ${t.bio ? `
          <div class="card" style="margin-bottom:var(--space-3);">
            <div class="card-title" style="margin-bottom:var(--space-2);">About</div>
            <p style="color:var(--color-text-secondary);font-size:14px;line-height:1.7;">${t.bio}</p>
          </div>` : ''}

          <!-- Certifications (= title field) -->
          ${t.certifications.length > 0 ? `
          <div class="card" style="margin-bottom:var(--space-3);">
            <div class="card-title" style="margin-bottom:var(--space-3);">Certifications</div>
            ${t.certifications.map(c => `
              <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-2);">
                <div style="width:32px;height:32px;border-radius:var(--radius-full);background:var(--color-success-bg);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" stroke="var(--color-success)" stroke-width="2.5"/></svg>
                </div>
                <span style="font-size:14px;color:var(--color-text);font-weight:500;">${c}</span>
              </div>`).join('')}
          </div>` : ''}

          <!-- Classes -->
          ${t.classes.length > 0 ? `
          <div class="card" style="margin-bottom:var(--space-3);">
            <div class="card-title" style="margin-bottom:var(--space-3);">Classes</div>
            ${t.classes.map(c => `
              <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2);">
                <div style="width:28px;height:28px;border-radius:var(--radius-md);background:var(--color-primary-bg);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" stroke="var(--color-primary)" stroke-width="2"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" stroke="var(--color-primary)" stroke-width="2"/></svg>
                </div>
                <span style="font-size:14px;color:var(--color-text);">${c}</span>
              </div>`).join('')}
          </div>` : ''}

          <!-- Info card -->
          <div class="card">
            <div class="card-title" style="margin-bottom:var(--space-2);">Info</div>
            <div class="info-row"><span class="info-row__key">Branch</span><span class="info-row__val">${t.branch}</span></div>
            ${t.sinceDate ? `<div class="info-row"><span class="info-row__key">Since</span><span class="info-row__val">${UI.formatDate(t.sinceDate)}</span></div>` : ''}
            ${t.email ? `<div class="info-row"><span class="info-row__key">Email</span><span class="info-row__val" style="word-break:break-all;">${t.email}</span></div>` : ''}
            ${t.phone ? `<div class="info-row"><span class="info-row__key">Phone</span><span class="info-row__val">${t.phone}</span></div>` : ''}
          </div>

        </div>
      </div>
    </div>`;
});

// ============================
// SCREEN: SUBSCRIPTIONS
// ============================

Router.register('subscriptions', async () => {
  const subs     = await DataService.getAllSubscriptions().catch(() => []);
  const packages = await DataService.getPackages().catch(() => []);

  // ── Active Subscriptions ─────────────────────────────────────
  const subsHTML = subs.length === 0
    ? `<div class="empty-state" style="margin-bottom:var(--space-4);">
         <div class="empty-state__title">No Active Subscriptions</div>
         <div class="empty-state__body">No packages have been assigned yet. Contact Minds\' Craft Center to get started.</div>
       </div>`
    : subs.map(s => {
        const isExpired  = s.status === 'expired' || s.status === 'none';
        const isExpiring = s.status === 'warning';
        // Determine Sessions Left display
        const sessLeftDisplay = s.sessionsTotal > 0
          ? `${s.sessionsLeft} / ${s.sessionsTotal}`
          : (s.sessionsLeft > 0 ? s.sessionsLeft : '—');
        const sessBarWidth = s.sessionsTotal > 0
          ? Math.min(100, Math.round((s.sessionsLeft / s.sessionsTotal) * 100)) : 0;

        // Price display
        const priceDisplay = s.price != null
          ? `$${Number(s.price).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}${s.discountPct > 0 ? ' <span style="font-size:10px;opacity:0.8;">(−' + s.discountPct + '%)</span>' : ''}`
          : '—';

        return `
        <div class="${UI.subCardClass(s)}" style="margin-bottom:var(--space-3);cursor:default;">
          <div style="position:relative;">

            <!-- Header: kid name + status badge -->
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
              <div class="sub-card__name" style="color:white;">${s.kidName}</div>
              <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;background:rgba(255,255,255,0.25);color:white;border:1px solid rgba(255,255,255,0.4);">
                ${isExpired ? '🔴 Expired' : isExpiring ? '⚠️ Expiring Soon' : '✅ Active'}
              </span>
            </div>

            <!-- Package name + plan -->
            <div class="sub-card__plan" style="color:rgba(255,255,255,0.85);">${s.packageName}${s.plan && s.plan !== '—' ? ' · ' + s.plan : ''}</div>

            ${isExpired ? `
            <!-- Expired state -->
            <div style="background:rgba(0,0,0,0.25);border-radius:var(--radius-md);padding:10px 14px;margin:var(--space-2) 0;border:1px solid rgba(255,255,255,0.15);">
              <div style="font-size:12px;font-weight:600;color:white;">
                ❌ Package expired${s.expiryDate ? ' on ' + UI.formatDate(s.expiryDate) : ''} — please renew to continue classes.
              </div>
            </div>
            <button class="btn btn--block btn--sm" style="margin-top:var(--space-2);background:white;color:var(--color-danger);font-weight:700;border:none;"
              onclick="UI.toast('Renewal request sent. Our team will contact you shortly.','✅')">🔄 Request Renewal</button>
            ` : `
            <!-- Stats row: Sessions Left · Days Left · Price Paid -->
            <div class="sub-card__stats" style="gap:var(--space-4);">
              <div>
                <span class="sub-card__stat-val">${sessLeftDisplay}</span>
                <span class="sub-card__stat-label">Sessions Left</span>
              </div>
              <div>
                <span class="sub-card__stat-val">${s.daysLeft}</span>
                <span class="sub-card__stat-label">Days Left</span>
              </div>
              <div>
                <span class="sub-card__stat-val" style="font-size:16px;">${priceDisplay}</span>
                <span class="sub-card__stat-label">Price Paid</span>
              </div>
            </div>

            <!-- Progress bar (sessions) if applicable -->
            ${s.sessionsTotal > 0 ? `
            <div class="progress-bar-wrap" style="margin-bottom:var(--space-2);">
              <div class="progress-bar-fill" style="width:${sessBarWidth}%;"></div>
            </div>` : ''}

            <!-- Date range -->
            <div style="font-size:11px;color:rgba(255,255,255,0.8);margin-bottom:var(--space-2);">
              📅 ${UI.formatDateShort(s.startDate)} → ${UI.formatDate(s.expiryDate)}
            </div>

            ${isExpiring ? `
            <div style="background:rgba(251,191,36,0.25);border-radius:var(--radius-md);padding:8px 12px;border:1px solid rgba(251,191,36,0.5);">
              <span style="font-size:12px;font-weight:600;color:#FDE68A;">⚠️ Expiring in ${s.daysLeft} day${s.daysLeft !== 1 ? 's' : ''} — please renew soon!</span>
            </div>` : ''}`}

          </div>
        </div>`;
      }).join('');

  // ── Available Packages — from DB (packages + package_courses) ───
  const packagesHTML = packages.map(p => {
    // Duration label
    const durLabel = p.durationMonths === 1  ? '1 Month'
                   : p.durationMonths === 3  ? '3 Months'
                   : p.durationMonths === 12 ? '1 Year'
                   : p.durationMonths ? `${p.durationMonths} Months` : '';

    // Price display — base_price with default_discount applied
    const effectivePrice = p.price != null ? Number(p.price) : null;
    const basePrice      = p.basePrice != null ? Number(p.basePrice) : null;
    const hasDiscount    = p.discountPct > 0 && basePrice != null;

    const priceBlock = effectivePrice != null
      ? `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
           ${hasDiscount ? `<div style="font-size:11px;color:#94A3B8;text-decoration:line-through;">$${basePrice.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}</div>` : ''}
           <div style="font-size:22px;font-weight:800;color:var(--color-primary);line-height:1.1;">$${effectivePrice.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}</div>
           ${hasDiscount ? `<div style="font-size:11px;font-weight:700;color:#10B981;background:#D1FAE5;padding:1px 8px;border-radius:99px;">${p.discountPct}% off</div>` : `<div style="font-size:11px;color:var(--color-text-secondary);">per package</div>`}
         </div>`
      : `<div style="font-size:13px;font-weight:600;color:var(--color-text-secondary);padding:4px 8px;background:var(--color-bg);border-radius:var(--radius-sm);">Contact us</div>`;

    // Features from description
    const featureRows = (p.features || []).filter(f => f.trim()).map(f => `
      <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
        <span style="flex-shrink:0;width:18px;height:18px;background:#D1FAE5;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;">
          <svg width="11" height="11" fill="none" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" stroke="#059669" stroke-width="3"/></svg>
        </span>
        <span style="font-size:13px;color:var(--color-text-secondary);line-height:1.4;">${f}</span>
      </div>`).join('');

    // Included courses badges
    const coursesBadges = (p.courses || []).length > 0
      ? `<div style="margin-bottom:var(--space-3);">
           <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">Included Courses</div>
           <div style="display:flex;flex-wrap:wrap;gap:6px;">
             ${p.courses.map(c => `<span style="font-size:12px;font-weight:600;padding:4px 12px;border-radius:99px;background:var(--color-primary);color:white;">${c}</span>`).join('')}
           </div>
         </div>`
      : '';

    return `
    <div class="card" style="margin-bottom:var(--space-5);position:relative;overflow:visible;">

      <!-- Package header: name + price side by side -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-3);gap:var(--space-3);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:18px;font-weight:700;color:var(--color-text);margin-bottom:4px;">${p.name}</div>
          ${durLabel ? `<span style="display:inline-block;font-size:11px;font-weight:600;padding:2px 10px;border-radius:99px;background:var(--color-primary-bg);color:var(--color-primary);">📅 ${durLabel}</span>` : ''}
        </div>
        <div style="flex-shrink:0;text-align:right;">
          ${priceBlock}
        </div>
      </div>

      <!-- Divider -->
      <div style="height:1px;background:var(--color-border);margin-bottom:var(--space-3);"></div>

      ${coursesBadges}
      ${featureRows ? `<div style="margin-bottom:var(--space-3);">${featureRows}</div>` : ''}

      <button class="btn btn--primary btn--block"
        onclick="UI.toast('Our team will contact you about the ${p.name.replace(/'/g,"\\'")} package. 📞','✅')">
        Enquire About This Package
      </button>
    </div>`;
  }).join('');

  const el = document.getElementById('screen-subscriptions');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      ${UI.appBar('Subscriptions & Packages', true)}
      <div class="scroll-content">
        <div class="page-content">
          <div class="section-header"><h2 class="section-title">Active Subscriptions</h2></div>
          ${subsHTML}
          <div class="section-header" style="margin-top:var(--space-5);">
            <h2 class="section-title">Available Packages</h2>
          </div>
          <p style="font-size:13px;color:var(--color-text-secondary);margin-bottom:var(--space-4);">Interested in upgrading or changing your plan? Contact us and our team will assist you.</p>
          ${packagesHTML || '<div class="empty-state"><div class="empty-state__title">No packages found</div></div>'}
        </div>
      </div>
    </div>`;
});



// ============================
// SCREEN: NOTIFICATIONS
// ============================
Router.register('notifications', async () => {
  const notifs = await DataService.getNotifications();

  const notifsHTML = notifs.map(n => `
    <div class="notif-item ${n.unread ? 'unread' : ''}" onclick="markNotifRead('${n.id}', this); Router.navigate('${n.linkTo || 'home'}')">
      <div class="notif-icon notif-icon--${n.type}">
        ${getNotifIcon(n.type)}
      </div>
      <div class="notif-content">
        <div class="notif-title">${n.title}</div>
        <div class="notif-body">${n.body}</div>
        <div class="notif-time">${n.time}</div>
      </div>
      ${n.unread ? '<div class="notif-dot"></div>' : ''}
    </div>`).join('');

  const el = document.getElementById('screen-notifications');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      ${UI.appBar('Notifications', true, `<button class="btn btn--ghost btn--sm" onclick="markAllRead()" style="font-size:12px;padding:6px 12px;">Mark all read</button>`)}
      <div class="scroll-content">
        <div style="background:white;border-radius:0;overflow:hidden;">
          ${notifsHTML || '<div class="empty-state"><div class="empty-state__icon"><svg width="32" height="32" fill="none" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2"/></svg></div><div class="empty-state__title">No Notifications</div><div class="empty-state__body">You\'re all caught up!</div></div>'}
        </div>
      </div>
    </div>`;
});

function markNotifRead(id, el) {
  DataService.markRead(id);
  el.classList.remove('unread');
  const dot = el.querySelector('.notif-dot');
  if (dot) dot.remove();
  NavManager.refreshBadge();
}

async function markAllRead() {
  await DataService.markAllRead();
  document.querySelectorAll('.notif-item').forEach(n => {
    n.classList.remove('unread');
    const dot = n.querySelector('.notif-dot');
    if (dot) dot.remove();
  });
  NavManager.refreshBadge();
  UI.toast('All notifications marked as read.', '✓');
}

// ============================
// SCREEN: MORE
// ============================
Router.register('more', async () => {
  const parent = await DataService.getParent();

  const el = document.getElementById('screen-more');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      ${UI.appBar('More', false)}

      <div class="scroll-content">
        <div class="page-content">
          <!-- Profile -->
          <div class="card" style="margin-bottom:var(--space-4);cursor:pointer;" onclick="Router.navigate('profile')">
            <div style="display:flex;align-items:center;gap:var(--space-3);">
              <div class="avatar-placeholder avatar-placeholder--lg">${parent.initials}</div>
              <div style="flex:1;">
                <div style="font-size:17px;font-weight:700;">${parent.name}</div>
                <div style="font-size:13px;color:var(--color-text-secondary);">${parent.email}</div>
                <div style="font-size:12px;color:var(--color-primary);margin-top:3px;">Edit Profile →</div>
              </div>
            </div>
          </div>

          <!-- Links -->
          <div class="settings-section">
            ${[
              ['trainers', 'Trainers', '#D1FAE5', 'var(--color-success)',
                `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" stroke-width="2"/>`],
              ['subscriptions', 'Subscriptions & Packages', '#DBEAFE', 'var(--color-info)',
                `<rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="2"/>`],
              ['notifications', 'Notifications', 'var(--color-primary-bg)', 'var(--color-primary)',
                `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2"/><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" stroke-width="2"/>`],
              ['about', 'About Mind\'s Craft', '#FEF3C7', '#92400E',
                `<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2"/><line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" stroke-width="2"/>`],
              ['profile', 'Settings', 'var(--color-bg)', 'var(--color-text-secondary)',
                `<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="2"/>`]
            ].map(([screen, label, bg, color, icon]) => `
              <div class="settings-row" onclick="Router.navigate('${screen}')">
                <div class="settings-row__icon" style="background:${bg};">
                  <svg width="20" height="20" fill="none" viewBox="0 0 24 24" style="color:${color};">${icon}</svg>
                </div>
                <span class="settings-row__label">${label}</span>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="var(--color-text-muted)" stroke-width="2"/></svg>
              </div>`).join('')}
          </div>

          <!-- Logout -->
          <div class="settings-section" style="margin-top:var(--space-4);">
            <div class="settings-row" onclick="doLogout()" style="color:var(--color-danger);">
              <div class="settings-row__icon" style="background:var(--color-danger-bg);">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="var(--color-danger)" stroke-width="2"/></svg>
              </div>
              <span class="settings-row__label" style="color:var(--color-danger);">Sign Out</span>
            </div>
          </div>



          <p style="text-align:center;font-size:11px;color:var(--color-text-muted);margin-top:var(--space-6);">Minds' Craft Parent Portal v1.0<br>© 2026 Minds' Craft Center</p>
        </div>
      </div>
    </div>`;
});

// ============================
// SCREEN: ABOUT US
// ============================
Router.register('about', async () => {
  const el = document.getElementById('screen-about');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      <div class="about-hero">
        <div style="background:white;border-radius:16px;padding:12px 20px;margin:0 auto var(--space-3);display:inline-block;box-shadow:0 4px 16px rgba(0,0,0,0.2);">
          <img src="icons/logo.png" alt="Minds' Craft" style="width:160px;height:auto;display:block;">
        </div>
        <h1 style="font-size:22px;font-weight:800;margin-bottom:6px;">Minds' Craft Center</h1>
        <p style="opacity:0.75;font-size:14px;line-height:1.6;">Shaping minds. Building champions.</p>
      </div>

      <div class="scroll-content">
        <div class="page-content">
          <div class="card" style="margin-bottom:var(--space-3);">
            <div style="margin-bottom:var(--space-4);">
              <div class="about-stat-grid">
                <div><span class="about-stat-num">500+</span><span class="about-stat-label">Students</span></div>
                <div><span class="about-stat-num">12</span><span class="about-stat-label">Trainers</span></div>
                <div><span class="about-stat-num">3</span><span class="about-stat-label">Branches</span></div>
              </div>
            </div>
          </div>

          <div class="card" style="margin-bottom:var(--space-3);">
            <div class="card-title" style="margin-bottom:var(--space-3);">Our Mission</div>
            <p style="color:var(--color-text-secondary);font-size:14px;line-height:1.7;">At Minds' Craft Center, we believe that martial arts is more than physical training — it is a holistic discipline that nurtures focus, confidence, respect and resilience in every student.</p>
            <p style="color:var(--color-text-secondary);font-size:14px;line-height:1.7;margin-top:var(--space-3);">Our expert trainers create a safe, structured and inspiring environment where every child can grow at their own pace, discover their strengths and become the best version of themselves.</p>
          </div>

          <div class="card" style="margin-bottom:var(--space-3);">
            <div class="card-title" style="margin-bottom:var(--space-3);">Our Branches</div>
            ${[
              ['Beirut Main Campus', 'Hamra Street, Beirut', 'Mon–Sat: 8AM – 8PM'],
              ['Jounieh Branch', 'Kaslik Road, Jounieh', 'Mon–Sat: 9AM – 7PM'],
              ['Tripoli Branch', 'Mina Road, Tripoli', 'Mon–Fri: 9AM – 6PM']
            ].map(([name, address, hours]) => `
              <div class="list-item" style="cursor:default;">
                <div class="list-item__icon">
                  <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="2"/></svg>
                </div>
                <div class="list-item__content">
                  <div class="list-item__title">${name}</div>
                  <div class="list-item__sub">${address}</div>
                  <div class="list-item__sub">${hours}</div>
                </div>
              </div>`).join('')}
          </div>

          <div class="card" style="margin-bottom:var(--space-3);">
            <div class="card-title" style="margin-bottom:var(--space-3);">Contact Us</div>
            ${[
              ['Phone', '+961 1 234 567', `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.61 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6.18 6.18l.95-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" stroke-width="2"/>`],
              ['Email', 'info@mindscraft.com', `<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" stroke-width="2"/><polyline points="22,6 12,13 2,6" stroke="currentColor" stroke-width="2"/>`],
              ['WhatsApp', '+961 70 123 456', `<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="currentColor" stroke-width="2"/>`]
            ].map(([label, val, icon]) => `
              <div class="list-item" style="cursor:default;">
                <div class="list-item__icon">
                  <svg width="20" height="20" fill="none" viewBox="0 0 24 24">${icon}</svg>
                </div>
                <div class="list-item__content">
                  <div class="list-item__title">${val}</div>
                  <div class="list-item__sub">${label}</div>
                </div>
              </div>`).join('')}
          </div>

          <div style="display:flex;gap:var(--space-3);justify-content:center;margin-top:var(--space-4);">
            ${['Instagram', 'Facebook', 'YouTube'].map(s => `
              <div style="padding:8px 16px;border-radius:var(--radius-full);background:var(--color-primary-bg);font-size:12px;font-weight:600;color:var(--color-primary);cursor:pointer;" onclick="UI.toast('Opening ${s}...','🔗')">${s}</div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
});

// ============================
// SCREEN: PROFILE & SETTINGS
// ============================
Router.register('profile', async () => {
  const parent = await DataService.getParent();

  const el = document.getElementById('screen-profile');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;background:var(--color-bg);">
      ${UI.appBar('Profile & Settings', true)}
      <div class="scroll-content">
        <div class="page-content">
          <!-- Profile card -->
          <div class="card" style="text-align:center;margin-bottom:var(--space-5);padding:var(--space-6);">
            <div class="avatar-placeholder avatar-placeholder--2xl" style="margin:0 auto var(--space-3);">${parent.initials}</div>
            <h2 style="font-size:20px;font-weight:700;">${parent.name}</h2>
            <p style="color:var(--color-text-secondary);font-size:14px;">${parent.email}</p>
            <p style="color:var(--color-text-secondary);font-size:14px;">${parent.phone}</p>
            <button class="btn btn--secondary btn--sm" style="margin-top:var(--space-4);" onclick="UI.toast('Profile editing will be available in the next update.','✏️')">Edit Profile</button>
          </div>

          <!-- Account -->
          <p style="font-size:11px;font-weight:700;color:var(--color-text-muted);letter-spacing:0.5px;margin-bottom:var(--space-2);">ACCOUNT</p>
          <div class="settings-section" style="margin-bottom:var(--space-5);">
            <div class="settings-row" onclick="Router.navigate('forgot-password')">
              <div class="settings-row__icon" style="background:var(--color-primary-bg);">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" stroke="var(--color-primary)" stroke-width="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="var(--color-primary)" stroke-width="2"/></svg>
              </div>
              <span class="settings-row__label">Change Password</span>
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="var(--color-text-muted)" stroke-width="2"/></svg>
            </div>
            <div class="settings-row" onclick="UI.toast('Language selection coming soon.','🌍')">
              <div class="settings-row__icon" style="background:#D1FAE5;">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="var(--color-success)" stroke-width="2"/><line x1="2" y1="12" x2="22" y2="12" stroke="var(--color-success)" stroke-width="2"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="var(--color-success)" stroke-width="2"/></svg>
              </div>
              <span class="settings-row__label">Language</span>
              <span class="settings-row__value">English</span>
            </div>
          </div>

          <!-- Notifications Preferences -->
          <p style="font-size:11px;font-weight:700;color:var(--color-text-muted);letter-spacing:0.5px;margin-bottom:var(--space-2);">NOTIFICATIONS</p>
          <div class="settings-section" style="margin-bottom:var(--space-5);">
            ${[
              ['class_reminders',       'Class Reminders'],
              ['attendance_alerts',     'Attendance Alerts'],
              ['assessment_updates',    'Assessment Updates'],
              ['package_reminders',     'Package & Payment Reminders'],
              ['events_announcements',  'Events & Announcements']
            ].map(([key, label]) => {
              // Default = true for ALL; read saved preference from localStorage
              const stored = localStorage.getItem('notif_' + key);
              const isOn   = stored === null ? true : stored === 'true';
              return `
              <div class="settings-row" style="cursor:default;">
                <span class="settings-row__label">${label}</span>
                <label class="toggle">
                  <input type="checkbox" ${isOn ? 'checked' : ''}
                    onchange="saveNotifPref('${key}', this.checked); UI.toast(this.checked ? '${label} activé.' : '${label} désactivé.', '🔔')">
                  <span class="toggle-slider"></span>
                </label>
              </div>`;
            }).join('')}
          </div>

          <!-- PWA Install -->
          <p style="font-size:11px;font-weight:700;color:var(--color-text-muted);letter-spacing:0.5px;margin-bottom:var(--space-2);">APP</p>
          <div class="settings-section" style="margin-bottom:var(--space-5);">
            <div class="settings-row" id="install-row" onclick="triggerInstall()">
              <div class="settings-row__icon" style="background:var(--color-primary-bg);">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M12 2v10M12 12l-4-4M12 12l4-4M2 17l.621 2.485A2 2 0 0 0 4.561 21h14.878a2 2 0 0 0 1.94-1.515L22 17" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round"/></svg>
              </div>
              <span class="settings-row__label">Install App on Phone</span>
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="var(--color-text-muted)" stroke-width="2"/></svg>
            </div>
          </div>

          <!-- Logout -->
          <button class="btn btn--danger btn--block" onclick="doLogout()">Sign Out</button>

          <p style="text-align:center;font-size:11px;color:var(--color-text-muted);margin-top:var(--space-6);">Version 1.0 · Minds' Craft Parent Portal<br>© 2026 All rights reserved</p>
        </div>
      </div>
    </div>`;
});

// ============================
// HELPERS
// ============================

/**
 * Notification preferences — persisted in localStorage.
 * Keys: class_reminders | attendance_alerts | assessment_updates |
 *       package_reminders | events_announcements
 * Default: ALL true (first launch or if key missing).
 */
function saveNotifPref(key, value) {
  localStorage.setItem('notif_' + key, value ? 'true' : 'false');
}

function getNotifPref(key) {
  const stored = localStorage.getItem('notif_' + key);
  return stored === null ? true : stored === 'true'; // default ON
}

/** Initialise all notification prefs to true on first launch */
(function initNotifPrefs() {
  const keys = [
    'class_reminders', 'attendance_alerts', 'assessment_updates',
    'package_reminders', 'events_announcements'
  ];
  keys.forEach(k => {
    if (localStorage.getItem('notif_' + k) === null) {
      localStorage.setItem('notif_' + k, 'true');
    }
  });
})();

/**
 * Count how many times a given weekday (e.g. "Thursday") occurs
 * from today (inclusive) up to and including endDate.
 * Returns 0 if endDate is in the past or dayName is unknown.
 */
/**
 * Count how many sessions remain from today (inclusive) to endDate.
 * classTime: optional HH:MM string — if today IS the class day and the
 * session has already passed, we start counting from next week.
 */
function calcSessionsLeft(dayName, endDate, classTime) {
  if (!dayName || dayName === 'TBD') return '—';
  const dayIndex = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(dayName);
  if (dayIndex < 0) return '—';
  const now  = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const end = endDate ? new Date(endDate) : null;
  if (!end) return '—';
  end.setHours(23, 59, 59, 0);
  if (end < today) return 0;

  // Determine start cursor: today if class day is today AND session hasn't started yet
  const cursor = new Date(today);
  const diff = (dayIndex - today.getDay() + 7) % 7;
  cursor.setDate(cursor.getDate() + diff);

  // If today is the class day, check if the session time has already passed
  if (diff === 0 && classTime) {
    const [hh, mm] = classTime.split(':').map(Number);
    const sessionStart = new Date(today);
    sessionStart.setHours(hh, mm, 0, 0);
    if (now >= sessionStart) {
      // Session already started/passed today — skip to next week
      cursor.setDate(cursor.getDate() + 7);
    }
  }

  let count = 0;
  const c = new Date(cursor);
  while (c <= end) {
    count++;
    c.setDate(c.getDate() + 7);
  }
  return count;
}

/**
 * Render one course row inside a kid card.
 * If the package is expired (pkgExpired=true), attendance and sessions-left
 * show "—" with a "Renew package" notice instead of real values.
 */
/**
 * Find the allocation that matches a given course.
 * Match rule: the package name contains the course name (case-insensitive).
 * e.g. "Speed Math - Monthly Basic" contains "Speed Math"
 * Falls back to the most-recent active allocation if no specific match found.
 */
function findAllocForCourse(cls, allSubs) {
  if (!allSubs || allSubs.length === 0) return null;
  const courseName = (cls.courseName || cls.name || '').trim().toLowerCase();

  // 1. Exact match: packageName contains courseName
  const exact = allSubs.find(s =>
    s.packageName && s.packageName.toLowerCase().includes(courseName)
  );
  if (exact) return exact;

  // 2. Reverse match: courseName contains part of packageName (shorter names)
  const reverse = allSubs.find(s =>
    s.packageName && courseName.includes(s.packageName.toLowerCase().split(/[\s\-–]/)[0])
  );
  if (reverse) return reverse;

  // 3. Fallback: first active allocation
  return allSubs.find(s => s.status === 'active') || allSubs[0] || null;
}

/**
 * Build one course row for the kid card / overview tab.
 * Now receives allSubs (all allocations) and matches the right one per course.
 */
function buildCourseRow(cls, attendance, allSubs, hasLevelIds) {
  // Find the allocation that belongs specifically to this course
  const sub = findAllocForCourse(cls, allSubs);

  const pkgExpired = !sub || sub.status === 'expired' || sub.status === 'none' || !sub.expiryDate;
  const pkgStart   = sub && sub.startDate  ? new Date(sub.startDate  + 'T00:00:00') : null;
  const pkgEnd     = sub && sub.expiryDate ? new Date(sub.expiryDate + 'T00:00:00') : null;

  // Course label = course name (e.g. "Robotics & STEM")
  // Level label  = level name  (e.g. "Robotics Level 2")
  const courseLabel = cls.courseName || cls.name;
  const levelLabel  = cls.courseName && cls.name !== cls.courseName ? cls.name : null;

  // Package info line: name + expiry
  const pkgLabel = sub && sub.packageName && sub.packageName !== 'Training Package'
    ? sub.packageName
    : null;
  const pkgExpLabel = sub && sub.expiryDate
    ? `Exp. ${UI.formatDateShort(sub.expiryDate)}`
    : null;
  const pkgColor = sub && sub.daysLeft <= 7 ? 'var(--color-warning)' : 'var(--color-text-muted)';

  // Next session label — show "Today · HH:MM" if the next session is today
  let nextLabel;
  if (cls.nextSession) {
    const nsDate = new Date(cls.nextSession);
    const todayDate = new Date();
    const isToday = nsDate.getFullYear() === todayDate.getFullYear() &&
                    nsDate.getMonth()    === todayDate.getMonth()    &&
                    nsDate.getDate()     === todayDate.getDate();
    if (isToday) {
      nextLabel = `Today · ${cls.time}`;
    } else {
      nextLabel = `${(cls.nextSessionDay || '').substring(0, 3)} ${nsDate.getDate()} · ${cls.time}`;
    }
  } else {
    nextLabel = cls.time || '—';
  }

  if (pkgExpired) {
    return `
    <div style="border:1px solid var(--color-warning-bg);border-radius:var(--radius-md);padding:var(--space-3);margin-bottom:var(--space-2);background:var(--color-warning-bg);">
      <!-- Course header -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:var(--space-2);">
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--color-primary);">${courseLabel}</div>
          ${levelLabel ? `<div style="font-size:11px;color:var(--color-text-secondary);margin-top:1px;">${levelLabel}</div>` : ''}
        </div>
        <span style="font-size:11px;color:var(--color-text-muted);">${cls.days[0] || '—'} · ${cls.time}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;text-align:center;align-items:center;">
        <div><div style="font-size:14px;font-weight:800;color:var(--color-text-muted);">—</div><div style="font-size:10px;color:var(--color-text-muted);">Attendance</div></div>
        <div><div style="font-size:14px;font-weight:800;color:var(--color-text-muted);">—</div><div style="font-size:10px;color:var(--color-text-muted);">Sessions Left</div></div>
        <div><div style="font-size:11px;font-weight:700;color:var(--color-text);line-height:1.3;">${nextLabel}</div><div style="font-size:10px;color:var(--color-text-muted);">Next Session</div></div>
      </div>
      <div style="margin-top:var(--space-2);padding:6px 10px;background:var(--color-warning);border-radius:var(--radius-sm);text-align:center;">
        <span style="font-size:11px;font-weight:700;color:white;">🔄 Renew Subscription</span>
      </div>
    </div>`;
  }

  // Active package → compute attendance & sessions scoped to this package's date window
  const clsAtt = (attendance || []).filter(r => {
    const match = hasLevelIds ? r.levelId === cls.id : r.className === cls.name;
    if (!match) return false;
    const d = r.date ? new Date(r.date + 'T00:00:00') : null;
    if (!d) return true;
    return (!pkgStart || d >= pkgStart) && (!pkgEnd || d <= pkgEnd);
  });
  // Provisioned sessions = total scheduled sessions in the package window
  const provisionedSessions = (pkgStart && pkgEnd)
    ? (() => {
        const dayIndex = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(cls.days[0]);
        if (dayIndex < 0) return 0;
        let cnt = 0;
        const cursor = new Date(pkgStart);
        const startDiff = (dayIndex - cursor.getDay() + 7) % 7;
        cursor.setDate(cursor.getDate() + startDiff);
        while (cursor <= pkgEnd) { cnt++; cursor.setDate(cursor.getDate() + 7); }
        return cnt;
      })()
    : clsAtt.length || 1;

  const attPresent = clsAtt.filter(r => r.status === 'present' || r.status === 'late').length;
  // Attendance % = (attended / provisioned total) × 100
  const attRate    = provisionedSessions > 0 ? Math.round((attPresent / provisionedSessions) * 100) : null;
  const sessLeft   = calcSessionsLeft(cls.days[0], pkgEnd, cls.time);
  const sessColor  = (sessLeft !== '—' && sessLeft <= 2) ? 'var(--color-warning)' : 'var(--color-primary)';

  return `
  <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-3);margin-bottom:var(--space-2);">
    <!-- Course header: name + level + day/time -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;">
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--color-primary);">${courseLabel}</div>
        ${levelLabel ? `<div style="font-size:11px;color:var(--color-text-secondary);margin-top:1px;">${levelLabel}</div>` : ''}
      </div>
      <span style="font-size:11px;color:var(--color-text-muted);white-space:nowrap;margin-top:2px;">${cls.days[0] || '—'} · ${cls.time}</span>
    </div>
    <!-- Package info: name + expiry -->
    ${pkgLabel ? `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:4px 8px;background:var(--color-bg);border-radius:var(--radius-sm);border:1px solid var(--color-border);">
      <svg width="12" height="12" fill="none" viewBox="0 0 24 24" style="flex-shrink:0;color:var(--color-primary);"><rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span style="font-size:11px;color:var(--color-text-secondary);flex:1;font-weight:500;">${pkgLabel}</span>
      ${pkgExpLabel ? `<span style="font-size:11px;font-weight:600;color:${pkgColor};">${pkgExpLabel}</span>` : ''}
    </div>` : ''}
    <!-- Stats row -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;text-align:center;">
      <div>
        <div style="font-size:15px;font-weight:800;color:${attRate === null ? 'var(--color-text-muted)' : attRate >= 80 ? 'var(--color-success)' : 'var(--color-warning)'};">${attRate !== null ? attRate + '%' : '—'}</div>
        <div style="font-size:10px;color:var(--color-text-muted);">Attendance</div>
      </div>
      <div>
        <div style="font-size:15px;font-weight:800;color:${sessColor};">${sessLeft}</div>
        <div style="font-size:10px;color:var(--color-text-muted);">Sessions Left</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--color-text);line-height:1.3;">${nextLabel}</div>
        <div style="font-size:10px;color:var(--color-text-muted);">Next Session</div>
      </div>
    </div>
  </div>`;
}

function getNotifIcon(type) {
  const icons = {
    class: `<svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" stroke="currentColor" stroke-width="2"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" stroke="currentColor" stroke-width="2"/></svg>`,
    attend: `<svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/></svg>`,
    assess: `<svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4" stroke="currentColor" stroke-width="2"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke="currentColor" stroke-width="2"/></svg>`,
    package: `<svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="2"/></svg>`,
    event: `<svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" stroke-width="2"/><line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="2"/></svg>`,
    announce: `<svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2"/></svg>`
  };
  return icons[type] || icons.announce;
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'MORNING';
  if (h < 17) return 'AFTERNOON';
  return 'EVENING';
}

function initProgressRings() {
  document.querySelectorAll('.ring-fill').forEach(ring => {
    // already animated via CSS in inline styles
  });
}

function doLogout() {
  if (confirm('Are you sure you want to sign out?')) {
    RealtimeService.stop();                  // 🔕 stop live notifications
    window._realtimeStarted = false;
    AuthService.logout();
    Router.history = [];
    Router.navigate('login', {}, false);
    UI.toast('You have been signed out.', '👋');
  }
}

function triggerInstall() {
  if (window._deferredInstallPrompt) {
    window._deferredInstallPrompt.prompt();
    window._deferredInstallPrompt.userChoice.then(choice => {
      if (choice.outcome === 'accepted') {
        UI.toast('App installed successfully!', '🎉');
        window._deferredInstallPrompt = null;
      }
    });
  } else {
    UI.toast('To install: tap Share → Add to Home Screen (Safari on iOS) or use browser menu.', '📱');
  }
}

// ============================
// REALTIME — notifications live
// ============================

/**
 * Start the Supabase Realtime subscription for the logged-in parent.
 * Safe to call multiple times; RealtimeService deduplicates open sockets.
 */
function startRealtimeForCurrentUser() {
  const userId = AuthService.getUserId();
  const token  = AuthService.getToken();
  if (!userId || !token) return;

  // Register handler only once (avoid duplicates on re-navigate)
  if (window._realtimeStarted) {
    RealtimeService.stop();
  }
  window._realtimeStarted = true;

  RealtimeService.onNotification((notif) => {
    // 1. Refresh badge count
    NavManager.refreshBadge();

    // 2. Show in-app toast with icon
    const iconMap = {
      package: '💳', attend: '📋', class: '📚',
      assess: '⭐', event: '📅', announce: '📢'
    };
    const icon = iconMap[notif.type] || '🔔';
    UI.toast(`${notif.title}${notif.body ? '\n' + notif.body : ''}`, icon);

    // 3. If the Notifications screen is currently visible, prepend the new row
    const notifList = document.querySelector('#screen-notifications .scroll-content > div');
    if (notifList) {
      // Remove "empty state" if present
      const empty = notifList.querySelector('.empty-state');
      if (empty) empty.remove();

      const row = document.createElement('div');
      row.className = `notif-item unread`;
      row.setAttribute('onclick',
        `markNotifRead('${notif.id}', this); Router.navigate('${notif.linkTo || 'home'}')`);
      row.innerHTML = `
        <div class="notif-icon notif-icon--${notif.type}">${getNotifIcon(notif.type)}</div>
        <div class="notif-content">
          <div class="notif-title">${notif.title}</div>
          <div class="notif-body">${notif.body}</div>
          <div class="notif-time">Just now</div>
        </div>
        <div class="notif-dot"></div>`;
      notifList.prepend(row);
    }
  });

  RealtimeService.start(userId, token);
}

// ============================
// APP INITIALIZATION
// ============================
async function initApp() {
  // ── Detect Supabase password-reset redirect ──────────────────
  //
  // Supabase sends ONE of two formats depending on Auth settings:
  //
  // A) Legacy implicit flow (hash):
  //    https://app.com/#access_token=xxx&refresh_token=yyy&type=recovery
  //
  // B) PKCE flow (query param — newer Supabase default):
  //    https://app.com/?code=xxx
  //    Must be exchanged via POST /auth/v1/token?grant_type=pkce
  //    to get a real access_token + refresh_token.

  // ── Format A: hash-based (legacy implicit) ───────────────────
  const hash = window.location.hash;
  if (hash && hash.includes('access_token') && hash.includes('type=recovery')) {
    const params       = new URLSearchParams(hash.replace(/^#/, ''));
    const token        = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (token) {
      window._resetToken        = token;
      window._resetRefreshToken = refreshToken || null;
      history.replaceState(null, '', window.location.pathname + window.location.search);
      await Router.navigate('reset-password', { token, refreshToken }, false);
      return;
    }
  }

  // ── Format B: PKCE code exchange ─────────────────────────────
  // Supabase sends ?code=XXX when PKCE flow is active.
  // We stored a code_verifier in sessionStorage at forgotPassword() time.
  const urlParams   = new URLSearchParams(window.location.search);
  const pkceCode    = urlParams.get('code');
  if (pkceCode) {
    // Clean URL immediately so the code isn't reused on refresh
    history.replaceState(null, '', window.location.pathname);

    const codeVerifier = sessionStorage.getItem('pkce_verifier') || '';
    console.log('[Auth] PKCE code detected. verifier present:', !!codeVerifier);

    try {
      // Exchange the code + verifier for real tokens
      const body = codeVerifier
        ? { auth_code: pkceCode, code_verifier: codeVerifier }
        : { auth_code: pkceCode };

      const exchResp = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=pkce`,
        {
          method:  'POST',
          headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
          body:    JSON.stringify(body)
        }
      );
      const exchData = await exchResp.json().catch(() => ({}));
      console.log('[Auth] PKCE exchange →', exchResp.status, exchData);

      // Clear stored verifier (one-time use)
      sessionStorage.removeItem('pkce_verifier');

      if (exchResp.ok && exchData.access_token) {
        window._resetToken        = exchData.access_token;
        window._resetRefreshToken = exchData.refresh_token || null;
        await Router.navigate('reset-password', {
          token:        exchData.access_token,
          refreshToken: exchData.refresh_token || null
        }, false);
        return;
      }

      // Exchange failed — show error on reset-password screen with the raw code
      console.warn('[Auth] PKCE exchange failed:', exchData);
      // Fall through to show reset-password with empty token → "invalid link" UI
      window._resetToken        = '';
      window._resetRefreshToken = null;
      await Router.navigate('reset-password', { token: '', refreshToken: null }, false);
      return;
    } catch (e) {
      console.warn('[Auth] PKCE exchange error:', e.message);
    }
  }

  // ── Normal boot ──────────────────────────────────────────────
  await Router.navigate('splash', {}, false);

  setTimeout(async () => {
    if (AuthService.isLoggedIn()) {
      startRealtimeForCurrentUser();          // 🔔 start live notifications
      await Router.navigate('home', {}, false);
    } else {
      await Router.navigate('login', {}, false);
    }
  }, 1500);
}

// ── DEBUG: auto-probe trainer data right after home loads ──
window._trainerProbeRan = false;
window.debugTrainers = async function() {
  const token = AuthService.getToken();
  if (!token) { console.warn('[debug] Not logged in'); return; }
  const BASE = SUPABASE_URL + '/rest/v1';
  const h = { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + token };
  const get = async (label, path) => {
    const r = await fetch(BASE + '/' + path, { headers: h });
    const d = await r.json().catch(() => null);
    console.log('[DEBUG] === ' + label + ' [' + r.status + '] ===', JSON.stringify(d));
    return d;
  };
  console.log('[DEBUG] ====== TRAINER PROBE START ======');
  await get('ALL TRAINERS',             'trainers?select=id,full_name,status&limit=30');
  await get('TRAINER_SESSIONS all',     'trainer_sessions?select=*&limit=100');
  await get('TRAINER_SESSIONS+names',   'trainer_sessions?select=level_id,trainer_id,trainers(id,full_name),levels(id,name)&limit=100');
  await get('ALL LEVELS',               'levels?select=id,name,course_id,trainer_id,order_num&order=name.asc&limit=50');
  await get('LEVELS with name 7',       'levels?select=id,name,course_id,trainer_id&name=ilike.*7*&limit=20');
  await get('TRAINERS+trainer_sessions','trainers?select=id,full_name,trainer_sessions(level_id)&limit=30');
  console.log('[DEBUG] ====== TRAINER PROBE END ======');
};

// Start — works whether DOM is ready or not
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

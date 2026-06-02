/**
 * MIND'S CRAFT — Supabase Client & Configuration
 * Real backend integration for the Parent Portal
 */

// ── Local date helper ──────────────────────────────────────────────────────
// NEVER use toISOString() for date calculations — it converts to UTC and
// shifts the date by the timezone offset (Lebanon = UTC+3 → subtracts 3h).
// Always use this helper to get YYYY-MM-DD in the device's LOCAL timezone.
function _localDateStr(d) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
function _todayLocalStr() { return _localDateStr(new Date()); }

const SUPABASE_URL  = 'https://xiatsareoruybucwkpkc.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpYXRzYXJlb3J1eWJ1Y3drcGtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjgzOTcsImV4cCI6MjA4OTk0NDM5N30.l14cNOUt1PKqL0hl5VL5wpt2JRB9rG_gQlJeYeJNIqU';

// ============================================================
// PKCE HELPERS  (used for password-reset flow)
// ============================================================

/** Generate a cryptographically random code_verifier (43-128 chars, base64url) */
function _pkceGenerateVerifier() {
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Derive code_challenge = BASE64URL(SHA-256(verifier)) */
async function _pkceChallenge(verifier) {
  const enc  = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ============================================================
// LOW-LEVEL HTTP HELPERS
// ============================================================

/**
 * Build Supabase REST headers — injects JWT when logged in
 */
function sbHeaders(token) {
  const h = {
    'apikey':       SUPABASE_ANON,
    'Content-Type': 'application/json',
    'Prefer':       'return=representation'
  };
  h['Authorization'] = token
    ? `Bearer ${token}`
    : `Bearer ${SUPABASE_ANON}`;
  return h;
}

/**
 * Generic GET from PostgREST
 */
async function sbGet(path, token) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: sbHeaders(token),
    cache: 'no-store'
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ message: r.statusText }));
    throw new Error(err.message || `HTTP ${r.status}`);
  }
  return r.json();
}

/**
 * Generic POST to PostgREST
 */
async function sbPost(path, body, token) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: sbHeaders(token),
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ message: r.statusText }));
    throw new Error(err.message || `HTTP ${r.status}`);
  }
  return r.json();
}

/**
 * Generic PATCH to PostgREST
 */
async function sbPatch(path, body, token) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: sbHeaders(token),
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ message: r.statusText }));
    throw new Error(err.message || `HTTP ${r.status}`);
  }
  return r.json();
}

// ============================================================
// SUPABASE AUTH SERVICE
// ============================================================

const AuthService = {
  SESSION_KEY: 'mc_parent_session',
  TOKEN_KEY:   'mc_parent_token',

  /**
   * Login using Supabase Auth.
   * Username = email field from users table
   * Password = mobile/phone field (used as the Supabase Auth password)
   * 
   * NOTE: Per spec, when admin creates a parent account, the Supabase Auth
   * password is set to the mobile number. The email is the login username.
   */
  async login(emailInput, passwordInput) {
    try {
      // Step 1: Sign in with Supabase Auth
      // Retry once on 500 (Supabase "Database error querying schema" = project waking up)
      const doAuthFetch = () => fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'apikey':       SUPABASE_ANON,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email:    emailInput.trim().toLowerCase(),
          password: passwordInput
        })
      });

      let authResp = await doAuthFetch();

      // Auto-retry once after 3s if Supabase returns 500 (project waking up)
      if (authResp.status >= 500) {
        console.warn('[Auth] Got 500 on first attempt — retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        authResp = await doAuthFetch();
      }

      const authData = await authResp.json();

      if (!authResp.ok || authData.error) {
        // Provide clear, actionable error messages
        const rawMsg = (authData.error_description || authData.msg || authData.message || '').toLowerCase();
        let friendlyMsg = 'Email ou mot de passe incorrect.';

        if (authResp.status === 400) {
          if (rawMsg.includes('invalid') || rawMsg.includes('credentials') || rawMsg.includes('grant')) {
            friendlyMsg = 'Identifiants incorrects.\n\n• Vérifiez votre email\n• Votre mot de passe = votre numéro de mobile';
          } else if (rawMsg.includes('email not confirmed')) {
            friendlyMsg = 'Votre compte n\'est pas encore activé. Contactez l\'académie.';
          } else {
            friendlyMsg = rawMsg || 'Email ou mot de passe incorrect.';
          }
        } else if (authResp.status === 422) {
          friendlyMsg = 'Format d\'email invalide.';
        } else if (authResp.status >= 500) {
          friendlyMsg = `Erreur serveur (${authResp.status}). Veuillez réessayer.\n\nDétail: ${authData.error_description || authData.message || authData.msg || JSON.stringify(authData)}`;
        }

        console.warn('[Auth] Login failed — status:', authResp.status, '— body:', authData);
        return { success: false, error: friendlyMsg };
      }

      const token      = authData.access_token;
      const refreshTok = authData.refresh_token;
      const supaUserId = authData.user?.id;
      const expiresIn  = authData.expires_in || 28800;

      // Step 2: Fetch the parent's profile from users table using the JWT
      const userRows = await sbGet(
        `users?email=eq.${encodeURIComponent(emailInput.trim().toLowerCase())}&select=id,email,full_name,phone,user_type,avatar_url,status,notes&limit=1`,
        token
      );

      if (!userRows || userRows.length === 0) {
        return { success: false, error: 'Your account was not found. Please contact the academy.' };
      }

      const user = userRows[0];

      // Step 3: Check user_type — must be parent or student
      const allowedTypes = ['parent', 'student', 'guardian'];
      if (user.user_type && !allowedTypes.includes(user.user_type.toLowerCase())) {
        // If user_type is admin/staff, deny access to parent portal
        // But if user_type is null/unknown, allow (may not be set yet)
        if (['admin', 'staff', 'trainer'].includes(user.user_type.toLowerCase())) {
          return { success: false, error: 'This account does not have parent portal access.' };
        }
      }

      // Step 4: Store session
      const session = {
        userId:       user.id,
        supaUserId:   supaUserId,
        email:        user.email,
        fullName:     user.full_name,
        userType:     user.user_type,
        avatarUrl:    user.avatar_url,
        phone:        user.phone,
        token:        token,
        refreshToken: refreshTok,
        loginAt:      Date.now(),
        expiresAt:    Date.now() + (expiresIn * 1000)
      };

      localStorage.setItem(AuthService.SESSION_KEY, JSON.stringify(session));
      return { success: true, session };

    } catch (e) {
      console.error('[Auth] Login error:', e);
      return { success: false, error: 'Connection error. Please check your internet and try again.' };
    }
  },

  /**
   * Refresh session token
   */
  async refreshSession() {
    const session = this.getSession();
    if (!session?.refreshToken) return false;

    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refreshToken })
      });

      if (!r.ok) { this.logout(); return false; }
      const data = await r.json();

      session.token        = data.access_token;
      session.refreshToken = data.refresh_token;
      session.expiresAt    = Date.now() + (data.expires_in * 1000);
      localStorage.setItem(AuthService.SESSION_KEY, JSON.stringify(session));
      return true;
    } catch (e) {
      console.warn('[Auth] Token refresh failed:', e);
      return false;
    }
  },

  /**
   * Send forgot password email via Supabase Auth.
   * Simple POST to /recover — no PKCE params (they block email sending).
   * The email template uses {{ .Token }} which is exchanged via /verify in initApp.
   */
  async forgotPassword(email) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      const data = await r.json().catch(() => ({}));
      console.log('[Auth] forgotPassword →', r.status, data);
      return { success: r.ok };
    } catch (e) {
      console.warn('[Auth] forgotPassword error:', e.message);
      return { success: false };
    }
  },

  /**
   * Update password using a valid session access_token.
   * By the time this is called, initApp has already exchanged the PKCE code
   * (or legacy hash token) for a proper session JWT.
   *
   * @param {string} accessToken   — valid session JWT
   * @param {string} newPassword   — new password chosen by the user
   * @param {string} [refreshToken] — refresh_token (used as fallback if 401)
   */
  async updatePassword(accessToken, newPassword, refreshToken) {
    try {
      // The accessToken here is already a valid session JWT (exchanged from
      // PKCE code or extracted from the legacy hash). Use it directly.
      // If it fails with 401, try refreshing via refresh_token as fallback.
      let sessionToken = accessToken;

      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'apikey':        SUPABASE_ANON,
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify({ password: newPassword })
      });
      const data = await r.json().catch(() => ({}));

      // If 401 and we have a refresh_token, try exchanging it first
      if (!r.ok && (r.status === 401 || r.status === 403)) {
        const rtToUse = refreshToken || window._resetRefreshToken || null;
        if (rtToUse) {
          console.log('[Auth] Access token rejected, trying refresh_token exchange…');
          const exchR = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: rtToUse })
          });
          if (exchR.ok) {
            const exchData = await exchR.json().catch(() => ({}));
            if (exchData.access_token) {
              sessionToken = exchData.access_token;
              // Retry with fresh token
              const r2 = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
                method: 'PUT',
                headers: {
                  'apikey':        SUPABASE_ANON,
                  'Content-Type':  'application/json',
                  'Authorization': `Bearer ${sessionToken}`
                },
                body: JSON.stringify({ password: newPassword })
              });
              const data2 = await r2.json().catch(() => ({}));
              if (!r2.ok) {
                return { success: false, error: data2.message || data2.msg || 'Password update failed.' };
              }
              return { success: true };
            }
          }
        }
        const msg = data.message || data.msg || data.error_description || 'Password update failed.';
        return { success: false, error: msg };
      }

      if (!r.ok) {
        const msg = data.message || data.msg || data.error_description || 'Password update failed.';
        return { success: false, error: msg };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message || 'Network error.' };
    }
  },

  logout() {
    localStorage.removeItem(AuthService.SESSION_KEY);
    // Sign out from Supabase (best effort)
    const session = this.getSession();
    if (session?.token) {
      fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${session.token}` }
      }).catch(() => {});
    }
  },

  getSession() {
    try {
      const raw = localStorage.getItem(AuthService.SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (Date.now() > s.expiresAt) {
        // Try refresh silently
        this.refreshSession();
        return s; // still return it; refresh will update token
      }
      return s;
    } catch (e) { return null; }
  },

  getToken() {
    return this.getSession()?.token || null;
  },

  getUserId() {
    return this.getSession()?.userId || null;
  },

  isLoggedIn() {
    return this.getSession() !== null;
  }
};

// ============================================================
// DATA SERVICE — Real Supabase Queries
// ============================================================

const DataService = {

  // ── PARENT PROFILE ───────────────────────────────────────
  async getParent() {
    const s = AuthService.getSession();
    if (!s) throw new Error('Not authenticated');
    return {
      id:       s.userId,
      name:     s.fullName || s.email,
      email:    s.email,
      phone:    s.phone || '',
      avatar:   s.avatarUrl || null,
      initials: this._initials(s.fullName || s.email)
    };
  },

  // ── KIDS linked to this parent ────────────────────────────
  /**
   * Strategy: enrollments or users table linked via parent_id / user_type.
   * We query users where user_type = 'student' and parent is linked.
   * 
   * Primary approach: look for users where notes or a join links to parent.
   * The admin portal must have set parent_id somewhere.
   * We'll query enrollments to get student_ids, then fetch those students.
   * 
   * Fallback: if users has no parent_id column, we use the fact that
   * the admin linked them — we check student_allocations or enrollments
   * where the student is linked via a parent field.
   * 
   * Since user_type exists, we find students where parent email matches
   * or where notes contains parent id — we'll try several strategies.
   */
  async getKids() {
    const token  = AuthService.getToken();
    const userId = AuthService.getUserId();
    if (!token || !userId) return [];

    try {
      // Strategy 1: parent_id column
      let rows = await sbGet(
        `users?parent_id=eq.${userId}&user_type=eq.student&select=id,email,full_name,phone,avatar_url,avatar_color,status,user_type,notes,created_at`,
        token
      ).catch(() => null);
      if (rows?.length) { console.log('[getKids] strategy1 →', rows.map(r=>r.full_name)); return rows.map(u => this._mapKid(u)); }

      // Strategy 2: guardian_id column
      rows = await sbGet(
        `users?guardian_id=eq.${userId}&select=id,email,full_name,phone,avatar_url,avatar_color,status,user_type,notes,created_at`,
        token
      ).catch(() => null);
      if (rows?.length) { console.log('[getKids] strategy2 →', rows.map(r=>r.full_name)); return rows.map(u => this._mapKid(u)); }

      // Strategy 3: RLS-filtered all students
      rows = await sbGet(
        `users?user_type=eq.student&select=id,email,full_name,phone,avatar_url,avatar_color,status,user_type,notes,created_at`,
        token
      ).catch(() => []);
      console.log('[getKids] strategy3 →', (rows||[]).map(r=>r.full_name));
      return (rows || []).map(u => this._mapKid(u));
    } catch (e) {
      console.error('[DataService] getKids error:', e);
      return [];
    }
  },

  async getKid(id) {
    const token = AuthService.getToken();
    const rows = await sbGet(
      `users?id=eq.${id}&select=id,email,full_name,phone,avatar_url,avatar_color,status,user_type,notes,created_at`,
      token
    );
    return rows && rows[0] ? this._mapKid(rows[0]) : null;
  },

  // ── UPDATE KID AVATAR ─────────────────────────────────────────────────────
  // Saves base64 JPEG (compressed to 200×200 by caller) into public.users.avatar_url
  async updateKidAvatar(kidId, base64) {
    const token = AuthService.getToken();
    await sbPatch(`users?id=eq.${kidId}`, { avatar_url: base64 }, token);
  },

  // ── ATTENDANCE ─────────────────────────────────────────────
  async getAttendance(kidId) {
    const token = AuthService.getToken();
    try {
      const rows = await sbGet(
        `attendance?student_id=eq.${kidId}&select=id,student_id,level_id,date,status,notes,created_at,recorded_by&order=date.desc&limit=50`,
        token
      );
      // Enrich with level name
      const levelIds = [...new Set(rows.map(r => r.level_id).filter(Boolean))];
      let levelMap = {};
      if (levelIds.length > 0) {
        const levels = await sbGet(
          `levels?id=in.(${levelIds.join(',')})&select=id,name,day_of_week,start_time`,
          token
        ).catch(() => []);
        levels.forEach(l => { levelMap[l.id] = l; });
      }
      return rows.map(r => ({
        id:        r.id,
        levelId:   r.level_id,              // ← keep raw level_id for per-course filtering
        date:      r.date,
        day:       r.date ? new Date(r.date).toLocaleDateString('en-US',{weekday:'short'}) : '—',
        className: levelMap[r.level_id]?.name || 'Class',
        status:    r.status || 'present',
        time:      levelMap[r.level_id]?.start_time || '',
        notes:     r.notes || ''
      }));
    } catch (e) {
      console.error('[DataService] getAttendance error:', e);
      return [];
    }
  },

  async getAttendanceSummary(kidId) {
    const records = await this.getAttendance(kidId);
    const total   = records.length;
    const present = records.filter(r => r.status === 'present').length;
    const absent  = records.filter(r => r.status === 'absent').length;
    const rate    = total > 0 ? Math.round((present / total) * 100) : 0;
    return { total, present, absent, rate };
  },

  // ── ASSESSMENTS ─────────────────────────────────────────────
  async getAssessments(kidId) {
    const token = AuthService.getToken();

    // ── Raw fetch so we can log the exact HTTP status / error body ───────────
    const _rawFetch = async (path) => {
      const url = `${SUPABASE_URL}/rest/v1/${path}`;
      const r   = await fetch(url, { headers: sbHeaders(token), cache: 'no-store' });
      const body = await r.json().catch(() => null);
      console.log(`[getAssessments] GET ${path} → HTTP ${r.status}`, body);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(body)}`);
      return body;
    };

    try {
      // Attempt 1: full schema with assessed_at
      // No created_at column — use assessed_at only
      let rows = await _rawFetch(
        `assessments?student_id=eq.${kidId}&select=id,student_id,skill_key,skill_label,category,score,assessed_at,notes&order=assessed_at.desc.nullslast&limit=100`
      ).catch(e => { console.warn('[getAssessments] attempt1 failed:', e.message); return null; });

      if (!rows) {
        console.warn('[getAssessments] all queries failed');
        return [];
      }

      if (!rows.length) {
        console.log('[getAssessments] table accessible but 0 rows for kidId:', kidId);
        return [];
      }

      // ── Group rows into sessions ──────────────────────────────────────────
      // Strategy: group by full assessed_at timestamp (second precision).
      // If all rows share the exact same timestamp (common when trainer saves
      // multiple sessions at once), fall back to grouping by category/course
      // so each assessment session is shown separately.

      const sessionMap = new Map();
      rows.forEach(r => {
        const ts  = r.assessed_at || 'unknown';
        // Primary key: full timestamp up to seconds (19 chars "YYYY-MM-DDTHH:MM:SS")
        const key = ts.substring(0, 19);
        if (!sessionMap.has(key)) sessionMap.set(key, { ts, rows: [] });
        sessionMap.get(key).rows.push(r);
      });

      // Check if all rows ended up in a single bucket (same timestamp)
      // → trainer entered all sessions with identical assessed_at
      // → secondary-split by category field so each course = 1 session
      let sessionBuckets = [...sessionMap.values()];
      if (sessionBuckets.length === 1 && sessionBuckets[0].rows.length > 5) {
        // Re-group by category (each assessment session belongs to a different course/category)
        const catMap = new Map();
        sessionBuckets[0].rows.forEach(r => {
          // Try to get course name from notes JSON for this row
          let catKey = r.category || 'unknown';
          try {
            const hist = Array.isArray(r.notes) ? r.notes : JSON.parse(r.notes || '[]');
            if (hist.length && hist[0].course_name && hist[0].course_name !== '—') {
              catKey = hist[0].course_name;
            }
          } catch { /* ignore */ }
          if (!catMap.has(catKey)) catMap.set(catKey, { ts: r.assessed_at || 'unknown', rows: [] });
          catMap.get(catKey).rows.push(r);
        });
        // Only use category-split if it produced more than 1 group
        if (catMap.size > 1) {
          sessionBuckets = [...catMap.values()];
        }
      }

      // Sort newest → oldest, map each group to one session card
      const sessions = sessionBuckets
        .sort((a, b) => (a.ts > b.ts ? -1 : a.ts < b.ts ? 1 : 0))
        .map(({ ts, rows: domainRows }) => this._mapAssessmentSession(ts, domainRows));

      console.log('[getAssessments] ✅ sessions:', sessions.length, sessions.map(s => `${s.date}|${s.title}|${s.score}`));
      return sessions;
    } catch (e) {
      console.error('[DataService] getAssessments unexpected error:', e);
      return [];
    }
  },

  async getAssessment(kidId, assessId) {
    const token = AuthService.getToken();
    try {
      // Fetch the specific row by id to get its assessed_at timestamp
      const byId = await sbGet(
        `assessments?id=eq.${assessId}&student_id=eq.${kidId}&select=id,student_id,skill_key,skill_label,category,score,assessed_at,notes`,
        token
      ).catch(() => []);
      if (byId && byId.length) {
        const ts = byId[0].assessed_at;
        // Fetch all sibling domain rows sharing the same assessed_at
        const siblings = ts ? await sbGet(
          `assessments?student_id=eq.${kidId}&assessed_at=eq.${encodeURIComponent(ts)}&select=id,student_id,skill_key,skill_label,category,score,assessed_at,notes`,
          token
        ).catch(() => byId) : byId;
        const domainRows = (siblings && siblings.length) ? siblings : byId;
        return this._mapAssessmentSession(ts || 'unknown', domainRows);
      }
      return null;
    } catch (e) { return null; }
  },

  // ── CLASSES / LEVELS ─────────────────────────────────────────
  async getKidClasses(kidId) {
    const token = AuthService.getToken();
    try {
      // Get enrollments for this student — include schedule_slot and level_progress
      const enrollments = await sbGet(
        `enrollments?student_id=eq.${kidId}&status=eq.active&select=id,student_id,level_id,status,enrolled_at,schedule_slot,level_progress&limit=10`,
        token
      );
      if (!enrollments || enrollments.length === 0) return [];

      const levelIds = enrollments.map(e => e.level_id).filter(Boolean);
      if (levelIds.length === 0) return [];

      // Build maps: level_id → schedule_slot, level_id → level_progress
      const slotByLevel     = {};
      const progressByLevel = {};
      enrollments.forEach(e => {
        if (e.level_id && e.schedule_slot)    slotByLevel[e.level_id]     = e.schedule_slot;
        if (e.level_id != null)               progressByLevel[e.level_id] = e.level_progress ?? 0;
      });

      const levels = await sbGet(
        `levels?id=in.(${levelIds.join(',')})&select=id,course_id,name,order_num,trainer_id,capacity,day_of_week,start_time,end_time,status,description`,
        token
      );

      // Override level day/time with enrollment schedule_slot when available
      // schedule_slot format: "Thursday 17:30:00-19:00:00"
      levels.forEach(l => {
        const slot = slotByLevel[l.id];
        if (!slot) return;
        // Parse day name
        const parts = slot.trim().split(' ');          // ["Thursday", "17:30:00-19:00:00"]
        const dayPart = parts[0];                      // "Thursday"
        const timePart = parts[1] || '';               // "17:30:00-19:00:00"
        const dayMap = {
          'sunday':0,'monday':1,'tuesday':2,'wednesday':3,
          'thursday':4,'friday':5,'saturday':6
        };
        if (dayMap[dayPart.toLowerCase()] !== undefined) {
          l.day_of_week = dayPart;                     // override with student's real day
        }
        if (timePart.includes('-')) {
          const [startT, endT] = timePart.split('-');
          if (startT) l.start_time = startT;           // override with student's real start time
          if (endT)   l.end_time   = endT;
        } else if (timePart) {
          l.start_time = timePart;
        }
      });

      // Get course names
      const courseIds = [...new Set(levels.map(l => l.course_id).filter(Boolean))];
      let courseMap = {};
      if (courseIds.length > 0) {
        const courses = await sbGet(
          `courses?id=in.(${courseIds.join(',')})&select=id,name,description,image_url,status`,
          token
        ).catch(() => []);
        courses.forEach(c => { courseMap[c.id] = c; });
      }

      // Fetch ALL trainers per level via trainer_sessions junction table
      const trainersByLevel = await this._fetchTrainersByLevel(levelIds, token);

      return levels.map(l => ({
        ...this._mapLevel(l, courseMap[l.course_id], trainersByLevel[l.id] || []),
        levelProgress: progressByLevel[l.id] ?? 0   // 0-100 from enrollments.level_progress
      }));
    } catch (e) {
      console.error('[DataService] getKidClasses error:', e);
      return [];
    }
  },

  async getAllClasses() {
    const token = AuthService.getToken();
    const userId = AuthService.getUserId();
    try {
      // Get all enrolled levels for all kids of this parent
      const kids = await this.getKids();
      if (!kids.length) return [];

      const kidIds = kids.map(k => k.id);
      const enrollments = await sbGet(
        `enrollments?student_id=in.(${kidIds.join(',')})&status=eq.active&select=id,student_id,level_id`,
        token
      );
      if (!enrollments.length) return [];

      const levelIds = [...new Set(enrollments.map(e => e.level_id).filter(Boolean))];
      const levels = await sbGet(
        `levels?id=in.(${levelIds.join(',')})&select=id,course_id,name,order_num,trainer_id,capacity,day_of_week,start_time,end_time,status,description`,
        token
      );

      const courseIds = [...new Set(levels.map(l => l.course_id).filter(Boolean))];
      let courseMap = {};
      if (courseIds.length) {
        const courses = await sbGet(`courses?id=in.(${courseIds.join(',')})&select=id,name,image_url`, token).catch(() => []);
        courses.forEach(c => { courseMap[c.id] = c; });
      }

      // Fetch ALL trainers per level via trainer_sessions junction table
      const trainersByLevel = await this._fetchTrainersByLevel(levelIds, token);

      // Enrich each level with which kid it belongs to
      const enrollMap = {};
      enrollments.forEach(e => { enrollMap[e.level_id] = enrollMap[e.level_id] || []; enrollMap[e.level_id].push(e.student_id); });

      return levels.map(l => ({
        ...this._mapLevel(l, courseMap[l.course_id], trainersByLevel[l.id] || []),
        kidIds: enrollMap[l.id] || []
      }));
    } catch (e) {
      console.error('[DataService] getAllClasses error:', e);
      return [];
    }
  },

  async getClass(classId) {
    const token = AuthService.getToken();
    try {
      const rows = await sbGet(
        `levels?id=eq.${classId}&select=id,course_id,name,order_num,trainer_id,capacity,day_of_week,start_time,end_time,status,description`,
        token
      );
      if (!rows || !rows[0]) return null;
      const l = rows[0];

      const [courses, trainersByLevel] = await Promise.all([
        l.course_id ? sbGet(`courses?id=eq.${l.course_id}&select=id,name,image_url`, token).catch(() => []) : [],
        this._fetchTrainersByLevel([classId], token)
      ]);

      return this._mapLevel(l, courses[0], trainersByLevel[classId] || []);
    } catch (e) { return null; }
  },

  // ── TRAINERS ─────────────────────────────────────────────────
  async getAllTrainers() {
    const token = AuthService.getToken();
    try {
      // Fetch trainers with all columns — only published trainers (isPublished = true)
      const rows = await sbGet(
        `trainers?is_published=eq.true&select=id,full_name,phone,email,status,created_at,title,start_year,start_date,description,avatar_url,rating,priority&order=priority.asc.nullslast&limit=50`,
        token
      ).catch(() => []);
      if (!rows || !rows.length) return [];

      // Use trainer_assignments to find all levels per trainer (supports multi-assignment)
      const trainerIds = rows.map(r => r.id);
      let studentCountMap = {};
      try {
        const assignments = await sbGet(
          `trainer_assignments?trainer_id=in.(${trainerIds.join(',')})&select=trainer_id,level_id`,
          token
        ).catch(() => []);

        // Build trainerIds → [levelIds] map
        const trainerLevels = {};
        assignments.forEach(a => {
          if (!trainerLevels[a.trainer_id]) trainerLevels[a.trainer_id] = [];
          trainerLevels[a.trainer_id].push(a.level_id);
        });

        // Also include levels.trainer_id (fallback for levels not in trainer_assignments)
        const fbLevels = await sbGet(
          `levels?trainer_id=in.(${trainerIds.join(',')})&select=id,trainer_id`,
          token
        ).catch(() => []);
        fbLevels.forEach(l => {
          if (!trainerLevels[l.trainer_id]) trainerLevels[l.trainer_id] = [];
          if (!trainerLevels[l.trainer_id].includes(l.id)) trainerLevels[l.trainer_id].push(l.id);
        });

        // Count unique active students per trainer
        const allLevelIds = [...new Set(Object.values(trainerLevels).flat())];
        if (allLevelIds.length > 0) {
          const enrollments = await sbGet(
            `enrollments?level_id=in.(${allLevelIds.join(',')})&status=eq.active&select=level_id,student_id`,
            token
          ).catch(() => []);
          // Build level → trainers map for counting
          const levelToTrainers = {};
          Object.entries(trainerLevels).forEach(([tid, lids]) => {
            lids.forEach(lid => {
              if (!levelToTrainers[lid]) levelToTrainers[lid] = [];
              if (!levelToTrainers[lid].includes(tid)) levelToTrainers[lid].push(tid);
            });
          });
          const trainerStudents = {};
          enrollments.forEach(e => {
            (levelToTrainers[e.level_id] || []).forEach(tid => {
              if (!trainerStudents[tid]) trainerStudents[tid] = new Set();
              trainerStudents[tid].add(e.student_id);
            });
          });
          trainerIds.forEach(tid => {
            studentCountMap[tid] = trainerStudents[tid] ? trainerStudents[tid].size : 0;
          });
        }
      } catch (_) {}

      return rows.map(t => this._mapTrainer(t, [], studentCountMap[t.id] || 0));
    } catch (e) {
      console.error('[DataService] getAllTrainers error:', e);
      return [];
    }
  },

  async getTrainer(trainerId) {
    if (!trainerId) return null;
    const token = AuthService.getToken();
    try {
      const rows = await sbGet(
        `trainers?id=eq.${trainerId}&is_published=eq.true&select=id,full_name,phone,email,status,created_at,title,start_year,start_date,description,avatar_url,rating`,
        token
      );
      if (!rows || !rows[0]) return null;

      // Get ALL levels for this trainer via trainer_assignments + fallback levels.trainer_id
      const [assignments, fbLevels] = await Promise.all([
        sbGet(`trainer_assignments?trainer_id=eq.${trainerId}&select=level_id`, token).catch(() => []),
        sbGet(`levels?trainer_id=eq.${trainerId}&select=id,name,course_id,day_of_week,start_time`, token).catch(() => [])
      ]);

      // Merge level IDs from both sources
      const assignedLevelIds = (assignments || []).map(a => a.level_id).filter(Boolean);
      const fbLevelIds = (fbLevels || []).map(l => l.id);
      const allLevelIds = [...new Set([...assignedLevelIds, ...fbLevelIds])];

      // Fetch full level objects for assigned levels not already in fbLevels
      const newIds = assignedLevelIds.filter(id => !fbLevelIds.includes(id));
      let extraLevels = [];
      if (newIds.length > 0) {
        extraLevels = await sbGet(
          `levels?id=in.(${newIds.join(',')})&select=id,name,course_id,day_of_week,start_time`,
          token
        ).catch(() => []);
      }
      const levels = [...(fbLevels || []), ...extraLevels];

      // Count unique students enrolled in trainer's levels
      let studentCount = 0;
      try {
        if (allLevelIds.length > 0) {
          const enrollments = await sbGet(
            `enrollments?level_id=in.(${allLevelIds.join(',')})&status=eq.active&select=student_id`,
            token
          ).catch(() => []);
          studentCount = new Set(enrollments.map(e => e.student_id)).size;
        }
      } catch (_) {}

      return this._mapTrainer(rows[0], levels, studentCount);
    } catch (e) { return null; }
  },

  // ── SUBSCRIPTIONS & PACKAGES ──────────────────────────────────
  async getSubscription(studentId) {
    // Always query by student_id — fetch the most recent allocation
    const token = AuthService.getToken();
    try {
      const rows = await sbGet(
        `student_allocations?student_id=eq.${studentId}&select=*&order=created_at.desc&limit=1`,
        token
      ).catch((e) => { console.warn('[getSubscription] fetch failed:', e.message); return []; });

      console.log(`[getSubscription] studentId=${studentId} → ${rows?.length ?? 'null'} rows`, rows);
      if (!rows || rows.length === 0) return this._noPackage();
      const alloc = rows[0];

      // Get package details
      let pkg = null;
      if (alloc.package_id) {
        const pkgs = await sbGet(
          `packages?id=eq.${alloc.package_id}&select=id,name,description,status,base_price,default_discount,duration_months`,
          token
        ).catch(() => []);
        pkg = pkgs[0] || null;
      }

      // Get kid name
      let kidName = '';
      if (alloc.student_id) {
        const kids = await sbGet(
          `users?id=eq.${alloc.student_id}&select=full_name`,
          token
        ).catch(() => []);
        kidName = kids[0]?.full_name || '';
      }

      return this._mapAllocation(alloc, pkg, kidName);
    } catch (e) {
      console.error('[DataService] getSubscription error:', e);
      return this._noPackage();
    }
  },

  // All allocations for ONE specific student (newest first)
  async getKidSubscriptions(studentId) {
    const token = AuthService.getToken();
    try {
      const rows = await sbGet(
        `student_allocations?student_id=eq.${studentId}&select=*&order=created_at.desc`,
        token
      ).catch((e) => { console.warn('[getKidSubscriptions] fetch failed:', e.message); return []; });
      if (rows && rows.length > 0) {
        console.log(`[DataService] getKidSubscriptions(${studentId}) → ${rows.length} rows`);
        console.log('[DataService] student_allocations columns:', Object.keys(rows[0]));
        console.log('[DataService] first allocation raw:', JSON.stringify(rows[0]));
      } else {
        console.log(`[DataService] getKidSubscriptions(${studentId}) → 0 rows`);
      }
      if (!rows || rows.length === 0) return [];

      const pkgIds = [...new Set(rows.map(r => r.package_id).filter(Boolean))];
      let pkgMap = {};
      if (pkgIds.length) {
        const pkgs = await sbGet(
          `packages?id=in.(${pkgIds.join(',')})&select=id,name,description,status,base_price,default_discount,duration_months`,
          token
        ).catch(() => []);
        pkgs.forEach(p => { pkgMap[p.id] = p; });
      }
      return rows.map(a => this._mapAllocation(a, pkgMap[a.package_id] || null, ''));
    } catch (e) {
      console.error('[DataService] getKidSubscriptions error:', e);
      return [];
    }
  },

  async getAllSubscriptions() {
    const token = AuthService.getToken();
    try {
      const kids = await this.getKids();
      if (!kids.length) return [];

      const kidIds = kids.map(k => k.id);

      // Fetch allocations + enrollments (with schedule_slot) + levels in parallel
      const [allocations, enrollments] = await Promise.all([
        sbGet(`student_allocations?student_id=in.(${kidIds.join(',')})&select=*&order=created_at.desc`, token).catch(() => []),
        sbGet(`enrollments?student_id=in.(${kidIds.join(',')})&status=eq.active&select=id,student_id,level_id,schedule_slot`, token).catch(() => [])
      ]);

      // Build kidId → [level_ids] map and level_id → schedule_slot map
      const kidLevelIds = {};
      const slotByLevel = {}; // level_id → schedule_slot string
      enrollments.forEach(e => {
        if (!kidLevelIds[e.student_id]) kidLevelIds[e.student_id] = [];
        kidLevelIds[e.student_id].push(e.level_id);
        if (e.level_id && e.schedule_slot) slotByLevel[e.level_id] = e.schedule_slot;
      });

      // Fetch all relevant levels (for day_of_week + start_time + course_id)
      const allLevelIds = [...new Set(enrollments.map(e => e.level_id).filter(Boolean))];
      let levelMap = {};
      if (allLevelIds.length) {
        const levels = await sbGet(
          `levels?id=in.(${allLevelIds.join(',')})&select=id,course_id,day_of_week,start_time`,
          token
        ).catch(() => []);
        // Apply schedule_slot override (same logic as getKidClasses)
        levels.forEach(l => {
          const slot = slotByLevel[l.id];
          if (slot) {
            const parts = slot.trim().split(' ');
            const dayPart  = parts[0];
            const timePart = parts[1] || '';
            const dMap = {'sunday':0,'monday':1,'tuesday':2,'wednesday':3,'thursday':4,'friday':5,'saturday':6};
            if (dMap[dayPart.toLowerCase()] !== undefined) l.day_of_week = dayPart;
            if (timePart.includes('-')) { const [st] = timePart.split('-'); if (st) l.start_time = st; }
            else if (timePart) l.start_time = timePart;
          }
          levelMap[l.id] = l;
        });
      }

      // Fetch packages + which courses each package covers (package_courses)
      const pkgIds = [...new Set(allocations.map(a => a.package_id).filter(Boolean))];
      let pkgMap = {};
      let pkgCourseIds = {}; // pkgId → [courseId, ...]
      if (pkgIds.length) {
        const pkgs = await sbGet(
          `packages?id=in.(${pkgIds.join(',')})&select=id,name,description,status,base_price,default_discount,duration_months`,
          token
        ).catch(() => []);
        pkgs.forEach(p => { pkgMap[p.id] = p; });

        // Which course(s) does each package cover?
        const pcRows = await sbGet(
          `package_courses?package_id=in.(${pkgIds.join(',')})&select=package_id,course_id`,
          token
        ).catch(() => []);
        (pcRows || []).forEach(pc => {
          if (!pkgCourseIds[pc.package_id]) pkgCourseIds[pc.package_id] = [];
          if (pc.course_id) pkgCourseIds[pc.package_id].push(pc.course_id);
        });
      }

      const kidMap = {};
      kids.forEach(k => { kidMap[k.id] = k; });

      // Day name helper
      const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const dayMap = {
        0:'Sunday',1:'Monday',2:'Tuesday',3:'Wednesday',4:'Thursday',5:'Friday',6:'Saturday',
        'monday':'Monday','tuesday':'Tuesday','wednesday':'Wednesday',
        'thursday':'Thursday','friday':'Friday','saturday':'Saturday','sunday':'Sunday'
      };

      return allocations.map(a => {
        const kid  = kidMap[a.student_id];
        const sub  = this._mapAllocation(a, pkgMap[a.package_id], kid?.name || '');

        if (sub.status === 'expired' || sub.status === 'none' || !sub.expiryDate) return sub;

        // Find all levels enrolled by THIS kid
        const kidLevels = (kidLevelIds[a.student_id] || []).map(lid => levelMap[lid]).filter(Boolean);
        if (!kidLevels.length) return sub;

        // Helper: count sessLeft for one level
        const _calcLeft = (lev) => {
          const dayRaw  = lev.day_of_week;
          const dayName = dayMap[dayRaw] || dayMap[(dayRaw + '').toLowerCase()] || null;
          if (!dayName || dayName === 'TBD') return null;
          const dayIndex  = DAY_NAMES.indexOf(dayName);
          const classTime = lev.start_time ? lev.start_time.substring(0, 5) : null;
          const now   = new Date();
          const today = new Date(now); today.setHours(0, 0, 0, 0);
          const end   = new Date((sub.expiryDate || '').replace(/-/g, '/')); end.setHours(23, 59, 59, 0);
          if (end < today) return 0;
          const diff   = (dayIndex - today.getDay() + 7) % 7;
          const cursor = new Date(today);
          cursor.setDate(cursor.getDate() + diff);
          if (diff === 0 && classTime) {
            const [hh, mm] = classTime.split(':').map(Number);
            const sessionStart = new Date(today); sessionStart.setHours(hh, mm, 0, 0);
            if (now >= sessionStart) cursor.setDate(cursor.getDate() + 7);
          }
          let cnt = 0;
          const c = new Date(cursor);
          while (c <= end) { cnt++; c.setDate(c.getDate() + 7); }
          return cnt;
        };

        const _calcTotal = (lev) => {
          const dayRaw  = lev.day_of_week;
          const dayName = dayMap[dayRaw] || dayMap[(dayRaw + '').toLowerCase()] || null;
          if (!dayName || dayName === 'TBD' || !sub.startDate) return 0;
          const dayIndex = DAY_NAMES.indexOf(dayName);
          const st = new Date((sub.startDate  || '').replace(/-/g, '/'));
          const en = new Date((sub.expiryDate || '').replace(/-/g, '/')); en.setHours(23, 59, 59, 0);
          const diff = (dayIndex - st.getDay() + 7) % 7;
          const c = new Date(st); c.setDate(c.getDate() + diff);
          let cnt = 0;
          while (c <= en) { cnt++; c.setDate(c.getDate() + 7); }
          return cnt;
        };

        // Determine which levels belong to THIS package using package_courses.
        // pkgCourseIds[pkg_id] = [courseId, courseId, ...]
        // Match kidLevels whose course_id is in that list.
        // Fallback: if no package_courses data, use all kid levels (old behaviour).
        const coveredCourseIds = pkgCourseIds[a.package_id] || [];
        const relevantLevels = coveredCourseIds.length
          ? kidLevels.filter(l => coveredCourseIds.includes(l.course_id))
          : kidLevels; // no package_courses data → fallback to all

        // If still empty after filter, try direct courseId match then all levels
        const levelsToUse = relevantLevels.length ? relevantLevels : kidLevels;

        let sessLeft  = 0;
        let sessTotal = 0;

        for (const lev of levelsToUse) {
          const left = _calcLeft(lev);
          if (left !== null) {
            sessLeft  += left;
            sessTotal += _calcTotal(lev) || left;
          }
        }

        if (sessLeft === 0 && sessTotal === 0) return sub; // couldn't calculate

        sub.sessionsLeft  = sessLeft;
        sub.sessionsTotal = sessTotal;
        sub.sessionsUsed  = Math.max(0, sessTotal - sessLeft);
        return sub;
      });
    } catch (e) { console.error('[getAllSubscriptions]', e); return []; }
  },

  async getPackages() {
    const token = AuthService.getToken();
    try {
      // Fetch active packages with correct column names from DB schema
      const rows = await sbGet(
        `packages?select=id,name,duration_months,base_price,default_discount,description,status&status=eq.active&order=base_price.asc`,
        token
      ).catch(() => []);
      if (!rows || !rows.length) return [];

      // Fetch which courses each package includes (package_courses → courses)
      const pkgIds = rows.map(r => r.id);
      let coursesByPkg = {};
      try {
        const pcRows = await sbGet(
          `package_courses?package_id=in.(${pkgIds.join(',')})&select=package_id,courses(id,name,status)`,
          token
        ).catch(() => []);
        (pcRows || []).forEach(pc => {
          if (!coursesByPkg[pc.package_id]) coursesByPkg[pc.package_id] = [];
          if (pc.courses && pc.courses.name) {
            coursesByPkg[pc.package_id].push(pc.courses.name);
          }
        });
      } catch(_) {}

      return rows.map((p, i) => {
        const basePrice      = p.base_price      ?? null;
        const discountPct    = p.default_discount ?? 0;
        // Effective price after default discount
        const effectivePrice = basePrice != null
          ? Math.round(basePrice * (1 - discountPct / 100) * 100) / 100
          : null;

        // Build feature list from description lines + included courses
        const descFeatures = p.description
          ? p.description.split('\n').map(f => f.trim()).filter(Boolean)
          : [];
        const courseNames = coursesByPkg[p.id] || [];

        return {
          id:              p.id,
          name:            p.name || `Package ${i + 1}`,
          description:     p.description || '',
          durationMonths:  p.duration_months || 1,
          basePrice:       basePrice,
          discountPct:     discountPct,
          price:           effectivePrice,           // effective price shown to parent
          popular:         false,                    // no 'most popular' highlight
          features:        descFeatures,             // from description field
          courses:         courseNames,              // included courses
          status:          p.status
        };
      });
    } catch (e) {
      console.error('[DataService] getPackages error:', e);
      return [];
    }
  },

  async getLevelEnrolledCount(levelId) {
    if (!levelId) return 0;
    const token = AuthService.getToken();
    try {
      const rows = await sbGet(
        `enrollments?level_id=eq.${levelId}&status=eq.active&select=id`,
        token
      ).catch(() => []);
      return (rows || []).length;
    } catch (e) { return 0; }
  },

  // ── LEVEL PROGRESS ────────────────────────────────────────────
  async getLevelInfo(kidId) {
    const token = AuthService.getToken();
    try {
      // Get ALL active enrollments — we aggregate level_progress across all enrolled courses
      const enrollments = await sbGet(
        `enrollments?student_id=eq.${kidId}&status=eq.active&select=id,student_id,level_id,enrolled_at,level_progress&order=enrolled_at.desc&limit=10`,
        token
      ).catch(() => []);

      if (!enrollments.length) return this._defaultLevel();

      const enrollment = enrollments[0];
      const levelRows = await sbGet(
        `levels?id=eq.${enrollment.level_id}&select=id,course_id,name,order_num,capacity,description`,
        token
      ).catch(() => []);

      if (!levelRows.length) return this._defaultLevel();
      const level = levelRows[0];

      // Get total levels in this course for progress calculation
      const allLevels = await sbGet(
        `levels?course_id=eq.${level.course_id}&select=id,name,order_num&order=order_num.asc`,
        token
      ).catch(() => []);

      const totalLevels  = allLevels.length || 1;
      const currentOrder = level.order_num || 1;

      // Real progress from DB — use level_progress from the enrollment row (0-100).
      // If not set (0 or null), fall back to position-based estimate so it's never blank.
      const rawProgress  = enrollment.level_progress ?? 0;
      const levelPct     = rawProgress > 0
        ? rawProgress
        : Math.min(100, Math.round((currentOrder / totalLevels) * 100));

      // Find next level
      const nextLevel = allLevels.find(l => l.order_num === currentOrder + 1);

      // Build per-enrollment progress map for all enrolled courses
      const progressByEnroll = {};
      enrollments.forEach(e => { progressByEnroll[e.level_id] = e.level_progress ?? 0; });

      return {
        current:         level.name || `Level ${currentOrder}`,
        currentCode:     (level.name || 'L').substring(0,2).toUpperCase(),
        number:          currentOrder,
        total:           totalLevels,
        pct:             levelPct,          // real DB value (or fallback)
        nextLevel:       nextLevel?.name || 'Advanced Level',
        progressByLevel: progressByEnroll,  // { level_id: 0-100 } for all enrollments
        milestones:      allLevels.map(l => ({
          id:    l.id,
          title: l.name,
          done:  l.order_num < currentOrder,
          date:  l.order_num < currentOrder ? 'Completed' : null
        }))
      };
    } catch (e) {
      return this._defaultLevel();
    }
  },

  // ── EVENTS ───────────────────────────────────────────────────
  async getEvents(filter = 'all') {
    const token = AuthService.getToken();
    try {
      const rows = await sbGet(
        `events?select=id,title,description,start_date,end_date,start_time,end_time,location,capacity,status,theme_color,image_url,image_key,created_at,updated_at&order=start_date.desc.nullslast,start_time.desc.nullslast&limit=50`,
        token
      ).catch((e) => { console.error('[getEvents] fetch error:', e); return []; });
      // Déduplique par id — au cas où Supabase retourne des doublons
      const seen = new Set();
      const unique = (rows || []).filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
      console.log('[getEvents] raw:', rows?.length, 'unique:', unique.length);
      const mapped = unique.map(e => this._mapEvent(e));

      // Sort: newest → oldest (desc) — pure ISO string compare on YYYY-MM-DD
      const _dateStr = e => String(e.date || e.startDate || '0000-01-01').substring(0, 10);
      const _desc    = (a, b) => (_dateStr(a) > _dateStr(b) ? -1 : _dateStr(a) < _dateStr(b) ? 1 : 0);

      let result;
      if (filter === 'upcoming') result = mapped.filter(e => e.status === 'upcoming').sort(_desc);
      else if (filter === 'past') result = mapped.filter(e => e.status === 'past').sort(_desc);
      else result = mapped.sort(_desc);

      console.log('[getEvents] sorted order:', result.map(e => `${e.title} → ${_dateStr(e)}`));
      return result;
    } catch (e) { return []; }
  },

  async getEvent(id) {
    const token = AuthService.getToken();
    try {
      const rows = await sbGet(`events?id=eq.${id}&select=id,title,description,start_date,end_date,start_time,end_time,location,capacity,status,theme_color,image_url,image_key,created_at,updated_at`, token);
      return rows && rows[0] ? this._mapEvent(rows[0]) : null;
    } catch (e) { return null; }
  },

  // ── NOTIFICATIONS ─────────────────────────────────────────────
  // ── NOTIFICATIONS (table: parent_notifications) ─────────────
  // Populated by the admin portal via DB.pushParentNotification().
  // The parent app reads its own rows (RLS: parent_user_id = auth.uid()).

  async getNotifications() {
    const token  = AuthService.getToken();
    const userId = AuthService.getUserId();
    if (!userId) return [];
    try {
      const rows = await sbGet(
        `parent_notifications?parent_user_id=eq.${userId}&select=id,subject,body,type,is_read,created_at,metadata&order=created_at.desc&limit=50`,
        token
      ).catch(() => []);
      return (rows || []).map(n => this._mapNotification(n));
    } catch (e) { return []; }
  },

  async getUnreadCount() {
    const token  = AuthService.getToken();
    const userId = AuthService.getUserId();
    if (!userId) return 0;
    try {
      // Use HEAD + Prefer: count=exact for a lightweight count query
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/parent_notifications?parent_user_id=eq.${userId}&is_read=eq.false&select=id`,
        { headers: { ...sbHeaders(token), 'Prefer': 'count=exact' } }
      );
      const countHeader = r.headers.get('content-range'); // e.g. "0-4/5"
      if (countHeader) {
        const total = parseInt(countHeader.split('/')[1], 10);
        return isNaN(total) ? 0 : total;
      }
      // Fallback: parse body
      const rows = await r.json().catch(() => []);
      return Array.isArray(rows) ? rows.length : 0;
    } catch (e) { return 0; }
  },

  async markRead(notifId) {
    const token = AuthService.getToken();
    try {
      await sbPatch(`parent_notifications?id=eq.${notifId}`, { is_read: true }, token);
    } catch (e) {}
    return true;
  },

  async markAllRead() {
    const userId = AuthService.getUserId();
    const token  = AuthService.getToken();
    if (!userId) return;
    try {
      await sbPatch(
        `parent_notifications?parent_user_id=eq.${userId}&is_read=eq.false`,
        { is_read: true },
        token
      );
    } catch (e) {}
    return true;
  },

  // ── DATA MAPPERS ──────────────────────────────────────────────

  _initials(name) {
    if (!name) return '?';
    const parts = name.split(' ').filter(Boolean);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase()
      : name.substring(0, 2).toUpperCase();
  },

  _mapKid(u) {
    return {
      id:               u.id,
      name:             u.full_name || u.email || 'Student',
      firstName:        (u.full_name || '').split(' ')[0] || 'Student',
      email:            u.email,
      phone:            u.phone || '',
      avatar:           u.avatar_url  || null,   // base64 or URL — shown as <img>
      avatarColor:      u.avatar_color || null,  // hex fallback colour from DB
      initials:         this._initials(u.full_name || u.email),
      level:            'Active Student',
      levelCode:        'AS',
      levelNumber:      1,
      totalLevels:      8,
      accomplishmentPct: 50,
      trainerId:        null,
      classIds:         [],
      subscriptionId:   u.id, // use student id to look up allocation
      status:           u.status || 'active',
      joinDate:         u.created_at,
      branch:           'Minds\' Craft Center',
      notes:            u.notes || ''
    };
  },

  _mapTrainer(t, levels = [], studentCount = 0) {
    // avatar: prefer avatar_url from DB, fall back to null (UI.avatar handles initials fallback)
    const avatar = t.avatar_url || null;

    // title → shown as specialty / certifications
    const title = t.title || '';

    // Since: prefer start_date (exact date), fall back to start_year as Jan 1st
    let sinceDate = null;
    if (t.start_date) {
      sinceDate = t.start_date; // 'YYYY-MM-DD'
    } else if (t.start_year) {
      sinceDate = `${t.start_year}-01-01`;
    } else {
      sinceDate = t.created_at || null;
    }

    return {
      id:             t.id,
      name:           t.full_name || 'Trainer',
      initials:       this._initials(t.full_name),
      avatar:         avatar,
      specialty:      title || 'Instructor',   // shown under name in list + hero
      bio:            t.description || '',      // About card
      certifications: title ? [title] : [],     // Certifications card → array with the title
      classes:        levels.map(l => l.name || 'Class'),
      studentCount:   studentCount,
      sinceDate:      sinceDate,               // Since field (start_date or start_year)
      branch:         'Minds\' Craft Center',
      email:          t.email || '',
      phone:          t.phone || '',
      status:         t.status
    };
  },

  // ── Fetch ALL trainers for a set of level IDs via trainer_assignments junction table.
  // trainer_assignments: { id, trainer_id, level_id, created_at }
  // Falls back to levels.trainer_id for levels not in trainer_assignments.
  // Returns: { [levelId]: [{id, full_name}, …] }
  async _fetchTrainersByLevel(levelIds, token) {
    if (!levelIds || levelIds.length === 0) return {};
    const map = {};

    const add = (levelId, trainer) => {
      if (!levelId || !trainer || !trainer.id) return;
      if (!map[levelId]) map[levelId] = [];
      if (!map[levelId].find(x => x.id === trainer.id)) {
        map[levelId].push({ id: trainer.id, full_name: (trainer.full_name || '').trim() });
      }
    };

    try {
      // ── Primary: trainer_assignments junction table ──────────────────────────────
      // Fetch all assignments for the given level IDs, embedding trainer name
      // Only include trainers where is_published = true
      const assignments = await sbGet(
        `trainer_assignments?level_id=in.(${levelIds.join(',')})&select=level_id,trainer_id,trainers(id,full_name,is_published)`,
        token
      ).catch(() => []);

      if (Array.isArray(assignments) && assignments.length > 0) {
        assignments.forEach(row => {
          // Skip unpublished trainers
          if (row.trainers && row.trainers.is_published !== false) add(row.level_id, row.trainers);
        });
        console.log('[Trainers] trainer_assignments:', assignments.length, 'rows →',
          Object.fromEntries(Object.entries(map).map(([k,v])=>[k, v.map(t=>t.full_name)])));
      } else {
        console.log('[Trainers] trainer_assignments: 0 rows for these levels');
      }

      // ── Fallback: levels.trainer_id for levels with no assignment rows ───────────
      const missing = levelIds.filter(id => !map[id] || map[id].length === 0);
      if (missing.length > 0) {
        const levelRows = await sbGet(
          `levels?id=in.(${missing.join(',')})&select=id,trainer_id`,
          token
        ).catch(() => []);
        const fbIds = [...new Set((levelRows || []).map(l => l.trainer_id).filter(Boolean))];
        if (fbIds.length > 0) {
          const trainerRows = await sbGet(
            `trainers?id=in.(${fbIds.join(',')})&is_published=eq.true&select=id,full_name`,
            token
          ).catch(() => []);
          const tmap = {};
          trainerRows.forEach(t => { tmap[t.id] = t; });
          levelRows.forEach(l => {
            if (l.trainer_id && tmap[l.trainer_id]) add(l.id, tmap[l.trainer_id]);
          });
          console.log('[Trainers] levels.trainer_id fallback for', missing.length, 'levels');
        }
      }

    } catch (e) {
      console.warn('[Trainers] _fetchTrainersByLevel error:', e.message);
    }

    console.log('[Trainers] Final map:',
      JSON.stringify(Object.fromEntries(Object.entries(map).map(([k,v])=>[k, v.map(t=>t.full_name)]))));
    return map;
  },

  // trainers param can be a single trainer object OR an array of trainer objects
  _mapLevel(l, course, trainers) {
    const dayMap = {
      0:'Sunday',1:'Monday',2:'Tuesday',3:'Wednesday',4:'Thursday',5:'Friday',6:'Saturday',
      'monday':'Monday','tuesday':'Tuesday','wednesday':'Wednesday',
      'thursday':'Thursday','friday':'Friday','saturday':'Saturday','sunday':'Sunday'
    };

    const dayRaw = l.day_of_week;
    const dayName = dayMap[dayRaw] || dayMap[(dayRaw+'').toLowerCase()] || (dayRaw+'') || 'TBD';

    // Calculate next session — all arithmetic in LOCAL time (no toISOString = no UTC shift)
    const now = new Date();
    let nextSession = null;
    let nextSessionDay = dayName;
    if (dayName && dayName !== 'TBD') {
      const dayIndex = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(dayName);
      if (dayIndex >= 0) {
        // diff = days until next occurrence of this weekday (0 = today)
        let diff = (dayIndex - now.getDay() + 7) % 7;

        // If today IS the class day, check whether the session time has already passed
        if (diff === 0 && l.start_time) {
          const [hh, mm] = l.start_time.split(':').map(Number);
          const sessionStart = new Date(now);
          sessionStart.setHours(hh, mm, 0, 0);
          if (now >= sessionStart) diff = 7; // already passed → jump to next week
        } else if (diff === 0 && !l.start_time) {
          // No time info and today is the class day → assume it's upcoming (keep diff=0)
        }

        // Build the target date using LOCAL arithmetic
        const next = new Date(now);
        next.setHours(12, 0, 0, 0);   // noon local — safe against any DST edge
        next.setDate(now.getDate() + diff);
        nextSession    = _localDateStr(next);
        nextSessionDay = dayName;
      }
    }

    // Normalise trainers into an array — filter out any blank names
    let trainerArr = [];
    if (Array.isArray(trainers)) {
      trainerArr = trainers.filter(t => t && t.id);
    } else if (trainers && trainers.id) {
      trainerArr = [trainers];
    }

    // Primary trainer (for backwards compat)
    const primaryTrainer = trainerArr[0] || null;

    // Build display string — only include trainers with a real name
    const namedTrainers = trainerArr.filter(t => t.full_name && t.full_name.trim() !== '');
    const trainerNamesStr = namedTrainers.length > 0
      ? namedTrainers.map(t => t.full_name.trim()).join(', ')
      : '—';

    return {
      id:              l.id,
      name:            l.name || 'Class',
      type:            course?.name || 'Group Class',
      trainerId:       primaryTrainer?.id   || l.trainer_id || null,
      trainerName:     primaryTrainer?.full_name?.trim() || '—',
      trainers:        trainerArr,                          // full list [{id, full_name}, …]
      trainerNames:    trainerNamesStr,
      days:            [dayName],
      time:            l.start_time ? l.start_time.substring(0,5) : 'TBD',
      duration:        l.start_time && l.end_time ? this._calcDuration(l.start_time, l.end_time) : '—',
      location:        'Minds\' Craft Center',
      branch:          'Minds\' Craft Center',
      capacity:        l.capacity || 0,
      enrolled:        0,
      status:          l.status || 'active',
      description:     l.description || course?.description || '',
      nextSession:     nextSession,
      nextSessionDay:  nextSessionDay,
      courseId:        l.course_id,
      courseName:      course?.name || '',
      orderNum:        l.order_num  ?? 999
    };
  },

  _calcDuration(start, end) {
    try {
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      const mins = (eh * 60 + em) - (sh * 60 + sm);
      return mins > 0 ? `${mins} min` : '—';
    } catch { return '—'; }
  },

  // Map a group of domain rows (same assessed_at) into one session object
  _mapAssessmentSession(timestamp, domainRows) {
    // ── Detect course type ────────────────────────────────────────────────────
    // category = 'speedmath' → SpeedMath session (1 row, score in notes.speedmath_score)
    // category = 'domain'    → Robotics & STEM session (1–5 rows, level in notes.level)
    const isSpeedMath = domainRows.some(r => r.category === 'speedmath' || r.skill_key === 'speedmath_score');

    // ── SpeedMath branch ──────────────────────────────────────────────────────
    if (isSpeedMath) {
      const row   = domainRows[0];
      const dateStr = (timestamp && timestamp !== 'unknown') ? timestamp.split('T')[0] : _todayLocalStr();
      const timeStr = (timestamp && timestamp.includes('T')) ? timestamp.split('T')[1].substring(0,5) : '';

      let notes = {};
      try {
        const raw = row.notes;
        notes = (typeof raw === 'string') ? JSON.parse(raw) : (raw || {});
        if (Array.isArray(notes)) notes = notes[0] || {};
      } catch { notes = {}; }

      const smScore    = typeof notes.speedmath_score === 'number' ? notes.speedmath_score : 0;
      const courseName = notes.course_name || 'Speed Math';
      const levelName  = notes.level_name  || '';
      const comment    = notes.comment     || '';

      // Grade band  0–39 Beginner | 40–59 Needs Practice | 60–79 Average | 80–99 Good | 100–120 Excellent
      let smBand = 'Beginner';
      if      (smScore >= 100) smBand = 'Excellent';
      else if (smScore >= 80)  smBand = 'Good';
      else if (smScore >= 60)  smBand = 'Average';
      else if (smScore >= 40)  smBand = 'Needs Practice';

      // Map band to a display colour (reuse palette keys via overallLevel)
      const BAND_LEVEL = { Beginner:'Emerging', 'Needs Practice':'Developing', Average:'Developing', Good:'Proficient', Excellent:'Advanced' };
      const BAND_ICON  = { Beginner:'🔢', 'Needs Practice':'📝', Average:'📊', Good:'🌟', Excellent:'🏆' };

      return {
        type:          'speedmath',
        id:            row.id || timestamp,
        date:          dateStr,
        time:          timeStr,
        title:         courseName + ' Assessment',
        levelName:     levelName,
        overallLevel:  BAND_LEVEL[smBand] || 'Emerging',   // for card colour only
        speedmathScore: smScore,
        speedmathBand:  smBand,
        speedmathIcon:  BAND_ICON[smBand] || '🔢',
        comment:       comment,
        remarks:       comment || 'Assessment completed.',
        skills:        [],     // no domain skills for SpeedMath
        score:         smScore,
        maxScore:      120,
        grade:         smBand,
        category:      'speedmath',
      };
    }

    // ── Robotics & STEM branch ────────────────────────────────────────────────
    // Score: 1-4 scale → convert to a 0-100 display score
    // 1=Emerging(25) 2=Developing(50) 3=Proficient(75) 4=Advanced(100)
    const levelMap = { 1: 'Emerging', 2: 'Developing', 3: 'Proficient', 4: 'Advanced' };
    const scoreToDisplay = s => Math.round((Math.min(Math.max(s || 0), 4) / 4) * 100);

    // Average score across all domains (for the header ring)
    const validScores = domainRows.map(r => r.score || 0).filter(s => s > 0);
    const avgRaw  = validScores.length ? validScores.reduce((a, b) => a + b, 0) / validScores.length : 0;
    const avgDisplay = Math.round(scoreToDisplay(avgRaw));

    // Grade from average display score
    let grade = 'C';
    if (avgDisplay >= 90) grade = 'A';
    else if (avgDisplay >= 75) grade = 'B+';
    else if (avgDisplay >= 60) grade = 'B';
    else if (avgDisplay >= 50) grade = 'C+';

    // Date string and time string from timestamp
    const dateStr = (timestamp && timestamp !== 'unknown') ? timestamp.split('T')[0] : _todayLocalStr();
    const timeStr = (timestamp && timestamp.includes('T')) ? timestamp.split('T')[1].substring(0,5) : '';

    // ── Parse notes — dual-model support ─────────────────────────────────────
    // NEW model (admin progress.js v2): notes is a plain object {}
    //   { course_name, comment, level, assessed_at, … }
    //   Each DB row = 1 domain entry for exactly 1 session.
    // LEGACY model: notes is an array [] of history entries
    //   [{ assessed_at, course_name, comment, … }, …]
    //   5 permanent rows per student, history stacked in the array.
    function _parseNotes(raw) {
      if (!raw) return { obj: null, arr: [] };
      let parsed = raw;
      if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch { return { obj: null, arr: [] }; }
      }
      if (Array.isArray(parsed)) return { obj: null, arr: parsed };
      if (parsed && typeof parsed === 'object') return { obj: parsed, arr: [] };
      return { obj: null, arr: [] };
    }

    // Course name + level_name — try all domain rows, prefer new-model object first
    // notes JSON structure (new admin model):
    //   { course_name, course_id, level_name, level_id, level, comment }
    //   level_name = levels.name  e.g. "Level 6 — Wednesday 16h"  ← THE course level to display
    //   level      = skill proficiency string: "emerging" / "developing" / "proficient" / "advanced"
    let courseName   = '—';
    let levelName    = '';   // levels.name — e.g. "Level 6 — Wednesday 16h" (from notes.level_name)
    let trainerNote  = '—';
    for (let di = 0; di < domainRows.length; di++) {
      const { obj, arr } = _parseNotes(domainRows[di]?.notes);
      // New model: notes.course_name + notes.level_name
      if (obj && obj.course_name && obj.course_name !== '—') {
        courseName = obj.course_name;
        if (obj.level_name) levelName = obj.level_name;  // ← use level_name, NOT level
        break;
      }
      // Legacy model: notes[0].course_name
      if (arr.length > 0 && arr[0].course_name && arr[0].course_name !== '—') {
        courseName = arr[0].course_name;
        if (arr[0].level_name) levelName = arr[0].level_name;
        break;
      }
    }
    // Final fallback: category field on the row
    if (courseName === '—' && domainRows[0]?.category) {
      courseName = domainRows[0].category;
    }

    // Build skills array — one entry per domain row
    const SKILL_ORDER = ['technical','logical','creativity','communication','collaboration'];
    const sorted = [...domainRows].sort((a, b) => {
      const ia = SKILL_ORDER.indexOf(a.skill_key); const ib = SKILL_ORDER.indexOf(b.skill_key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    const skills = sorted.map(r => {
      let comment = '';
      try {
        const { obj, arr } = _parseNotes(r.notes);
        if (obj) {
          // NEW model: comment lives directly on the object
          comment = obj.comment || '';
        } else {
          // LEGACY model: find the entry matching this session's timestamp
          const match = arr.find(h => h.assessed_at === timestamp) || arr[0];
          comment = match?.comment || '';
        }
      } catch { comment = ''; }

      // Skill proficiency level — prefer notes.level string (new model), normalise capitalisation
      // notes.level can be lowercase: 'emerging' / 'developing' / 'proficient' / 'advanced'
      const PROF_LEVELS = ['Emerging','Developing','Proficient','Advanced'];
      let level = levelMap[r.score] || 'Emerging';
      try {
        const { obj, arr } = _parseNotes(r.notes);
        const raw = obj ? (obj.level || '') : (arr[0]?.level || '');
        if (raw) {
          // Normalise: capitalise first letter for consistent matching
          const cap = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
          if (PROF_LEVELS.includes(cap)) level = cap;
        }
      } catch { /* keep score-derived level */ }

      const displayScore = scoreToDisplay(r.score);
      return {
        name:    r.skill_label || r.skill_key || 'Skill',
        score:   displayScore,
        level:   level,
        comment: comment
      };
    });

    // ── Overall session skill level — majority vote on skills[].level strings ──
    // This avoids using the numeric score (which can be wrong if all DB scores = 4
    // but the trainer actually set mixed levels via notes.level).
    const PROF_ORDER = ['Emerging','Developing','Proficient','Advanced'];
    const levelCounts = { Emerging:0, Developing:0, Proficient:0, Advanced:0 };
    skills.forEach(s => { if (levelCounts[s.level] !== undefined) levelCounts[s.level]++; });
    const totalSkills = skills.length || 1;
    // Weighted average position (0-3) then map back to label
    const weightedPos = PROF_ORDER.reduce((sum, l, i) => sum + levelCounts[l] * i, 0) / totalSkills;
    const overallLevelStr = PROF_ORDER[Math.round(weightedPos)] || 'Emerging';
    // Keep avgDisplay only for internal grade calc — not exposed in UI as "/100"

    // Global remarks: collect non-empty comments across all domains
    const remarks = skills.map(s => s.comment).filter(Boolean).join(' · ')
      || 'Assessment completed.';

    // Use the first domain row id as the session id (for navigation)
    const id = domainRows[0]?.id || timestamp;

    return {
      id:           id,
      date:         dateStr,
      time:         timeStr,
      title:        courseName !== '—' ? `${courseName} Assessment` : 'Skills Assessment',
      levelName:    levelName || '',   // ← levels.name e.g. "Level 6 — Wednesday 16h" (from notes.level_name)
      overallLevel: overallLevelStr,   // ← computed from skills[].level majority vote
      trainer:      trainerNote,
      category:     courseName !== '—' ? courseName : 'Skills Evaluation',
      score:        avgDisplay,        // kept for internal grade only — not shown in UI
      maxScore:     100,
      grade:        grade,
      remarks:      remarks,
      skills:       skills
    };
  },

  // Legacy single-row mapper kept for backwards compat
  _mapAssessment(r) {
    return this._mapAssessmentSession(r.assessed_at || r.created_at, [r]);
  },

  _mapAllocation(a, pkg, kidName) {
    const startDate  = a.start_date;
    const endDate    = a.end_date;

    // Compare dates as local calendar dates (ignore time / timezone shifts)
    const todayStr   = _todayLocalStr(); // YYYY-MM-DD local
    const today      = new Date(todayStr + 'T00:00:00');
    const expiry     = endDate ? new Date(endDate + 'T00:00:00')
                               : new Date(today.getTime() + 30 * 86400000);
    const daysLeft   = Math.ceil((expiry - today) / 86400000); // can be negative
    const daysLeftClamped = Math.max(0, daysLeft);
    const isExpired  = daysLeft < 0 || a.status === 'expired';  // strictly past end date
    const isExpiring = !isExpired && daysLeft <= 7;

    // Sessions — calculate from attendance records within the package period
    // sessTotal = number of scheduled sessions in the package window (based on duration)
    // sessUsed  = attendance records (present) within the window
    // sessLeft  = sessTotal - sessUsed
    const durMonthsForSess = pkg?.duration_months ?? 1;
    // Approximate total sessions: 4 sessions/week × 4 weeks × duration_months
    // We use a conservative 4 sessions/month as default
    const sessTotal = Math.round(durMonthsForSess * 4);
    // sessUsed will be updated by the UI layer from real attendance data
    // For now set to 0 — app.js will patch this after loading attendance
    const sessUsed  = 0;
    const sessLeft  = sessTotal;

    // Price — use price_paid from the allocation (what the parent actually paid),
    // fall back to pkg.base_price × (1 - discount_pct/100) if price_paid is absent
    const discountPct = a.discount_pct ?? pkg?.default_discount ?? 0;
    const pricePaid   = a.price_paid   ?? null;
    const pkgBase     = pkg?.base_price ?? null;
    const rawPrice = pricePaid != null
      ? pricePaid
      : pkgBase != null
        ? Math.round(pkgBase * (1 - discountPct / 100) * 100) / 100
        : null;

    // Duration label from package
    const durMonths = pkg?.duration_months ?? null;
    const planLabel = durMonths
      ? (durMonths === 1 ? 'Monthly' : durMonths === 3 ? 'Quarterly' : durMonths === 12 ? 'Annual' : `${durMonths}-month`)
      : (pkg?.description || '—');

    return {
      id:            a.id,
      kidId:         a.student_id,
      kidName:       kidName || 'Student',
      packageName:   pkg?.name || 'Training Package',
      plan:          planLabel,
      startDate:     startDate || _todayLocalStr(),
      expiryDate:    endDate   || _localDateStr(expiry),
      sessionsTotal: sessTotal,
      sessionsUsed:  sessUsed,
      sessionsLeft:  sessLeft,
      status:        isExpired ? 'expired' : isExpiring ? 'warning' : 'active',
      autoRenew:     a.auto_renew ?? false,
      price:         rawPrice,
      discountPct:   discountPct,
      daysLeft:      daysLeftClamped,
      courseId:      a.course_id || null,
      courseName:    a.course_name || pkg?.name || null,
    };
  },

  _mapEvent(e) {
    // Status: toujours dériver depuis la date réelle (end_date ou start_date)
    // pour que le filtre Upcoming/Past soit fiable même si la DB est désynchronisée
    let status = 'upcoming';
    const refDateStr = e.end_date || e.start_date || e.date || null;
    if (refDateStr) {
      const ref = new Date(refDateStr.replace(/-/g, '/'));
      ref.setHours(23, 59, 59, 0);
      status = ref < new Date() ? 'past' : 'upcoming';
    } else if (e.status === 'completed' || e.status === 'past' || e.status === 'cancelled') {
      status = 'past';
    }

    // Date: prefer start_date, fallback to date, then created_at
    const startDate = e.start_date || e.date || (e.created_at ? e.created_at.split('T')[0] : _todayLocalStr());
    const endDate   = e.end_date || startDate;

    // Time: prefer start_time, fallback to time field
    const startTime = e.start_time ? e.start_time.substring(0,5) : (e.time || null);
    const endTime   = e.end_time   ? e.end_time.substring(0,5)   : null;

    // Image priority:
    // 1. image_url — direct URL or base64 stored in the DB column (added via ALTER TABLE)
    // 2. image_key — Supabase Storage key → build public URL from bucket "events"
    let image = null;
    if (e.image_url && (e.image_url.startsWith('data:') || e.image_url.startsWith('http'))) {
      image = e.image_url;
    } else if (e.image_key) {
      // image_key can be a full URL (https://...) or a Storage key (events/photo.jpg)
      if (e.image_key.startsWith('http')) {
        image = e.image_key;
      } else {
        image = `${SUPABASE_URL}/storage/v1/object/public/events/${e.image_key}`;
      }
    }
    const themeColor = e.theme_color || null;

    return {
      id:          e.id,
      title:       e.title || 'Event',
      date:        startDate,
      endDate:     endDate,
      time:        startTime || '—',
      endTime:     endTime,
      startDate:   startDate,
      location:    e.location || e.venue || 'Minds\' Craft Center',
      category:    e.category || e.type || 'Event',
      description: e.description || '',
      image:       image,
      themeColor:  themeColor,
      status:      status
    };
  },

  _mapNotification(n) {
    // parent_notifications uses: subject, body, type, is_read, created_at, metadata
    // type values from admin: payment | absence | expiry | event | welcome | info | other
    const typeMap = {
      // admin portal types → icon key
      'payment':     'package',
      'absence':     'attend',
      'expiry':      'package',
      'event':       'event',
      'welcome':     'announce',
      'info':        'announce',
      'other':       'announce',
      // legacy / fallback
      'class':       'class',
      'attendance':  'attend',
      'assessment':  'assess',
      'package':     'package',
      'announcement':'announce',
      'system':      'announce'
    };
    const type = typeMap[n.type] || 'announce';

    // Human-readable time-ago
    const createdAt = n.created_at ? new Date(n.created_at) : new Date();
    const diffMs = Date.now() - createdAt.getTime();
    const diffM  = Math.floor(diffMs / 60000);
    const diffH  = Math.floor(diffMs / 3600000);
    const diffD  = Math.floor(diffH / 24);
    const timeStr = diffD > 0
      ? `${diffD} day${diffD > 1 ? 's' : ''} ago`
      : diffH > 0
        ? `${diffH} hour${diffH > 1 ? 's' : ''} ago`
        : diffM > 1
          ? `${diffM} min ago`
          : 'Just now';

    // Derive linkTo from type
    const linkMap = {
      payment: 'subscriptions', expiry: 'subscriptions',
      absence: 'kid-detail',   event:  'home'
    };
    const linkTo = linkMap[n.type] || 'home';

    // Parse metadata JSON if string
    let meta = {};
    if (n.metadata) {
      try { meta = typeof n.metadata === 'string' ? JSON.parse(n.metadata) : n.metadata; }
      catch (_) {}
    }

    return {
      id:      n.id,
      type:    type,
      title:   n.subject || 'Notification',     // subject field = title
      body:    n.body    || '',
      time:    timeStr,
      unread:  !n.is_read,
      meta:    meta,                             // {student, package, amount, …}
      linkTo:  linkTo
    };
  },

  // No real allocation found — shown as "no package"
  _noPackage() {
    return {
      id: null, kidId: null, kidName: 'Student',
      packageName: 'No Package', plan: '—',
      startDate: null, expiryDate: null,
      sessionsTotal: 0, sessionsUsed: 0, sessionsLeft: 0,
      status: 'none', autoRenew: false, price: '—', daysLeft: 0
    };
  },

  // Legacy — kept for getAllSubscriptions fallback only
  _defaultSub() {
    return {
      id: null, kidId: null, kidName: 'Student',
      packageName: 'No Package', plan: '—',
      startDate: null, expiryDate: null,
      sessionsTotal: 0, sessionsUsed: 0, sessionsLeft: 0,
      status: 'none', autoRenew: false, price: '—', daysLeft: 0
    };
  },

  _defaultLevel() {
    return {
      current: 'Active Student', currentCode: 'AS',
      number: 1, total: 8, pct: 25,
      nextLevel: 'Next Level',
      milestones: [
        { id: '1', title: 'Enrollment Complete', done: true, date: 'Joined' },
        { id: '2', title: 'First Assessment', done: false, date: null }
      ]
    };
  }
};

// Export to window
window.AuthService  = AuthService;
window.DataService  = DataService;
window.SUPABASE_URL = SUPABASE_URL;
window.sbGet        = sbGet;
window.sbPost       = sbPost;
window.sbPatch      = sbPatch;

// ============================================================
// REALTIME SERVICE — Supabase WebSocket (no SDK required)
// Listens for INSERT on parent_notifications filtered by
// parent_user_id = current user's auth.uid().
// Calls registered handlers when a new notification arrives.
// ============================================================

const RealtimeService = {
  _ws:          null,
  _handlers:    [],   // [{fn}]
  _heartbeat:   null,
  _reconnectT:  null,
  _active:      false,
  _ref:         0,    // incremental message ref counter

  /**
   * Start listening. Safe to call multiple times — reconnects if needed.
   * @param {string} userId  — auth.uid() of the logged-in parent
   * @param {string} token   — JWT access token
   */
  start(userId, token) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) return; // already running
    this._active = true;
    this._userId = userId;
    this._token  = token;
    this._connect();
  },

  /** Stop and clean up completely */
  stop() {
    this._active = false;
    clearInterval(this._heartbeat);
    clearTimeout(this._reconnectT);
    if (this._ws) { try { this._ws.close(); } catch (_) {} }
    this._ws = null;
    console.log('[Realtime] stopped');
  },

  /** Register a handler — called with a mapped notification object on new INSERT */
  onNotification(fn) {
    this._handlers.push(fn);
  },

  _connect() {
    if (!this._active) return;
    clearInterval(this._heartbeat);

    // Supabase Realtime WebSocket endpoint
    const wsUrl = SUPABASE_URL.replace('https://', 'wss://') + '/realtime/v1/websocket'
      + `?apikey=${SUPABASE_ANON}&vsn=1.0.0`;

    console.log('[Realtime] connecting…');
    const ws = new WebSocket(wsUrl);
    this._ws = ws;

    ws.onopen = () => {
      console.log('[Realtime] connected');
      // 1. Join the Phoenix channel for postgres_changes
      this._send({
        topic:   'realtime:parent-notif-' + this._userId,
        event:   'phx_join',
        payload: {
          config: {
            broadcast:  { self: false },
            presence:   { key:  '' },
            postgres_changes: [{
              event:  'INSERT',
              schema: 'public',
              table:  'parent_notifications',
              filter: `parent_user_id=eq.${this._userId}`
            }]
          },
          access_token: this._token
        },
        ref: String(++this._ref)
      });

      // 2. Heartbeat every 25 s to keep the WS alive
      this._heartbeat = setInterval(() => {
        this._send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++this._ref) });
      }, 25000);
    };

    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (_) { return; }

      // postgres_changes INSERT event
      if (
        msg.event === 'postgres_changes' &&
        msg.payload?.data?.type === 'INSERT' &&
        msg.payload?.data?.record
      ) {
        const raw = msg.payload.data.record;
        console.log('[Realtime] new notification received:', raw);
        const mapped = DataService._mapNotification(raw);
        this._handlers.forEach(fn => { try { fn(mapped); } catch (_) {} });
      }
    };

    ws.onerror = (e) => console.warn('[Realtime] WS error', e);

    ws.onclose = (e) => {
      console.warn('[Realtime] closed, code=', e.code);
      clearInterval(this._heartbeat);
      if (this._active) {
        // Reconnect with back-off (5 s)
        this._reconnectT = setTimeout(() => this._connect(), 5000);
      }
    };
  },

  _send(obj) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }
};

window.RealtimeService = RealtimeService;

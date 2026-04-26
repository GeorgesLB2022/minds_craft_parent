/**
 * MIND'S CRAFT — Supabase Client & Configuration
 * Real backend integration for the Parent Portal
 */

const SUPABASE_URL  = 'https://xiatsareoruybucwkpkc.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpYXRzYXJlb3J1eWJ1Y3drcGtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjgzOTcsImV4cCI6MjA4OTk0NDM5N30.l14cNOUt1PKqL0hl5VL5wpt2JRB9rG_gQlJeYeJNIqU';

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
      const authResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
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
          friendlyMsg = 'Erreur serveur. Veuillez réessayer dans quelques instants.';
        }

        console.warn('[Auth] Login failed:', authData);
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
   * Send forgot password email via Supabase Auth
   */
  async forgotPassword(email) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      return { success: r.ok };
    } catch (e) {
      return { success: false };
    }
  },

  /**
   * Update password using a recovery token (Option A flow).
   * Called from the reset-password screen after Supabase redirects
   * the user back with #access_token in the URL hash.
   * @param {string} accessToken  — token extracted from the URL hash
   * @param {string} newPassword  — new password chosen by the user
   */
  async updatePassword(accessToken, newPassword) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'apikey':        SUPABASE_ANON,
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ password: newPassword })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = data.message || data.msg || 'Password update failed.';
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
        `users?parent_id=eq.${userId}&user_type=eq.student&select=id,email,full_name,phone,avatar_url,status,user_type,notes,created_at`,
        token
      ).catch(() => null);
      if (rows?.length) { console.log('[getKids] strategy1 →', rows.map(r=>r.full_name)); return rows.map(u => this._mapKid(u)); }

      // Strategy 2: guardian_id column
      rows = await sbGet(
        `users?guardian_id=eq.${userId}&select=id,email,full_name,phone,avatar_url,status,user_type,notes,created_at`,
        token
      ).catch(() => null);
      if (rows?.length) { console.log('[getKids] strategy2 →', rows.map(r=>r.full_name)); return rows.map(u => this._mapKid(u)); }

      // Strategy 3: RLS-filtered all students
      rows = await sbGet(
        `users?user_type=eq.student&select=id,email,full_name,phone,avatar_url,status,user_type,notes,created_at`,
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
      `users?id=eq.${id}&select=id,email,full_name,phone,avatar_url,status,user_type,notes,created_at`,
      token
    );
    return rows && rows[0] ? this._mapKid(rows[0]) : null;
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
    const late    = records.filter(r => r.status === 'late').length;
    const rate    = total > 0 ? Math.round((present / total) * 100) : 0;
    return { total, present, absent, late, rate };
  },

  // ── ASSESSMENTS ─────────────────────────────────────────────
  async getAssessments(kidId) {
    const token = AuthService.getToken();
    try {
      const rows = await sbGet(
        `assessments?student_id=eq.${kidId}&select=id,student_id,score,notes,created_at&order=created_at.desc&limit=20`,
        token
      );
      return rows.map(r => this._mapAssessment(r));
    } catch (e) {
      console.error('[DataService] getAssessments error:', e);
      return [];
    }
  },

  async getAssessment(kidId, assessId) {
    const token = AuthService.getToken();
    try {
      const rows = await sbGet(
        `assessments?id=eq.${assessId}&student_id=eq.${kidId}&select=id,student_id,score,notes,created_at`,
        token
      );
      return rows && rows[0] ? this._mapAssessment(rows[0]) : null;
    } catch (e) { return null; }
  },

  // ── CLASSES / LEVELS ─────────────────────────────────────────
  async getKidClasses(kidId) {
    const token = AuthService.getToken();
    try {
      // Get enrollments for this student
      const enrollments = await sbGet(
        `enrollments?student_id=eq.${kidId}&status=eq.active&select=id,student_id,level_id,status,enrolled_at&limit=10`,
        token
      );
      if (!enrollments || enrollments.length === 0) return [];

      const levelIds = enrollments.map(e => e.level_id).filter(Boolean);
      if (levelIds.length === 0) return [];

      const levels = await sbGet(
        `levels?id=in.(${levelIds.join(',')})&select=id,course_id,name,order_num,trainer_id,capacity,day_of_week,start_time,end_time,status,description`,
        token
      );

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

      // Get trainer names
      const trainerIds = [...new Set(levels.map(l => l.trainer_id).filter(Boolean))];
      let trainerMap = {};
      if (trainerIds.length > 0) {
        const trainers = await sbGet(
          `trainers?id=in.(${trainerIds.join(',')})&select=id,full_name,phone,email,status`,
          token
        ).catch(() => []);
        trainers.forEach(t => { trainerMap[t.id] = t; });
      }

      return levels.map(l => this._mapLevel(l, courseMap[l.course_id], trainerMap[l.trainer_id]));
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

      const trainerIds = [...new Set(levels.map(l => l.trainer_id).filter(Boolean))];
      let trainerMap = {};
      if (trainerIds.length) {
        const trainers = await sbGet(`trainers?id=in.(${trainerIds.join(',')})&select=id,full_name`, token).catch(() => []);
        trainers.forEach(t => { trainerMap[t.id] = t; });
      }

      // Enrich each level with which kid it belongs to
      const enrollMap = {};
      enrollments.forEach(e => { enrollMap[e.level_id] = enrollMap[e.level_id] || []; enrollMap[e.level_id].push(e.student_id); });

      return levels.map(l => ({
        ...this._mapLevel(l, courseMap[l.course_id], trainerMap[l.trainer_id]),
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

      const [courses, trainers] = await Promise.all([
        l.course_id ? sbGet(`courses?id=eq.${l.course_id}&select=id,name,image_url`, token).catch(() => []) : [],
        l.trainer_id ? sbGet(`trainers?id=eq.${l.trainer_id}&select=id,full_name,phone,email`, token).catch(() => []) : []
      ]);

      return this._mapLevel(l, courses[0], trainers[0]);
    } catch (e) { return null; }
  },

  // ── TRAINERS ─────────────────────────────────────────────────
  async getAllTrainers() {
    const token = AuthService.getToken();
    try {
      // Fetch trainers with all new columns
      const rows = await sbGet(
        `trainers?select=id,full_name,phone,email,status,created_at,title,start_year,start_date,description,avatar_url&limit=50`,
        token
      ).catch(() => []);
      if (!rows || !rows.length) return [];

      // For each trainer, count students enrolled in their levels
      const trainerIds = rows.map(r => r.id);
      let studentCountMap = {};
      try {
        // Get all levels for these trainers
        const allLevels = await sbGet(
          `levels?trainer_id=in.(${trainerIds.join(',')})&select=id,trainer_id`,
          token
        ).catch(() => []);
        const levelIds = allLevels.map(l => l.id);
        if (levelIds.length > 0) {
          // Count active enrollments per level
          const enrollments = await sbGet(
            `enrollments?level_id=in.(${levelIds.join(',')})&status=eq.active&select=id,level_id,student_id`,
            token
          ).catch(() => []);
          // Build trainer → unique students map
          const levelTrainerMap = {};
          allLevels.forEach(l => { levelTrainerMap[l.id] = l.trainer_id; });
          const trainerStudents = {};
          enrollments.forEach(e => {
            const tid = levelTrainerMap[e.level_id];
            if (!tid) return;
            if (!trainerStudents[tid]) trainerStudents[tid] = new Set();
            trainerStudents[tid].add(e.student_id);
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
        `trainers?id=eq.${trainerId}&select=id,full_name,phone,email,status,created_at,title,start_year,start_date,description,avatar_url`,
        token
      );
      if (!rows || !rows[0]) return null;

      // Get levels (classes) for this trainer
      const levels = await sbGet(
        `levels?trainer_id=eq.${trainerId}&select=id,name,course_id,day_of_week,start_time`,
        token
      ).catch(() => []);

      // Count unique students enrolled in trainer's levels
      let studentCount = 0;
      try {
        const levelIds = levels.map(l => l.id);
        if (levelIds.length > 0) {
          const enrollments = await sbGet(
            `enrollments?level_id=in.(${levelIds.join(',')})&status=eq.active&select=student_id`,
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
          `packages?id=eq.${alloc.package_id}&select=id,name,description,status`,
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
      console.log(`[DataService] getKidSubscriptions(${studentId}) → ${rows?.length ?? 'null'} rows`, rows);
      if (!rows || rows.length === 0) return [];

      const pkgIds = [...new Set(rows.map(r => r.package_id).filter(Boolean))];
      let pkgMap = {};
      if (pkgIds.length) {
        const pkgs = await sbGet(
          `packages?id=in.(${pkgIds.join(',')})&select=id,name,description,status`,
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
      const allocations = await sbGet(
        `student_allocations?student_id=in.(${kidIds.join(',')})&select=*&order=created_at.desc`,
        token
      ).catch(() => []);

      const pkgIds = [...new Set(allocations.map(a => a.package_id).filter(Boolean))];
      let pkgMap = {};
      if (pkgIds.length) {
        const pkgs = await sbGet(
          `packages?id=in.(${pkgIds.join(',')})&select=id,name,description,status`,
          token
        ).catch(() => []);
        pkgs.forEach(p => { pkgMap[p.id] = p; });
      }

      const kidMap = {};
      kids.forEach(k => { kidMap[k.id] = k; });

      return allocations.map(a => {
        const kid = kidMap[a.student_id];
        return this._mapAllocation(a, pkgMap[a.package_id], kid?.name || '');
      });
    } catch (e) { return []; }
  },

  async getPackages() {
    const token = AuthService.getToken();
    try {
      const rows = await sbGet(
        `packages?select=id,name,description,status,created_at&order=created_at.asc`,
        token
      ).catch(() => []);
      return (rows || []).map((p, i) => ({
        id:      p.id,
        name:    p.name || `Package ${i+1}`,
        description: p.description || '',
        price:   null, // price field not found in schema — may be in description or other field
        popular: i === 1,
        features: p.description ? p.description.split('\n').filter(f => f.trim()) : [],
        status:  p.status
      }));
    } catch (e) { return []; }
  },

  // ── LEVEL PROGRESS ────────────────────────────────────────────
  async getLevelInfo(kidId) {
    const token = AuthService.getToken();
    try {
      // Get active enrollment to find current level
      const enrollments = await sbGet(
        `enrollments?student_id=eq.${kidId}&status=eq.active&select=id,student_id,level_id,enrolled_at&order=enrolled_at.desc&limit=1`,
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

      const totalLevels = allLevels.length || 1;
      const currentOrder = level.order_num || 1;
      const pct = Math.round((currentOrder / totalLevels) * 100);

      // Find next level
      const nextLevel = allLevels.find(l => l.order_num === currentOrder + 1);

      // Get attendance to estimate progress within level
      const attRecords = await this.getAttendance(kidId);
      const presentCount = attRecords.filter(r => r.status === 'present').length;
      const levelPct = Math.min(100, Math.round((presentCount / Math.max(allLevels.length * 4, 8)) * 100));

      return {
        current:     level.name || `Level ${currentOrder}`,
        currentCode: (level.name || 'L').substring(0,2).toUpperCase(),
        number:      currentOrder,
        total:       totalLevels,
        pct:         levelPct,
        nextLevel:   nextLevel?.name || 'Advanced Level',
        milestones:  allLevels.map(l => ({
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
      let query = `events?select=id,title,description,status,created_at,updated_at&order=created_at.desc&limit=30`;

      const rows = await sbGet(query, token).catch(() => []);
      const mapped = rows.map(e => this._mapEvent(e));

      if (filter === 'upcoming') return mapped.filter(e => e.status === 'upcoming');
      if (filter === 'past')     return mapped.filter(e => e.status === 'past');
      return mapped;
    } catch (e) { return []; }
  },

  async getEvent(id) {
    const token = AuthService.getToken();
    try {
      const rows = await sbGet(
        `events?id=eq.${id}&select=id,title,description,status,created_at,updated_at`,
        token
      );
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
      avatar:           u.avatar_url || null,
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
      branch:           'Mind\'s Craft Academy',
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
      branch:         'Mind\'s Craft Academy',
      email:          t.email || '',
      phone:          t.phone || '',
      status:         t.status
    };
  },

  _mapLevel(l, course, trainer) {
    const dayMap = {
      0:'Sunday',1:'Monday',2:'Tuesday',3:'Wednesday',4:'Thursday',5:'Friday',6:'Saturday',
      'monday':'Monday','tuesday':'Tuesday','wednesday':'Wednesday',
      'thursday':'Thursday','friday':'Friday','saturday':'Saturday','sunday':'Sunday'
    };

    const dayRaw = l.day_of_week;
    const dayName = dayMap[dayRaw] || dayMap[(dayRaw+'').toLowerCase()] || (dayRaw+'') || 'TBD';

    // Calculate next session
    const today = new Date();
    let nextSession = null;
    let nextSessionDay = dayName;
    if (dayName && dayName !== 'TBD') {
      const dayIndex = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(dayName);
      if (dayIndex >= 0) {
        // If today IS the class day, show today (not next week)
        const diff = (dayIndex - today.getDay() + 7) % 7;
        nextSession = new Date(today);
        nextSession.setDate(today.getDate() + diff);
        nextSession = nextSession.toISOString().split('T')[0];
      }
    }

    return {
      id:              l.id,
      name:            l.name || 'Class',
      type:            course?.name || 'Group Class',
      trainerId:       l.trainer_id,
      trainerName:     trainer?.full_name || '—',
      days:            [dayName],
      time:            l.start_time ? l.start_time.substring(0,5) : 'TBD',
      duration:        l.start_time && l.end_time ? this._calcDuration(l.start_time, l.end_time) : '—',
      location:        'Mind\'s Craft Academy',
      branch:          'Main Campus',
      capacity:        l.capacity || 0,
      enrolled:        0,
      status:          l.status || 'active',
      description:     l.description || course?.description || '',
      nextSession:     nextSession,
      nextSessionDay:  nextSessionDay,
      courseId:        l.course_id,
      courseName:      course?.name || ''
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

  _mapAssessment(r) {
    const score = r.score || 0;
    let grade = 'C';
    if (score >= 90) grade = 'A';
    else if (score >= 80) grade = 'B+';
    else if (score >= 70) grade = 'B';
    else if (score >= 60) grade = 'C+';

    return {
      id:          r.id,
      date:        r.created_at ? r.created_at.split('T')[0] : new Date().toISOString().split('T')[0],
      title:       'Assessment',
      trainer:     '—',
      category:    'Skills Evaluation',
      score:       score,
      maxScore:    100,
      grade:       grade,
      remarks:     r.notes || 'Keep up the excellent work!',
      skills:      []
    };
  },

  _mapAllocation(a, pkg, kidName) {
    const startDate  = a.start_date;
    const endDate    = a.end_date;

    // Compare dates as local calendar dates (ignore time / timezone shifts)
    const todayStr   = new Date().toISOString().split('T')[0]; // YYYY-MM-DD local
    const today      = new Date(todayStr + 'T00:00:00');
    const expiry     = endDate ? new Date(endDate + 'T00:00:00')
                               : new Date(today.getTime() + 30 * 86400000);
    const daysLeft   = Math.ceil((expiry - today) / 86400000); // can be negative
    const daysLeftClamped = Math.max(0, daysLeft);
    const isExpired  = daysLeft < 0 || a.status === 'expired';  // strictly past end date
    const isExpiring = !isExpired && daysLeft <= 7;

    // Read sessions from DB columns (try several possible column names)
    const sessTotal = a.sessions_total ?? a.total_sessions ?? a.session_count ?? 8;
    const sessUsed  = a.sessions_used  ?? a.used_sessions  ?? a.attended_sessions ?? 0;
    const sessLeft  = a.sessions_left  ?? a.remaining_sessions ?? Math.max(0, sessTotal - sessUsed);

    return {
      id:            a.id,
      kidId:         a.student_id,
      kidName:       kidName || 'Student',
      packageName:   pkg?.name || a.package_name || 'Training Package',
      plan:          pkg?.description || a.plan || 'Monthly Plan',
      startDate:     startDate || new Date().toISOString().split('T')[0],
      expiryDate:    endDate   || expiry.toISOString().split('T')[0],
      sessionsTotal: sessTotal,
      sessionsUsed:  sessUsed,
      sessionsLeft:  sessLeft,
      status:        isExpired ? 'expired' : isExpiring ? 'warning' : 'active',
      autoRenew:     a.auto_renew ?? false,
      price:         a.price || '—',
      daysLeft:      daysLeftClamped,
      courseId:      a.course_id || a.level_id || null,
      courseName:    a.course_name || pkg?.name || null,
    };
  },

  _mapEvent(e) {
    // Determine status from created_at / updated_at since we have no date column
    // Events are "upcoming" by default unless status field says otherwise
    const status = (e.status === 'completed' || e.status === 'past' || e.status === 'cancelled')
      ? 'past' : 'upcoming';

    return {
      id:          e.id,
      title:       e.title || 'Event',
      date:        e.created_at ? e.created_at.split('T')[0] : new Date().toISOString().split('T')[0],
      time:        '—',
      location:    'Mind\'s Craft Academy',
      category:    'Event',
      description: e.description || '',
      image:       null,
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

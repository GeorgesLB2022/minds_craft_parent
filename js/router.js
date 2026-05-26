/**
 * MIND'S CRAFT — Client-Side Router
 * Handles screen navigation, history, state, and transitions.
 */

const Router = {
  currentScreen: null,
  currentParams: {},
  history: [],
  screens: {},

  // Register all screens
  register(screenId, renderFn) {
    this.screens[screenId] = renderFn;
  },

  // Navigate to a screen
  async navigate(screenId, params = {}, addToHistory = true) {
    if (!this.screens[screenId]) {
      console.warn('[Router] Unknown screen:', screenId);
      return;
    }

    // Store history
    if (addToHistory && this.currentScreen) {
      this.history.push({ screen: this.currentScreen, params: this.currentParams });
    }

    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

    // Update state
    this.currentScreen = screenId;
    this.currentParams = params;

    // Show target screen FIRST — so it's never blank
    const target = document.getElementById('screen-' + screenId);
    if (target) {
      // TOUJOURS vider le contenu précédent avant le render
      // évite la duplication et les enfants orphelins sur re-navigation
      target.innerHTML = '';
      target.classList.add('active');
      // Spinner de chargement
      target.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;background:var(--color-bg,#F8F7FF);"><div style="text-align:center;"><div style="width:40px;height:40px;border:3px solid #EDE9FF;border-top-color:#6C3AE8;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 12px;"></div><p style="color:#94A3B8;font-size:14px;">Loading…</p></div></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
    }

    // Run render function — catch ALL errors
    try {
      await this.screens[screenId](params);
    } catch(err) {
      console.error('[Router] Screen error on "' + screenId + '":', err);
      if (target) {
        target.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#F8F7FF;padding:24px;text-align:center;">
            <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
            <h2 style="font-size:18px;font-weight:700;color:#1E1B4B;margin-bottom:8px;">Something went wrong</h2>
            <p style="color:#64748B;font-size:14px;margin-bottom:24px;">${err.message || 'Unable to load this screen.'}</p>
            <button onclick="Router.navigate('home',{},false)" style="padding:12px 24px;background:#6C3AE8;color:white;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;">← Go Home</button>
          </div>`;
      }
    }

    // Re-show target (in case render replaced it)
    if (target) target.classList.add('active');

    // Scroll to top
    if (target) {
      const scroll = target.querySelector('.scroll-content');
      if (scroll) scroll.scrollTop = 0;
      else target.scrollTop = 0;
    }

    // Update bottom nav
    NavManager.updateActive(screenId);

    // Update unread badge
    NavManager.refreshBadge();
  },

  // Go back
  back() {
    if (this.history.length > 0) {
      const prev = this.history.pop();
      this.navigate(prev.screen, prev.params, false);
    } else {
      this.navigate('home', {}, false);
    }
  }
};

// ============================
// NAVIGATION MANAGER
// ============================
const NavManager = {
  navScreens: ['home', 'kids', 'classes', 'events', 'more'],

  updateActive(screenId) {
    const bottomNav = document.getElementById('bottom-nav');
    if (!bottomNav) return;

    // Hide nav for auth screens
    const authScreens = ['splash', 'login', 'forgot-password', 'reset-password', 'reset-success'];
    const target = document.getElementById('screen-' + screenId);
    if (authScreens.includes(screenId)) {
      bottomNav.classList.add('hidden');
      if (target) target.classList.add('screen--fullheight');
      return;
    }
    bottomNav.classList.remove('hidden');
    if (target) target.classList.remove('screen--fullheight');

    // Determine which nav item to highlight
    const navMap = {
      'home': 'home',
      'kids': 'kids',
      'kid-detail': 'kids',
      'kid-attendance': 'kids',
      'kid-assessments': 'kids',
      'classes': 'classes',
      'class-detail': 'classes',
      'events': 'events',
      'event-detail': 'events',
      'more': 'more',
      'trainers': 'more',
      'trainer-detail': 'more',
      'subscriptions': 'more',
      'notifications': 'more',
      'about': 'more',
      'profile': 'more',
      'assessment-detail': 'kids'
    };

    const active = navMap[screenId] || screenId;
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.screen === active);
    });
  },

  async refreshBadge() {
    const count = await DataService.getUnreadCount();
    const badge = document.getElementById('notif-badge');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 9 ? '9+' : count;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  }
};

// ============================
// UI HELPERS
// ============================
const UI = {

  // Render avatar or placeholder
  // src        — avatar_url (base64 or https URL) — shown as <img> if present
  // initials   — 1-2 letter fallback text
  // sizeCls    — sm | md | lg | xl | 2xl
  // avatarColor — hex colour from DB (avatar_color field) used as fallback bg
  // editable   — if true, wraps in a tappable container (for kid-detail photo edit)
  avatar(src, initials, sizeCls = 'md', avatarColor = null, editable = false) {
    // ── Photo available ────────────────────────────────────────────────
    if (src) {
      const img = `<img src="${src}" alt="${initials}"
        class="avatar avatar--${sizeCls}"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
        <div class="avatar-placeholder avatar-placeholder--${sizeCls}"
          style="display:none;${avatarColor ? 'background:' + avatarColor + ';' : ''}">${initials}</div>`;
      if (editable) {
        return `<div class="avatar-edit-wrap" style="position:relative;display:inline-block;">
          ${img}
          <div class="avatar-edit-badge">📷</div>
        </div>`;
      }
      // Wrap in a span so the onerror sibling works correctly
      return `<span style="position:relative;display:inline-flex;flex-shrink:0;">${img}</span>`;
    }

    // ── No photo → colour placeholder ─────────────────────────────────
    const gradients = [
      'linear-gradient(135deg,#6C3AE8,#A855F7)',
      'linear-gradient(135deg,#3B82F6,#8B5CF6)',
      'linear-gradient(135deg,#10B981,#34D399)',
      'linear-gradient(135deg,#F59E0B,#F97316)',
      'linear-gradient(135deg,#EF4444,#EC4899)'
    ];
    const bg = avatarColor
      ? avatarColor                                          // use DB colour
      : gradients[(initials || '?').charCodeAt(0) % gradients.length]; // deterministic gradient
    const placeholder = `<div class="avatar-placeholder avatar-placeholder--${sizeCls}"
      style="background:${bg};">${initials || '?'}</div>`;

    if (editable) {
      return `<div class="avatar-edit-wrap" style="position:relative;display:inline-block;">
        ${placeholder}
        <div class="avatar-edit-badge">📷</div>
      </div>`;
    }
    return placeholder;
  },

  // Render badge
  badge(text, type = 'neutral') {
    return `<span class="badge badge--${type}">${text}</span>`;
  },

  // Status badge for attendance
  attendanceBadge(status) {
    const map = {
      present: ['Present', 'success'],
      absent:  ['Absent',  'danger'],
      late:    ['Late',    'warning']
    };
    const [label, type] = map[status] || ['Unknown', 'neutral'];
    return this.badge(label, type);
  },

  // Format date
  // Format time string "HH:MM" or "HH:MM:SS" → "10:00 AM" / "5:30 PM"
  formatTime(timeStr) {
    if (!timeStr || timeStr === 'TBD' || timeStr === '—') return timeStr || '—';
    const parts = timeStr.split(':');
    let h = parseInt(parts[0], 10);
    const m = parts[1] ? parts[1].padStart(2, '0') : '00';
    if (isNaN(h)) return timeStr;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  },

  formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  },

  // Format short date
  formatDateShort(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  // Days until
  daysUntil(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    return Math.max(0, Math.ceil((d - now) / 86400000));
  },

  // Score grade
  scoreType(score) {
    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'average';
    return 'poor';
  },

  // Progress ring SVG
  progressRing(pct, size = 56) {
    const radius = (size - 10) / 2;
    const circ = 2 * Math.PI * radius;
    const filled = circ * (pct / 100);
    const remaining = circ - filled;
    return `
      <div class="ring-wrap" style="width:${size}px;height:${size}px;">
        <svg class="ring-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <circle class="ring-track" cx="${size/2}" cy="${size/2}" r="${radius}"/>
          <circle class="ring-fill" cx="${size/2}" cy="${size/2}" r="${radius}"
            stroke-dasharray="${filled} ${remaining}" data-dasharray="${circ}" data-pct="${pct}"/>
        </svg>
        <div class="ring-text">${pct}%</div>
      </div>`;
  },

  // Show toast
  toast(message, icon = '✓') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  },

  // Subscription status
  subStatusBadge(sub) {
    if (!sub || sub.status === 'none' || sub.packageName === 'No Package') return this.badge('No Package', 'neutral');
    if (sub.status === 'expired') return this.badge('Expired', 'danger');
    if (sub.status === 'warning' || (sub.daysLeft != null && sub.daysLeft > 0 && sub.daysLeft <= 7)) return this.badge('Expiring soon', 'warning');
    return this.badge('Active', 'success');
  },

  // Sub card color class
  subCardClass(sub) {
    if (!sub) return 'sub-card';
    if (sub.status === 'expired') return 'sub-card sub-card--expired';
    if (sub.status === 'warning' || (sub.daysLeft != null && sub.daysLeft <= 7)) return 'sub-card sub-card--warning';
    return 'sub-card';
  },

  // Build app-bar HTML
  appBar(title, showBack = false, actions = '') {
    return `
      <header class="app-bar">
        ${showBack ? `<button class="app-bar__back" onclick="Router.back()" aria-label="Back">
          <svg width="24" height="24" fill="none" viewBox="0 0 24 24"><path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>` : ''}
        <h1 class="app-bar__title">${title}</h1>
        <div class="app-bar__actions">${actions}</div>
      </header>`;
  },

  // Notification bell icon button
  notifBellBtn() {
    return `
      <button class="icon-btn" onclick="Router.navigate('notifications')" aria-label="Notifications">
        <div class="nav-icon-wrap">
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span class="nav-badge hidden" id="notif-badge-header">3</span>
        </div>
      </button>`;
  }
};

window.Router = Router;
window.NavManager = NavManager;
window.UI = UI;

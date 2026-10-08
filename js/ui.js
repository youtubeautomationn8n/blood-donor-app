/* ============================================================
   UI — router, toast, badges and the delegated action dispatcher.
   All dynamic buttons use data-action="..." (no inline handlers,
   which keeps the Content Security Policy strict).
   ============================================================ */
const UI = (() => {

  const $ = id => document.getElementById(id);

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; // textContent: no HTML injection possible
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- verification badge pill ---------- */
  function badgePill(badge) {
    if (badge === 'verified') return '<span class="badge b-verified">🟢 Verified donor</span>';
    if (badge === 'proof')    return '<span class="badge b-proof">🟠 Proof uploaded</span>';
    return '<span class="badge b-registered">🟡 Registered</span>';
  }

  /* ---------- router ---------- */
  const history = [];
  function go(name) {
    const cur = document.querySelector('.screen.active');
    if (cur) history.push(cur.id.replace('s-', ''));
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = $('s-' + name);
    if (!el) return;
    el.classList.add('active');
    const title = el.dataset.title || '';
    const isHome = name === 'home';
    $('hdrTitle').textContent = title;
    $('hdrTitle').classList.toggle('hidden', isHome);
    $('logoWrap').classList.toggle('hidden', !isHome);
    $('backBtn').classList.toggle('hidden', isHome);
    window.scrollTo(0, 0);
    if (name === 'home') renderHome();
    if (name === 'dash') Donor.renderDashboard();
  }
  function goBack() {
    const prev = history.pop();
    if (prev) { history.pop(); go(prev); } else go('home');
  }

  function renderHome() {
    let backend = null;
    try { backend = Backend.get(); } catch (e) { /* pre-init: fall back to local */ }
    if (backend && !backend.isDemo) {
      // LIVE mode: count real donors from the server, not samples.
      $('st-donors').textContent = '…';
      $('st-verified').textContent = '…';
      backend.listDonors().then(list => {
        $('st-donors').textContent = list.length;
        $('st-verified').textContent = list.filter(d => d.badge === 'verified').length;
      }).catch(() => {
        $('st-donors').textContent = '–';
        $('st-verified').textContent = '–';
      });
    } else {
      $('st-donors').textContent = Store.donorCount();
      $('st-verified').textContent = Store.verifiedCount();
    }
    $('st-requests').textContent = Store.getFulfilled();
    updateModePill();
  }

  /* Visible sync-status pill so it's always obvious which mode is live. */
  function updateModePill() {
    const pill = $('modePill');
    if (!pill) return;
    let cls = 'mode-error', label = '⚠️ SYNC OFF — backend not configured';
    try {
      if (Backend.get().isDemo) {
        cls = 'mode-demo';
        label = '🧪 DEMO MODE — everything stays on this device only';
      } else {
        cls = 'mode-live';
        label = '☁️ LIVE — synced across all devices';
      }
    } catch (e) { /* backend failed to init: keep error state */ }
    pill.className = 'mode-pill ' + cls;
    pill.textContent = label;
  }

  /* ---------- delegated actions ----------
     Modules register handlers: UI.registerAction('name', fn) */
  const actions = {};
  function registerAction(name, fn) { actions[name] = fn; }

  function initDispatcher() {
    $('screens').addEventListener('click', e => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      const fn = actions[t.dataset.action];
      if (fn) fn(t.dataset.id, t, e);
    });
    // keyboard support for role="button" chips
    $('screens').addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-action][role="button"]')) {
        e.preventDefault();
        e.target.click();
      }
    });
  }

  /* Best-effort geolocation. Never rejects — resolves null on
     denial/timeout so flows never block waiting for permission. */
  function getPosition(timeoutMs = 7000) {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      setTimeout(() => finish(null), timeoutMs + 500);
      navigator.geolocation.getCurrentPosition(
        p => finish({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => finish(null),
        { timeout: timeoutMs, maximumAge: 600000 }
      );
    });
  }

  return {
    $, toast, badgePill, go, goBack, renderHome,
    registerAction, initDispatcher, getPosition
  };
})();

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
    $('st-donors').textContent = Store.donorCount();
    $('st-verified').textContent = Store.verifiedCount();
    $('st-requests').textContent = Store.getFulfilled();
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

  return {
    $, toast, badgePill, go, goBack, renderHome,
    registerAction, initDispatcher
  };
})();

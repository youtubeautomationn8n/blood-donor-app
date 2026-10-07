/* ============================================================
   main.js — application entry point.
   Binds static UI controls, initializes modules, connects the
   data backend (demo or Firebase), then renders home.
   Load order (see index.html): config -> security -> data ->
   store -> ui -> backend -> otp -> request -> donor -> main
   ============================================================ */
(function main() {
  'use strict';

  document.addEventListener('DOMContentLoaded', async () => {
    // Router + delegated dynamic actions
    UI.initDispatcher();

    // Header
    UI.$('backBtn').addEventListener('click', () => { Request.stopTracking(); Donor.stopInbox(); UI.goBack(); });
    UI.$('logoWrap').addEventListener('click', () => UI.go('home'));
    UI.$('logoWrap').addEventListener('keydown', e => {
      if (e.key === 'Enter') UI.go('home');
    });

    // Home
    UI.$('btnNeedBlood').addEventListener('click', () => UI.go('req-form'));
    UI.$('btnBecomeDonor').addEventListener('click', () => Donor.startSignup());
    UI.$('btnTrust').addEventListener('click', () => UI.go('trust'));
    UI.$('btnTrustSignup').addEventListener('click', () => Donor.startSignup());

    // Feature modules
    Request.init();
    Donor.init();

    // Data backend: demo (local) or Firebase (real-time sync).
    try {
      await Backend.init();
      if (!Backend.get().isDemo) UI.toast('☁️ Live sync connected');
    } catch (err) {
      // Firebase misconfigured? Fall back to demo so the app never breaks.
      console.warn('Backend init failed, staying local:', err);
      UI.toast('Demo mode: ' + err.message);
    }

    // First paint
    UI.renderHome();
  });
})();

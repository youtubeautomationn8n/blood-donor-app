/* ============================================================
   main.js — application entry point.
   Binds static UI controls, initializes modules, renders home.
   Load order (see index.html): config -> security -> data ->
   store -> ui -> otp -> request -> donor -> main
   ============================================================ */
(function main() {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    // Router + delegated dynamic actions
    UI.initDispatcher();

    // Header
    UI.$('backBtn').addEventListener('click', UI.goBack);
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

    // First paint
    UI.renderHome();
  });
})();

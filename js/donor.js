/* ============================================================
   Donor — signup (with OTP verification) + donor dashboard.

   Works in both modes:
     demo     : local profile + simulated incoming requests.
     firebase : profile synced to Firestore; incoming emergency
                requests arrive LIVE via subscription — a request
                sent from another phone appears here in seconds.
   SECURITY: signup step 3 requires a fresh OTP session
   (sessionStorage, 10-min TTL). Phone numbers are masked in
   the UI; full numbers only revealed after mutual acceptance.
   ============================================================ */
const Donor = (() => {

  const esc = Security.escapeHtml;
  let myGroup = null;
  let resendTimer = null;
  let myPos = null;
  let unsubInbox = null;
  const countedFulfilled = new Set(
    JSON.parse(localStorage.getItem('rakd_counted') || '[]')
  );
  function markCounted(rid) {
    countedFulfilled.add(rid);
    try { localStorage.setItem('rakd_counted', JSON.stringify([...countedFulfilled])); } catch (e) {}
  }

  function init() {
    UI.$('btnSendOtp').addEventListener('click', sendOtp);
    UI.$('btnVerifyOtp').addEventListener('click', verifyOtp);
    UI.$('btnResendOtp').addEventListener('click', sendOtp);
    UI.$('btnFinishSignup').addEventListener('click', finishSignup);
    buildMyGroupChips();

    let toggling = false;
    UI.registerAction('toggle-avail', async () => {
      if (toggling) return;
      const me = Store.getMyDonor();
      if (!me) return;
      toggling = true;
      const prev = me.available;
      me.available = !prev;
      // In LIVE mode, sync FIRST; only keep the change if the server accepted it,
      // so the toggle never lies about your real availability.
      if (!Backend.get().isDemo) {
        try { await Backend.get().upsertMyDonor(me); }
        catch (e) {
          me.available = prev;
          toggling = false;
          renderDashboard();
          UI.toast('Could not sync — still ' + (prev ? 'available' : 'paused') + '. ' + e.message);
          return;
        }
      }
      Store.setMyDonor(me);
      toggling = false;
      renderDashboard();
      UI.toast(me.available ? '✅ Available — you will receive alerts' : '⏸️ Paused — you will not receive alerts');
    });
    UI.registerAction('delete-account', async () => {
      const me = Store.getMyDonor();
      if (!me) return;
      const ok = confirm(
        'Delete your donor account permanently?\n\n' +
        'Your profile will be removed and you will stop receiving requests. ' +
        'This cannot be undone.'
      );
      if (!ok) return;
      try {
        if (!Backend.get().isDemo) await Backend.get().deleteMyAccount();
      } catch (e) {
        alert('Delete failed: ' + e.message);
        return;
      }
      stopInbox();
      try { Request.stopTracking(); } catch (e) {}
      Store.clearMyDonor();
      UI.go('home');
      UI.renderHome();
      UI.toast('Account deleted.');
    });
    UI.registerAction('inbox-accept', id => inboxAct(id, 'accepted'));
    UI.registerAction('inbox-decline', id => inboxAct(id, 'declined'));
    UI.registerAction('inbox-done', id => inboxDone(id));

    // Best-effort geolocation for "nearby" matching (never blocks signup).
    UI.$('btnBecomeDonor').addEventListener('click', () => {
      myPos = null;
      UI.getPosition().then(p => { myPos = p; });
    });
    UI.$('btnTrustSignup').addEventListener('click', () => {
      myPos = null;
      UI.getPosition().then(p => { myPos = p; });
    });
  }

  function buildMyGroupChips() {
    const el = UI.$('myGroups');
    el.innerHTML = '';
    BloodData.GROUPS.forEach(g => {
      const c = document.createElement('div');
      c.className = 'gchip';
      c.textContent = g;
      c.setAttribute('role', 'button');
      c.setAttribute('tabindex', '0');
      c.dataset.action = 'pick-my-group';
      c.dataset.group = g;
      el.appendChild(c);
    });
    UI.registerAction('pick-my-group', (id, chip) => {
      el.querySelectorAll('.gchip').forEach(x => x.classList.remove('sel'));
      chip.classList.add('sel');
      myGroup = chip.dataset.group;
    });
  }

  function startSignup() {
    if (Store.getMyDonor()) { UI.go('dash'); return; }
    stopInbox();
    showStep(1);
    UI.go('signup');
  }

  function showStep(n) {
    [1, 2, 3].forEach(i => {
      UI.$('su-step' + i).style.display = i === n ? 'block' : 'none';
      UI.$('sd' + i).classList.toggle('on', i <= n);
    });
  }

  /* ---------- OTP ---------- */
  function startResendCooldown() {
    const btn = UI.$('btnResendOtp');
    let left = AppConfig.otp.resendCooldownSec;
    btn.disabled = true;
    clearInterval(resendTimer);
    const tick = () => {
      if (left <= 0) { btn.disabled = false; btn.textContent = 'Resend OTP'; clearInterval(resendTimer); return; }
      btn.textContent = `Resend OTP (${left}s)`;
      left -= 1;
    };
    tick();
    resendTimer = setInterval(tick, 1000);
  }

  async function sendOtp() {
    const name = UI.$('su-name').value.trim();
    const phoneRaw = UI.$('su-phone').value;
    const city = UI.$('su-city').value.trim();

    if (!Security.isValidName(name)) return UI.toast('Please enter your name.');
    if (!Security.isValidPhone(phoneRaw)) return UI.toast('Please enter a valid 10-digit mobile number.');
    if (!Security.isValidShortText(city, 2, 60)) return UI.toast('Please enter your city.');

    const phone = Security.normalizePhone(phoneRaw);
    const rl = Security.checkRateLimit('otp_' + phone, AppConfig.otp.maxAttemptsPerHour);
    if (!rl.allowed) return UI.toast('Too many OTP requests. Please try again later.');

    const e164 = Security.toE164(phone);
    const provider = Otp.getProvider();
    UI.$('btnSendOtp').disabled = true;
    try {
      const res = await provider.send(e164);
      UI.$('otpSentTo').textContent = `Sent to +91 ${phone} (${provider.isDemo ? 'demo — shown below' : 'check your SMS'})`;
      const wrap = UI.$('demoOtpWrap');
      if (provider.isDemo) {
        wrap.classList.remove('hidden');
        UI.$('demoOtpCode').textContent = res.demoCode;
      } else {
        wrap.classList.add('hidden');
      }
      showStep(2);
      startResendCooldown();
      UI.toast(provider.isDemo ? '📱 OTP sent (demo)' : '📱 OTP sent via SMS');
    } catch (err) {
      UI.toast(err.message || 'Could not send OTP. Please try again.');
    } finally {
      UI.$('btnSendOtp').disabled = false;
    }
  }

  async function verifyOtp() {
    const code = UI.$('su-otp').value.trim();
    if (code.length !== AppConfig.otp.codeLength) return UI.toast('Please enter the 6-digit OTP.');
    const provider = Otp.getProvider();
    try {
      const res = await provider.verify(code);
      if (!res.ok) return UI.toast(res.error || 'Wrong OTP.');
      try {
        sessionStorage.setItem('rakd_otp_session', JSON.stringify({
          phone: Security.normalizePhone(UI.$('su-phone').value),
          at: Date.now()
        }));
      } catch (e) {}
      showStep(3);
      UI.toast('✅ Number verified');
    } catch (err) {
      UI.toast(err.message || 'Verification failed.');
    }
  }

  function otpSessionValid() {
    try {
      const s = JSON.parse(sessionStorage.getItem('rakd_otp_session') || 'null');
      if (!s) return false;
      return Date.now() - s.at < AppConfig.otp.sessionTtlMin * 60_000;
    } catch (e) { return false; }
  }

  /* ---------- finish signup ---------- */
  async function finishSignup() {
    if (!otpSessionValid()) {
      showStep(2);
      return UI.toast('Session expired — please verify your number again.');
    }
    if (!myGroup) return UI.toast('Please select your blood group.');
    if (!UI.$('su-age').checked) return UI.toast('Please confirm you meet basic eligibility (18+, 50kg+).');

    const file = UI.$('su-proof').files[0];
    const fv = Security.isValidFile(file);
    if (!fv.ok) return UI.toast(fv.error);

    const lastDon = UI.$('su-lastdon').value;
    if (lastDon && new Date(lastDon) > new Date()) return UI.toast('Last donation date cannot be in the future.');

    const profile = {
      name: UI.$('su-name').value.trim().slice(0, 60),
      phone: Security.normalizePhone(UI.$('su-phone').value),
      city: UI.$('su-city').value.trim().slice(0, 60),
      group: myGroup,
      badge: file ? 'proof' : 'registered',
      proofName: file ? file.name.slice(0, 80) : null,
      donations: 0,
      lastDonation: lastDon ? new Date(lastDon).toISOString() : null,
      available: true,
      lat: myPos?.lat ?? null, lng: myPos?.lng ?? null,
      history: [], inbox: []
    };
    Store.setMyDonor(profile);

    const backend = Backend.get();
    if (!backend.isDemo) {
      try {
        UI.toast('☁️ Syncing your profile…');
        await backend.upsertMyDonor(profile);
      } catch (err) {
        UI.toast('Sync failed (saved on this device): ' + err.message);
      }
    }

    UI.go('dash');
    UI.renderHome();
    UI.toast(file ? '🎉 Welcome! You earned the 🟠 badge' : '🎉 Welcome aboard, donor!');
    subscribeInbox();

    // Demo: simulate an incoming emergency request shortly after signup.
    if (backend.isDemo) {
      setTimeout(() => {
        const me = Store.getMyDonor();
        if (!me || !Store.isEligible(me)) return;
        const needable = BloodData.COMPAT[me.group];
        const need = needable[Math.floor(Math.random() * needable.length)];
        me.inbox.unshift({
          id: 'in' + Date.now(), needGroup: need, units: 2,
          hospital: 'District Hospital, Sehore', patient: 'Emergency patient',
          phone: '9425011876', urgency: 'Urgent', status: 'pending',
          at: new Date().toISOString()
        });
        Store.setMyDonor(me);
        if (UI.$('s-dash').classList.contains('active')) renderDashboard();
        UI.toast('🚨 New emergency request near you!');
      }, 12000);
    }
  }

  /* ---------- dashboard ---------- */
  function stopInbox() {
    if (unsubInbox) { unsubInbox(); unsubInbox = null; }
  }

  function subscribeInbox() {
    stopInbox();
    const me = Store.getMyDonor();
    const backend = Backend.get();
    if (!me || backend.isDemo) return;
    unsubInbox = backend.onIncomingRequests(me.group, list => {
      if (UI.$('s-dash').classList.contains('active')) renderInboxFirebase(list);
      // Auto-upgrade: requester confirmed a donation I accepted → my device
      // records it (only I can write my own donor doc).
      list.forEach(async r => {
        const myResp = (r.responses || {})[backend.getUid()];
        if (r.status === 'fulfilled' && myResp && myResp.status === 'accepted' && !countedFulfilled.has(r.id)) {
          markCounted(r.id);
          try { await backend.recordMyDonation(); } catch (e) {}
          const m2 = Store.getMyDonor();
          if (m2) {
            m2.donations = (m2.donations || 0) + 1;
            m2.lastDonation = new Date().toISOString();
            m2.badge = 'verified';
            m2.history = m2.history || [];
            m2.history.unshift({ date: m2.lastDonation, hospital: r.hospital });
            Store.setMyDonor(m2);
          }
          if (UI.$('s-dash').classList.contains('active')) renderDashboard();
          UI.toast('❤️ A donation was confirmed — you are now 🟢 Verified!');
        }
      });
    });
  }

  function renderDashboard() {
    const d = Store.getMyDonor();
    if (!d) { UI.go('home'); return; }

    UI.$('dashAvatar').textContent = (d.name[0] || '?').toUpperCase();
    UI.$('dashName').textContent = d.name;
    UI.$('dashMeta').textContent = `${d.group} · ${d.city} · ${Security.maskPhone(d.phone)}`;
    UI.$('dashBadge').innerHTML = UI.badgePill(d.badge);

    const tgl = UI.$('availToggle');
    tgl.classList.toggle('on', d.available);
    tgl.setAttribute('aria-checked', d.available ? 'true' : 'false');
    UI.$('availLabel').textContent = d.available
      ? '✅ Available — you will receive emergency alerts'
      : '⏸️ Paused — you will not receive alerts';

    UI.$('dashDonations').textContent = d.donations || 0;
    const ne = Store.nextEligibleDate(d);
    UI.$('dashEligible').textContent = !ne || ne <= new Date() ? 'Now' : BloodData.fmtDate(ne);
    UI.$('dashLives').textContent = (d.donations || 0) * 3;

    const badges = [
      ['🩸', 'First Drop', (d.donations || 0) >= 1],
      ['❤️', 'Life Saver', (d.donations || 0) >= 3],
      ['🛡️', 'Guardian', (d.donations || 0) >= 5],
      ['🏅', 'Hero', (d.donations || 0) >= 10],
      ['✅', 'Verified Hero', d.badge === 'verified']
    ];
    UI.$('dashBadges').innerHTML = badges.map(b =>
      `<span class="badge ${b[2] ? 'b-verified' : 'b-registered'}"${b[2] ? '' : ' style="opacity:.55"'}>${b[0]} ${esc(b[1])}</span>`
    ).join('');

    if (Backend.get().isDemo) renderInboxDemo(d);
    else renderInboxFirebase(null); // async fill via subscription

    const hb = UI.$('dashHistory');
    hb.innerHTML = '';
    if (!d.history || !d.history.length) {
      hb.innerHTML = '<div class="card"><p class="muted" style="font-size:13.5px">No donations recorded yet. Your first donation earns the 🟢 Verified badge.</p></div>';
    } else {
      d.history.forEach(h => {
        const c = document.createElement('div');
        c.className = 'card';
        const info = document.createElement('div');
        info.className = 'donor';
        info.innerHTML = `<div class="avatar">🩸</div><div class="info"><b></b><div class="meta"></div></div><span class="badge b-verified">✓</span>`;
        info.querySelector('b').textContent = `Donated at ${h.hospital}`;
        info.querySelector('.meta').textContent = BloodData.fmtDate(h.date);
        c.appendChild(info);
        hb.appendChild(c);
      });
    }
    subscribeInbox();
  }

  /* ----- demo inbox (local simulated requests) ----- */
  function renderInboxDemo(d) {
    const ib = UI.$('dashInbox');
    ib.innerHTML = '';
    const ne = Store.nextEligibleDate(d);
    if (!Store.isEligible(d) && ne > new Date()) {
      const n = document.createElement('div');
      n.className = 'note';
      n.textContent = `⏳ You donated recently — eligible again on ${BloodData.fmtDate(ne)}. This 90-day rule is what keeps fake frequent donors out.`;
      ib.appendChild(n);
    }
    if (!d.inbox || !d.inbox.length) {
      if (!ib.children.length) {
        ib.innerHTML = `<div class="empty"><div class="big">📭</div><b>No requests right now.</b><br><span class="muted">We will alert you the moment someone nearby needs ${esc(d.group)}.</span></div>`;
      }
      return;
    }
    d.inbox.forEach(q => {
      const card = document.createElement('div');
      card.className = 'card alert-card';
      let action = '';
      if (q.status === 'pending' && Store.isEligible(d)) {
        action = `<div class="row2"><button class="btn btn-primary btn-sm" style="margin:0" data-action="inbox-accept" data-id="${esc(q.id)}">Accept ✅</button>` +
                 `<button class="btn btn-ghost btn-sm" style="margin:0" data-action="inbox-decline" data-id="${esc(q.id)}">Decline</button></div>`;
      } else if (q.status === 'accepted') {
        action = `<div class="phone-reveal">📞 Requester contact revealed:<br><b>${esc(Security.maskPhone(q.phone))}</b>` +
                 `<br><span class="muted" style="font-size:12.5px">${esc(q.patient)} · ${esc(q.hospital)}</span></div>` +
                 `<div style="height:10px"></div><button class="btn btn-dark btn-sm" data-action="inbox-done" data-id="${esc(q.id)}">Mark donation done ✓</button>`;
      } else if (q.status === 'declined') {
        action = '<p class="muted" style="font-size:13px">You declined this request.</p>';
      } else if (q.status === 'completed') {
        action = '<p style="font-size:13px;color:var(--green);font-weight:700">🏁 Donation completed — thank you, hero!</p>';
      }
      card.innerHTML = `<h3>🚨 ${q.units} unit${q.units !== 1 ? 's' : ''} of <span style="color:var(--red)">${esc(q.needGroup)}</span> needed</h3>` +
                       `<p class="muted">${esc(q.urgency)} · ${esc(q.hospital)}</p>${action}`;
      ib.appendChild(card);
    });
  }

  /* ----- firebase inbox (live requests from other devices) ----- */
  let lastFirebaseList = null;
  function renderInboxFirebase(list) {
    if (list) lastFirebaseList = list;
    list = list || lastFirebaseList || [];
    const d = Store.getMyDonor();
    const ib = UI.$('dashInbox');
    if (!d || !ib) return;
    ib.innerHTML = '';
    const backend = Backend.get();
    const uid = backend.getUid();
    const ne = Store.nextEligibleDate(d);
    if (!Store.isEligible(d) && ne > new Date()) {
      const n = document.createElement('div');
      n.className = 'note';
      n.textContent = `⏳ You donated recently — eligible again on ${BloodData.fmtDate(ne)}.`;
      ib.appendChild(n);
    }
    if (!list.length) {
      ib.innerHTML += `<div class="empty"><div class="big">📭</div><b>No requests right now.</b><br><span class="muted">Requests sent from any device appear here live.</span></div>`;
      return;
    }
    list.forEach(r => {
      const myResp = (r.responses || {})[uid];
      const myStatus = myResp ? myResp.status : 'pending';
      const card = document.createElement('div');
      card.className = 'card alert-card';
      let action = '';
      if (myStatus === 'pending' && Store.isEligible(d)) {
        action = `<div class="row2"><button class="btn btn-primary btn-sm" style="margin:0" data-action="inbox-accept" data-id="${esc(r.id)}">Accept ✅</button>` +
                 `<button class="btn btn-ghost btn-sm" style="margin:0" data-action="inbox-decline" data-id="${esc(r.id)}">Decline</button></div>`;
      } else if (myStatus === 'accepted') {
        action = `<div class="phone-reveal" data-reveal="req-phone" data-rid="${esc(r.id)}">📞 Fetching requester contact…</div>` +
                 `<div style="height:10px"></div><button class="btn btn-dark btn-sm" data-action="inbox-done" data-id="${esc(r.id)}">Mark donation done ✓</button>`;
      } else if (myStatus === 'declined') {
        action = '<p class="muted" style="font-size:13px">You declined this request.</p>';
      } else if (myStatus === 'completed' || r.status === 'fulfilled') {
        action = '<p style="font-size:13px;color:var(--green);font-weight:700">🏁 Completed — thank you, hero!</p>';
      }
      const when = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
      card.innerHTML = `<h3>🚨 ${r.units} unit${r.units !== 1 ? 's' : ''} of <span style="color:var(--red)">${esc(r.needGroup)}</span> needed</h3>` +
        `<p class="muted">${esc(r.urgency)} · ${esc(r.hospital)}${when ? ' · ' + esc(when) : ''}${r.note ? '<br>' + esc(r.note) : ''}</p>${action}`;
      ib.appendChild(card);
    });
    // async requester-contact reveal (allowed: donor accepted → sharedWith)
    ib.querySelectorAll('[data-reveal="req-phone"]').forEach(async slot => {
      try {
        const contact = await backend.getRequesterContact(slot.dataset.rid);
        slot.innerHTML = `📞 Requester contact revealed:<br><b>${esc(Security.maskPhone(contact?.phone || ''))}</b>`;
      } catch (e) {
        slot.innerHTML = `📞 Contact syncing… will appear shortly.`;
      }
    });
  }

  async function inboxAct(id, status) {
    const backend = Backend.get();
    if (backend.isDemo) {
      const me = Store.getMyDonor();
      if (!me) return;
      const q = (me.inbox || []).find(x => x.id === id);
      if (!q || q.status !== 'pending') return;
      q.status = status;
      Store.setMyDonor(me);
      renderDashboard();
      UI.toast(status === 'accepted' ? '✅ Accepted! Contact revealed below.' : 'Request declined.');
      return;
    }
    // firebase: write my response, then exchange contact visibility
    try {
      const req = (lastFirebaseList || []).find(r => r.id === id);
      await backend.respond(id, status);
      if (status === 'accepted' && req) {
        await backend.shareContacts(id, backend.getUid(), req.requesterUid);
      }
      UI.toast(status === 'accepted' ? '✅ Accepted! Requester notified.' : 'Request declined.');
    } catch (err) {
      UI.toast('Could not respond: ' + err.message);
    }
  }

  async function inboxDone(id) {
    const backend = Backend.get();
    if (backend.isDemo) {
      const me = Store.getMyDonor();
      if (!me) return;
      const q = (me.inbox || []).find(x => x.id === id);
      if (!q || q.status !== 'accepted') return;
      q.status = 'completed';
      me.donations = (me.donations || 0) + 1;
      me.lastDonation = new Date().toISOString();
      me.badge = 'verified';
      me.history = me.history || [];
      me.history.unshift({ date: me.lastDonation, hospital: q.hospital });
      Store.setMyDonor(me);
      renderDashboard();
      UI.renderHome();
      UI.toast('❤️ Amazing! You are now a 🟢 Verified donor.');
      return;
    }
    try {
      await backend.respond(id, 'completed');
      await backend.recordMyDonation();
      markCounted(id);
      const me = Store.getMyDonor();
      const req = (lastFirebaseList || []).find(r => r.id === id);
      if (me) {
        me.donations = (me.donations || 0) + 1;
        me.lastDonation = new Date().toISOString();
        me.badge = 'verified';
        me.history = me.history || [];
        me.history.unshift({ date: me.lastDonation, hospital: req?.hospital || '—' });
        Store.setMyDonor(me);
      }
      renderDashboard();
      UI.renderHome();
      UI.toast('❤️ Amazing! You are now a 🟢 Verified donor.');
    } catch (err) {
      UI.toast('Could not update: ' + err.message);
    }
  }

  return { init, startSignup, renderDashboard, stopInbox };
})();

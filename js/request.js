/* ============================================================
   Request — emergency blood-request flow:
   form -> matching donors -> send -> live tracking.

   Works in both modes:
     demo     : matches local seed donors, responses simulated.
     firebase : matches real registered donors, responses arrive
                live via Firestore subscriptions (cross-device).
   PRIVACY: phone numbers are never in public docs; revealed only
   after mutual acceptance (see firestore.rules).
   ============================================================ */
const Request = (() => {

  const esc = Security.escapeHtml;
  let needGroup = null;
  let units = 2;
  let urgency = 'Critical';
  let matches = [];        // donor objects for the current search
  let donorIndex = {};     // uid -> donor (for tracking render)
  let current = null;      // active request being tracked
  let unsubTracking = null;
  let myPos = null;        // {lat,lng} captured best-effort

  /* ---------- form ---------- */
  function buildGroupChips(containerId, onPick) {
    const el = UI.$(containerId);
    el.innerHTML = '';
    BloodData.GROUPS.forEach(g => {
      const c = document.createElement('div');
      c.className = 'gchip';
      c.textContent = g;
      c.setAttribute('role', 'button');
      c.setAttribute('tabindex', '0');
      c.dataset.action = 'pick-group';
      c.dataset.group = g;
      c.dataset.target = containerId;
      el.appendChild(c);
    });
    UI.registerAction('pick-group', (id, chip) => {
      const box = UI.$(chip.dataset.target);
      box.querySelectorAll('.gchip').forEach(x => x.classList.remove('sel'));
      chip.classList.add('sel');
      onPick(chip.dataset.group);
    });
  }

  function init() {
    buildGroupChips('needGroups', g => { needGroup = g; });
    UI.$('btnUnitsMinus').addEventListener('click', () => setUnits(-1));
    UI.$('btnUnitsPlus').addEventListener('click', () => setUnits(1));
    UI.$('btnFindDonors').addEventListener('click', findDonors);
    UI.$('sendReqBtn').addEventListener('click', sendRequest);

    UI.registerAction('pick-urgency', (id, chip) => {
      document.querySelectorAll('#urgRow .uchip').forEach(x => x.classList.remove('sel'));
      chip.classList.add('sel');
      urgency = chip.dataset.id;
    });
    UI.registerAction('report-donor', () => {
      UI.toast('Reported. Our team will review this profile.');
    });
    UI.registerAction('confirm-donation', donorUid => confirmDonation(donorUid));

    // Best-effort geolocation so "nearby" is real (never blocks the flow).
    UI.$('btnNeedBlood').addEventListener('click', () => {
      myPos = null;
      UI.getPosition().then(p => { myPos = p; });
    });
  }

  function setUnits(d) {
    units = Math.min(10, Math.max(1, units + d));
    UI.$('unitsVal').textContent = units;
  }

  function donorKey(d) { return d.uid || d.id; }

  function distOf(d) {
    if (d.dist != null) return d.dist; // demo seeds
    const km = Backend.distanceKm(myPos, d);
    return km != null ? km : null;
  }

  /* ---------- matching ---------- */
  async function findDonors() {
    const hospital = UI.$('f-hospital').value.trim();
    const patient = UI.$('f-patient').value.trim();
    const phone = UI.$('f-phone').value.trim();

    if (!needGroup) return UI.toast('Please select the blood group needed.');
    if (!Security.isValidShortText(hospital)) return UI.toast('Please enter a valid hospital name.');
    if (!Security.isValidName(patient)) return UI.toast('Please enter the patient name.');
    if (!Security.isValidPhone(phone)) return UI.toast('Please enter a valid 10-digit mobile number.');

    UI.toast('🔍 Finding donors…');
    let all;
    try {
      all = await Backend.get().listDonors();
    } catch (err) {
      return UI.toast('Could not reach the donor directory: ' + err.message);
    }

    const compatible = all.filter(d => BloodData.canDonateTo(d.group, needGroup));
    const skipped = compatible.filter(d => !(d.available && Store.isEligible(d))).length;

    const rank = { verified: 0, proof: 1, registered: 2 };
    matches = compatible
      .filter(d => d.available && Store.isEligible(d))
      .map(d => ({ ...d, _km: distOf(d) }))
      .sort((a, b) => (rank[a.badge] - rank[b.badge]) ||
        ((a._km == null ? 1e9 : a._km) - (b._km == null ? 1e9 : b._km)));

    donorIndex = {};
    matches.forEach(d => { donorIndex[donorKey(d)] = d; });

    current = {
      id: null, needGroup, units, urgency,
      hospital, patient, phone: Security.normalizePhone(phone),
      note: UI.$('f-note').value.trim().slice(0, 300),
      city: '', lat: myPos?.lat ?? null, lng: myPos?.lng ?? null,
      requesterUid: Backend.get().isDemo ? 'local' : Backend.get().getUid(),
      status: 'open', responses: {}, createdAt: new Date().toISOString()
    };

    UI.$('matchHead').textContent =
      `${matches.length} compatible donor${matches.length !== 1 ? 's' : ''} for ${needGroup}`;
    UI.$('matchSub').textContent =
      `${units} unit${units !== 1 ? 's' : ''} · ${urgency} · ${hospital} — verified first, then nearest.`;

    const list = UI.$('matchList');
    list.innerHTML = '';
    if (!matches.length) {
      const emptyMode = Backend.get().isDemo
        ? 'We will keep looking — try again in a while.'
        : 'No donors registered yet — be the first! Share the app to grow the network.';
      list.innerHTML = `<div class="empty"><div class="big">🔍</div><b>No eligible donors nearby right now.</b><br><span class="muted">${esc(emptyMode)}</span></div>`;
    }
    matches.forEach(d => {
      const km = d._km;
      const distTxt = km == null ? esc(d.city || 'nearby') : `📍 ${km.toFixed(1)} km away`;
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        `<div class="donor"><div class="avatar">${esc(d.name[0] || '?')}</div>` +
        `<div class="info"><b>${esc(d.name)}</b> <span style="font-weight:800;color:var(--red)">${esc(d.group)}</span>` +
        `<div class="meta">${distTxt} · 🩸 ${d.donations || 0} donations</div>` +
        `${UI.badgePill(d.badge)}</div></div>` +
        `<div style="text-align:right;margin-top:8px"><button class="report-link" data-action="report-donor">Report</button></div>`;
      list.appendChild(card);
    });

    const note = UI.$('eligNote');
    if (skipped > 0) {
      note.classList.remove('hidden');
      note.textContent = `ℹ️ ${skipped} nearby donor${skipped !== 1 ? 's were' : ' was'} skipped — donated within the last 90 days. This rule blocks fake frequent donors.`;
    } else note.classList.add('hidden');

    UI.$('sendReqBtn').disabled = !matches.length;
    UI.go('req-match');
  }

  /* ---------- send + live tracking ---------- */
  async function sendRequest() {
    if (!current || !matches.length) return;
    const backend = Backend.get();

    if (backend.isDemo) {
      current.id = await backend.createRequest(current);
      current.responses = {};
      matches.forEach(d => { current.responses[donorKey(d)] = { status: 'notified' }; });
      UI.go('req-track');
      renderTrack();
      UI.toast(`📢 Request sent to ${matches.length} donors`);
      backend.simulateResponses(matches, (donorUid, status) => {
        const r = current.responses[donorUid];
        if (!r || r.status !== 'notified') return;
        r.status = status;
        if (UI.$('s-req-track').classList.contains('active')) renderTrack();
        if (status === 'accepted') {
          const d = donorIndex[donorUid];
          UI.toast(`✅ ${d ? d.name : 'A donor'} accepted your request!`);
        }
      });
      return;
    }

    // ---- firebase: real request, real-time tracking ----
    try {
      UI.toast('📢 Sending request…');
      const rid = await backend.createRequest(current);
      current.id = rid;
      if (unsubTracking) unsubTracking();
      unsubTracking = backend.onRequest(rid, snap => {
        current = { ...current, ...snap, responses: snap.responses || {} };
        if (UI.$('s-req-track').classList.contains('active')) renderTrack();
        const acc = Object.entries(current.responses)
          .filter(([, r]) => r.status === 'accepted' || r.status === 'completed');
        if (acc.length && !current._announced) {
          current._announced = true;
          const d = donorIndex[acc[0][0]];
          UI.toast(`✅ ${d ? d.name : 'A donor'} accepted your request!`);
        }
      });
      UI.go('req-track');
      renderTrack();
    } catch (err) {
      UI.toast('Send failed: ' + err.message);
    }
  }

  const STATUS_PILL = {
    notified: '<span class="badge b-registered">🔔 Notified</span>',
    accepted: '<span class="badge b-verified">✅ Accepted</span>',
    declined: '<span class="badge" style="background:#fdeaea;color:#b3261e">✖ Declined</span>',
    completed: '<span class="badge b-verified">🏁 Completed</span>'
  };

  function statusOf(r, uid) {
    const resp = (r.responses || {})[uid];
    return resp ? resp.status : 'notified';
  }

  function renderTrack() {
    const r = current;
    if (!r) return;
    const backend = Backend.get();
    UI.$('trkSub').textContent =
      `${r.units} unit${r.units !== 1 ? 's' : ''} of ${r.needGroup} · ${r.urgency} · ${r.hospital} · Patient: ${r.patient}`;
    const entries = Object.entries(r.responses || {});
    const accepted = entries.filter(([, x]) => x.status === 'accepted' || x.status === 'completed').length;
    const done = r.status === 'fulfilled' || entries.some(([, x]) => x.status === 'completed');
    UI.$('trkProg').style.width = done ? '100%' : accepted ? '70%' : '40%';

    const steps = [
      { t: 'Request sent', s: `${entries.length} compatible donors alerted`, st: 'done' },
      { t: 'Donors notified', s: backend.isDemo ? 'Waiting for responses…' : 'Syncing live across devices…', st: 'done' },
      { t: accepted ? 'Donor accepted' : 'Waiting for acceptance',
        s: accepted ? 'Contact revealed below' : 'Donors see your request (not your number)', st: accepted ? 'done' : 'now' },
      { t: done ? 'Donation completed' : 'Donation pending',
        s: done ? 'Thank you for confirming ❤️' : 'Confirm once blood is donated', st: done ? 'done' : '' }
    ];
    UI.$('trkTimeline').innerHTML = steps.map(s =>
      `<div class="tstep ${s.st}"><div class="tdot">${s.st === 'done' ? '✓' : s.st === 'now' ? '…' : '·'}</div>` +
      `<div class="tt"><b>${esc(s.t)}</b><span>${esc(s.s)}</span></div></div>`
    ).join('');

    const box = UI.$('trkAlerts');
    box.innerHTML = '';
    entries.forEach(([uid, resp]) => {
      const d = donorIndex[uid];
      if (!d) return;
      const card = document.createElement('div');
      card.className = 'card';
      const km = d._km;
      const distTxt = km == null ? esc(d.city || 'nearby') : `${km.toFixed(1)} km`;
      // data-reveal="phone" slots get filled async in firebase mode
      const phoneSlot = resp.status === 'accepted'
        ? `<div class="phone-reveal" data-reveal="phone" data-uid="${esc(uid)}">📞 Donor accepted — fetching contact…</div>`
        : '';
      const confirmBtn = resp.status === 'accepted'
        ? `<div style="height:10px"></div><button class="btn btn-dark btn-sm" data-action="confirm-donation" data-id="${esc(uid)}">Confirm donation completed ✓</button>`
        : '';
      card.innerHTML =
        `<div class="donor"><div class="avatar">${esc(d.name[0] || '?')}</div>` +
        `<div class="info"><b>${esc(d.name)}</b> <span style="font-weight:800;color:var(--red)">${esc(d.group)}</span>` +
        `<div class="meta">📍 ${distTxt} · 🩸 ${d.donations || 0} donations</div>` +
        `${UI.badgePill(d.badge)}</div><div>${STATUS_PILL[resp.status] || STATUS_PILL.notified}</div></div>` +
        phoneSlot + confirmBtn;
      box.appendChild(card);
    });

    // Async contact reveal (firebase: read private contact doc — allowed after accept)
    if (!backend.isDemo) {
      box.querySelectorAll('[data-reveal="phone"]').forEach(async slot => {
        try {
          const contact = await backend.getDonorContact(slot.dataset.uid);
          const d = donorIndex[slot.dataset.uid] || {};
          slot.innerHTML = `📞 Donor accepted — contact revealed:<br><b>${esc(Security.maskPhone(contact?.phone || d.phone || ''))}</b>` +
            `<br><span class="muted" style="font-size:12.5px">Call now &amp; head to ${esc(r.hospital)}</span>`;
        } catch (e) {
          slot.innerHTML = `📞 Donor accepted — contact will appear once sync completes.`;
        }
      });
    } else {
      box.querySelectorAll('[data-reveal="phone"]').forEach(slot => {
        const d = donorIndex[slot.dataset.uid] || {};
        slot.innerHTML = `📞 Donor accepted — contact revealed:<br><b>${esc(Security.maskPhone(d.phone || ''))}</b>` +
          `<br><span class="muted" style="font-size:12.5px">Call now &amp; head to ${esc(r.hospital)}</span>`;
      });
    }
  }

  async function confirmDonation(donorUid) {
    if (!current) return;
    const backend = Backend.get();
    const resp = (current.responses || {})[donorUid];
    if (!resp || resp.status !== 'accepted') return;

    if (backend.isDemo) {
      resp.status = 'completed';
      const d = donorUid === 'me' ? Store.getMyDonor() : donorIndex[donorUid];
      Store.updateDonor(donorUid, {
        donations: ((d && d.donations) || 0) + 1,
        lastDonation: new Date().toISOString(),
        badge: 'verified'
      });
      if (donorUid === 'me') {
        const me = Store.getMyDonor();
        me.history = me.history || [];
        me.history.unshift({ date: new Date().toISOString(), hospital: current.hospital });
        Store.setMyDonor(me);
      }
      Store.bumpFulfilled();
      renderTrack();
      UI.renderHome();
      UI.toast('❤️ Donation confirmed! Donor is now 🟢 Verified.');
      return;
    }

    // firebase: requester marks fulfilled; the donor's own device upgrades
    // their badge/donations (only they have write access to their profile).
    try {
      await backend.markFulfilled(current.id);
      Store.bumpFulfilled();
      UI.renderHome();
      UI.toast('❤️ Marked fulfilled — thank you!');
    } catch (err) {
      UI.toast('Could not update: ' + err.message);
    }
  }

  function stopTracking() {
    if (unsubTracking) { unsubTracking(); unsubTracking = null; }
  }

  return { init, stopTracking };
})();

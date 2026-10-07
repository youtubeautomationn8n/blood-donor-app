/* ============================================================
   Request — emergency blood-request flow:
   form -> matching donors -> send -> live tracking.
   PRIVACY: requester phone is never shown to donors until a
   donor accepts; donor phones are never shown until accepted.
   ============================================================ */
const Request = (() => {

  const esc = Security.escapeHtml;
  let needGroup = null;
  let units = 2;
  let urgency = 'Critical';
  let matches = [];
  let current = null; // active request being tracked

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
    UI.registerAction('confirm-donation', donorId => confirmDonation(donorId));
  }

  function setUnits(d) {
    units = Math.min(10, Math.max(1, units + d));
    UI.$('unitsVal').textContent = units;
  }

  /* ---------- matching ---------- */
  function findDonors() {
    const hospital = UI.$('f-hospital').value.trim();
    const patient = UI.$('f-patient').value.trim();
    const phone = UI.$('f-phone').value.trim();

    if (!needGroup) return UI.toast('Please select the blood group needed.');
    if (!Security.isValidShortText(hospital)) return UI.toast('Please enter a valid hospital name.');
    if (!Security.isValidName(patient)) return UI.toast('Please enter the patient name.');
    if (!Security.isValidPhone(phone)) return UI.toast('Please enter a valid 10-digit mobile number.');

    const compatible = Store.allDonors().filter(d => BloodData.canDonateTo(d.group, needGroup));
    const skipped = compatible.filter(d => !(d.available && Store.isEligible(d))).length;

    const rank = { verified: 0, proof: 1, registered: 2 };
    matches = compatible
      .filter(d => d.available && Store.isEligible(d))
      .sort((a, b) => (rank[a.badge] - rank[b.badge]) || (a.dist - b.dist));

    current = {
      id: 'r' + Date.now(), needGroup, units, urgency,
      hospital, patient, phone: Security.normalizePhone(phone),
      note: UI.$('f-note').value.trim().slice(0, 300),
      createdAt: new Date().toISOString(),
      alerts: []
    };

    UI.$('matchHead').textContent =
      `${matches.length} compatible donor${matches.length !== 1 ? 's' : ''} for ${needGroup}`;
    UI.$('matchSub').textContent =
      `${units} unit${units !== 1 ? 's' : ''} · ${urgency} · ${hospital} — verified first, then nearest.`;

    const list = UI.$('matchList');
    list.innerHTML = '';
    if (!matches.length) {
      list.innerHTML = '<div class="empty"><div class="big">🔍</div><b>No eligible donors nearby right now.</b><br><span class="muted">We will keep looking — try again in a while.</span></div>';
    }
    matches.forEach(d => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        `<div class="donor"><div class="avatar">${esc(d.name[0] || '?')}</div>` +
        `<div class="info"><b>${esc(d.name)}</b> <span style="font-weight:800;color:var(--red)">${esc(d.group)}</span>` +
        `<div class="meta">📍 ${d.dist.toFixed(1)} km away · 🩸 ${d.donations || 0} donations</div>` +
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
  function sendRequest() {
    if (!current || !matches.length) return;
    current.alerts = matches.map(d => ({ donorId: d.id, status: 'notified' }));
    UI.go('req-track');
    renderTrack();
    UI.toast(`📢 Request sent to ${matches.length} donors`);

    // Demo: simulate live donor responses arriving over time.
    const shuffled = [...matches.map(d => d.id)].sort(() => Math.random() - 0.5);
    const accepters = shuffled.slice(0, Math.min(2, shuffled.length));
    const decliner = shuffled.length > 2 ? shuffled[2] : null;
    accepters.forEach((id, i) => setTimeout(() => setAlert(id, 'accepted'), 6000 + i * 6000));
    if (decliner) setTimeout(() => setAlert(decliner, 'declined'), 9000);
  }

  function setAlert(donorId, status) {
    if (!current) return;
    const a = current.alerts.find(x => x.donorId === donorId);
    if (!a || a.status !== 'notified') return;
    a.status = status;
    if (UI.$('s-req-track').classList.contains('active')) renderTrack();
    if (status === 'accepted') {
      const d = Store.getDonor(donorId);
      UI.toast(`✅ ${d ? d.name : 'A donor'} accepted your request!`);
    }
  }

  const STATUS_PILL = {
    notified: '<span class="badge b-registered">🔔 Notified</span>',
    accepted: '<span class="badge b-verified">✅ Accepted</span>',
    declined: '<span class="badge" style="background:#fdeaea;color:#b3261e">✖ Declined</span>',
    completed: '<span class="badge b-verified">🏁 Completed</span>'
  };

  function renderTrack() {
    const r = current;
    if (!r) return;
    UI.$('trkSub').textContent =
      `${r.units} unit${r.units !== 1 ? 's' : ''} of ${r.needGroup} · ${r.urgency} · ${r.hospital} · Patient: ${r.patient}`;
    const accepted = r.alerts.filter(a => a.status === 'accepted' || a.status === 'completed').length;
    const done = r.alerts.some(a => a.status === 'completed');
    UI.$('trkProg').style.width = done ? '100%' : accepted ? '70%' : '40%';

    const steps = [
      { t: 'Request sent', s: `${r.alerts.length} compatible donors alerted`, st: 'done' },
      { t: 'Donors notified', s: 'Waiting for responses…', st: 'done' },
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
    r.alerts.forEach(a => {
      const d = Store.getDonor(a.donorId);
      if (!d) return;
      const card = document.createElement('div');
      card.className = 'card';
      let extra = '';
      if (a.status === 'accepted') {
        // Contact revealed ONLY after acceptance (privacy by design).
        extra =
          `<div class="phone-reveal">📞 Donor accepted — contact revealed:<br><b>${esc(Security.maskPhone(d.phone))}</b>` +
          `<br><span class="muted" style="font-size:12.5px">Call now &amp; head to ${esc(r.hospital)}</span></div>` +
          `<div style="height:10px"></div>` +
          `<button class="btn btn-dark btn-sm" data-action="confirm-donation" data-id="${esc(a.donorId)}">Confirm donation completed ✓</button>`;
      }
      card.innerHTML =
        `<div class="donor"><div class="avatar">${esc(d.name[0] || '?')}</div>` +
        `<div class="info"><b>${esc(d.name)}</b> <span style="font-weight:800;color:var(--red)">${esc(d.group)}</span>` +
        `<div class="meta">📍 ${d.dist.toFixed(1)} km · 🩸 ${d.donations || 0} donations</div>` +
        `${UI.badgePill(d.badge)}</div><div>${STATUS_PILL[a.status]}</div></div>${extra}`;
      box.appendChild(card);
    });
  }

  function confirmDonation(donorId) {
    if (!current) return;
    const a = current.alerts.find(x => x.donorId === donorId);
    if (!a || a.status !== 'accepted') return;
    a.status = 'completed';
    Store.updateDonor(donorId, {
      donations: (Store.getDonor(donorId).donations || 0) + 1,
      lastDonation: new Date().toISOString(),
      badge: 'verified' // proof through action: the strongest verification
    });
    if (donorId === 'me') {
      const me = Store.getMyDonor();
      me.history = me.history || [];
      me.history.unshift({ date: new Date().toISOString(), hospital: current.hospital });
      Store.setMyDonor(me);
    }
    Store.bumpFulfilled();
    renderTrack();
    UI.renderHome();
    UI.toast('❤️ Donation confirmed! Donor is now 🟢 Verified.');
  }

  return { init };
})();

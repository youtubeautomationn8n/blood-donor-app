/* ============================================================
   Backend — data layer with two implementations:

     'demo'     : everything stays in THIS browser (localStorage).
                  Requests are simulated — perfect for trying the UI,
                  but nothing leaves the device.
     'firebase' : real-time sync via Cloud Firestore (Spark plan =
                  free, no billing needed: 50K reads/day, 20K writes/day).
                  Requests, donors and responses sync across ALL
                  devices instantly.

   Switch with ONE line in js/config.js:  backend: 'demo' | 'firebase'

   Firestore data model:
     donors/{uid}                  public profile (no phone number)
     donors/{uid}/private/contact  { ownerUid, phone, sharedWith[] }
     requests/{rid}                public request + responses map
     requests/{rid}/private/contact { ownerUid, phone, sharedWith[] }
   Phone numbers are NEVER in public docs — see firestore.rules.
   ============================================================ */
const Backend = (() => {

  let active = null;

  /* ---------- shared Firebase SDK bootstrap ---------- */
  let sdkReady = false;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load Firebase SDK: ' + src));
      document.head.appendChild(s);
    });
  }

  async function ensureFirebase(withFirestore) {
    if (!sdkReady) {
      await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
      await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js');
      if (withFirestore)
        await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js');
      sdkReady = true;
    }
    const cfg = AppConfig.firebase;
    if (!cfg.apiKey || String(cfg.apiKey).startsWith('PASTE_'))
      throw new Error('Firebase config missing — paste your keys into js/config.js (see README).');
    if (!window.firebase.apps.length) window.firebase.initializeApp(cfg);
    return window.firebase;
  }

  /* ---------- geo helper ---------- */
  function distanceKm(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const R = 6371, rad = d => d * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
              Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ============================================================
     DemoBackend — local-only (current prototype behavior)
     ============================================================ */
  const DemoBackend = {
    name: 'demo',
    isDemo: true,
    async init() {},
    async listDonors() { return Store.allDonors(); },
    async upsertMyDonor() { /* Store already holds it */ },
    async createRequest(req) { req.id = 'r' + Date.now(); return req.id; },

    /* Simulated donor responses so the demo feels alive. */
    simulateResponses(matches, onEvent) {
      const shuffled = [...matches.map(d => d.uid || d.id)].sort(() => Math.random() - 0.5);
      const accepters = shuffled.slice(0, Math.min(2, shuffled.length));
      const decliner = shuffled.length > 2 ? shuffled[2] : null;
      accepters.forEach((id, i) => setTimeout(() => onEvent(id, 'accepted'), 6000 + i * 6000));
      if (decliner) setTimeout(() => onEvent(decliner, 'declined'), 9000);
    }
  };

  /* ============================================================
     FirebaseBackend — real-time Firestore sync
     ============================================================ */
  const FirebaseBackend = {
    name: 'firebase',
    isDemo: false,
    db: null,
    uid: null,

    async init() {
      const fb = await ensureFirebase(true);
      const auth = fb.auth();
      if (!auth.currentUser) {
        // Anonymous auth for the trial — free, no billing. When phone OTP
        // is enabled later, sign in with phone from the start instead,
        // otherwise the donor profile stays tied to the anonymous uid.
        await auth.signInAnonymously();
      }
      this.uid = auth.currentUser.uid;
      this.db = fb.firestore();
    },

    getUid() { return this.uid; },

    async upsertMyDonor(p) {
      const uid = this.uid;
      const fv = window.firebase.firestore.FieldValue;
      await this.db.collection('donors').doc(uid).set({
        name: p.name, group: p.group, city: p.city, badge: p.badge,
        donations: p.donations || 0, available: p.available !== false,
        lastDonation: p.lastDonation || null,
        lat: p.lat ?? null, lng: p.lng ?? null,
        updatedAt: fv.serverTimestamp(), createdAt: fv.serverTimestamp()
      }, { merge: true });
      await this.db.collection('donors').doc(uid)
        .collection('private').doc('contact')
        .set({ ownerUid: uid, phone: p.phone, sharedWith: [] }, { merge: true });
    },

    async listDonors() {
      const snap = await this.db.collection('donors').where('available', '==', true).get();
      return snap.docs
        .map(d => ({ uid: d.id, id: d.id, ...d.data() }))
        .filter(d => d.uid !== this.uid); // never match yourself
    },

    async createRequest(r) {
      const fv = window.firebase.firestore.FieldValue;
      const ref = await this.db.collection('requests').add({
        needGroup: r.needGroup, units: r.units, urgency: r.urgency,
        hospital: r.hospital, patient: r.patient, note: r.note || '',
        city: r.city || '', lat: r.lat ?? null, lng: r.lng ?? null,
        requesterUid: this.uid, status: 'open', responses: {},
        createdAt: fv.serverTimestamp()
      });
      await ref.collection('private').doc('contact').set({
        ownerUid: this.uid, phone: r.phone, sharedWith: []
      });
      return ref.id;
    },

    /* Live subscription: fires on every change to the request. */
    onRequest(rid, cb) {
      return this.db.collection('requests').doc(rid).onSnapshot(
        s => { if (s.exists) cb({ id: s.id, ...s.data() }); },
        err => UI.toast('Sync error: ' + err.message)
      );
    },

    /* Live subscription: open requests this donor's group can fulfill. */
    onIncomingRequests(myGroup, cb) {
      const needable = BloodData.COMPAT[myGroup] || [];
      if (!needable.length) return () => {};
      return this.db.collection('requests')
        .where('status', '==', 'open')
        .where('needGroup', 'in', needable)
        .onSnapshot(
          snap => {
            const list = snap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(r => r.requesterUid !== this.uid)
              .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
            cb(list);
          },
          err => UI.toast('Sync error: ' + err.message)
        );
    },

    async respond(rid, status) {
      const fv = window.firebase.firestore.FieldValue;
      await this.db.collection('requests').doc(rid).update({
        [`responses.${this.uid}`]: { status, at: fv.serverTimestamp() }
      });
    },

    /* Exchange contact visibility after an accept (both directions). */
    async shareContacts(rid, donorUid, requesterUid) {
      const fv = window.firebase.firestore.FieldValue;
      await this.db.collection('donors').doc(donorUid)
        .collection('private').doc('contact')
        .update({ sharedWith: fv.arrayUnion(requesterUid) });
      // Rules allow an accepted donor to add themselves here:
      await this.db.collection('requests').doc(rid)
        .collection('private').doc('contact')
        .update({ sharedWith: fv.arrayUnion(donorUid) });
    },

    async getRequesterContact(rid) {
      const s = await this.db.collection('requests').doc(rid)
        .collection('private').doc('contact').get();
      return s.exists ? s.data() : null;
    },

    async getDonorContact(donorUid) {
      const s = await this.db.collection('donors').doc(donorUid)
        .collection('private').doc('contact').get();
      return s.exists ? s.data() : null;
    },

    async markFulfilled(rid) {
      await this.db.collection('requests').doc(rid).update({ status: 'fulfilled' });
    },

    async recordMyDonation() {
      const ref = this.db.collection('donors').doc(this.uid);
      const fv = window.firebase.firestore.FieldValue;
      const snap = await ref.get();
      const cur = snap.exists ? snap.data() : {};
      await ref.update({
        donations: (cur.donations || 0) + 1,
        lastDonation: new Date().toISOString(),
        badge: 'verified', // proof through action
        updatedAt: fv.serverTimestamp()
      });
    }
  };

  async function init() {
    const inst = AppConfig.backend === 'firebase' ? FirebaseBackend : DemoBackend;
    await inst.init(); // throws on misconfiguration — active stays unset
    active = inst;
    return active;
  }
  function get() {
    if (!active) throw new Error('Backend not initialized');
    return active;
  }

  return { init, get, ensureFirebase, distanceKm };
})();

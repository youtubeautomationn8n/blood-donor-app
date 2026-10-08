/* ============================================================
   Store — app state with localStorage persistence.
   SECURITY NOTE: this is device-local storage for the prototype.
   A production build must move donor/request data to a backend
   (e.g. Firestore with security rules) so it can't be tampered
   with from the browser console. See README.md.
   ============================================================ */
const Store = (() => {

  const KEYS = {
    donors: 'rakd_donors_v2',
    myDonor: 'rakd_myDonor_v2',
    fulfilled: 'rakd_fulfilled_v2'
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback; // corrupted entry -> fall back safely
    }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { /* storage full / private mode — app still works in-memory */ }
  }

  // Donor directory (seeded demo data on first run)
  let donors = read(KEYS.donors, null);
  if (!donors) {
    donors = BloodData.seedDonors();
    write(KEYS.donors, donors);
  }

  let myDonor = read(KEYS.myDonor, null);
  let fulfilled = read(KEYS.fulfilled, 3);

  function saveDonors()   { write(KEYS.donors, donors); }
  function saveMe()       { write(KEYS.myDonor, myDonor); }

  function setMyDonor(d)  { myDonor = d; saveMe(); }
  function getMyDonor()   { return myDonor; }
  function clearMyDonor() {
    myDonor = null;
    try { localStorage.removeItem(KEYS.myDonor); } catch (e) {}
  }

  function updateDonor(id, patch) {
    if (id === 'me' && myDonor) { Object.assign(myDonor, patch); saveMe(); return myDonor; }
    const d = donors.find(x => x.id === id);
    if (d) { Object.assign(d, patch); saveDonors(); }
    return d;
  }

  function getDonor(id) {
    if (id === 'me') return myDonor ? { ...myDonor, id: 'me', dist: 0.3 } : null;
    return donors.find(d => d.id === id) || null;
  }

  function allDonors() {
    const list = [...donors];
    if (myDonor) list.push({ ...myDonor, id: 'me', dist: 0.3 });
    return list;
  }

  function bumpFulfilled() {
    fulfilled += 1;
    write(KEYS.fulfilled, fulfilled);
  }
  function getFulfilled() { return fulfilled; }
  function verifiedCount() {
    const seedV = (window.AppConfig && AppConfig.useSeedDonors)
      ? donors.filter(d => d.badge === 'verified').length : 0;
    return seedV +
      (myDonor && myDonor.badge === 'verified' ? 1 : 0);
  }
  function donorCount() {
    const seeds = (window.AppConfig && AppConfig.useSeedDonors) ? donors.length : 0;
    return seeds + (myDonor ? 1 : 0);
  }

  /* ---- eligibility: 90-day gap between whole-blood donations ----
     This is the rule that makes "fake frequent donors" impossible. */
  function nextEligibleDate(donor) {
    if (!donor || !donor.lastDonation) return null;
    const n = new Date(donor.lastDonation);
    n.setDate(n.getDate() + AppConfig.donationGapDays);
    return n;
  }
  function isEligible(donor) {
    const n = nextEligibleDate(donor);
    return !n || n <= new Date();
  }

  return {
    allDonors, getDonor, updateDonor,
    getMyDonor, setMyDonor, clearMyDonor,
    bumpFulfilled, getFulfilled, verifiedCount, donorCount,
    nextEligibleDate, isEligible
  };
})();

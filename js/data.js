/* ============================================================
   Data — blood-group compatibility, date helpers, demo seed data.
   ============================================================ */
const BloodData = (() => {

  const GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];

  // COMPAT[donorGroup] = list of recipient groups that donor can give to.
  const COMPAT = {
    'O-':  ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
    'O+':  ['O+', 'A+', 'B+', 'AB+'],
    'A-':  ['A-', 'A+', 'AB-', 'AB+'],
    'A+':  ['A+', 'AB+'],
    'B-':  ['B-', 'B+', 'AB-', 'AB+'],
    'B+':  ['B+', 'AB+'],
    'AB-': ['AB-', 'AB+'],
    'AB+': ['AB+']
  };

  const canDonateTo = (donorGroup, needGroup) =>
    (COMPAT[donorGroup] || []).includes(needGroup);

  const daysAgo = n => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
  };

  const fmtDate = iso => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
  };

  /* Demo seed donors around Ashta/Sehore (MP).
     NOTE: clearly fake data for the prototype. */
  function seedDonors() {
    return [
      { id: 'd1', name: 'Rahul Sharma', group: 'O+',  dist: 1.2, badge: 'verified',   donations: 6,  lastDonation: daysAgo(120), available: true,  phone: '+919826042103' },
      { id: 'd2', name: 'Priya Verma',  group: 'B+',  dist: 2.5, badge: 'proof',      donations: 2,  lastDonation: daysAgo(200), available: true,  phone: '+919425177834' },
      { id: 'd3', name: 'Amit Patel',   group: 'A-',  dist: 3.1, badge: 'verified',   donations: 9,  lastDonation: daysAgo(150), available: true,  phone: '+919893051267' },
      { id: 'd4', name: 'Sneha Gupta',  group: 'O-',  dist: 4.0, badge: 'registered', donations: 0,  lastDonation: null,         available: true,  phone: '+919754030981' },
      { id: 'd5', name: 'Vikram Singh', group: 'AB+', dist: 5.2, badge: 'proof',      donations: 3,  lastDonation: daysAgo(100), available: true,  phone: '+919630488452' },
      // donated 40 days ago -> correctly excluded from matching (90-day rule demo)
      { id: 'd6', name: 'Neha Joshi',   group: 'B-',  dist: 6.8, badge: 'verified',   donations: 5,  lastDonation: daysAgo(40),  available: true,  phone: '+919406612745' },
      { id: 'd7', name: 'Arjun Mehta',  group: 'A+',  dist: 8.3, badge: 'registered', donations: 1,  lastDonation: daysAgo(300), available: false, phone: '+919827066390' },
      { id: 'd8', name: 'Kavita Rao',   group: 'O+',  dist: 9.5, badge: 'verified',   donations: 12, lastDonation: daysAgo(200), available: true,  phone: '+919893290417' }
    ];
  }

  return { GROUPS, COMPAT, canDonateTo, daysAgo, fmtDate, seedDonors };
})();

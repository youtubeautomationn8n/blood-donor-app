/* ============================================================
   Security — input sanitization, validation & abuse protection.
   Rule: NEVER inject raw user input into the DOM. Everything
   user-controlled goes through Security.escapeHtml() first.
   ============================================================ */
const Security = (() => {

  const ESCAPE_MAP = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    "'": '&#39;', '`': '&#96;', '=': '&#61;', '/': '&#47;'
  };

  /** Escape a string for safe insertion into HTML. */
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"'`=\/]/g, ch => ESCAPE_MAP[ch]);
  }

  /** Keep only digits; return the last 10 (Indian mobile). */
  function normalizePhone(raw) {
    return String(raw ?? '').replace(/\D/g, '').slice(-10);
  }

  /** Indian mobile: 10 digits starting with 6-9. */
  function isValidPhone(raw) {
    return /^[6-9]\d{9}$/.test(normalizePhone(raw));
  }

  /** Format for display: +91 98XXX X2103 (masked middle digits). */
  function maskPhone(raw) {
    const d = normalizePhone(raw);
    if (d.length !== 10) return '••••••••••';
    return `+91 ${d.slice(0, 2)}XXX X${d.slice(6)}`;
  }

  /** Full E.164 for Firebase: +91XXXXXXXXXX */
  function toE164(raw) {
    const d = normalizePhone(raw);
    return d.length === 10 ? `+91${d}` : null;
  }

  /** Names: letters, spaces and a few punctuation marks, 2–60 chars. */
  function isValidName(raw) {
    const s = String(raw ?? '').trim();
    return s.length >= 2 && s.length <= 60 && /^[A-Za-z\u0900-\u097F .'-]+$/.test(s);
  }

  /** Generic short text (hospital, city): 2–80 chars, no control chars. */
  function isValidShortText(raw, min = 2, max = 80) {
    const s = String(raw ?? '').trim();
    // eslint-disable-next-line no-control-regex
    return s.length >= min && s.length <= max && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(s);
  }

  function isValidFile(file) {
    if (!file) return { ok: true }; // optional upload
    if (!AppConfig.proofUpload.allowedTypes.includes(file.type))
      return { ok: false, error: 'Only JPG, PNG, WebP or PDF files are allowed.' };
    if (file.size > AppConfig.proofUpload.maxBytes)
      return { ok: false, error: 'File must be smaller than 5 MB.' };
    return { ok: true };
  }

  /* ---- client-side rate limiting (abuse protection) ----
     Stored per key in localStorage: { count, windowStart }. */
  function _rlKey(key) { return `rakd_rl_${key}`; }
  function checkRateLimit(key, maxPerHour) {
    const now = Date.now();
    let rec = { count: 0, windowStart: now };
    try {
      const raw = localStorage.getItem(_rlKey(key));
      if (raw) rec = JSON.parse(raw);
    } catch (e) { /* corrupted entry -> reset */ }
    if (now - rec.windowStart > 3600_000) rec = { count: 0, windowStart: now };
    if (rec.count >= maxPerHour) return { allowed: false, retryAfterMs: 3600_000 - (now - rec.windowStart) };
    rec.count += 1;
    try { localStorage.setItem(_rlKey(key), JSON.stringify(rec)); } catch (e) {}
    return { allowed: true };
  }

  return {
    escapeHtml, normalizePhone, isValidPhone, maskPhone, toE164,
    isValidName, isValidShortText, isValidFile, checkRateLimit
  };
})();

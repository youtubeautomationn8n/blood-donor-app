/* ============================================================
   Otp — pluggable one-time-password providers.

   Interface every provider implements:
     send(phoneE164) -> Promise<void>   // deliver the code
     verify(code)    -> Promise<{ok:boolean, error?:string}>
     isDemo          -> boolean

   Switch providers with ONE line in js/config.js:
     otpProvider: 'demo' | 'firebase'
   ============================================================ */
const Otp = (() => {

  /* ---------- demo provider (no SMS, for testing) ---------- */
  const DemoOtpProvider = {
    isDemo: true,
    _code: null,
    async send(/* phoneE164 */) {
      const n = AppConfig.otp.codeLength;
      this._code = String(Math.floor(Math.pow(10, n - 1) + Math.random() * 9 * Math.pow(10, n - 1)));
      return { demoCode: this._code };
    },
    async verify(code) {
      if (String(code).trim() === this._code) return { ok: true };
      return { ok: false, error: 'Wrong OTP — check the demo code shown above.' };
    },
    get demoCode() { return this._code; }
  };

  /* ---------- Firebase provider (REAL SMS) ----------
     Setup: see README.md "Enabling real OTP".
     Uses invisible reCAPTCHA (bot protection) + Firebase Phone Auth. */
  const FirebaseOtpProvider = {
    isDemo: false,
    _confirmation: null,
    _recaptcha: null,

    async _ensureReady() {
      // Shared bootstrap (also used by the Firestore backend).
      await Backend.ensureFirebase(AppConfig.backend === 'firebase');
      if (!this._recaptcha) {
        this._recaptcha = new window.firebase.auth.RecaptchaVerifier(
          'recaptcha-container', { size: 'invisible' });
      }
    },

    async send(phoneE164) {
      try {
        await this._ensureReady();
        const auth = window.firebase.auth();
        this._confirmation = await auth.signInWithPhoneNumber(phoneE164, this._recaptcha);
      } catch (err) {
        throw new Error(mapFirebaseError(err));
      }
    },

    async verify(code) {
      try {
        if (!this._confirmation) return { ok: false, error: 'Please request an OTP first.' };
        const cred = await this._confirmation.confirm(String(code).trim());
        return { ok: true, uid: cred.user.uid };
      } catch (err) {
        return { ok: false, error: mapFirebaseError(err) };
      }
    }
  };

  /* Human-friendly messages for Firebase Auth errors. */
  function mapFirebaseError(err) {
    const map = {
      'auth/quota-exceeded': "Today's free SMS limit (10/day) is reached. Please try again tomorrow.",
      'auth/too-many-requests': 'Too many attempts from this device. Please wait a while and try again.',
      'auth/invalid-phone-number': 'This phone number looks invalid. Use a 10-digit Indian mobile number.',
      'auth/invalid-app-credential': 'App not authorized yet — add your domain under Firebase Console > Authentication > Settings > Authorized domains.',
      'auth/network-request-failed': 'Network error. Check your connection and try again.',
      'auth/invalid-verification-code': 'Wrong code — please try again.',
      'auth/code-expired': 'Code expired — please request a new one.',
      'auth/session-expired': 'Session expired — please request a new OTP.'
    };
    return (err && map[err.code]) || (err && err.message) || 'Verification failed. Please try again.';
  }

  function getProvider() {
    if (AppConfig.otpProvider === 'firebase') return FirebaseOtpProvider;
    return DemoOtpProvider;
  }

  return { getProvider, DemoOtpProvider, FirebaseOtpProvider };
})();

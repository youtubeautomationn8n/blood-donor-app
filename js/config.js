/* ============================================================
   AppConfig — central configuration for Raktdaan.
   Change ONE value here to switch OTP providers.
   ============================================================ */
const AppConfig = Object.freeze({

  appName: 'Raktdaan',

  /* ---- OTP provider: 'demo' | 'firebase' ----
     'demo'     : no SMS sent; the code is shown on-screen (for testing).
     'firebase' : real SMS via Firebase Phone Auth. Requires:
                  1) a Firebase project with Phone sign-in enabled,
                  2) the config values below filled in,
                  3) your domain added under Authentication > Settings >
                     Authorized domains in the Firebase console.
                  NOTE (verified Oct 2026): since Sep 2024 Firebase phone
                  auth requires the Blaze plan (billing account attached).
                  First 10 SMS/day are free; India SMS ≈ $0.01–0.06 each.
                  See README.md for a free alternative (SMS gateway +
                  free serverless backend). */
  otpProvider: 'demo',

  firebase: {
    apiKey:     'PASTE_YOUR_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId:  'YOUR_PROJECT_ID',
    appId:      'YOUR_APP_ID'
  },

  otp: {
    codeLength: 6,
    resendCooldownSec: 60,   // client-side cooldown between OTP sends
    maxAttemptsPerHour: 5,   // max OTP sends per phone number per hour
    sessionTtlMin: 10        // verified OTP session valid for 10 minutes
  },

  donationGapDays: 90,       // min days between whole-blood donations

  proofUpload: {
    maxBytes: 5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  }
});

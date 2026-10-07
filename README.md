# 🩸 Raktdaan — Verified Blood Donors Nearby

A mobile-first web app that connects emergency blood requests with **verified**
donors nearby. No fake profiles, no public phone numbers, no money involved.

## Project structure

```
blood-donor-app/
├── index.html            # markup only — zero inline JS (CSP-safe)
├── css/
│   └── styles.css        # full design system, mobile-first
├── firestore.rules        # Firestore security rules (phone privacy, anti-abuse)
├── js/
│   ├── config.js         # ONE place for all settings (OTP + backend switches)
│   ├── security.js       # XSS escaping, input validation, rate limiting
│   ├── data.js           # blood-group compatibility, seed demo data
│   ├── store.js          # local state + localStorage persistence
│   ├── ui.js             # router, toast, badges, delegated actions, geolocation
│   ├── backend.js        # pluggable data layer: demo (local) | firebase (live sync)
│   ├── otp.js            # pluggable OTP: demo + Firebase (real SMS)
│   ├── request.js        # emergency request → matching → live tracking
│   ├── donor.js          # donor signup + dashboard (live inbox in firebase mode)
│   └── main.js           # entry point, binds all static controls
└── README.md
```

## Run it

No build step. Serve the folder (or just open `index.html`):

```bash
cd blood-donor-app
python3 -m http.server 8000
# open http://localhost:8000
```

Deploy by uploading the folder to Vercel / GitHub Pages / Netlify as a static site.

## Enabling REAL-TIME SYNC (currently demo/local mode)

Out of the box the app runs on `DemoBackend` — everything stays in the
browser, requests are simulated. To make requests actually travel between
phones in real time:

1. In the **Firebase Console**, go to **Build → Firestore Database** →
   **Create database** → choose **production mode** (we supply strict rules)
   → pick the closest region (`asia-south1` for India).
2. Open the **Rules** tab, delete everything, paste the contents of
   `firestore.rules` from this repo, click **Publish**.
3. Paste your Firebase web config into `js/config.js` (same keys as for OTP).
4. Set `backend: 'firebase'` in `js/config.js`. Done — no other code changes.

This uses the **Spark (free) plan — no billing needed**: 50K reads/day and
20K writes/day, far more than a trial needs. Sign-in is anonymous for the
trial; when you enable phone OTP later, have users sign in with phone from
the start so their donor profile stays tied to the right account.

## Enabling REAL OTP (currently in demo mode)

Out of the box the app uses `DemoOtpProvider` — the code is shown on-screen,
no SMS is sent. To send real SMS OTPs:

### Option A — Firebase Phone Auth (works from pure frontend)

1. Go to [Firebase Console](https://console.firebase.google.com) → create a project.
2. **Build → Authentication → Sign-in method** → enable **Phone**.
3. **Build → Authentication → Settings → Authorized domains** → add your
   deployed domain (e.g. `your-app.vercel.app`).
4. **Project settings → Your apps → Web app** → copy the config values.
5. Paste them into `js/config.js` → `firebase: { apiKey, authDomain, projectId, appId }`.
6. Set `otpProvider: 'firebase'` in `js/config.js`. Done — no other code changes.

> ⚠️ **Cost reality (verified Oct 2026):** since Sep 2024, Firebase phone auth
> requires the **Blaze plan** (a billing account attached — card required,
> but you are NOT charged for the free quota). The first **10 SMS/day are
> free** (≈300/month — plenty for a trial); after that India SMS costs ≈
> **$0.01–$0.06 each**. Recommended: set a **billing alert at ₹100** in
> Google Cloud Console → Billing → Budgets so a runaway can never surprise
> you. For testing, add test numbers under Authentication → Phone → test
> numbers (they never consume quota or send real SMS).

### Option B — Indian SMS gateway + free serverless backend (free-first)

Firebase is easiest but not free. The free-first path:

1. Sign up at **Fast2SMS** (popular in India, has a simple OTP API) or
   **SMSGatewayHub** (advertises 1,000 free SMS credits for trial).
2. You **cannot** call these from browser JS — the API key would be exposed
   and anyone could drain your credits. Instead, put the key in a tiny
   backend: a **Cloudflare Worker** (free: 100k requests/day) or a
   **Vercel Serverless Function** that exposes one endpoint:
   `POST /api/send-otp { phone }` → generates code, stores its **hash**
   (never plaintext) for 5 minutes, sends via the gateway.
3. Add a third provider in `js/otp.js` (`SmsGatewayOtpProvider`) that calls
   your endpoint for `send()` and a `/api/verify-otp` endpoint for `verify()`.

This keeps the frontend static and free while the secrets stay server-side.

## Security model

What this codebase enforces **today** (client-side):

- **XSS protection** — every user-controlled string passes through
  `Security.escapeHtml()` before touching the DOM; `textContent` is
  preferred over `innerHTML` everywhere.
- **Input validation** — Indian mobile format (`^[6-9]\d{9}$`), name/text
  allow-lists, file type + 5 MB cap on proof uploads.
- **Content Security Policy** — only first-party scripts run (plus Firebase
  SDKs when enabled); no inline event handlers anywhere.
- **OTP abuse protection** — 60-second resend cooldown, max 5 OTPs per
  number per hour, 10-minute verified-session TTL gating signup completion.
- **Bot protection** — invisible reCAPTCHA via Firebase when real OTP is on.
- **Privacy by design** — phone numbers are masked in the UI and revealed
  only after mutual acceptance; full numbers never appear in lists.

What still needs a **backend** before real launch:

- Donor/request data currently lives in `localStorage` — a user can edit it
  in devtools. Move to Firestore (or any DB) with security rules.
- Proof-of-donation review needs a human or automated moderation queue.
- OTP attempt logging / IP rate limiting lives server-side.

## The 5-layer trust system

1. Phone OTP at signup (one person, one profile)
2. Donation-certificate upload → 🟠 badge
3. Completed donation confirmed by recipient → 🟢 Verified (unfakeable)
4. 90-day donation-gap rule auto-excludes impossible claims
5. Contact privacy — numbers revealed only on acceptance

## License

Free for community / non-commercial use. If you deploy it for your
city, please keep the "never pay for blood" notice — selling blood is
illegal in India.

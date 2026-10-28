# Dynamic Booking Calendar

Static site (Vite + vanilla JS) hosted on **GitHub Pages**, using **Firebase Authentication** and **Cloud Firestore**. Shows a rolling 42-day calendar starting today (Asia/Kuala_Lumpur), a booking table, multi-user live sync, admin approval of users, and booking history.

Repo: https://github.com/petworldcloud-code/Dynamic-Booking-Calendar
Site (after setup): https://petworldcloud-code.github.io/Dynamic-Booking-Calendar/

## Status
See [Test report](#test-report) for what has and has not been verified. Nothing here has been deployed or connected to a real Firebase project until you complete the setup below.

## Firebase setup
1. Firebase Console → **Add project**.
2. **Project settings → Your apps → Web app (`</>`)** → register; copy the config values.
3. **Build → Authentication → Sign-in method** → enable **Email/Password**.
4. **Authentication → Settings → Authorized domains** → add `petworldcloud-code.github.io`.
5. **Build → Firestore Database → Create database** (production mode; choose a nearby location, e.g. `asia-southeast1`).
6. Publish rules and indexes:
   ```bash
   npx firebase login
   npx firebase use --add        # pick your project (updates .firebaserc)
   npx firebase deploy --only firestore:rules,firestore:indexes
   ```
7. **First administrator (bootstrap):** register in the app and verify the email. Then in the Firebase Console → Firestore → `users` → your UID document, set `role` = `admin` and `status` = `active`. Nobody becomes admin automatically. Later admins can approve users from the **Users** panel in the app.

Accounts are created through registration. Deleting a Firebase Auth account is done in the Firebase Console (a client-only app cannot do it securely).

## GitHub setup
1. Push this folder to `main` of the repository above.
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**, add (values from step 2 above): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`. These are public identifiers, not secrets; Firestore rules protect the data.
4. Each push to `main` runs tests, builds and deploys. Deploying never touches Firestore data.

## Local development
```bash
npm install
cp .env.example .env     # fill in the Firebase values
npm run dev
npm test                 # date logic tests
npm run test:rules       # Firestore rules tests (needs Java for the emulator)
```
`VITE_DEMO_MODE=demo` runs the UI on an in-memory mock with sample data (layout checks only; clearly bannered, never used in the deployed build).

## How it behaves
- **Calendar**: 42 consecutive dates from today in Malaysia time; rows are Mon–Sun, so a mid-week start leaves blank leading cells (up to 7 rows). Prev/Next shifts by 42 days; Today restores the rolling view. At Malaysian midnight (and on tab focus/wake) the date is recomputed from the timezone.
- **Overflow**: 6 labels per day, then `+N more bookings` opening a day detail view. All records are kept.
- **Live sync**: one range `onSnapshot` for the calendar and one for the table. Success messages appear only after the server confirms the write (15 s timeout otherwise). Edits use a transaction that rejects stale versions (conflict message with a "Load latest version" link).
- **Roles**: admins manage everything; standard users edit/delete only their own bookings. Enforced in `firestore.rules`. Pending/suspended or unverified users cannot read bookings.
- **History**: the History tab lists bookings before today. Nothing is deleted when the calendar moves on.
- **Retention**: permanent deletion is off by default. Admin sets days (default 90) in **Retention**.

## Optional scheduled cleanup
Off unless the repo variable `CLEANUP_ENABLED=true`. Even then it is a dry run unless `CLEANUP_DELETE=true` **and** an admin ticks "Allow permanent deletion" in the app. It uses GitHub OIDC + Google Workload Identity Federation (no key files): create a service account with only `roles/datastore.user`, a workload identity pool restricted to this repo and `refs/heads/main`, then set variables `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT`. Test with dummy data first (`workflow_dispatch`, dry run). To disable: set `CLEANUP_ENABLED` to `false` or untick the setting in the app.

## Migration of existing workbook data
`Dynamic Calendar.xlsx` was not available when this was built. To import genuine bookings later, add them through the app (or ask for a one-off import script that only creates new documents and never overwrites).

## Cost
Firebase's free tier has quotas, not unlimited use. Reads are limited by range queries and a 50-row table page. Check usage in the Firebase Console.

## Test report
| Test | Status |
|---|---|
| H weekday accuracy (27 Oct 2026 = Tuesday), G daily refresh, range/leap-day/timezone arithmetic | **Passed** (`npm test`, 10 tests) |
| Production build (`vite build`) | **Passed** |
| L overflow, calendar layout, day detail, responsive stacking | **Checked manually** in the browser on the demo mock |
| R Firestore rules | Tests written (`tests/rules.test.js`) but **not run**: Java is not installed here, so the emulator can't start |
| A, B–F, I, J, K, M, N (real auth / Firestore / two users / persistence) | **Not run**: needs a real Firebase project |
| O cleanup safeguards | Code written, **not run** against Firestore |
| Q deployed GitHub Pages check | **Not done** until pushed and Pages enabled |

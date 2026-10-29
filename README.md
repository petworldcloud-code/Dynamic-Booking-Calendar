# Dynamic Booking Calendar (DIM Calendar Booking)

A shared, multi-company **lorry booking calendar**. Each company logs in, picks a date, the type of truck and how many lorries, and its company name appears on a rolling 31-day calendar that everyone can see. Admins manage companies and can book on their behalf.

- **Live site:** https://petworldcloud-code.github.io/Dynamic-Booking-Calendar/
- **Source code:** https://github.com/petworldcloud-code/Dynamic-Booking-Calendar (public repository)
- **Local folder (original developer's PC):** `D:\Rie\Claude\DIM Calendar Booking`

> This README is the handover document. If you are picking this project up from someone else, read sections 1-4 first, then use section 7 (day-to-day tasks) and section 10 (troubleshooting).

---

## 1. What it does (user view)

| Who | Can do |
|---|---|
| **Company (standard user)** | Log in with a username + password. Add a booking: pick **one date**, **type of truck**, **number of trucks (1-6)**, optional notes and up to 5 attachments. The company name is **fixed to their own** (not selectable). View every company's bookings on the calendar and table. Edit/delete **only their own** bookings. Change their own password. |
| **Administrator** | Everything above, plus: edit/delete **any** booking; book **on behalf of any company** (Company dropdown); open **Users** to add, rename, suspend and delete companies; open **Retention** to set the (off-by-default) auto-delete policy. |

Screen layout: header (today, calendar range, legend, user menu); **left** = booking table (search, sort, Upcoming / History tabs, Add Booking); **right** = 31-day calendar (Mon-Sun columns, Prev / Today / Next).

Key behaviours:
- **Calendar** = 31 consecutive days starting **today in Malaysia time (Asia/Kuala_Lumpur)**. It rolls forward automatically at Malaysian midnight. Prev/Next move by 31 days; **Today** returns to the live range. If the first day is mid-week, earlier cells in that row are blank.
- **One date per booking** (not a date range).
- Each day shows up to **6** company labels, then `+N more bookings`, which opens the day list. Nothing is hidden or dropped.
- **Click a company name** (calendar, table or day list) to open a pop-up with the date, truck type, number of lorries, notes and attachments. Edit/Delete buttons appear only if you own the booking or are an admin.
- **Live sync:** when anyone adds/changes a booking, everyone else sees it within seconds, no refresh.
- **Conflict protection:** if two people edit the same booking, the second save is refused with a "Load latest version" message instead of overwriting.
- **History** tab lists past bookings. Moving the calendar forward never deletes data.
- **Attachments:** pictures, PDF, Word/Excel, CSV/TXT. Max 5 per booking. Pictures are shrunk automatically in the browser; other files must be under **600 KB** each.

---

## 2. Technology stack (what we are using)

| Layer | Technology | Notes |
|---|---|---|
| Language | **JavaScript** (ES modules, no TypeScript), **HTML5**, **CSS3** | No framework: plain DOM code. |
| Build tool | **Vite 6** | Produces static files in `dist/`. |
| Backend / database | **Firebase** (Google): **Cloud Firestore** | Real-time database. No server of our own. |
| Login | **Firebase Authentication** (Email/Password) | We map a *username* to an email behind the scenes (see 5.2). |
| Hosting | **GitHub Pages** | Static site, HTTPS, deployed by GitHub Actions. |
| CI/CD | **GitHub Actions** | `.github/workflows/deploy.yml` builds + publishes on every push to `main`. |
| Tests | **Vitest** (date logic) + **@firebase/rules-unit-testing** (security rules) | See section 9. |
| Optional cleanup | Node script + **firebase-admin**, run by GitHub Actions | Off by default. Section 8. |

Runtime packages: `firebase@11`. Dev packages: `vite`, `vitest`, `@firebase/rules-unit-testing`, `firebase-admin`, `firebase-tools`.
Developed with **Node 26 / npm 11** locally; CI uses **Node 22**. Any Node 20+ works.

No PHP, no MySQL, no always-on server, no paid services.

---

## 3. Accounts and ownership (who owns what)

| Thing | Account / owner | Used for |
|---|---|---|
| **GitHub organisation** | `petworldcloud-code` | Owns the repository `Dynamic-Booking-Calendar` and GitHub Pages. |
| **GitHub user used to push code** | `Riekie3` (collaborator with write access) | `git push` / `gh` CLI from the developer's PC. |
| **Google account that owns Firebase** | `petworldcloud@gmail.com` | Owns Firebase project `dynamic-booking-calendar` (Spark / free plan). Sign in to https://console.firebase.google.com with this account (it may appear as `/u/2/` if several Google accounts are logged in). |
| **Firebase project** | ID `dynamic-booking-calendar`, number `356655258614`, web app "Dynamic Booking Calendar Web" | Auth + Firestore. Database location **asia-southeast1 (Singapore)** - cannot be changed. |
| **App administrator login** | username `dim` (internal auth email `it-support@wahkong.net`) | The first/only admin in the app. Password is **not** stored anywhere in this repo. |
| **Test company** | username `tefal` (`tefal@dim.com.my`) | Created during testing; delete or keep as needed. |

**No passwords, API secrets or service-account keys are in this repository.** The Firebase "web config" values are public identifiers (they identify the project, they do not grant access). Data is protected by Firestore security rules (section 6).

> If the people above are unavailable: whoever controls `petworldcloud@gmail.com` can add another Google account as an Owner under Firebase Console -> Project settings -> Users and permissions; whoever is an owner of the `petworldcloud-code` GitHub organisation can add collaborators. Do this **before** anyone leaves.

---

## 4. Architecture in one picture

```
Browser (static site on GitHub Pages)
   |  Firebase JS SDK (direct, HTTPS)
   +--> Firebase Authentication  (who are you?)
   +--> Cloud Firestore          (bookings, users, usernames, attachments, settings)
                ^
                | protected by firestore.rules (this is the real security)

GitHub push to main --> GitHub Actions --> npm ci, tests, vite build --> GitHub Pages
```

Deploying the website **never touches the database**. Data lives in Firestore only.

### Folder map

```
index.html                  Single page: all screens + dialogs
assets/css/styles.css       All styling (mauve/purple theme)
src/main.js                 UI logic: screens, table, dialogs, wiring
src/calendar.js             Renders the calendar grid
src/date-utils.js           Malaysia-time maths, 31-day range, midnight watcher
src/bookings.js             Firestore bookings + attachments (create/update/delete/listen)
src/attachments.js          File checks, picture shrinking, base64 helpers
src/auth.js                 Login (username), password change, admin creates users
src/users.js                User profiles, username mapping, edit/delete user
src/retention.js            Retention settings read/write
src/firebase.js             Firebase init from env vars (+ second auth instance)
src/api.js                  Facade the UI calls (real Firebase, or demo)
src/demo.js                 In-memory fake backend for layout checks (demo mode only)
firestore.rules             Security rules (source of truth in git)
firestore.indexes.json      Required Firestore index
firebase.json / .firebaserc Firebase CLI config (project = dynamic-booking-calendar)
scripts/cleanup.js          Optional old-booking cleanup
tests/                      date-utils.test.js, rules.test.js
.github/workflows/          deploy.yml, cleanup-expired-bookings.yml
vite.config.js              base path = /Dynamic-Booking-Calendar/ (GitHub Pages sub-path)
.env.example                Template for the Firebase web config
```

---

## 5. Data and login design

### 5.1 Firestore collections

| Collection | Document ID | Fields (summary) |
|---|---|---|
| `users` | Firebase Auth UID | `displayName` (= **company name**), `username`, `email` (auth email), `role` (`admin`/`user`), `status` (`active`/`pending`/`suspended`), `createdAt`, `updatedAt` |
| `usernames` | the username (lowercase) | `email` (the auth email to sign in with), `uid`. Readable **one document at a time by anyone** (needed before login); listing is blocked. |
| `bookings` | auto ID | `bookingDate` (`YYYY-MM-DD`), `eventName` (= **company name**), `truckType`, `truckCount` (1-6), `notes`, `attachments` (list of `{id,name,type,size}`), `createdBy`, `createdByName`, `createdAt`, `updatedBy`, `updatedByName`, `updatedAt` |
| `bookings/{id}/attachments` | random ID | `name`, `type`, `size`, `data` (base64 file), `createdBy`, `createdAt` |
| `settings` | `retention` | `autoDeleteEnabled` (false by default), `retentionDays`, `updatedAt`, `updatedBy` |

- Dates are stored as plain `YYYY-MM-DD` text, never as timestamps, so timezones cannot shift a booking.
- Truck types allowed: `40footer`, `20footer`, `10ton`, `5ton`, `3ton`, `1ton`.
- Attachments are in **Firestore, not Firebase Storage**, because Storage needs a paid (Blaze) plan. Each file is limited to ~600 KB (a Firestore document is limited to 1 MiB). If the project ever moves to the Blaze plan, Storage can replace this.

### 5.2 Username login (important to understand)

Firebase Authentication only signs in with an **email**. We want people to use a **username**, so:
1. When an admin adds a company, the **username = company name in lowercase, spaces become dots** (e.g. "Ali Tan" -> `ali.tan`; 3-30 chars: letters, numbers, `.` `_` `-`).
2. The app creates a Firebase login with a real email if the admin typed one, otherwise a made-up email `username@dim-calendar.local`.
3. It writes `usernames/<username> -> { email, uid }` and `users/<uid>`.
4. On the login screen the app looks up `usernames/<typed username>` to find the email, then signs in with email + password. (Typing a full email also works.)

Consequences:
- **Renaming a company does not change its username/login.**
- Accounts with the made-up `.local` email **cannot receive password-reset emails**. They change their own password with the **Password** button, or an admin deletes and re-creates the company.
- Two companies cannot share the same name (same username).

### 5.3 No self-registration

There is no sign-up screen and no email verification. **Only an admin creates accounts** (Users -> Add user). Someone who somehow creates a bare Firebase login through the public API still has no profile, so the rules give them no data.

---

## 6. Security model (Firestore rules)

The rules in `firestore.rules` are the real protection. Summary:
- Only an **active** user (profile status `active`) can read bookings, attachments and settings. Pending/suspended/profile-less users see nothing.
- A user can create a booking only with their own UID and **their own company name**; admins may set another company.
- Only the booking's creator or an admin can edit/delete it or its attachments. Creation info cannot be altered.
- Booking fields are validated (date format, truck type list, count 1-6, max 5 attachments, size limits).
- Only admins create/rename/delete users and write usernames/settings. Admins cannot delete themselves.
- Everything else is denied.

Rules are **version-controlled in git** but must also be **published to Firebase** (section 7.5). Changing the file in GitHub does **not** change the live rules.

---

## 7. Day-to-day tasks (runbook)

### 7.1 Log in
Open the live site, enter **username** (e.g. `dim`) and password. Admin = `dim`.

### 7.2 Add a company (admin)
Header -> **Users** -> "Add user": enter **Company name**, optional email (only if they should be able to reset their own password by email), **initial password** (min 6), role (Standard user / Administrator) -> **Create**. Give them the username and password. They can change it via **Password** in the header.

### 7.3 Rename / suspend / delete a company (admin)
Users panel -> **Edit** (rename; username stays), the **Status** dropdown (`suspended` blocks access; `active` restores), or **Delete** (removes profile + username so they can no longer use the app; their past bookings remain). To remove the underlying Firebase login completely: Firebase Console -> Authentication -> Users -> delete.

### 7.4 Forgotten password
- Company has a real email: login screen -> "Forgot password?".
- No email (made-up `.local` address): the app cannot reset it. Delete the company and add it again with a new password, or add the real email in Firebase Console (Authentication -> Users) and use "Forgot password".

### 7.5 Publish security rules after changing `firestore.rules`
Either:
- **CLI:** `npx firebase login` (as `petworldcloud@gmail.com`), then `npx firebase deploy --only firestore:rules,firestore:indexes`; or
- **Console:** Firebase Console -> Firestore -> **Rules** tab -> paste the file contents -> **Publish**. (This is how the current rules were published.)

### 7.6 Deploy a website change
Edit code -> commit -> `git push` to `main`. GitHub Actions (`Deploy to GitHub Pages`) runs tests, builds and publishes in about a minute. Check the Actions tab. Users may need a hard refresh (**Ctrl+Shift+R**). Data is untouched.

### 7.7 Create the very first admin on a brand-new Firebase project
1. Firebase Console -> Authentication -> Users -> **Add user** (email + password).
2. Firestore -> create `users/<that UID>` with `displayName`, `username`, `email`, `role: admin`, `status: active`, `createdAt`, `updatedAt` (timestamps).
3. Firestore -> create `usernames/<username>` with `email` and `uid`.
Nobody becomes admin automatically.

### 7.8 Moving to a new Firebase project
Create the project, register a web app, enable Email/Password, create Firestore (Singapore), publish rules + the index, add the authorized domain `petworldcloud-code.github.io`, update the six GitHub variables (below), re-do 7.7. Existing bookings do not migrate automatically.

---

## 8. Setup from scratch (installation)

### 8.1 Firebase (one-time; already done for this project)
1. https://console.firebase.google.com -> **Add project** (`dynamic-booking-calendar`, Analytics off).
2. Project settings -> **Your apps** -> **Web (`</>`)** -> register -> copy the config.
3. **Authentication** -> Get started -> enable **Email/Password**.
4. Authentication -> Settings -> **Authorized domains** -> add `petworldcloud-code.github.io`.
5. **Firestore Database** -> Create database -> **Standard edition**, location **asia-southeast1**, **production mode**.
6. Publish `firestore.rules` (7.5).
7. **Index** (needed or the calendar will not load): Firestore -> Indexes -> collection `bookings`, fields `bookingDate` Ascending + `createdAt` Ascending, scope Collection. (Or `firebase deploy --only firestore:indexes`.) Status must show **Enabled**.

### 8.2 GitHub (one-time; already done)
1. Repository `petworldcloud-code/Dynamic-Booking-Calendar`.
2. **Settings -> Pages -> Source: GitHub Actions**.
3. **Settings -> Secrets and variables -> Actions -> Variables** (not Secrets), add:
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
   (values are in Firebase -> Project settings -> Your apps -> SDK setup and configuration).
4. Push to `main`; the workflow deploys.

### 8.3 Local development on a PC
```bash
git clone https://github.com/petworldcloud-code/Dynamic-Booking-Calendar.git
cd Dynamic-Booking-Calendar
npm install
copy .env.example .env      # Windows (use cp on Mac/Linux); fill in the six Firebase values
npm run dev                 # http://localhost:5173
npm test                    # date logic tests
npm run build               # production build into dist/
```
`.env` is git-ignored. Local dev talks to the **real** Firebase project (same data as live) - be careful.

Notes for Windows: run npm from **PowerShell or CMD**. In Git Bash `npm run ...` sometimes fails to find tools; calling `node node_modules/vite/bin/vite.js` and `node node_modules/vitest/vitest.mjs run` directly works.

**Demo mode** (no Firebase, fake in-memory data, for layout checks only): set `VITE_DEMO_MODE=demo` before `npm run dev`. A yellow banner shows; nothing is saved. Never set this variable in GitHub.

### 8.4 Optional: scheduled cleanup of old bookings
`.github/workflows/cleanup-expired-bookings.yml` + `scripts/cleanup.js` can permanently delete bookings older than N days (and their attachments). It is **disabled** and **dry-run** by default and does nothing unless **all** are true: repo variable `CLEANUP_ENABLED=true`, repo variable `CLEANUP_DELETE=true`, and an admin ticked "Allow permanent deletion" in the app (Retention). It needs Google Cloud Workload Identity Federation (no key files): create a service account with only `roles/datastore.user`, a workload identity pool restricted to this repo and `main`, then set variables `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT`. **Not set up and not tested.** Default behaviour: keep all history forever.

---

## 9. Testing status (honest)

| Area | Status |
|---|---|
| Date logic (Malaysia time, 31-day range, weekday alignment, midnight roll, leap years) | **Automated, passing** (`npm test`, 10 tests; also runs in CI). |
| Production build and GitHub Pages deployment | **Working** (deployed and loading). |
| Layout, calendar, overflow, dropdowns, details pop-up | Checked in browser (demo data and live as admin). |
| Firestore rules tests (`tests/rules.test.js`) | **Written but never run**: they need the Firebase emulator, which needs **Java** (not installed on the dev PC). Run with `npm run test:rules` after installing Java 11+. Rules are published and in use; treat them as untested by automation. |
| Two-user live sync, standard-user permissions, attachments, edit/delete user, saving bookings on the live site | **Not yet verified end-to-end** by the developer. Test with the admin account plus the `tefal` account in two browser windows. |
| Scheduled cleanup | Code only; not run. |

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Page looks old after a deploy | Hard refresh (Ctrl+Shift+R). The browser cached the old build. |
| Login says "Incorrect username or password" | Wrong password, or the `usernames/<name>` document is missing. Check Firestore -> `usernames`. Email also works at the login box. |
| "No access" after login | The login exists in Authentication but has no `users/<uid>` profile. Re-add the company in the Users panel or create the profile (7.7). |
| Calendar empty/forever "Loading", console shows "requires an index" | The `bookings` index is missing or still **Building** (8.1 step 7). |
| "Missing or insufficient permissions" | Rules not published, or the user is not `active`, or they tried to edit someone else's booking. |
| Save says "The server did not confirm the save" | Offline/blocked connection. Nothing was saved; retry. |
| Attachment rejected | Over 600 KB (non-picture), wrong type, or more than 5 files. |
| Deploy workflow fails | Open the failed run in GitHub -> Actions. Check the six `VITE_FIREBASE_*` **Variables** exist, and that tests pass. |
| Console shows `net::ERR_FAILED` / blocked for Firebase | Firewall/ad-blocker on the visitor's side. |

---

## 11. Costs and limits

Runs on Firebase **Spark (free)**: quotas, not unlimited. Free daily limits are roughly 50,000 reads, 20,000 writes and 20,000 deletes, and 1 GiB stored. Attachments are the main storage consumer (each up to ~0.8 MB stored). Check usage in Firebase Console -> Firestore -> Usage. If the quota is exceeded, the app stops saving until the next day or the project is upgraded to Blaze. GitHub Pages and Actions are free for this scale.

---

## 12. Known limitations / ideas for later

- No admin password reset for other users (client-only app has no way to do it safely). A Cloud Function or small admin tool would fix this (needs Blaze).
- Renaming a company does not rename its past bookings (they keep the name they were made under).
- Deleting a company does not delete its Firebase login (Console only).
- Attachments capped at ~600 KB because they live in Firestore.
- Rules tests not yet automated in CI.
- Optional: Firebase App Check, email notifications, export to Excel/CSV, per-company booking limits.

---

## 13. Change history (summary)

1. Initial build: 42-day calendar, booking table, Firebase auth + Firestore, rules, GitHub Pages deploy, history, optional cleanup.
2. Registration and email verification removed; admin-created accounts only.
3. Username login via `usernames` mapping; change-password dialog.
4. Username = company name; truck type (6 options) and number of trucks (1-6); attachments.
5. Calendar shortened to **31 days**; table date filters removed (use the calendar to navigate).
6. "Name" renamed to **Company**; company auto-filled on bookings (fixed for standard users); click-a-company details pop-up; admin edit/delete companies.

# Dynamic Booking Calendar (DIM Calendar Booking)

A shared **lorry booking calendar** with **several separate calendars** (DIM, TG, NF, PME). Staff log in, pick a date, a company from their calendar's list, the vehicle and how many, and the booking appears on a rolling 31-day calendar in that company's colour. Each staff account belongs to **one** calendar; administrators see and switch between all of them.

> **Multi-calendar status (2026-11-11):** the code is built and deployed, but the live site stays in its old single-calendar mode until the go-live steps in **7.9** are done. Until then the app finds no calendars and behaves exactly as before.

- **Live site:** https://petworldcloud-code.github.io/Dynamic-Booking-Calendar/
- **Source code:** https://github.com/petworldcloud-code/Dynamic-Booking-Calendar (public repository)
- **Local folder (original developer's PC):** `D:\Rie\Claude\DIM Calendar Booking`

> This README is the handover document. If you are picking this project up from someone else, read sections 1-4 first, then use section 7 (day-to-day tasks) and section 10 (troubleshooting).

---

## 1. What it does (user view)

| Who | Can do |
|---|---|
| **Staff (one calendar)** | Log in with **email + password**. Opens straight into their own calendar (cannot see or switch to any other). Add a booking: pick the **company** from that calendar's list, **one date**, a **time slot** (when the admin has set any), **type of delivery** (Delivery stock / Container pull / Unloading), **type of vehicle** (Van or Truck; **type of truck** only appears, and is required, when Truck is chosen), **number of vehicles (1-6)**, whether the cargo is **palletized**, an optional **plate number**, optional notes and up to 5 attachments. View every booking in their calendar. Edit/delete **only bookings they made**. Change their own password. |
| **Administrator** | Everything above in **every** calendar (switcher buttons DIM / TG / NF / PME in the header; links like `#tg` open a calendar directly), plus: edit/delete **any** booking; **Calendars** (add / archive calendars); **Companies** (each calendar's company list and colours); **Users** (staff accounts and which calendar each uses); per calendar: **Blocked dates**, **Time slots**, **Email alerts**; and the global **Retention** setting. |
| *Old company account (role `user`)* | *Before go-live only: today's username logins, one per company. They are suspended by the go-live move (7.9) and replaced by staff accounts.* |

**Per calendar:** bookings, company list (with colours), time slots, blocked dates, email alert list and settings.
**Global:** user accounts, the retention (auto-delete) setting.

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
src/main.js                 UI logic: screens, table, dialogs, calendar switcher, wiring
src/calendars.js            Current calendar + calendars list (path helper: calendars/{code}/...)
src/companies.js            Per-calendar company list (add/rename/recolour/archive)
src/calendar-utils.js       Pure helpers: who can use which calendar, codes, company ids/colours (unit-tested)
src/blocked.js              Blocked dates (per calendar; optional "all calendars")
src/notify.js / notify-utils.js  Email-alert recipients + settings (per calendar)
src/calendar.js             Renders the calendar grid
src/date-utils.js           Malaysia-time maths, 31-day range, midnight watcher
src/bookings.js             Firestore bookings + attachments (create/update/delete/listen)
src/attachments.js          File checks, picture shrinking, base64 helpers
src/auth.js                 Login (username), password change, admin creates users
src/users.js                User profiles, username mapping, edit/delete user
src/retention.js            Retention settings read/write
src/slots.js                Time-slot settings (live listener + admin save)
src/slot-utils.js           Pure slot helpers (build/clean/generate/format), unit-tested
src/booking-utils.js        Pure vehicle-field helpers (van/truck, palletized, plate), unit-tested
src/firebase.js             Firebase init from env vars (+ second auth instance)
src/api.js                  Facade the UI calls (real Firebase, or demo)
src/demo.js                 In-memory fake backend for layout checks (demo mode only)
firestore.rules             Security rules, TRANSITION version (old + calendar paths). Edit this one.
firestore.rules.final       Final rules (old paths closed). Generated: node scripts/make-final-rules.mjs
apps-script/Code.gs         Email sender + one-time move to calendars (Google Apps Script)
firestore.indexes.json      Required Firestore index
firebase.json / .firebaserc Firebase CLI config (project = dynamic-booking-calendar)
scripts/cleanup.js          Optional old-booking cleanup (all calendars, one global retention)
scripts/make-final-rules.mjs  Builds firestore.rules.final from firestore.rules
tests/                      unit tests (npm test) + rules.test.js, rules-calendars.test.js (need Java)
.github/workflows/          deploy.yml, cleanup-expired-bookings.yml
vite.config.js              base path = /Dynamic-Booking-Calendar/ (GitHub Pages sub-path)
.env.example                Template for the Firebase web config
```

---

## 5. Data and login design

### 5.1 Firestore collections

**Multi-calendar layout (after go-live).** Everything that belongs to one calendar lives under `calendars/{code}/`:

| Path | Fields (summary) |
|---|---|
| `calendars/{code}` | `name` (e.g. `TG`), `order`, `active` (false = archived: hidden from staff, data kept), `createdAt`, `updatedAt`. Code = 2-10 lowercase letters/digits, fixed once created. Every active user can read this list. |
| `calendars/{code}/companies/{id}` | `name`, `color` (`#rrggbb`), `active` (false = removed from the dropdown, old bookings keep it). Id is made from the name (`shell`, `tg-logistics`). |
| `calendars/{code}/bookings/{id}` (+ `/attachments`) | Same fields as `bookings` below, plus `companyId`; `eventName` = that company's name. |
| `calendars/{code}/blockedDates`, `/settings/slots`, `/settings/notifications`, `/notifyRecipients`, `/notifyLog` | Same as the root versions below, but for that calendar only. In `notifyRecipients`, `companies` holds **company ids**. |
| `users/{uid}` | Also `role: staff` and `calendar` (the code). Staff have no `usernames` entry: they log in with their email. |
| `settings/retention` | Stays **global** (one setting for all calendars). |

The table below is the **old single-calendar layout** (still used until go-live, then kept as a backup copy until the owner says to delete it):

| Collection | Document ID | Fields (summary) |
|---|---|---|
| `users` | Firebase Auth UID | `displayName` (= **company name**), `username`, `email` (auth email), `role` (`admin`/`user`), `status` (`active`/`pending`/`suspended`), `createdAt`, `updatedAt` |
| `usernames` | the username (lowercase) | `email` (the auth email to sign in with), `uid`. Readable **one document at a time by anyone** (needed before login); listing is blocked. |
| `bookings` | auto ID | `bookingDate` (`YYYY-MM-DD`), `eventName` (= **company name**), `deliveryType` (`Delivery stock`/`Container pull`/`Unloading`; absent on old bookings), `vehicleType` (`Van`/`Truck`; absent on bookings made before it existed, which count as Truck), `truckType` (only for trucks), `truckCount` (1-6), `palletized` (true/false; absent on old bookings), `plateNumber` (optional text, several allowed), `timeSlot` (optional, `"08:00-10:00"`), `notes`, `attachments` (list of `{id,name,type,size}`), `createdBy`, `createdByName`, `createdAt`, `updatedBy`, `updatedByName`, `updatedAt` |
| `bookings/{id}/attachments` | random ID | `name`, `type`, `size`, `data` (base64 file), `createdBy`, `createdAt` |
| `settings` | `retention` | `autoDeleteEnabled` (false by default), `retentionDays`, `updatedAt`, `updatedBy` |
| `blockedDates` | the date `YYYY-MM-DD` | `reason` (text, max 80), `createdBy`, `createdAt`. A document existing = that date is closed to all new bookings. Admin writes, active users read. |
| `notifyRecipients` | the lowercase email | `email`, `allCompanies` (bool), `companies` (list of company names), `createdBy`, `createdAt`. **Admin only** (read and write): emails are private. |
| `settings` | `notifications` | `onNew`, `dayBefore`, `twoHours` (bools), `dayBeforeHour` (0-23), `updatedAt`, `updatedBy`. |
| `notifyLog` | `kind_bookingId_date_slot` | Written only by the Apps Script (owner access bypasses the rules; no one in the app can read or write it). Marks a mail as already sent. |
| `settings` | `slots` | `slots` (list of `"HH:MM-HH:MM"` 24-hour text, max 24), `updatedAt`, `updatedBy`. Empty/missing = no time slots, bookings only have a date. |

- Dates are stored as plain `YYYY-MM-DD` text, never as timestamps, so timezones cannot shift a booking.
- Truck types allowed: `40footer`, `20footer`, `10ton`, `5ton`, `3ton`, `1ton`.
- Attachments are in **Firestore, not Firebase Storage**, because Storage needs a paid (Blaze) plan. Each file is limited to ~600 KB (a Firestore document is limited to 1 MiB). If the project ever moves to the Blaze plan, Storage can replace this.

### 5.2 Username login (important to understand)

> **Staff accounts (multi-calendar) do not use usernames:** they log in with their email address + password. Everything below applies to the old company accounts and to the admin login `dim`, which keep working.

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
- **Calendars:** `canUse(cal)` = an admin, or an active **staff** member whose profile `calendar` is that code (and the calendar is not archived). Everything under `calendars/{cal}/` needs it. Staff cannot change their own calendar, role or status.
- **Company on a booking** must be an **active company of the same calendar**, and `eventName` must equal its name, so nobody can book for another calendar's company or invent one.
- Companies, calendars, time slots, blocked dates, email recipients and settings: admin writes only. The email log is closed to the app.
- Everything else is denied.

**Two versions.** `firestore.rules` = **transition** rules: the old paths (for old company accounts and admins; staff are kept out) **and** the calendar paths. Publish these at go-live. `firestore.rules.final` = the same without the old paths; publish it about a week after go-live, with the owner's OK (7.9). Never edit the `.final` file by hand: edit `firestore.rules` and run `node scripts/make-final-rules.mjs`.

Rules are **version-controlled in git** but must also be **published to Firebase** (section 7.5). Changing the file in GitHub does **not** change the live rules.

---

## 7. Day-to-day tasks (runbook)

### 7.1 Log in
Open the live site, enter **username** (e.g. `dim`) or **email**, and the password. Admin = `dim`. Staff use their email.

### 7.2a Calendars and companies (admin, after go-live)
- **Calendars** (header): add a calendar by code (e.g. `pme`), or **Archive** one (hidden from staff, data kept; **Restore** brings it back). Calendars are never deleted.
- **Companies** (header, for the calendar you are viewing): add a company with a name and colour, **Edit** (rename / recolour), **Remove** (taken out of the dropdown; old bookings keep it and their colour). Renaming a company renames it for new bookings only.
- **Users** -> "Add staff or administrator": name, email, password, **Staff (one calendar)** + the calendar, or **Administrator (all calendars)**. **Change calendar** moves a staff member. The **Show** filter lists one calendar's staff.

### 7.2 Add a company (admin, old single-calendar mode)
Header -> **Users** -> "Add user": enter **Company name**, optional email (only if they should be able to reset their own password by email), **initial password** (min 6), role (Standard user / Administrator) -> **Create**. Give them the username and password. They can change it via **Password** in the header.

### 7.3 Rename / suspend / delete a company (admin)
Users panel -> **Edit** (rename; username stays), the **Status** dropdown (`suspended` blocks access; `active` restores), or **Delete** (removes profile + username so they can no longer use the app; their past bookings remain). To remove the underlying Firebase login completely: Firebase Console -> Authentication -> Users -> delete.

### 7.3b Set the allowed booking times (admin)
Header -> **Time slots** (for the calendar you are viewing; each calendar has its own hours). Add slots one by one (From / To -> **Add slot**) or use **Quick fill** (e.g. 08:00 to 12:00 every 1 hour -> "Replace the list") -> **Save**. From then on every booking must choose one of the slots (shown as the time before the company name on the calendar and in the details pop-up). Remove all slots and Save to switch the feature off. Changing the list never changes existing bookings; an old booking whose slot was removed shows "(no longer offered)" when edited. **Note:** the rules only check that a slot is well-formed; the choice of allowed slots is enforced by the app screen, not by the database.

### 7.3c Block a date, e.g. a public holiday (admin)
Header -> **Blocked dates** (title shows the calendar, e.g. "Blocked dates — TG"). Blocks are **per calendar**: blocking a date in TG leaves DIM open. For a public holiday tick **Block on all calendars** to save the block in every active calendar at once (each calendar then has its own copy; unblock it per calendar). Choose **From** (and **To** for several days), type a **Reason**, press **Block** (max 62 days at once). Blocked days show hatched with "Closed: reason" on the calendar. Nobody can book or move a booking onto that date, **administrators included** (the form shows a warning and Save is disabled, and the rules enforce it too). To book on it, press **Unblock** first. Bookings already on a date stay. To reopen a date press **Unblock** in the same dialog (only upcoming blocked dates are listed).

### 7.3d Email alerts: new bookings and reminders (admin)
**What it does.** Header -> **Email alerts**:
- **What to send:** (a) an email when a booking is added, (b) a reminder the day before at an hour you choose (default 17:00), (c) a reminder 2 hours before the booking's time slot starts (bookings without a time slot only get the day-before reminder). Tick what you want, press **Save what to send**.
- **Who receives them:** type an email, then either leave **All companies** ticked or untick it and tick one or more companies (one address can cover several companies). **Add**. **Edit** changes the companies of an existing address; **Remove** deletes it. Emails go out only for bookings of the companies ticked for that address.
- **Per calendar:** each calendar has its own list of addresses and its own "what to send" settings (the title shows which, e.g. "Email alerts — TG"). Company ticks come from that calendar's company list and are stored as company ids, so renaming a company keeps the tick. Mail subjects start with the calendar, e.g. `[TG] New booking: ...`, and the link opens that calendar.
- Old single-calendar mode: a booking is matched by its company name (`eventName`); if you rename a company, edit the address and tick the new name.

**How it works.** The site is on the free Firebase Spark plan, which cannot send email by itself. `apps-script/Code.gs` is a small free Google Apps Script that runs on the owner's Google account every 5 minutes, reads Firestore with the owner's own access (no keys stored anywhere), and sends the mail from the owner's Gmail. Emails can therefore arrive up to about 5 minutes late. Each mail goes out once (tracked in the `notifyLog` collection, which only the script can touch). A booking that is rescheduled gets reminded again for its new date/slot. A booking added after a reminder's moment has already passed gets only the "new booking" mail, not an instant reminder. The old backlog is never mailed: only bookings created after `setup()` ran.

**One-time setup (owner Google account, petworldcloud@gmail.com):**
1. Go to https://script.google.com -> **New project**. Name it "Booking Calendar Mailer".
2. Project Settings (gear) -> tick **Show "appsscript.json" manifest file in editor**. Replace the contents of `appsscript.json` with `apps-script/appsscript.json` from this repo, and the contents of `Code.gs` with `apps-script/Code.gs`. Save.
3. In the function list pick **sendTest** -> Run. Google asks you to authorise (Gmail sending, Firestore, triggers): choose the owner account -> Advanced -> Go to the project -> Allow. A test email arrives in the inbox.
4. Pick **setup** -> Run. It installs the 5-minute timer and does a first check. If the log shows `Firestore 403`, see Troubleshooting.
5. In the app add your first email under Email alerts and book something to test.

To stop all emails: run **stopAll** in the script editor (or remove the addresses in the app). Rules for `notifyRecipients` and `settings/notifications` must be published (7.5) before the Email alerts screen can save.

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

### 7.9 Go-live: moving to multiple calendars (one time, ~20 min, quiet time)
The new app code is **already live** (every push deploys), waiting in old mode: it switches to calendars by itself the moment `calendars/dim` exists and the rules let users read it. So the switch happens at step 4 below.

1. **Apps Script:** paste the new `apps-script/Code.gs` into the mailer project (7.3d) and Save. It keeps mailing from the old paths until calendars exist, so there is no gap in emails.
2. **Publish the transition rules** (`firestore.rules`, 7.5). Nothing visible changes yet.
3. In the Apps Script editor run **migrateDryRun**. Nothing is written; the log shows what would be copied, e.g. `{"calendar":1,"companies":5,"bookings":120,...}`. Check the numbers look right.
4. Run **migrateToCalendars** (details below). From now on the site opens the **DIM** calendar; ask anyone with the page open to refresh.
5. Run **migrateToCalendars** once more (catches a booking saved from a page that was still open in old mode).
6. **Check DIM** as admin: bookings are all there with company colours; the Companies list is right (fix names/colours).
7. **Calendars** -> add `tg`, `nf`, `pme`; for each: Companies, Time slots, Email alerts; then **Users** -> create the staff accounts.
8. **Live check:** a test staff account on TG makes a booking, the `[TG]` email arrives, the account cannot open DIM; delete the test booking and account.
9. **About a week later, with the owner's OK:** publish `firestore.rules.final` (old paths closed) and delete the old root copies (`bookings`, `blockedDates`, `notifyRecipients`, `notifyLog`, `settings/slots`, `settings/notifications`; keep `settings/retention`, `users`, `usernames`).

**Rollback** (before step 9): publish the previous rules from git history (e.g. `git show 90d3fd0:firestore.rules`), which deny reading `calendars`; the app falls back to the old paths, where the old data still is. Set the suspended company accounts back to `active` in Users. Bookings made in calendars since the switch would then have to be re-entered.

**What migrateToCalendars does:**
- It copies into `calendars/dim`: the company list (from company accounts, booking names and email-alert ticks, each with its own colour), bookings (same ids, times and creators, plus `companyId`) and their attachments, blocked dates, time slots, email settings and recipients (ticks become company ids), and the email log so nothing is mailed twice. Then it **suspends** the old company logins (role `user`); the admin account is not touched. Old data is **not** deleted.
- Safe to run again: it copies only what is missing, or bookings changed in the old app since the last run. A booking **deleted** in the old app after a run stays in `calendars/dim`; delete it there.
- The same script then sends mail for every active calendar (subject `[TG] New booking: ...`, link opens `#tg`). Before any calendar exists it keeps using the old paths.

---

## 8. Setup from scratch (installation)

### 8.1 Firebase (one-time; already done for this project)
1. https://console.firebase.google.com -> **Add project** (`dynamic-booking-calendar`, Analytics off).
2. Project settings -> **Your apps** -> **Web (`</>`)** -> register -> copy the config.
3. **Authentication** -> Get started -> enable **Email/Password**.
4. Authentication -> Settings -> **Authorized domains** -> add `petworldcloud-code.github.io`.
5. **Firestore Database** -> Create database -> **Standard edition**, location **asia-southeast1**, **production mode**.
6. Publish `firestore.rules` (7.5).
7. **Index** (needed or the calendar will not load): Firestore -> Indexes -> collection `bookings`, fields `bookingDate` Ascending + `createdAt` Ascending, scope Collection. **And a second one with both fields Descending** (the History tab needs it; without it History says "The query requires an index"). Status must show **Enabled** for both. (Or `firebase deploy --only firestore:indexes`.) Status must show **Enabled**.

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
`.github/workflows/cleanup-expired-bookings.yml` + `scripts/cleanup.js` can permanently delete bookings older than N days (and their attachments), in **every** calendar (archived ones too) and in the old `bookings` copy, using the one global Retention setting. It is **disabled** and **dry-run** by default and does nothing unless **all** are true: repo variable `CLEANUP_ENABLED=true`, repo variable `CLEANUP_DELETE=true`, and an admin ticked "Allow permanent deletion" in the app (Retention). It needs Google Cloud Workload Identity Federation (no key files): create a service account with only `roles/datastore.user`, a workload identity pool restricted to this repo and `main`, then set variables `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT`. **Not set up and not tested.** Default behaviour: keep all history forever.

---

## 9. Testing status (honest)

| Area | Status |
|---|---|
| Date logic, time-slot and vehicle helpers, calendar access/colour helpers, email matching, cleanup | **Automated, passing** (`npm test`, 56 tests; also runs in CI). |
| Apps Script sender + `migrateToCalendars()` | **Automated against a fake Firestore** (`tests/apps-script.test.js`): copy, run-twice safety, no repeated mail, `[TG]` mails to TG's list only. **Not yet run on the real Google account** (go-live step 3-5). |
| Multi-calendar screens | Checked in the browser in demo mode as admin, TG staff, staff without a calendar, old-site mode and phone width. Not yet on the live site (go-live step 6-8). |
| Production build and GitHub Pages deployment | **Working** (deployed and loading). |
| Layout, calendar, overflow, dropdowns, details pop-up | Checked in browser (demo data and live as admin). |
| Firestore rules tests (`tests/rules.test.js`, `tests/rules-calendars.test.js` for both rule versions) | **Written but never run**: they need the Firebase emulator, which needs **Java** (not installed on the dev PC). Run with `npm run test:rules` after installing Java 11+. Rules are published and in use; treat them as untested by automation. |
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
| Emails do not arrive | In script.google.com open the mailer project -> Executions: look for errors. `Firestore 403` = the owner account lacks access or the Cloud Firestore API is off for project `dynamic-booking-calendar` (Google Cloud Console -> APIs). Also check Spam, that the address is listed under Email alerts for that company, that the type is ticked, and that the timer exists (Triggers: `checkAll`, every 5 minutes; re-run `setup`). |
| Staff see "No calendar assigned" | Their profile has no calendar, or the calendar is archived. Users -> Change calendar (or restore the calendar). |
| Company missing from the booking dropdown | It belongs to another calendar, or was removed. Companies (in that calendar) -> add or restore it. |
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
- Time slots have no capacity limit (many companies can pick the same slot) and are not per-weekday.
- Email: sent every 5 minutes by an Apps Script on the owner's Gmail, so up to ~5 minutes late; a free Google account allows about 100 recipients a day (each address on each mail counts). Booking edits and deletions are not mailed. If the Google account is changed or the script is deleted, emails stop silently.
- Old root data (pre-calendar) stays as a backup until deleted at go-live step 9; a booking deleted in the old app after a migrate run stays in `calendars/dim`.
- Optional: Firebase App Check, export to Excel/CSV, per-company booking limits, per-slot capacity.

---

## 13. Change history (summary)

1. Initial build: 42-day calendar, booking table, Firebase auth + Firestore, rules, GitHub Pages deploy, history, optional cleanup.
2. Registration and email verification removed; admin-created accounts only.
3. Username login via `usernames` mapping; change-password dialog.
4. Username = company name; truck type (6 options) and number of trucks (1-6); attachments.
5. Calendar shortened to **31 days**; table date filters removed (use the calendar to navigate).
6. "Name" renamed to **Company**; company auto-filled on bookings (fixed for standard users); click-a-company details pop-up; admin edit/delete companies.
7. **Time slots**: admin defines allowed arrival times (`settings/slots`); bookings pick one (`timeSlot`). Rules must be re-published (7.5).
8. **Vehicle details**: type of vehicle (Van/Truck; truck type only for trucks), cargo palletized yes/no, optional plate number. `truckType` is no longer required by the rules (vans have none). Rules must be re-published **before** deploying the code (7.5).
9. **Blocked dates** (holidays): admin closes dates (`blockedDates` collection); nobody, admins included, can book onto them (UI + rules). Rules must be re-published before deploying.
10. **Type of delivery** dropdown (Delivery stock / Container pull / Unloading). Rules must be re-published before deploying.
11. **Email alerts**: admin screen for recipients (per-company filter, multi-select) and for new-booking / day-before / 2-hours-before mails, sent by the Google Apps Script in `apps-script/` (7.3d). Rules must be re-published before deploying.
12. **Multiple calendars** (DIM / TG / NF / PME, plan in `docs/MULTI-CALENDAR-PLAN.md`): staff accounts (email + one calendar), per-calendar company list with colours, time slots, blocked dates (+ "all calendars" tick) and email alerts; admin switcher; transition + final rules; multi-calendar mail sender and `migrateToCalendars()`; cleanup across calendars. Goes live with the steps in 7.9.

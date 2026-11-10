# Plan: Multiple calendars (DIM, TG, NF, PME)

Status: **all decisions confirmed** (2026-11-10). Ready to build from Phase 1.

v2 changes: accounts are now **staff** (email + password) tied to **one** calendar, and **companies** become a list per calendar that the admin maintains.

## Goal

Today the site has one calendar (DIM), and each company logs in with its own account. After this change:

- **Calendars.** There are several calendars: **DIM, TG, NF, PME**. The admin can add more later. The names are just the codes.
- **Separate data.** Each calendar has its own:
  - bookings
  - companies
  - time slots
  - blocked dates
  - email alerts

  Only people in DIM can see DIM bookings.
- **Admins** see every calendar and can switch between them at any time.
- **Staff accounts.** Accounts are now staff. Each one logs in with an **email and password** and belongs to **exactly one** calendar, chosen by the admin.
- **Companies are no longer accounts.** They are a list per calendar, maintained by the admin, and each company has its **own colour**. When booking, staff pick the company from a dropdown that only shows that calendar's companies.

## What the user sees

| Who | What changes |
|---|---|
| Admin | A **calendar switcher** in the header (DIM / TG / NF / PME). The selected calendar's code is shown next to the title, e.g. **TG · Booking Calendar**. |
| Admin | **Calendars** screen to add, rename or archive a calendar. Archived calendars are hidden from staff, and their data is kept. |
| Admin | **Companies** screen, for the calendar currently selected: add, rename or remove a company, and pick its colour. Removed companies stay on their old bookings but are no longer offered in the dropdown. |
| Admin | **Users** screen: create a staff account with name, email, password and its one calendar. The list shows each account's calendar and can be filtered by calendar. |
| Admin | **Time slots, Blocked dates and Email alerts** open for the calendar currently selected. Blocked dates gets an extra tick, "Block on all calendars", for public holidays. |
| Staff | Logs in with email + password and lands straight in their calendar, with no switcher. The booking form has a **Company** dropdown listing that calendar's companies. |
| Everyone | Each booking label on the calendar is shown in its **company's colour**. |
| Everyone | "Forgot password" now really emails a reset link, because staff have real email addresses. |

The login box accepts an email. The old usernames, like the admin `dim`, keep working.

## Data model (Firestore)

```
calendars/{cal}                          { name, order, active, createdAt, updatedAt }
calendars/{cal}/companies/{id}           { name, color, active, createdAt, updatedAt }
calendars/{cal}/bookings/{id}            today's fields + companyId (eventName = company name at booking time)
calendars/{cal}/bookings/{id}/attachments/{aid}
calendars/{cal}/blockedDates/{date}
calendars/{cal}/settings/slots
calendars/{cal}/settings/notifications
calendars/{cal}/notifyRecipients/{email} { allCompanies, companies: [companyId…] }
calendars/{cal}/notifyLog/{key}          (sender script only)
users/{uid}                              { displayName, email, role: admin|staff, status, calendar: "tg" }
settings/retention                       stays global
usernames/{name}                         kept only for old username logins
```

- **Calendar codes:** `{cal}` is a short lowercase code (`dim`, `tg`, `nf`, `pme`). It is fixed once created.
- **Indexes:** the existing booking indexes already cover these sub-collections, so no new indexes are needed.
- **Why each calendar gets its own folder:** the security rules can check access from the path alone. A mistake in a query therefore cannot show TG data inside DIM.

## Security rules (summary)

- **Access check.** `canUse(cal)` is true for an admin, or for active staff whose profile has `calendar == cal`.
- **Bookings** under `calendars/{cal}/…` need `canUse(cal)` plus today's checks:
  - shape and limits;
  - blocked dates apply to everyone;
  - creation info can't be changed;
  - staff edit or delete only bookings they created, and an admin can change any booking.
- **Company on a booking.** It must point to an **active company of that same calendar**, and the booking's company name must match it. Staff therefore cannot book for a company from another calendar or invent one.
- **Admin-only areas:**
  - companies, calendars, time slots and blocked dates (writes only);
  - email recipients and email settings;
  - the notify log.
- **Profiles.** Only admins can create staff or change a staff member's calendar or role. Staff cannot move themselves to another calendar.

## Email alerts

- **Recipients and settings are per calendar**, because each calendar has a different person in charge.
- **Company ticks.** Inside a calendar, each email can tick "All companies" or pick from **that calendar's** company list, as today.
- **The sender script** (Apps Script) loops over every active calendar every 5 minutes.
  - Subjects start with the code, e.g. `[TG] New booking: …`.
  - The link in the mail opens that calendar.
- **No repeats.** Reminders already sent are remembered per calendar, so moving the data does not resend anything.

## Moving the existing DIM data (one time)

The Apps Script runs as the Firebase owner, so it can copy data exactly, keeping the original times and creators. A new function `migrateToCalendars()`:

1. Creates `calendars/dim`.
2. **Builds the DIM company list** from today's company accounts and from every company name found on existing bookings. Each company gets a different starting colour, which the admin can change later.
3. Copies into `calendars/dim/…`:
   - bookings and their attachments, each booking gaining its `companyId`;
   - blocked dates;
   - time slots;
   - email settings and recipients (their company ticks become company ids);
   - the notify log.
4. **Old company logins** (like `tefal`) are **suspended, not deleted.** Companies no longer log in. The admin creates staff accounts instead. The admin account is untouched.
5. Reports the counts. It is **safe to run twice**: it only copies what is missing or newer.

The old data is **not deleted**. It stays as a backup until the owner says to remove it.

### Go-live order (one quiet window, ~20 min)

1. **Publish transition rules** that allow both the old and the new paths.
2. **Run `migrateToCalendars()`** and check the counts.
3. **Push the new app.** GitHub Pages deploys it in about 1–2 minutes.
4. **Run `migrateToCalendars()` again** to catch any booking made in the old app during step 3.
5. **Update the Apps Script** sender to the multi-calendar version.
6. **Check DIM:**
   - every booking is there, with company colours;
   - the companies list is right.
7. **Add TG, NF and PME** with their companies, then create the staff accounts and email alert lists.
8. **A week later**, with the owner's OK:
   - publish the final rules, which lock the old paths;
   - delete the old copies.

## Build phases (each one committed and pushed)

| # | Phase | Main files |
|---|---|---|
| 1 | **Data layer:** calendar path helper, calendars + companies read/write, access helper, company colour palette, unit tests | `src/calendars.js`, `src/companies.js` (new), `src/bookings.js`, `src/blocked.js`, `src/slots.js`, `src/notify.js`, `src/api.js`, `tests/calendars.test.js` |
| 2 | **Calendar switching:** admin switcher, staff go straight to their calendar, per-calendar live loading, `#tg` links, "no calendar assigned" screen | `src/main.js`, `index.html`, `assets/css/styles.css` |
| 3 | **Company dropdown and colours:** dropdown in the booking form, company colours on calendar labels and in the table | `src/main.js`, `src/calendar.js`, `assets/css/styles.css` |
| 4 | **Admin screens:** Calendars and Companies screens; staff accounts with email + one calendar in Users | `src/main.js`, `src/users.js`, `src/auth.js`, `index.html` |
| 5 | **Per-calendar settings:** email alerts per calendar (company ticks from that calendar's list), and "Block on all calendars" | `src/main.js`, `src/blocked.js` |
| 6 | **Rules:** transition and final versions, plus rules tests | `firestore.rules`, `firestore.rules.final`, `tests/rules.test.js` |
| 7 | **Apps Script:** multi-calendar sender, `migrateToCalendars()`, unit tests | `apps-script/Code.gs`, `tests/notify.test.js` |
| 8 | **Demo mode and browser check:** 4 calendars with sample companies; check every screen as an admin and as staff, including at phone width | `src/demo.js` |
| 9 | **Go-live:** the steps above, the README handover update, and the auto-delete script looping over calendars | `README.md`, `scripts/cleanup.js` |

Phases 1–8 change nothing on the live site. It changes only in phase 9, in the agreed window.

## Testing

- **Unit tests:**
  - who can use which calendar;
  - path building;
  - company colours;
  - the migration's company list building, and its "copy only what's missing" step.
- **Demo mode:**
  - a TG staff account never sees DIM;
  - the company dropdown only lists the current calendar's companies;
  - colours show on the calendar.
- **Rules tests:** written but they **cannot run on this PC**, because they need Java. Instead they are checked by hand in the live window, with a test staff account on TG.
- **Live check after go-live:**
  1. Make a test booking in TG.
  2. Confirm the `[TG]` email arrives.
  3. Confirm the TG test staff cannot open DIM.
  4. Delete the test booking and the test account.

## Confirmed by the owner (2026-11-10)

1. **One account, one calendar.** Accounts are staff with email + password. Companies are a per-calendar dropdown list maintained by the admin.
2. **Email alerts are separate per calendar.**
3. **No per-calendar admins.** Admins see everything.
4. **Calendar names are the codes** DIM / TG / NF / PME.
5. **No calendar colours.** Each company has its own colour instead.
6. **Staff edit or delete only the bookings they made** (as today). The admin can change any booking. Staff can still view every booking in their calendar.

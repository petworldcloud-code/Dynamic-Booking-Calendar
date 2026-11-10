# Plan: Multiple calendars (DIM, TG, NF, PME)

Status: **draft, waiting for owner approval** (2026-11-10). Nothing is built yet.

## Goal

Today the site has one calendar (DIM). After this change:

- There are several calendars: **DIM, TG, NF, PME**, and the admin can add more later.
- Each calendar is completely separate. It has its own bookings, time slots, blocked dates and email alerts.
- **Admins** see every calendar and can switch between them at any time.
- The **admin decides which accounts can use which calendars**. One company login can be given one calendar or several.
- A company only sees the calendars it has been given. If it has just one, there is no switcher and the site looks the same as today.

## What the user sees

| Who | What changes |
|---|---|
| Admin | A **calendar switcher** in the header shows DIM / TG / NF / PME. The current calendar's name and colour are shown big, so it's always clear which one you're working in. |
| Admin | A new **Calendars** screen to add a calendar (code + full name + colour), rename it, reorder it, or archive it. Archived calendars are hidden from companies but their data is kept. |
| Admin | In **Users**, each account gets ticks for the calendars it may use. The same ticks appear when creating a new account. |
| Admin | **Time slots, Blocked dates and Email alerts** open for the calendar currently selected. Blocked dates gets an extra tick, "Block on all calendars", for public holidays. |
| Company with 2+ calendars | Same switcher, showing only its own calendars. |
| Company with 1 calendar | No visible change. |
| Company with 0 calendars | Sees "Your account has no calendar yet. Ask the admin." |
| Everyone | The last calendar used is remembered. A link like `…/Dynamic-Booking-Calendar/#tg` opens TG directly. |

The site title becomes **"Booking Calendar"**, with the selected calendar shown next to it (e.g. **TG · Booking Calendar**).

## Data model (Firestore)

Each calendar keeps its data under its own folder, so calendars can never mix:

```
calendars/{cal}                      { name, color, order, active, createdAt, updatedAt }
calendars/{cal}/bookings/{id}        same fields as today (+ attachments sub-collection)
calendars/{cal}/blockedDates/{date}  same as today
calendars/{cal}/settings/slots       same as today
calendars/{cal}/settings/notifications
calendars/{cal}/notifyRecipients/{email}
calendars/{cal}/notifyLog/{key}      (sender script only)
users/{uid}                          + calendars: ["dim", "tg"]   (ignored for admins)
settings/retention                   stays global (one auto-delete rule for all calendars)
usernames/{name}                     unchanged
```

- `{cal}` is a short lowercase code (`dim`, `tg`, `nf`, `pme`). It cannot be changed once created; the display name can.
- The existing booking indexes already cover `bookings` sub-collections, so no new indexes are needed.

### Why separate folders and not a "calendar" field on each booking

- The security rules can check access from the path alone, which makes them simple and hard to get wrong.
- Time slots, blocked dates and email settings split per calendar naturally.
- One bug in a query cannot show TG bookings inside DIM.

## Security rules (summary)

- `canUse(cal)` is true for an admin, or for an active user whose profile `calendars` list contains `cal`.
- **Bookings, blocked dates, slots:** read, create, edit and delete under `calendars/{cal}/…` require `canUse(cal)` plus all of today's checks:
  - a company can only book under its own name;
  - blocked dates apply to everyone;
  - the data shape is validated.
- **Calendar list (names and colours):** readable by any active user. Only admins write it. Calendars are archived, never deleted, from the app.
- **Calendar access on profiles:** only admins can change a profile's `calendars` list. A company cannot give itself access.
- **Email recipients, notification settings and the notify log:** admin-only, as today.

## Email alerts

- **Recipients and settings are per calendar.** If one email should get alerts for TG and NF, the admin adds it in both calendars.
  - Inside each calendar, the per-company ticks work as they do today.
  - The company list shows only the companies that have access to that calendar.
- **The sender script (Apps Script)** loops over every active calendar every 5 minutes. Subjects get a prefix, e.g. `[TG] New booking: …`. The link in the mail opens that calendar.
- Reminders already sent are remembered per calendar, so moving the data does not resend anything.

## Moving the existing DIM data (one time)

The Apps Script runs as the Firebase owner, so it can copy data exactly: original times and creators are kept, and the security rules are not involved. A new function `migrateToCalendars()`:

1. Creates `calendars/dim` (name "DIM").
2. Copies everything under the old paths into `calendars/dim/…`:
   - bookings and their attachments;
   - blocked dates;
   - time slots;
   - notification settings, recipients and the notify log.
3. Gives every non-admin account `calendars: ["dim"]`, so nobody loses access.
4. Reports the counts copied. It is **safe to run twice**: it only copies what is missing or newer.

The old data is **not deleted** in this step. It stays as a backup until the owner says to remove it.

### Go-live order (one quiet window, ~20 min)

1. **Publish transition rules** that allow both the old and the new paths.
2. **Run `migrateToCalendars()`** and check the counts.
3. **Push the new app.** GitHub Pages deploys in about 1–2 minutes.
4. **Run `migrateToCalendars()` again** to catch any booking made in the old app during step 3.
5. **Update the Apps Script** sender to the multi-calendar version.
6. **Check DIM** looks exactly as before. Then add TG, NF and PME, and tick access for the right accounts.
7. **A week later**, with the owner's OK: publish the final rules (old paths locked) and delete the old copies.

## Build phases (each one committed and pushed)

| # | Phase | Main files |
|---|---|---|
| 1 | Data layer: calendar path helper, `calendars` collection read/write, access helper + unit tests | `src/calendars.js` (new), `src/bookings.js`, `src/blocked.js`, `src/slots.js`, `src/notify.js`, `src/api.js`, `tests/calendars.test.js` |
| 2 | Switcher + per-calendar loading (stop and restart live listeners on switch, remember last calendar, `#tg` links, "no calendar" screen) | `src/main.js`, `index.html`, `assets/css/styles.css` |
| 3 | Admin: Calendars screen (add/rename/colour/order/archive) and calendar ticks in Users / new account | `src/main.js`, `src/users.js`, `index.html` |
| 4 | Per-calendar Email alerts in the app + "Block on all calendars" | `src/main.js`, `src/blocked.js` |
| 5 | Rules (transition + final versions) and rules tests | `firestore.rules`, `firestore.rules.final`, `tests/rules.test.js` |
| 6 | Apps Script: multi-calendar sender + `migrateToCalendars()` + unit tests | `apps-script/Code.gs`, `tests/notify.test.js` |
| 7 | Demo mode with 4 calendars and a browser check of every screen (admin + company, phone width) | `src/demo.js` |
| 8 | Go-live (see above), README handover update, auto-delete script loops over calendars | `README.md`, `scripts/cleanup.js` |

Phases 1–7 change nothing on the live site. The live site only changes in phase 8, in the agreed window.

## Testing

- **Unit tests:** access rules for who sees which calendar, path building, and the migration's "copy only what's missing" logic.
- **Demo mode:** checked in the browser as an admin and as a company with 1 calendar and with 2 calendars. A booking made in TG must never appear in DIM.
- **Rules tests:** written but, as today, they **cannot run on this PC** (they need Java). Rules are checked by hand in the live window instead, with a test company account given TG only.
- **Live check after go-live:**
  - Make a test booking in TG and confirm the new-booking email arrives with `[TG]`.
  - Confirm the test company cannot open DIM.
  - Delete the test booking.

## Decisions to confirm (recommended answer first)

1. **One login for several calendars.** A company that books in both DIM and TG uses the same account with both ticked, not two separate accounts. *(Recommended.)*
2. **Email alert lists are per calendar.** The alternative is one list where each email picks calendars and companies. Per calendar is simpler and matches "separate calendars".
3. **No per-calendar admins for now.** Admins see everything. A "TG admin" who manages only TG can be added later if needed.
4. **Full names for the calendars.** What do TG, NF and PME stand for, if the header should show more than the code? Is "DIM" also the right display name for the existing one?
5. **Colours.** One colour per calendar in the header so staff notice when they switch. *(Recommended; the admin can change them.)*

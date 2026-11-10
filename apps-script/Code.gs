/**
 * Dynamic Booking Calendar - email sender (Google Apps Script).
 *
 * Why this exists: the site runs on Firebase's free Spark plan, which cannot run server code or send mail.
 * This script runs on the owner's Google account (free), wakes up every 5 minutes, reads Firestore with the
 * owner's own access, and sends:
 *   1. "New booking" mail          - when a booking is added
 *   2. "Tomorrow" reminder         - the day before, at the hour chosen in the app (Email alerts)
 *   3. "In 2 hours" reminder       - 2 hours before the booking's time slot starts
 * to the addresses configured in the app (Email alerts), filtered by company.
 *
 * Several calendars (DIM, TG, NF, PME): every active calendar under calendars/{code} is checked with its own
 * recipients, settings and log; subjects start with the code, e.g. "[TG] New booking: ...". Before the data is
 * moved (no calendars exist yet) it works on the old single-calendar paths exactly as before.
 *
 * migrateToCalendars() (bottom of this file) copies the old single-calendar data into calendars/dim.
 * Run migrateDryRun() first to see the counts without writing anything. See README 7.9.
 *
 * Nothing secret is stored here: it uses the signed-in owner's Google token. Setup steps: README section 7.3d.
 * Mail goes out from the owner's Gmail (limit: about 100 recipients a day on a free Google account;
 * each address counts, so keep the list short).
 */

var PROJECT_ID = 'dynamic-booking-calendar';
var APP_URL = 'https://petworldcloud-code.github.io/Dynamic-Booking-Calendar/';
var TZ = 'Asia/Kuala_Lumpur';
var UTC_OFFSET = '+08:00'; // Malaysia has no daylight saving
var SENDER_NAME = 'Dynamic Booking Calendar';
var DOCS = 'projects/' + PROJECT_ID + '/databases/(default)/documents';
var DB = 'https://firestore.googleapis.com/v1/' + DOCS;

// ------------------------------------------------------------------ pure helpers (unit-tested in the repo)

/** "2026-11-12" + "08:00-10:00" -> epoch ms of the slot start in Malaysia time, or null when there is no slot. */
function slotStartMs(date, slot) {
  var m = /^([01][0-9]|2[0-3]):([0-5][0-9])-/.exec(slot || '');
  if (!m) return null;
  return Date.parse(date + 'T' + m[1] + ':' + m[2] + ':00' + UTC_OFFSET);
}

/** Epoch ms of HH:00 on a Malaysian date. */
function hourOnMs(date, hour) {
  return Date.parse(date + 'T' + (hour < 10 ? '0' : '') + hour + ':00:00' + UTC_OFFSET);
}

/** Same as src/notify-utils.js: in a calendar the ticks are company ids (booking.companyId); the old calendar ticks names. */
function wantsCompany(recipient, company, companyId) {
  if (recipient.allCompanies) return true;
  var ticked = recipient.companies || [];
  return ticked.indexOf(company) !== -1 || (!!companyId && ticked.indexOf(companyId) !== -1);
}

function recipientsFor(list, company, companyId) {
  return list.filter(function (r) { return wantsCompany(r, company, companyId); }).map(function (r) { return r.email; });
}

/** Firestore path prefix of a calendar ('' = the old single-calendar paths). */
function basePath(cal) { return cal ? '/calendars/' + cal : ''; }

/** Link in the mail: opens that calendar (#tg). */
function linkFor(cal) { return APP_URL + (cal ? '#' + cal : ''); }

/**
 * Which calendars to check: the active ones, in order. No calendar documents at all means the data has not been
 * moved yet, so the old paths are used ([null]). Calendars that exist but are all archived = nothing to check.
 */
function calendarsToCheck(list) {
  if (!list || !list.length) return [null];
  return list.filter(function (c) { return c.active !== false; })
    .sort(function (a, b) { return (a.order || 0) - (b.order || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); })
    .map(function (c) { return c.id; });
}

function slotText(slot) {
  var m = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(slot || '');
  return m ? m[1] + ' \u2013 ' + m[2] : '';
}

/** Firestore REST value -> plain JS value. */
function fromValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}

function fromFields(fields) {
  var out = {};
  Object.keys(fields || {}).forEach(function (k) { out[k] = fromValue(fields[k]); });
  return out;
}

function fromDoc(doc) {
  var data = fromFields(doc.fields || {});
  data.id = doc.name.split('/').pop();
  return data;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Rows shown in every mail. */
function detailRows(b, cal) {
  var vehicle = b.vehicleType === 'Van' ? 'Van' : (b.truckType ? 'Truck (' + b.truckType + ')' : (b.vehicleType || ''));
  var rows = [
    ['Calendar', cal ? String(cal).toUpperCase() : ''],
    ['Company', b.eventName],
    ['Date', b.bookingDate],
    ['Time slot', slotText(b.timeSlot)],
    ['Type of delivery', b.deliveryType],
    ['Vehicle', vehicle ? (b.truckCount || 1) + ' x ' + vehicle : ''],
    ['Cargo', b.palletized === true ? 'Palletized' : (b.palletized === false ? 'Not palletized' : '')],
    ['Plate number', b.plateNumber],
    ['Notes', b.notes],
    ['Booked by', b.createdByName]
  ];
  return rows.filter(function (r) { return r[1]; });
}

function mailBody(heading, b, cal) {
  var trs = detailRows(b, cal).map(function (r) {
    return '<tr><td style="padding:4px 14px 4px 0;color:#666">' + esc(r[0]) + '</td><td style="padding:4px 0"><b>' + esc(r[1]) + '</b></td></tr>';
  }).join('');
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' +
    '<h3 style="margin:0 0 10px">' + esc(heading) + '</h3><table>' + trs + '</table>' +
    '<p style="margin-top:14px"><a href="' + linkFor(cal) + '">Open the booking calendar</a></p></div>';
}

/** Plain-text twin of the HTML mail (sent as the alternative body; some spam filters prefer mail that has one). */
function mailText(heading, b, cal) {
  var lines = detailRows(b, cal).map(function (r) { return r[0] + ': ' + r[1]; });
  return heading + '\n\n' + lines.join('\n') + '\n\nOpen the booking calendar: ' + linkFor(cal) + '\n';
}

function subjectFor(kind, b, cal) {
  var when = b.bookingDate + (b.timeSlot ? ' ' + slotText(b.timeSlot) : '');
  var tag = cal ? '[' + String(cal).toUpperCase() + '] ' : '';
  if (kind === 'new') return tag + 'New booking: ' + b.eventName + ' - ' + when;
  if (kind === 'day') return tag + 'Reminder - tomorrow: ' + b.eventName + ' - ' + when;
  return tag + 'Reminder - in 2 hours: ' + b.eventName + ' - ' + when;
}

function headingFor(kind) {
  if (kind === 'new') return 'A booking was added';
  if (kind === 'day') return 'Booking arriving tomorrow';
  return 'Booking arriving in about 2 hours';
}

/** The log makes each mail go out once. Keys include date and slot, so a rescheduled booking is reminded again. */
function logKey(kind, b) {
  return kind + '_' + b.id + '_' + b.bookingDate + '_' + String(b.timeSlot || 'noslot').replace(/[^0-9a-z]/gi, '');
}

// ---------- pure helpers for the one-time move (same rules as src/calendar-utils.js) ----------

var COMPANY_COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#0891b2',
  '#db2777', '#4d7c0f', '#ea580c', '#475569', '#0d9488', '#9333ea'
];

function nameKey(name) { return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

/** Company ids are made from the name; a numeric suffix keeps them unique (same as the app). */
function companyIdFor(name, takenIds) {
  var base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'company';
  if (takenIds.indexOf(base) === -1) return base;
  var i = 2;
  while (takenIds.indexOf(base + '-' + i) !== -1) i++;
  return base + '-' + i;
}

/**
 * Every company name the old calendar knows: company accounts (role 'user'), names on bookings and names ticked
 * for email alerts. Duplicates differing only in case/spaces count once; the first spelling seen wins
 * (company accounts first, as those are the names the admin typed).
 */
function companyNamesFrom(users, bookings, recipients) {
  var seen = {}, out = [];
  function add(n) {
    var clean = String(n || '').trim().replace(/\s+/g, ' ');
    var k = clean.toLowerCase();
    if (!clean || clean.length > 120 || seen[k]) return;
    seen[k] = true; out.push(clean);
  }
  (users || []).filter(function (u) { return u.role === 'user'; }).forEach(function (u) { add(u.displayName); });
  (bookings || []).forEach(function (b) { add(b.eventName); });
  (recipients || []).forEach(function (r) { (r.companies || []).forEach(add); });
  return out;
}

/**
 * Which companies to add to a calendar that may already have some. Returns
 * { add: [{id, name, color}], idOf: {lowercase name: id} } covering existing and new companies.
 * New companies get the next unused palette colour (the admin can change it later).
 */
function planCompanies(names, existing) {
  var idOf = {}, ids = [], colors = [], add = [];
  (existing || []).forEach(function (c) {
    idOf[nameKey(c.name)] = c.id; ids.push(c.id); colors.push(String(c.color || '').toLowerCase());
  });
  names.slice().sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; }).forEach(function (n) {
    if (idOf[nameKey(n)]) return;
    var id = companyIdFor(n, ids);
    var free = COMPANY_COLORS.filter(function (c) { return colors.indexOf(c) === -1; })[0];
    var color = free || COMPANY_COLORS[colors.length % COMPANY_COLORS.length];
    idOf[nameKey(n)] = id; ids.push(id); colors.push(color);
    add.push({ id: id, name: n, color: color });
  });
  return { add: add, idOf: idOf };
}

/** Email-alert ticks: old company names -> company ids (names with no company are dropped). */
function ticksToIds(names, idOf) {
  var out = [];
  (names || []).forEach(function (n) { var id = idOf[nameKey(n)]; if (id && out.indexOf(id) === -1) out.push(id); });
  return out;
}

/** Copy a booking when the calendar has no copy yet, or the old one was changed after the copy was made. */
function needsCopy(src, dst) {
  if (!dst) return true;
  return (src.updatedAt || 0) > (dst.updatedAt || 0);
}

// ------------------------------------------------------------------ Firestore access (owner's token)

function call(method, path, payload) {
  var res = UrlFetchApp.fetch(DB + path, {
    method: method,
    contentType: 'application/json',
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'x-goog-user-project': PROJECT_ID
    }
  });
  var code = res.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('Firestore ' + code + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}

/** Query a collection directly under base ('' = the root, '/calendars/tg' = inside that calendar). */
function runQuery(base, structuredQuery) {
  var rows = call('post', base + ':runQuery', { structuredQuery: structuredQuery }) || [];
  return rows.filter(function (r) { return r.document; }).map(function (r) { return fromDoc(r.document); });
}

function fieldFilter(field, op, value) {
  return { fieldFilter: { field: { fieldPath: field }, op: op, value: value } };
}

/** Every raw document of a collection (all pages). fields = optional list of field names to fetch (a mask). */
function listRaw(path, fields) {
  var out = [];
  var token = '';
  var mask = (fields || []).map(function (f) { return '&mask.fieldPaths=' + encodeURIComponent(f); }).join('');
  do {
    var r = call('get', path + '?pageSize=300' + mask + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    if (!r) break;
    (r.documents || []).forEach(function (d) { out.push(d); });
    token = r.nextPageToken || '';
  } while (token);
  return out;
}

function listAll(path, fields) { return listRaw(path, fields).map(fromDoc); }

function getSettings(base) {
  var d = call('get', base + '/settings/notifications');
  var s = d ? fromDoc(d) : {};
  return {
    onNew: s.onNew !== false,
    dayBefore: s.dayBefore !== false,
    twoHours: s.twoHours !== false,
    dayBeforeHour: typeof s.dayBeforeHour === 'number' ? s.dayBeforeHour : 17
  };
}

function alreadyDone(base, key) { return call('get', base + '/notifyLog/' + key) !== null; }

function markDone(base, key, sent) {
  call('patch', base + '/notifyLog/' + key, {
    fields: { sentAt: { timestampValue: new Date().toISOString() }, mailed: { booleanValue: !!sent } }
  });
}

// ------------------------------------------------------------------ sending

function sendOnce(cal, kind, b, recipients) {
  var base = basePath(cal);
  var key = logKey(kind, b);
  if (alreadyDone(base, key)) return 0;
  var to = recipientsFor(recipients, b.eventName, b.companyId);
  if (!to.length) { markDone(base, key, false); return 0; }
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(), // the owner's address; everybody else is in Bcc so addresses stay private
    bcc: to.join(','),
    subject: subjectFor(kind, b, cal),
    body: mailText(headingFor(kind), b, cal),
    htmlBody: mailBody(headingFor(kind), b, cal),
    name: SENDER_NAME
  });
  markDone(base, key, true);
  return to.length;
}

/** Runs every 5 minutes (installed by setup()). */
function checkAll() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var startedAt = Number(PropertiesService.getScriptProperties().getProperty('startedAt')) || Date.now();
    calendarsToCheck(listAll('/calendars')).forEach(function (cal) {
      try {
        checkCalendar(cal, startedAt);
      } catch (e) {
        console.error('Could not check calendar ' + (cal || '(old)') + ': ' + e); // the others still run; retried next time
      }
    });
  } finally {
    lock.releaseLock();
  }
}

/** One calendar (null = the old single-calendar paths), with its own settings, recipients and log. */
function checkCalendar(cal, startedAt) {
  var base = basePath(cal);
  var settings = getSettings(base);
  var recipients = listAll(base + '/notifyRecipients');
  if (!recipients.length) return;

  var now = Date.now();
  var today = Utilities.formatDate(new Date(now), TZ, 'yyyy-MM-dd');
  var tomorrow = Utilities.formatDate(new Date(now + 24 * 3600 * 1000), TZ, 'yyyy-MM-dd');
  var hourNow = Number(Utilities.formatDate(new Date(now), TZ, 'H'));

  // 1. new bookings (only ones created after setup(), so the old backlog is never mailed)
  if (settings.onNew) {
    var fresh = runQuery(base, {
      from: [{ collectionId: 'bookings' }],
      where: fieldFilter('createdAt', 'GREATER_THAN_OR_EQUAL', { timestampValue: new Date(startedAt).toISOString() }),
      limit: 200
    });
    fresh.forEach(function (b) { trySend(cal, 'new', b, recipients); });
  }

  // 2 + 3. reminders look at today's and tomorrow's bookings
  if (settings.dayBefore || settings.twoHours) {
    var soon = runQuery(base, {
      from: [{ collectionId: 'bookings' }],
      where: { compositeFilter: { op: 'AND', filters: [
        fieldFilter('bookingDate', 'GREATER_THAN_OR_EQUAL', { stringValue: today }),
        fieldFilter('bookingDate', 'LESS_THAN_OR_EQUAL', { stringValue: tomorrow })
      ] } },
      limit: 500
    });
    soon.forEach(function (b) {
      // Day-before: tomorrow's bookings, once the chosen hour has passed today.
      if (settings.dayBefore && b.bookingDate === tomorrow && hourNow >= settings.dayBeforeHour) {
        // A booking made after that hour already got its "new booking" mail; don't remind straight away.
        var late = (b.createdAt || 0) >= hourOnMs(today, settings.dayBeforeHour);
        trySend(cal, 'day', b, recipients, late);
      }
      // 2 hours before the slot starts (bookings without a slot only get the day-before mail).
      var start = slotStartMs(b.bookingDate, b.timeSlot);
      if (settings.twoHours && start !== null && start > now && start - now <= 2 * 3600 * 1000) {
        trySend(cal, 'two', b, recipients, (b.createdAt || 0) >= start - 2 * 3600 * 1000);
      }
    });
  }
}

function trySend(cal, kind, b, recipients, skipSilently) {
  try {
    if (skipSilently) {
      var base = basePath(cal), key = logKey(kind, b);
      if (!alreadyDone(base, key)) markDone(base, key, false);
      return;
    }
    sendOnce(cal, kind, b, recipients);
  } catch (e) {
    console.error('Could not process ' + kind + ' for booking ' + (cal || '') + '/' + b.id + ': ' + e); // retried at the next run
  }
}

// ------------------------------------------------------------------ one-time setup helpers (run from the editor)

/** Run once: remembers "now" as the start point and installs the 5-minute timer. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('startedAt')) props.setProperty('startedAt', String(Date.now()));
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'checkAll') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkAll').timeBased().everyMinutes(5).create();
  checkAll(); // proves the Firestore access works (an error here shows in the log)
  console.log('Setup done. Emails are checked every 5 minutes.');
}

/** Optional: sends a test mail to the owner to confirm Gmail sending works. */
function sendTest() {
  var sample = {
    eventName: 'Sample Company', bookingDate: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'),
    timeSlot: '08:00-10:00', deliveryType: 'Delivery stock', vehicleType: 'Truck', truckType: '10ton', truckCount: 1, palletized: true
  };
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'Booking calendar: test email',
    body: mailText('Test email', sample),
    htmlBody: mailBody('Test email', sample),
    name: SENDER_NAME
  });
}

/** Stop all emails: run this to remove the timer. */
function stopAll() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

// ------------------------------------------------------------------ one-time move to calendars (run from the editor)

/** Shows what migrateToCalendars() would do, without writing anything. */
function migrateDryRun() { return moveToDim(true); }

/**
 * Copies the old single-calendar data into calendars/dim, keeping ids, times and creators:
 * calendar doc, company list, bookings (+ companyId) and their attachments, blocked dates, time slots,
 * email settings and recipients (ticks become company ids), and the notify log (so no mail is sent twice).
 * Then suspends the old company logins (role 'user'); the admin account is not touched.
 * Safe to run again: it only copies what is missing, or bookings changed in the old app since the last copy.
 * The old data is NOT deleted.
 */
function migrateToCalendars() { return moveToDim(false); }

function moveToDim(dryRun) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) throw new Error('The mailer is busy; try again in a minute.');
  try {
    var now = { timestampValue: new Date().toISOString() };
    var w = writer(dryRun);
    var n = { calendar: 0, companies: 0, bookings: 0, bookingsUpToDate: 0, attachments: 0, blockedDates: 0,
      settings: 0, recipients: 0, logEntries: 0, loginsSuspended: 0 };
    var CAL = 'calendars/dim';

    // 1. the calendar itself
    if (!call('get', '/' + CAL)) {
      w.set(CAL, { name: { stringValue: 'DIM' }, order: { integerValue: '1' }, active: { booleanValue: true }, createdAt: now, updatedAt: now });
      n.calendar = 1;
    }

    // 2. the company list
    var users = listAll('/users');
    var oldBookingsRaw = listRaw('/bookings');
    var oldBookings = oldBookingsRaw.map(fromDoc);
    var oldRecipientsRaw = listRaw('/notifyRecipients');
    var plan = planCompanies(
      companyNamesFrom(users, oldBookings, oldRecipientsRaw.map(fromDoc)),
      listAll('/' + CAL + '/companies'));
    plan.add.forEach(function (c) {
      w.set(CAL + '/companies/' + c.id, { name: { stringValue: c.name }, color: { stringValue: c.color },
        active: { booleanValue: true }, createdAt: now, updatedAt: now });
    });
    n.companies = plan.add.length;

    // 3. bookings (+ companyId) and their attachments
    var copied = {};
    listAll('/' + CAL + '/bookings', ['updatedAt']).forEach(function (d) { copied[d.id] = d; });
    oldBookingsRaw.forEach(function (raw, i) {
      var b = oldBookings[i];
      if (!needsCopy(b, copied[b.id])) { n.bookingsUpToDate++; return; }
      var fields = JSON.parse(JSON.stringify(raw.fields || {}));
      var cid = plan.idOf[nameKey(b.eventName)];
      if (cid) fields.companyId = { stringValue: cid };
      w.set(CAL + '/bookings/' + b.id, fields);
      n.bookings++;
      (b.attachments || []).forEach(function (a) {
        if (!a || !a.id) return;
        var dst = '/' + CAL + '/bookings/' + b.id + '/attachments/' + a.id;
        if (call('get', dst + '?mask.fieldPaths=name')) return;
        var src = call('get', '/bookings/' + b.id + '/attachments/' + a.id);
        if (!src) return;
        w.set(dst.slice(1), src.fields || {});
        n.attachments++;
      });
    });

    // 4. blocked dates, time slots, email settings: copy what is missing
    n.blockedDates = copyMissing('/blockedDates', '/' + CAL + '/blockedDates', w, 'reason');
    ['slots', 'notifications'].forEach(function (s) {
      if (call('get', '/' + CAL + '/settings/' + s)) return;
      var src = call('get', '/settings/' + s);
      if (src) { w.set(CAL + '/settings/' + s, src.fields || {}); n.settings++; }
    });

    // 5. email recipients: company names become company ids
    var haveRecipients = {};
    listAll('/' + CAL + '/notifyRecipients', ['email']).forEach(function (r) { haveRecipients[r.id] = true; });
    oldRecipientsRaw.forEach(function (raw) {
      var r = fromDoc(raw);
      if (haveRecipients[r.id]) return;
      var fields = JSON.parse(JSON.stringify(raw.fields || {}));
      var ids = ticksToIds(r.companies, plan.idOf);
      fields.companies = { arrayValue: { values: ids.map(function (id) { return { stringValue: id }; }) } };
      w.set(CAL + '/notifyRecipients/' + r.id, fields);
      n.recipients++;
    });

    // 6. the notify log, so reminders already sent are not sent again
    n.logEntries = copyMissing('/notifyLog', '/' + CAL + '/notifyLog', w, 'sentAt');

    w.flush();

    // 7. old company logins are suspended (not deleted); staff accounts replace them
    users.filter(function (u) { return u.role === 'user' && u.status === 'active'; }).forEach(function (u) {
      w.patch('users/' + u.id, { status: { stringValue: 'suspended' }, updatedAt: now });
      n.loginsSuspended++;
    });
    w.flush();

    var report = (dryRun ? 'DRY RUN (nothing written): ' : 'Moved to calendars/dim: ') + JSON.stringify(n) +
      ' | old bookings in total: ' + oldBookings.length;
    console.log(report);
    return n;
  } finally {
    lock.releaseLock();
  }
}

/** Copies documents of one collection into another when the target id does not exist yet. Returns the count. */
function copyMissing(fromPath, toPath, w, maskField) {
  var have = {};
  listRaw(toPath, [maskField]).forEach(function (d) { have[d.name.split('/').pop()] = true; });
  var count = 0;
  listRaw(fromPath).forEach(function (d) {
    var id = d.name.split('/').pop();
    if (have[id]) return;
    w.set(toPath.slice(1) + '/' + id, d.fields || {});
    count++;
  });
  return count;
}

/** Collects writes and sends them in batches (Firestore commit: up to 500 writes, ~10 MB per request). */
function writer(dryRun) {
  var pending = [], bytes = 0;
  function push(write) {
    var size = JSON.stringify(write).length;
    if (pending.length && (pending.length >= 200 || bytes + size > 4000000)) flush();
    pending.push(write); bytes += size;
  }
  function flush() {
    if (pending.length && !dryRun) call('post', ':commit', { writes: pending });
    pending = []; bytes = 0;
  }
  return {
    set: function (path, fields) { push({ update: { name: DOCS + '/' + path, fields: fields } }); },
    patch: function (path, fields) {
      push({ update: { name: DOCS + '/' + path, fields: fields }, updateMask: { fieldPaths: Object.keys(fields) },
        currentDocument: { exists: true } });
    },
    flush: flush
  };
}

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
 * Nothing secret is stored here: it uses the signed-in owner's Google token. Setup steps: README section 7.3d.
 * Mail goes out from the owner's Gmail (limit: about 100 recipients a day on a free Google account;
 * each address counts, so keep the list short).
 */

var PROJECT_ID = 'dynamic-booking-calendar';
var APP_URL = 'https://petworldcloud-code.github.io/Dynamic-Booking-Calendar/';
var TZ = 'Asia/Kuala_Lumpur';
var UTC_OFFSET = '+08:00'; // Malaysia has no daylight saving
var SENDER_NAME = 'Dynamic Booking Calendar';
var DB = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';

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

function wantsCompany(recipient, company) {
  return !!recipient.allCompanies || (recipient.companies || []).indexOf(company) !== -1;
}

function recipientsFor(list, company) {
  return list.filter(function (r) { return wantsCompany(r, company); }).map(function (r) { return r.email; });
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
function detailRows(b) {
  var vehicle = b.vehicleType === 'Van' ? 'Van' : (b.truckType ? 'Truck (' + b.truckType + ')' : (b.vehicleType || ''));
  var rows = [
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

function mailBody(heading, b) {
  var trs = detailRows(b).map(function (r) {
    return '<tr><td style="padding:4px 14px 4px 0;color:#666">' + esc(r[0]) + '</td><td style="padding:4px 0"><b>' + esc(r[1]) + '</b></td></tr>';
  }).join('');
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' +
    '<h3 style="margin:0 0 10px">' + esc(heading) + '</h3><table>' + trs + '</table>' +
    '<p style="margin-top:14px"><a href="' + APP_URL + '">Open the booking calendar</a></p></div>';
}

function subjectFor(kind, b) {
  var when = b.bookingDate + (b.timeSlot ? ' ' + slotText(b.timeSlot) : '');
  if (kind === 'new') return 'New booking: ' + b.eventName + ' - ' + when;
  if (kind === 'day') return 'Reminder - tomorrow: ' + b.eventName + ' - ' + when;
  return 'Reminder - in 2 hours: ' + b.eventName + ' - ' + when;
}

function headingFor(kind) {
  if (kind === 'new') return 'A booking was added';
  if (kind === 'day') return 'Booking arriving tomorrow';
  return 'Booking arriving in about 2 hours';
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

function runQuery(structuredQuery) {
  var rows = call('post', ':runQuery', { structuredQuery: structuredQuery }) || [];
  return rows.filter(function (r) { return r.document; }).map(function (r) { return fromDoc(r.document); });
}

function fieldFilter(field, op, value) {
  return { fieldFilter: { field: { fieldPath: field }, op: op, value: value } };
}

function listRecipients() {
  var out = [];
  var token = '';
  do {
    var r = call('get', '/notifyRecipients?pageSize=100' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    if (!r) break;
    (r.documents || []).forEach(function (d) { out.push(fromDoc(d)); });
    token = r.nextPageToken || '';
  } while (token);
  return out;
}

function getSettings() {
  var d = call('get', '/settings/notifications');
  var s = d ? fromDoc(d) : {};
  return {
    onNew: s.onNew !== false,
    dayBefore: s.dayBefore !== false,
    twoHours: s.twoHours !== false,
    dayBeforeHour: typeof s.dayBeforeHour === 'number' ? s.dayBeforeHour : 17
  };
}

/** The log makes each mail go out once. Keys include date and slot, so a rescheduled booking is reminded again. */
function logKey(kind, b) {
  return kind + '_' + b.id + '_' + b.bookingDate + '_' + String(b.timeSlot || 'noslot').replace(/[^0-9a-z]/gi, '');
}

function alreadyDone(key) { return call('get', '/notifyLog/' + key) !== null; }

function markDone(key, sent) {
  call('patch', '/notifyLog/' + key, {
    fields: { sentAt: { timestampValue: new Date().toISOString() }, mailed: { booleanValue: !!sent } }
  });
}

// ------------------------------------------------------------------ sending

function sendOnce(kind, b, recipients, settings) {
  var key = logKey(kind, b);
  if (alreadyDone(key)) return 0;
  var to = recipientsFor(recipients, b.eventName);
  if (!to.length) { markDone(key, false); return 0; }
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(), // the owner's address; everybody else is in Bcc so addresses stay private
    bcc: to.join(','),
    subject: subjectFor(kind, b),
    htmlBody: mailBody(headingFor(kind), b),
    name: SENDER_NAME
  });
  markDone(key, true);
  return to.length;
}

/** Runs every 5 minutes (installed by setup()). */
function checkAll() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var startedAt = Number(props.getProperty('startedAt')) || Date.now();
    var settings = getSettings();
    var recipients = listRecipients();
    if (!recipients.length) return;

    var now = Date.now();
    var today = Utilities.formatDate(new Date(now), TZ, 'yyyy-MM-dd');
    var tomorrow = Utilities.formatDate(new Date(now + 24 * 3600 * 1000), TZ, 'yyyy-MM-dd');
    var hourNow = Number(Utilities.formatDate(new Date(now), TZ, 'H'));

    // 1. new bookings (only ones created after setup(), so the old backlog is never mailed)
    if (settings.onNew) {
      var fresh = runQuery({
        from: [{ collectionId: 'bookings' }],
        where: fieldFilter('createdAt', 'GREATER_THAN_OR_EQUAL', { timestampValue: new Date(startedAt).toISOString() }),
        limit: 200
      });
      fresh.forEach(function (b) { trySend('new', b, recipients, settings); });
    }

    // 2 + 3. reminders look at today's and tomorrow's bookings
    if (settings.dayBefore || settings.twoHours) {
      var soon = runQuery({
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
          trySend('day', b, recipients, settings, late);
        }
        // 2 hours before the slot starts (bookings without a slot only get the day-before mail).
        var start = slotStartMs(b.bookingDate, b.timeSlot);
        if (settings.twoHours && start !== null && start > now && start - now <= 2 * 3600 * 1000) {
          trySend('two', b, recipients, settings, (b.createdAt || 0) >= start - 2 * 3600 * 1000);
        }
      });
    }
  } finally {
    lock.releaseLock();
  }
}

function trySend(kind, b, recipients, settings, skipSilently) {
  try {
    if (skipSilently) { var key = logKey(kind, b); if (!alreadyDone(key)) markDone(key, false); return; }
    sendOnce(kind, b, recipients, settings);
  } catch (e) {
    console.error('Could not process ' + kind + ' for booking ' + b.id + ': ' + e); // retried at the next run
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
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'Booking calendar: test email',
    htmlBody: mailBody('Test email', {
      eventName: 'Sample Company', bookingDate: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'),
      timeSlot: '08:00-10:00', deliveryType: 'Delivery stock', vehicleType: 'Truck', truckType: '10ton', truckCount: 1, palletized: true
    }),
    name: SENDER_NAME
  });
}

/** Stop all emails: run this to remove the timer. */
function stopAll() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

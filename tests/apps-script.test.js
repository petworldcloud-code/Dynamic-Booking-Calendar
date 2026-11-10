// Runs apps-script/Code.gs against an in-memory fake of the Firestore REST API and the Google services,
// so the multi-calendar sender and migrateToCalendars() are checked without Google.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { companyId, COMPANY_COLORS, nextCompanyColor } from '../src/calendar-utils.js';

const gs = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const DOCS = 'projects/dynamic-booking-calendar/databases/(default)/documents';
const BASE_URL = `https://firestore.googleapis.com/v1/${DOCS}`;

// ---------- REST value helpers ----------
const S = (v) => ({ stringValue: v });
const I = (v) => ({ integerValue: String(v) });
const Bo = (v) => ({ booleanValue: v });
const T = (iso) => ({ timestampValue: iso });
const A = (vals) => ({ arrayValue: { values: vals } });
const plain = (v) => {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)]));
  return null;
};

// ---------- fake world ----------
function makeWorld({ now = Date.parse('2026-11-11T02:00:00Z'), startedAt = Date.parse('2026-11-01T00:00:00Z') } = {}) {
  const store = new Map(); // 'bookings/b1' -> fields
  const mails = [];
  const counts = { commits: 0 };
  const segs = (p) => p.split('/').filter(Boolean);
  const docOut = (path, fields) => ({ name: `${DOCS}/${path}`, fields });
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body ?? {}) });
  const masked = (fields, mask) => (mask.length ? Object.fromEntries(Object.entries(fields).filter(([k]) => mask.includes(k))) : fields);
  const match = (fields, f) => {
    if (f.compositeFilter) return f.compositeFilter.filters.every((x) => match(fields, x));
    const { field, op, value } = f.fieldFilter;
    const v = fields[field.fieldPath] ? plain(fields[field.fieldPath]) : undefined;
    const want = plain(value);
    if (v === undefined) return false;
    if (op === 'GREATER_THAN_OR_EQUAL') return v >= want;
    if (op === 'LESS_THAN_OR_EQUAL') return v <= want;
    if (op === 'EQUAL') return v === want;
    throw new Error('op ' + op);
  };

  const UrlFetchApp = {
    fetch(url, opts) {
      if (!url.startsWith(BASE_URL)) throw new Error('unexpected url ' + url);
      const [rawPath, qs = ''] = url.slice(BASE_URL.length).split('?');
      const params = new URLSearchParams(qs);
      const mask = params.getAll('mask.fieldPaths');
      const body = opts.payload ? JSON.parse(opts.payload) : null;
      const method = opts.method;

      if (rawPath.endsWith(':commit')) {
        counts.commits++;
        for (const w of body.writes) {
          const path = w.update.name.slice(DOCS.length + 1);
          if (w.currentDocument?.exists && !store.has(path)) return resp(400, { error: 'missing ' + path });
          if (w.updateMask) store.set(path, { ...(store.get(path) || {}), ...w.update.fields });
          else store.set(path, w.update.fields);
        }
        return resp(200, {});
      }
      if (rawPath.endsWith(':runQuery')) {
        const parent = segs(rawPath.slice(0, -':runQuery'.length)).join('/');
        const q = body.structuredQuery;
        const col = (parent ? parent + '/' : '') + q.from[0].collectionId;
        const rows = [...store.entries()]
          .filter(([p]) => p.startsWith(col + '/') && segs(p).length === segs(col).length + 1)
          .filter(([, f]) => !q.where || match(f, q.where))
          .map(([p, f]) => ({ document: docOut(p, f) }));
        return resp(200, rows.length ? rows : [{ readTime: 'x' }]);
      }
      const path = segs(rawPath).join('/');
      if (method === 'patch') { store.set(path, body.fields); return resp(200, docOut(path, body.fields)); }
      if (method === 'get') {
        if (segs(path).length % 2 === 0) {
          return store.has(path) ? resp(200, docOut(path, masked(store.get(path), mask))) : resp(404, { error: 'nf' });
        }
        const docs = [...store.entries()]
          .filter(([p]) => p.startsWith(path + '/') && segs(p).length === segs(path).length + 1)
          .map(([p, f]) => docOut(p, masked(f, mask)));
        return resp(200, docs.length ? { documents: docs } : {});
      }
      throw new Error('unexpected ' + method + ' ' + url);
    }
  };
  const pad = (n) => String(n).padStart(2, '0');
  const Utilities = {
    formatDate(d, tz, fmt) {
      const m = new Date(d.getTime() + 8 * 3600 * 1000); // Malaysia
      if (fmt === 'yyyy-MM-dd') return `${m.getUTCFullYear()}-${pad(m.getUTCMonth() + 1)}-${pad(m.getUTCDate())}`;
      if (fmt === 'H') return String(m.getUTCHours());
      throw new Error(fmt);
    }
  };
  const globals = {
    UrlFetchApp, Utilities,
    ScriptApp: { getOAuthToken: () => 'token' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'startedAt' ? String(startedAt) : null) }) },
    MailApp: { sendEmail: (m) => mails.push(m) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@x.co' }) },
    console: { log() {}, error: (...a) => { throw new Error('script error: ' + a.join(' ')); } }
  };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now])); }
    static now() { return now; }
  }
  const names = Object.keys(globals);
  const lib = new Function(...names, 'Date', `${gs}; return { checkAll, migrateToCalendars, migrateDryRun, calendarsToCheck,
    companyIdFor, planCompanies, companyNamesFrom, ticksToIds, needsCopy, subjectFor, mailText, linkFor, recipientsFor };`)(
    ...names.map((n) => globals[n]), FakeDate);
  const get = (p) => (store.has(p) ? Object.fromEntries(Object.entries(store.get(p)).map(([k, v]) => [k, plain(v)])) : undefined);
  const list = (col) => [...store.keys()].filter((p) => p.startsWith(col + '/') && segs(p).length === segs(col).length + 1);
  return { store, mails, lib, get, list, counts };
}

// ---------- the old single-calendar data ----------
function seedOld(w) {
  const put = (p, f) => w.store.set(p, f);
  put('users/admin', { displayName: S('DIM Admin'), role: S('admin'), status: S('active'), email: S('a@x.co') });
  put('users/u-tefal', { displayName: S('Tefal'), role: S('user'), status: S('active'), email: S('t@x.co') });
  put('users/u-gone', { displayName: S('Gone Co'), role: S('user'), status: S('suspended'), email: S('g@x.co') });
  const booking = (id, name, by, created, updated, extra = {}) => put(`bookings/${id}`, {
    bookingDate: S('2026-11-12'), eventName: S(name), truckType: S('5ton'), truckCount: I(1), timeSlot: S('08:00-10:00'),
    createdBy: S(by), createdByName: S(by), createdAt: T(created), updatedBy: S(by), updatedByName: S(by), updatedAt: T(updated), ...extra
  });
  booking('b1', 'Tefal', 'u-tefal', '2026-11-05T01:00:00Z', '2026-11-05T01:00:00Z', {
    attachments: A([{ mapValue: { fields: { id: S('att1'), name: S('a.pdf') } } }])
  });
  booking('b2', 'Shell ', 'admin', '2026-11-06T01:00:00Z', '2026-11-06T01:00:00Z'); // stray space in the name
  put('bookings/b1/attachments/att1', { name: S('a.pdf'), type: S('application/pdf'), size: I(3), data: S('QUJD'), createdBy: S('u-tefal'), createdAt: T('2026-11-05T01:00:00Z') });
  put('blockedDates/2026-12-25', { reason: S('Christmas'), createdBy: S('admin'), createdAt: T('2026-11-01T00:00:00Z') });
  put('settings/slots', { slots: A([S('08:00-10:00')]), updatedBy: S('admin'), updatedAt: T('2026-11-01T00:00:00Z') });
  put('settings/notifications', { onNew: Bo(true), dayBefore: Bo(true), twoHours: Bo(true), dayBeforeHour: I(17), updatedBy: S('admin'), updatedAt: T('2026-11-01T00:00:00Z') });
  put('settings/retention', { autoDeleteEnabled: Bo(false), retentionDays: I(90) });
  put('notifyRecipients/all@x.co', { email: S('all@x.co'), allCompanies: Bo(true), companies: A([]), createdBy: S('admin'), createdAt: T('2026-11-01T00:00:00Z') });
  put('notifyRecipients/acme@x.co', { email: S('acme@x.co'), allCompanies: Bo(false), companies: A([S('Acme'), S('tefal')]), createdBy: S('admin'), createdAt: T('2026-11-01T00:00:00Z') });
  put('notifyLog/new_b1_2026-11-12_08001000', { sentAt: T('2026-11-05T01:05:00Z'), mailed: Bo(true) });
}

describe('Code.gs company helpers match the app', () => {
  const { lib } = makeWorld();
  it('makes the same company ids as src/calendar-utils.js', () => {
    for (const [name, taken] of [['Shell', []], ['Tefal Sdn. Bhd.', []], ['Shell', ['shell']], ['Shell', ['shell', 'shell-2']], ['!!!', []]]) {
      expect(lib.companyIdFor(name, taken)).toBe(companyId(name, taken.map((id) => ({ id }))));
    }
  });
  it('gives new companies the next unused palette colour, like the app', () => {
    const existing = [{ id: 'x', name: 'X', color: COMPANY_COLORS[0] }];
    const plan = lib.planCompanies(['Beta', 'alpha', 'X'], existing);
    expect(plan.add.map((c) => c.name)).toEqual(['alpha', 'Beta']); // X already exists (any case)
    expect(plan.add[0].color).toBe(nextCompanyColor(existing));
    expect(plan.add[1].color).toBe(nextCompanyColor([...existing, plan.add[0]]));
    expect(plan.idOf).toEqual({ x: 'x', alpha: 'alpha', beta: 'beta' });
  });
  it('collects names from accounts, bookings and alert ticks once each', () => {
    const names = lib.companyNamesFrom(
      [{ role: 'user', displayName: 'Tefal' }, { role: 'admin', displayName: 'Admin' }],
      [{ eventName: 'tefal' }, { eventName: ' Shell  Co ' }],
      [{ companies: ['Acme', 'SHELL CO'] }]);
    expect(names).toEqual(['Tefal', 'Shell Co', 'Acme']);
    expect(lib.ticksToIds(['Acme', 'acme', 'Nope'], { acme: 'acme' })).toEqual(['acme']);
  });
  it('picks calendars to check', () => {
    expect(lib.calendarsToCheck([])).toEqual([null]);
    expect(lib.calendarsToCheck([{ id: 'tg', order: 2 }, { id: 'dim', order: 1 }, { id: 'nf', order: 3, active: false }])).toEqual(['dim', 'tg']);
    expect(lib.calendarsToCheck([{ id: 'nf', active: false }])).toEqual([]);
  });
  it('tags subjects and links with the calendar', () => {
    const b = { bookingDate: '2026-11-12', eventName: 'Shell', timeSlot: '08:00-10:00' };
    expect(lib.subjectFor('new', b, 'tg')).toBe('[TG] New booking: Shell - 2026-11-12 08:00 – 10:00');
    expect(lib.subjectFor('new', b)).toBe('New booking: Shell - 2026-11-12 08:00 – 10:00');
    expect(lib.mailText('Hi', b, 'tg')).toContain('Calendar: TG');
    expect(lib.mailText('Hi', b, 'tg')).toContain('Dynamic-Booking-Calendar/#tg');
  });
});

describe('migrateToCalendars()', () => {
  let w;
  beforeEach(() => { w = makeWorld(); seedOld(w); });

  it('dry run writes nothing', () => {
    const before = JSON.stringify([...w.store]);
    const n = w.lib.migrateDryRun();
    expect(JSON.stringify([...w.store])).toBe(before);
    expect(n).toMatchObject({ calendar: 1, bookings: 2, companies: 4, loginsSuspended: 1 });
  });

  it('copies everything into calendars/dim and suspends old company logins', () => {
    const n = w.lib.migrateToCalendars();
    expect(n).toEqual({ calendar: 1, companies: 4, bookings: 2, bookingsUpToDate: 0, attachments: 1, blockedDates: 1,
      settings: 2, recipients: 2, logEntries: 1, loginsSuspended: 1 });
    expect(w.get('calendars/dim')).toMatchObject({ name: 'DIM', order: 1, active: true });
    // companies: account names first spelling wins; stray spaces cleaned
    const cos = w.list('calendars/dim/companies').map((p) => w.get(p).name).sort();
    expect(cos).toEqual(['Acme', 'Gone Co', 'Shell', 'Tefal']);
    // bookings keep id, times and creator, and gain companyId
    expect(w.get('calendars/dim/bookings/b1')).toMatchObject({ eventName: 'Tefal', companyId: 'tefal', createdBy: 'u-tefal',
      createdAt: Date.parse('2026-11-05T01:00:00Z') });
    expect(w.get('calendars/dim/bookings/b2').companyId).toBe('shell');
    expect(w.get('calendars/dim/bookings/b1/attachments/att1')).toMatchObject({ name: 'a.pdf', data: 'QUJD' });
    expect(w.get('calendars/dim/blockedDates/2026-12-25').reason).toBe('Christmas');
    expect(w.get('calendars/dim/settings/slots').slots).toEqual(['08:00-10:00']);
    expect(w.get('calendars/dim/settings/notifications').dayBeforeHour).toBe(17);
    expect(w.get('calendars/dim/settings/retention')).toBeUndefined(); // stays global
    // alert ticks become company ids
    expect(w.get('calendars/dim/notifyRecipients/acme@x.co')).toMatchObject({ allCompanies: false, companies: ['acme', 'tefal'] });
    expect(w.get('calendars/dim/notifyRecipients/all@x.co')).toMatchObject({ allCompanies: true, companies: [] });
    expect(w.get('calendars/dim/notifyLog/new_b1_2026-11-12_08001000').mailed).toBe(true);
    // logins
    expect(w.get('users/u-tefal').status).toBe('suspended');
    expect(w.get('users/admin').status).toBe('active');
    expect(w.get('users/u-tefal').displayName).toBe('Tefal'); // patched, not replaced
    // old data stays as a backup
    expect(w.get('bookings/b1')).toBeDefined();
  });

  it('is safe to run twice, and picks up bookings added or changed in the old app meanwhile', () => {
    w.lib.migrateToCalendars();
    const again = w.lib.migrateToCalendars();
    expect(again).toEqual({ calendar: 0, companies: 0, bookings: 0, bookingsUpToDate: 2, attachments: 0, blockedDates: 0,
      settings: 0, recipients: 0, logEntries: 0, loginsSuspended: 0 });

    w.store.set('bookings/b1', { ...w.store.get('bookings/b1'), notes: S('changed'), updatedAt: T('2026-11-10T00:00:00Z') });
    w.store.set('bookings/b3', { ...w.store.get('bookings/b2'), eventName: S('NewCo') });
    const third = w.lib.migrateToCalendars();
    expect(third).toMatchObject({ bookings: 2, bookingsUpToDate: 1, companies: 1 });
    expect(w.get('calendars/dim/bookings/b1').notes).toBe('changed');
    expect(w.get('calendars/dim/bookings/b3').companyId).toBe('newco');
  });

  it('keeps changes made in the new app when the old copy is older', () => {
    w.lib.migrateToCalendars();
    w.store.set('calendars/dim/bookings/b2', { ...w.store.get('calendars/dim/bookings/b2'), notes: S('edited in new app'), updatedAt: T('2026-11-10T00:00:00Z') });
    w.lib.migrateToCalendars();
    expect(w.get('calendars/dim/bookings/b2').notes).toBe('edited in new app');
  });
});

describe('checkAll()', () => {
  it('before the move it mails from the old paths, matching company names', () => {
    const w = makeWorld(); seedOld(w);
    w.lib.checkAll();
    // b1's "new" mail is already in the log; b2 (Shell) is new -> only the All-companies address
    const news = w.mails.filter((m) => m.subject.startsWith('New booking'));
    expect(news.map((m) => [m.subject, m.bcc])).toEqual([['New booking: Shell  - 2026-11-12 08:00 – 10:00', 'all@x.co']]);
    expect(w.get('notifyLog/new_b2_2026-11-12_08001000').mailed).toBe(true);
  });

  it('after the move it mails per calendar, never repeats a mail, and matches ticks by company id', () => {
    const w = makeWorld(); seedOld(w);
    w.lib.checkAll();             // old sender run before the move
    w.lib.migrateToCalendars();
    const before = w.mails.length;
    w.lib.checkAll();             // first run of the new sender on calendars/dim
    expect(w.mails.slice(before).filter((m) => /New booking/.test(m.subject))).toEqual([]); // nothing resent

    // TG: its own company, recipient and settings
    w.store.set('calendars/tg', { name: S('TG'), order: I(2), active: Bo(true) });
    w.store.set('calendars/tg/companies/shell', { name: S('Shell'), color: S('#2563eb'), active: Bo(true) });
    w.store.set('calendars/tg/notifyRecipients/tg@x.co', { email: S('tg@x.co'), allCompanies: Bo(false), companies: A([S('shell')]) });
    w.store.set('calendars/tg/bookings/t1', {
      bookingDate: S('2026-11-20'), eventName: S('Shell'), companyId: S('shell'), truckType: S('5ton'), truckCount: I(1),
      createdBy: S('tina'), createdByName: S('Tina'), createdAt: T('2026-11-11T01:00:00Z'), updatedAt: T('2026-11-11T01:00:00Z')
    });
    // an archived calendar is skipped
    w.store.set('calendars/nf', { name: S('NF'), order: I(3), active: Bo(false) });
    w.store.set('calendars/nf/notifyRecipients/nf@x.co', { email: S('nf@x.co'), allCompanies: Bo(true), companies: A([]) });
    w.store.set('calendars/nf/bookings/n1', { ...w.store.get('calendars/tg/bookings/t1') });

    const mark = w.mails.length;
    w.lib.checkAll();
    const sent = w.mails.slice(mark).filter((m) => /New booking/.test(m.subject));
    expect(sent.map((m) => [m.subject, m.bcc])).toEqual([['[TG] New booking: Shell - 2026-11-20', 'tg@x.co']]);
    expect(sent[0].body).toContain('#tg');
    expect(w.get('calendars/tg/notifyLog/new_t1_2026-11-20_noslot').mailed).toBe(true);

    w.lib.checkAll();
    expect(w.mails.length).toBe(mark + 1); // sent once
  });
});

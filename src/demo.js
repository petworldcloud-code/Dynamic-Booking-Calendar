// In-memory mock backend for UI/layout verification ONLY (VITE_DEMO_MODE=demo).
// Sample rows are generated relative to today; nothing here ships as production data.
import { todayISO, addDays } from './date-utils.js';
import { cleanCompany, companyId } from './calendar-utils.js';
import { cleanRecipient, cleanNotifySettings, DEFAULT_NOTIFY, MAX_RECIPIENTS } from './notify-utils.js';

// ?as=tg opens the demo as TG staff; ?as=none as staff with no calendar. Default: admin.
const asParam = new URLSearchParams(globalThis.location?.search || '').get('as');
const me = asParam
  ? { uid: 'demo-staff', displayName: 'Demo Staff', email: 'staff@example.com' }
  : { uid: 'demo-admin', displayName: 'Demo Admin', email: 'demo@example.com' };
const profile = asParam
  ? { ...me, role: 'staff', status: 'active', ...(asParam === 'none' ? {} : { calendar: asParam }) }
  : { ...me, role: 'admin', status: 'active' };
const calendars = [
  { id: 'dim', name: 'DIM', order: 1, active: true }, { id: 'tg', name: 'TG', order: 2, active: true },
  { id: 'nf', name: 'NF', order: 3, active: true }, { id: 'pme', name: 'PME', order: 4, active: true }
];
// Per-calendar company lists (id = lowercase name). Each company has its own colour.
const PAL = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4d7c0f', '#ea580c', '#475569', '#0d9488', '#9333ea'];
const mkCos = (list) => list.map((n, i) => ({ id: n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: n, color: PAL[i % PAL.length], active: true }));
const companies = {
  dim: mkCos(['Tefal', 'Sony', '3M', 'GOON', 'Nestle', 'Unilever', 'Coca Cola', 'Watsons', 'Dove', 'Pepsi', 'Samsung', 'Lenovo']),
  tg: mkCos(['TG Logistics', 'Shell', 'Petronas']), nf: mkCos(['NF Supplier']), pme: []
};
const coSubs = new Set();
const fireCos = () => coSubs.forEach((f) => f());
const calSubs = new Set();
let users = [
  { ...profile },
  { uid: 'u2', displayName: 'Pending Person', email: 'pending@example.com', role: 'user', status: 'pending' },
  { uid: 'u3', displayName: 'Aisyah (TG staff)', email: 'aisyah@example.com', role: 'staff', status: 'active', calendar: 'tg' },
  { uid: 'u4', displayName: 'Lee (DIM staff)', email: 'lee@example.com', role: 'staff', status: 'active', calendar: 'dim' }
];
const userSubs = new Set();
let currentCal = null;
const inCal = (r) => (r.cal || 'dim') === (currentCal || 'dim');
let seq = 0;
let rows = [];
const subs = new Set();
const notify = () => subs.forEach((f) => f());
let slots = ['08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00'];
const slotSubs = new Set();
const blocked = new Map([[addDays(todayISO(), 5), 'Public holiday'], [addDays(todayISO(), 6), 'Public holiday']]);
const blockedSubs = new Set();
const recipSubs = new Set();
const recipientsBy = { dim: new Map([['ops@example.com', { email: 'ops@example.com', allCompanies: true, companies: [] }]]) };
const recipientsOf = () => (recipientsBy[currentCal || 'dim'] ||= new Map()); // each calendar has its own list
let notifySettings = { ...DEFAULT_NOTIFY };

const names = ['Tefal', 'Sony', '3M', 'GOON', 'Nestle', 'Unilever', 'Coca Cola', 'Watsons', 'Dove', 'Pepsi', 'Samsung', 'Lenovo'];
function mk(dayOffset, eventName, n = 0, cal = 'dim') {
  seq += 1;
  return {
    cal,
    id: `d${String(seq).padStart(3, '0')}`, ...(companies[cal]?.find((c) => c.name === eventName) ? { companyId: companies[cal].find((c) => c.name === eventName).id } : {}), bookingDate: addDays(todayISO(), dayOffset), eventName, notes: '',
    ...(seq % 5 === 0 ? { vehicleType: 'Van' } : { vehicleType: 'Truck', truckType: ['40footer', '20footer', '10ton', '5ton', '3ton', '1ton'][seq % 6] }),
    deliveryType: ['Delivery stock', 'Container pull', 'Unloading'][seq % 3],
    truckCount: (seq % 6) + 1, palletized: seq % 2 === 0, ...(seq % 3 === 0 ? { plateNumber: `WXY ${1000 + seq}` } : {}), attachments: [],
    timeSlot: ['08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00'][seq % 4],
    createdBy: me.uid, createdByName: me.displayName, updatedBy: me.uid, updatedByName: me.displayName,
    createdAt: { toMillis: () => 1000 + seq }, updatedAt: { toMillis: () => 1000 + seq + n }
  };
}
[[0, 0], [0, 1], [1, 2], [3, 3], [4, 4], [6, 5], [7, 6], [9, 7], [10, 4], [14, 8], [16, 9], [20, 10], [24, 11]]
  .forEach(([d, i]) => rows.push(mk(d, names[i])));
for (let i = 0; i < 8; i++) rows.push(mk(12, `Overflow ${i + 1}`)); // 8 on one day => "+2 more"
rows.push(mk(-5, 'Past booking A'), mk(-30, 'Past booking B'));
[[0, 'TG Logistics'], [2, 'Shell'], [8, 'Petronas']].forEach(([d, n]) => rows.push(mk(d, n, 0, 'tg')));
rows.push(mk(1, 'NF Supplier', 0, 'nf'));

const byDate = (a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.createdAt.toMillis() - b.createdAt.toMillis();

function sub(fn) { const run = () => fn(); subs.add(run); run(); return () => subs.delete(run); }

export const api = {
  watchSession(cb) { setTimeout(() => cb({ state: 'active', user: me, profile }), 50); return () => {}; },
  login: async () => {}, logout: async () => {}, resetPassword: async () => {},
  async adminCreateUser({ name, email, role, calendar }) {
    if (role === 'staff' && !calendar) throw new Error('Choose which calendar this staff member uses.');
    users.push({ uid: `u${users.length + 1}`, displayName: name, email, role, status: 'active', ...(calendar ? { calendar } : {}) });
    userSubs.forEach((f) => f()); return 'demo-new';
  },
  changePassword: async () => {},
  setCalendar(c) { currentCal = c || null; },
  getCalendar: () => currentCal,
  // ?legacy acts like today's live site, where the rules refuse the calendars list.
  watchCalendars(cb, onError) {
    const legacy = new URLSearchParams(globalThis.location?.search || '').has('legacy');
    if (legacy) { setTimeout(() => onError({ code: 'permission-denied' }), 20); return () => {}; }
    const run = () => cb(calendars.map((c) => ({ ...c })));
    calSubs.add(run); setTimeout(run, 20);
    return () => calSubs.delete(run);
  },
  async createCalendar(code, order) { calendars.push({ id: code, name: code.toUpperCase(), order, active: true }); companies[code] = []; calSubs.forEach((f) => f()); },
  async setCalendarActive(id, active) { calendars.find((c) => c.id === id).active = active; calSubs.forEach((f) => f()); },
  watchCompanies(cb) {
    const run = () => cb((companies[currentCal || 'dim'] || []).map((c) => ({ ...c })));
    coSubs.add(run); run();
    return () => coSubs.delete(run);
  },
  async addCompany(form, existing = []) {
    const c = cleanCompany(form, existing);
    const list = (companies[currentCal || 'dim'] ||= []);
    list.push({ id: companyId(c.name, list), ...c, active: true }); fireCos();
  },
  async updateCompany(id, form, existing = []) {
    const c = cleanCompany(form, existing, id);
    Object.assign((companies[currentCal || 'dim'] || []).find((x) => x.id === id), c); fireCos();
  },
  async setCompanyActive(id, active) { (companies[currentCal || 'dim'] || []).find((x) => x.id === id).active = active; fireCos(); },
  watchRange(s, e, cb) { return sub(() => cb(rows.filter((r) => inCal(r) && r.bookingDate >= s && r.bookingDate <= e).sort(byDate))); },
  watchList({ from, before, max = 50 }, cb) {
    return sub(() => {
      const mine = rows.filter(inCal);
      const l = before ? mine.filter((r) => r.bookingDate < before).sort((a, b) => byDate(b, a))
        : mine.filter((r) => r.bookingDate >= from).sort(byDate);
      cb(l.slice(0, max));
    });
  },
  async createBooking(user, f, files = []) {
    seq += 1; rows.push({ ...mk(0, f.eventName, 0, currentCal || 'dim'), ...f, attachments: files.map(({ id, name, type, size }) => ({ id, name, type, size })), id: `d${seq}x` }); notify();
  },
  getAttachment: async () => null,
  async updateBooking(user, id, expected, f) {
    const r = rows.find((x) => x.id === id);
    if (!r) throw Object.assign(new Error('This booking no longer exists.'), { code: 'gone' });
    if (r.updatedAt.toMillis() !== expected) throw Object.assign(new Error('Someone else changed this booking.'), { code: 'conflict' });
    for (const k of ['truckType', 'plateNumber', 'timeSlot', 'deliveryType']) delete r[k]; // optional fields cleared when empty, as in Firestore
    seq += 1; Object.assign(r, f, { updatedAt: { toMillis: () => 5000 + seq } }); notify();
  },
  async deleteBooking(b) { rows = rows.filter((r) => r.id !== b.id); notify(); },
  millis: (t) => (t && t.toMillis ? t.toMillis() : 0),
  watchUsers(cb) {
    const run = () => cb(users.map((u) => ({ ...u })));
    userSubs.add(run); run();
    return () => userSubs.delete(run);
  },
  async updateUser(uid, f) {
    const u = users.find((x) => x.uid === uid);
    Object.assign(u, f); if ('calendar' in f && !f.calendar) delete u.calendar; userSubs.forEach((x) => x());
  },
  async deleteUser(uid) { users = users.filter((u) => u.uid !== uid); userSubs.forEach((x) => x()); },
  getRetention: async () => ({ autoDeleteEnabled: false, retentionDays: 90 }),
  saveRetention: async () => {},
  watchSlots(cb) {
    const run = () => cb([...slots]);
    slotSubs.add(run); run();
    return () => slotSubs.delete(run);
  },
  async saveSlots(uid, list) { slots = [...list]; slotSubs.forEach((f) => f()); },
  watchBlocked(cb) {
    const run = () => cb(new Map(blocked));
    blockedSubs.add(run); run();
    return () => blockedSubs.delete(run);
  },
  async blockDates(uid, dates, reason, all) {
    dates.forEach((d) => blocked.set(d, reason)); blockedSubs.forEach((f) => f());
    globalThis.__demoBlockedAll = all; // lets a browser check see what was asked for
  },
  async unblockDate(d) { blocked.delete(d); blockedSubs.forEach((f) => f()); },
  watchRecipients(cb) {
    const run = () => cb([...recipientsOf().values()].sort((a, b) => a.email.localeCompare(b.email)));
    recipSubs.add(run); run();
    return () => recipSubs.delete(run);
  },
  async saveRecipient(uid, form, count, isNew) {
    const r = cleanRecipient(form);
    if (isNew && count >= MAX_RECIPIENTS) throw new Error(`At most ${MAX_RECIPIENTS} email addresses.`);
    recipientsOf().set(r.email, r); recipSubs.forEach((f) => f());
  },
  async removeRecipient(email) { recipientsOf().delete(email); recipSubs.forEach((f) => f()); },
  watchNotifySettings(cb) { cb({ ...notifySettings }); return () => {}; },
  async saveNotifySettings(uid, s) { notifySettings = cleanNotifySettings(s); }
};

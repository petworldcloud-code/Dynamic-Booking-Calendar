// In-memory mock backend for UI/layout verification ONLY (VITE_DEMO_MODE=demo).
// Sample rows are generated relative to today; nothing here ships as production data.
import { todayISO, addDays } from './date-utils.js';

const me = { uid: 'demo-admin', displayName: 'Demo Admin', email: 'demo@example.com' };
const profile = { ...me, role: 'admin', status: 'active' };
let seq = 0;
let rows = [];
const subs = new Set();
const notify = () => subs.forEach((f) => f());

const names = ['Tefal', 'Sony', '3M', 'GOON', 'Nestle', 'Unilever', 'Coca Cola', 'Watsons', 'Dove', 'Pepsi', 'Samsung', 'Lenovo'];
function mk(dayOffset, eventName, n = 0) {
  seq += 1;
  return {
    id: `d${String(seq).padStart(3, '0')}`, bookingDate: addDays(todayISO(), dayOffset), eventName, notes: '',
    truckType: ['40footer', '20footer', '10ton', '5ton', '3ton', '1ton'][seq % 6], truckCount: (seq % 6) + 1, attachments: [],
    createdBy: me.uid, createdByName: me.displayName, updatedBy: me.uid, updatedByName: me.displayName,
    createdAt: { toMillis: () => 1000 + seq }, updatedAt: { toMillis: () => 1000 + seq + n }
  };
}
[[0, 0], [0, 1], [1, 2], [3, 3], [4, 4], [6, 5], [7, 6], [9, 7], [10, 4], [14, 8], [16, 9], [20, 10], [24, 11]]
  .forEach(([d, i]) => rows.push(mk(d, names[i])));
for (let i = 0; i < 8; i++) rows.push(mk(12, `Overflow ${i + 1}`)); // 8 on one day => "+2 more"
rows.push(mk(-5, 'Past booking A'), mk(-30, 'Past booking B'));

const byDate = (a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.createdAt.toMillis() - b.createdAt.toMillis();

function sub(fn) { const run = () => fn(); subs.add(run); run(); return () => subs.delete(run); }

export const api = {
  watchSession(cb) { setTimeout(() => cb({ state: 'active', user: me, profile }), 50); return () => {}; },
  login: async () => {}, logout: async () => {}, resetPassword: async () => {},
  adminCreateUser: async () => 'demo-new', changePassword: async () => {},
  watchRange(s, e, cb) { return sub(() => cb(rows.filter((r) => r.bookingDate >= s && r.bookingDate <= e).sort(byDate))); },
  watchList({ from, before, max = 50 }, cb) {
    return sub(() => {
      const l = before ? rows.filter((r) => r.bookingDate < before).sort((a, b) => byDate(b, a))
        : rows.filter((r) => r.bookingDate >= from).sort(byDate);
      cb(l.slice(0, max));
    });
  },
  async createBooking(user, f, files = []) {
    seq += 1; rows.push({ ...mk(0, f.eventName), ...f, attachments: files.map(({ id, name, type, size }) => ({ id, name, type, size })), id: `d${seq}x` }); notify();
  },
  getAttachment: async () => null,
  async updateBooking(user, id, expected, f) {
    const r = rows.find((x) => x.id === id);
    if (!r) throw Object.assign(new Error('This booking no longer exists.'), { code: 'gone' });
    if (r.updatedAt.toMillis() !== expected) throw Object.assign(new Error('Someone else changed this booking.'), { code: 'conflict' });
    seq += 1; Object.assign(r, f, { updatedAt: { toMillis: () => 5000 + seq } }); notify();
  },
  async deleteBooking(b) { rows = rows.filter((r) => r.id !== b.id); notify(); },
  millis: (t) => (t && t.toMillis ? t.toMillis() : 0),
  watchUsers(cb) {
    cb([{ ...profile }, { uid: 'u2', displayName: 'Pending Person', email: 'pending@example.com', role: 'user', status: 'pending' }]);
    return () => {};
  },
  async updateUser() {},
  getRetention: async () => ({ autoDeleteEnabled: false, retentionDays: 90 }),
  saveRetention: async () => {}
};

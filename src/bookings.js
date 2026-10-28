import {
  collection, doc, query, where, orderBy, limit, onSnapshot, getDoc, writeBatch,
  runTransaction, serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase.js';

export const TRUCK_TYPES = ['40footer', '20footer', '10ton', '5ton', '3ton', '1ton'];
export const TRUCK_COUNTS = [1, 2, 3, 4, 5, 6];

const col = () => collection(db, 'bookings');
const attCol = (bookingId) => collection(db, 'bookings', bookingId, 'attachments');
const WRITE_TIMEOUT_MS = 20000;

const toBooking = (d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) });
export const millis = (ts) => (ts && ts.toMillis ? ts.toMillis() : 0);

/** Stable order: bookingDate, createdAt, then id. */
export function sortStable(list) {
  return [...list].sort((a, b) =>
    a.bookingDate.localeCompare(b.bookingDate) || millis(a.createdAt) - millis(b.createdAt) || a.id.localeCompare(b.id));
}

/** One range query feeds the whole calendar (no per-cell reads). */
export function watchRange(startISO, endISO, cb, onError) {
  const q = query(col(), where('bookingDate', '>=', startISO), where('bookingDate', '<=', endISO),
    orderBy('bookingDate'), orderBy('createdAt'));
  return onSnapshot(q, (s) => cb(sortStable(s.docs.map(toBooking))), onError);
}

/** Table/history list: upcoming (asc, date >= from) or history (desc, date < before). */
export function watchList({ from, before, max = 50 }, cb, onError) {
  const cons = before
    ? [where('bookingDate', '<', before), orderBy('bookingDate', 'desc'), orderBy('createdAt', 'desc')]
    : [where('bookingDate', '>=', from), orderBy('bookingDate'), orderBy('createdAt')];
  const q = query(col(), ...cons, limit(max));
  return onSnapshot(q, (s) => cb(s.docs.map(toBooking)), onError);
}

function withTimeout(p) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(
      () => rej(new Error('The server did not confirm the save. Check your connection and try again.')), WRITE_TIMEOUT_MS))
  ]);
}

const meta = (f) => ({ id: f.id, name: f.name, type: f.type, size: f.size });
const attDoc = (user, f) => ({
  name: f.name, type: f.type, size: f.size, data: f.data, createdBy: user.uid, createdAt: serverTimestamp()
});

export function createBooking(user, fields, files = []) {
  const ref = doc(col());
  const batch = writeBatch(db);
  batch.set(ref, {
    bookingDate: fields.bookingDate, eventName: fields.eventName, notes: fields.notes || '',
    truckType: fields.truckType, truckCount: fields.truckCount, attachments: files.map(meta),
    createdBy: user.uid, createdByName: user.displayName, createdAt: serverTimestamp(),
    updatedBy: user.uid, updatedByName: user.displayName, updatedAt: serverTimestamp()
  });
  files.forEach((f) => batch.set(doc(attCol(ref.id), f.id), attDoc(user, f)));
  return withTimeout(batch.commit());
}

/** Optimistic concurrency: refuse if the stored version is newer than the one being edited. */
export function updateBooking(user, id, expectedUpdatedMs, fields, { add = [], remove = [] } = {}) {
  const ref = doc(db, 'bookings', id);
  return withTimeout(runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw Object.assign(new Error('This booking no longer exists.'), { code: 'gone' });
    const cur = snap.data();
    if (millis(cur.updatedAt) !== expectedUpdatedMs) {
      throw Object.assign(new Error('Someone else changed this booking. Reload the latest version before saving.'), { code: 'conflict' });
    }
    const kept = (cur.attachments || []).filter((a) => !remove.includes(a.id));
    tx.update(ref, {
      bookingDate: fields.bookingDate, eventName: fields.eventName, notes: fields.notes || '',
      truckType: fields.truckType, truckCount: fields.truckCount,
      attachments: [...kept, ...add.map(meta)],
      updatedBy: user.uid, updatedByName: user.displayName, updatedAt: serverTimestamp()
    });
    remove.forEach((aid) => tx.delete(doc(attCol(id), aid)));
    add.forEach((f) => tx.set(doc(attCol(id), f.id), attDoc(user, f)));
  }));
}

export function deleteBooking(booking) {
  const batch = writeBatch(db);
  (booking.attachments || []).forEach((a) => batch.delete(doc(attCol(booking.id), a.id)));
  batch.delete(doc(db, 'bookings', booking.id));
  return withTimeout(batch.commit());
}

/** Fetch one attachment's stored data on demand. */
export async function getAttachment(bookingId, attId) {
  const s = await getDoc(doc(attCol(bookingId), attId));
  return s.exists() ? s.data() : null;
}

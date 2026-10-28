import {
  collection, doc, query, where, orderBy, limit, onSnapshot, addDoc, deleteDoc,
  runTransaction, serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase.js';

const col = () => collection(db, 'bookings');
const WRITE_TIMEOUT_MS = 15000;

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

export function createBooking(user, { bookingDate, eventName, notes }) {
  return withTimeout(addDoc(col(), {
    bookingDate, eventName, notes: notes || '',
    createdBy: user.uid, createdByName: user.displayName,
    createdAt: serverTimestamp(),
    updatedBy: user.uid, updatedByName: user.displayName, updatedAt: serverTimestamp()
  }));
}

/** Optimistic concurrency: refuse if the stored version is newer than the one being edited. */
export function updateBooking(user, id, expectedUpdatedMs, { bookingDate, eventName, notes }) {
  const ref = doc(db, 'bookings', id);
  return withTimeout(runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw Object.assign(new Error('This booking no longer exists.'), { code: 'gone' });
    if (millis(snap.data().updatedAt) !== expectedUpdatedMs) {
      throw Object.assign(new Error('Someone else changed this booking. Reload the latest version before saving.'), { code: 'conflict' });
    }
    tx.update(ref, {
      bookingDate, eventName, notes: notes || '',
      updatedBy: user.uid, updatedByName: user.displayName, updatedAt: serverTimestamp()
    });
  }));
}

export function deleteBooking(id) {
  return withTimeout(deleteDoc(doc(db, 'bookings', id)));
}

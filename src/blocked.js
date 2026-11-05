import { collection, doc, onSnapshot, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';

// blockedDates/{YYYY-MM-DD} = { reason, createdBy, createdAt }. Admin writes, every active user reads.
const col = () => collection(db, 'blockedDates');

/** Live map of closed dates: "2026-12-25" -> "Christmas". */
export function watchBlocked(cb, onError) {
  return onSnapshot(col(), (s) => cb(new Map(s.docs.map((d) => [d.id, d.data().reason || '']))), onError);
}

export function blockDates(uid, dates, reason) {
  const batch = writeBatch(db);
  dates.forEach((d) => batch.set(doc(col(), d), { reason, createdBy: uid, createdAt: serverTimestamp() }));
  return batch.commit();
}

export function unblockDate(date) {
  const batch = writeBatch(db);
  batch.delete(doc(col(), date));
  return batch.commit();
}

import { collection, doc, onSnapshot, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { calCollection } from './calendars.js';

// blockedDates/{YYYY-MM-DD} = { reason, createdBy, createdAt }. Admin writes, every active user reads.
const col = () => calCollection('blockedDates');

/** Live map of closed dates: "2026-12-25" -> "Christmas". */
export function watchBlocked(cb, onError) {
  return onSnapshot(col(), (s) => cb(new Map(s.docs.map((d) => [d.id, d.data().reason || '']))), onError);
}

/** Close dates on this calendar, or (allCalendars = list of codes) on each of those calendars, e.g. public holidays. */
export async function blockDates(uid, dates, reason, allCalendars = null) {
  const cols = allCalendars?.length ? allCalendars.map((c) => collection(db, 'calendars', c, 'blockedDates')) : [col()];
  const writes = cols.flatMap((c) => dates.map((d) => [doc(c, d), { reason, createdBy: uid, createdAt: serverTimestamp() }]));
  for (let i = 0; i < writes.length; i += 400) { // a batch holds at most 500 writes
    const batch = writeBatch(db);
    writes.slice(i, i + 400).forEach(([ref, data]) => batch.set(ref, data));
    await batch.commit();
  }
}

export function unblockDate(date) {
  const batch = writeBatch(db);
  batch.delete(doc(col(), date));
  return batch.commit();
}

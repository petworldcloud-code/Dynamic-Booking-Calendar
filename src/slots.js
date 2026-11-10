import { onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { calDoc } from './calendars.js';
import { cleanSlots, MAX_SLOTS } from './slot-utils.js';

// settings/slots = { slots: ["08:00-10:00", ...], updatedAt, updatedBy }. Admin writes, every active user reads.
const ref = () => calDoc('settings', 'slots');

/** Live list of the time slots admins allow (empty = no time slots, bookings just have a date). */
export function watchSlots(cb, onError) {
  return onSnapshot(ref(), (s) => cb(s.exists() ? cleanSlots(s.data().slots) : []), onError);
}

export function saveSlots(uid, slots) {
  const list = cleanSlots(slots);
  if (list.length > MAX_SLOTS) throw new Error(`At most ${MAX_SLOTS} time slots.`);
  return setDoc(ref(), { slots: list, updatedAt: serverTimestamp(), updatedBy: uid });
}

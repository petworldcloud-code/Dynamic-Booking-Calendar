import { collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { cleanRecipient, cleanNotifySettings, MAX_RECIPIENTS } from './notify-utils.js';

// notifyRecipients/{email} = { email, allCompanies, companies[], createdBy, createdAt }  (admin only: emails are private)
// settings/notifications   = { onNew, dayBefore, twoHours, dayBeforeHour, updatedAt, updatedBy }
// The emails themselves are sent by apps-script/Code.gs, which reads these two places.
const col = () => collection(db, 'notifyRecipients');

export function watchRecipients(cb, onError) {
  return onSnapshot(col(), (s) => cb(s.docs.map((d) => d.data()).sort((a, b) => a.email.localeCompare(b.email))), onError);
}

export function saveRecipient(uid, form, existingCount = 0, isNew = true) {
  const r = cleanRecipient(form);
  if (isNew && existingCount >= MAX_RECIPIENTS) throw new Error(`At most ${MAX_RECIPIENTS} email addresses.`);
  return setDoc(doc(col(), r.email), { ...r, createdBy: uid, createdAt: serverTimestamp() });
}

export function removeRecipient(email) { return deleteDoc(doc(col(), email)); }

export function watchNotifySettings(cb, onError) {
  return onSnapshot(doc(db, 'settings', 'notifications'), (s) => cb(cleanNotifySettings(s.exists() ? s.data() : {})), onError);
}

export function saveNotifySettings(uid, s) {
  return setDoc(doc(db, 'settings', 'notifications'), { ...cleanNotifySettings(s), updatedAt: serverTimestamp(), updatedBy: uid });
}

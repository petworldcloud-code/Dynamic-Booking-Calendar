import {
  doc, getDoc, onSnapshot, collection, query, orderBy, updateDoc, writeBatch, serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase.js';

/** Public single-document read (rules allow get, never list): username -> auth email. */
export async function lookupUsernameEmail(username) {
  const s = await getDoc(doc(db, 'usernames', username));
  return s.exists() ? s.data().email : null;
}

/** Admin only (enforced by rules): profile + username mapping, written atomically. */
export function createUserProfile(uid, { displayName, username, email, role, status }) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid), {
    displayName: displayName.slice(0, 80), username, email, role, status,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  batch.set(doc(db, 'usernames', username), { email, uid });
  return batch.commit();
}

export function watchProfile(uid, cb, onError) {
  return onSnapshot(doc(db, 'users', uid), (s) => cb(s.exists() ? { uid, ...s.data() } : null), onError);
}

export function watchUsers(cb, onError) {
  const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ uid: d.id, ...d.data() }))), onError);
}

export function updateUser(uid, fields) {
  return updateDoc(doc(db, 'users', uid), { ...fields, updatedAt: serverTimestamp() });
}

import {
  doc, setDoc, onSnapshot, collection, query, orderBy, updateDoc, serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase.js';

/** Admin only (enforced by rules): create the profile for an account the admin just made. */
export function createUserProfile(uid, { displayName, email, role, status }) {
  return setDoc(doc(db, 'users', uid), {
    displayName: displayName.slice(0, 80), email, role, status,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
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

import {
  doc, getDoc, setDoc, onSnapshot, collection, query, orderBy, updateDoc, serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase.js';

/** Create the caller's own profile (always role=user, status=pending; enforced by rules). */
export async function ensureProfile(user, displayName) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    displayName: (displayName || user.displayName || user.email.split('@')[0]).slice(0, 80),
    email: user.email, role: 'user', status: 'pending',
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

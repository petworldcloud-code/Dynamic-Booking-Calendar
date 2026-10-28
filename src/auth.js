import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, updateProfile
} from 'firebase/auth';
import { auth, secondaryAuth } from './firebase.js';
import { watchProfile, createUserProfile } from './users.js';

/**
 * cb({state, user, profile, error});
 * state: signedOut | noaccess | pending | active | suspended | error
 * There is no self-registration: only an admin creates accounts, so a signed-in user
 * without a profile has no access.
 */
export function watchSession(cb) {
  let unProfile = null;
  const unAuth = onAuthStateChanged(auth, (user) => {
    unProfile?.(); unProfile = null;
    if (!user) return cb({ state: 'signedOut' });
    unProfile = watchProfile(user.uid, (p) => {
      if (!p) return cb({ state: 'noaccess', user });
      const state = { active: 'active', suspended: 'suspended' }[p.status] || 'pending';
      cb({ state, user, profile: p });
    }, (error) => cb({ state: 'error', user, error }));
  });
  return () => { unProfile?.(); unAuth(); };
}

export const login = (email, pw) => signInWithEmailAndPassword(auth, email, pw);
export const logout = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

/** Admin only: create a login with a second Auth instance, then write its profile as the admin. */
export async function adminCreateUser({ name, email, password, role }) {
  const second = secondaryAuth();
  const cred = await createUserWithEmailAndPassword(second, email, password);
  try {
    await updateProfile(cred.user, { displayName: name });
    await createUserProfile(cred.user.uid, { displayName: name, email, role, status: 'active' });
  } finally {
    await signOut(second);
  }
  return cred.user.uid;
}

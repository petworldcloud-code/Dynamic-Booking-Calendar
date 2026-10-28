import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, updateProfile, reload
} from 'firebase/auth';
import { auth } from './firebase.js';
import { ensureProfile, watchProfile } from './users.js';

/** cb({state, user, profile, error}); state: signedOut | verify | pending | active | suspended | error */
export function watchSession(cb) {
  let unProfile = null;
  const unAuth = onAuthStateChanged(auth, async (user) => {
    unProfile?.(); unProfile = null;
    if (!user) return cb({ state: 'signedOut' });
    if (!user.emailVerified) return cb({ state: 'verify', user });
    try {
      await ensureProfile(user);
      unProfile = watchProfile(user.uid, (p) => {
        if (!p) return cb({ state: 'pending', user, profile: null });
        const state = { active: 'active', suspended: 'suspended' }[p.status] || 'pending';
        cb({ state, user, profile: p });
      }, (error) => cb({ state: 'error', user, error }));
    } catch (error) {
      cb({ state: 'error', user, error });
    }
  });
  return () => { unProfile?.(); unAuth(); };
}

export const login = (email, pw) => signInWithEmailAndPassword(auth, email, pw);

export async function register(name, email, pw) {
  const cred = await createUserWithEmailAndPassword(auth, email, pw);
  await updateProfile(cred.user, { displayName: name });
  await sendEmailVerification(cred.user);
  await ensureProfile(cred.user, name);
  return cred.user;
}

export const logout = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export const resendVerification = () => sendEmailVerification(auth.currentUser);

/** Re-check verification and force a fresh ID token (rules read email_verified from it). */
export async function refreshVerification() {
  await reload(auth.currentUser);
  await auth.currentUser.getIdToken(true);
  return auth.currentUser.emailVerified;
}

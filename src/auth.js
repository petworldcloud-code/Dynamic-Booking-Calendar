import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, updateProfile, updatePassword,
  reauthenticateWithCredential, EmailAuthProvider
} from 'firebase/auth';
import { auth, secondaryAuth } from './firebase.js';
import { watchProfile, createUserProfile, lookupUsernameEmail } from './users.js';

export const SYNTHETIC_DOMAIN = 'dim-calendar.local';
export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

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

/** Username (or, for convenience, a full email) -> the email Firebase Auth uses. */
async function resolveEmail(identifier) {
  const id = identifier.trim().toLowerCase();
  if (id.includes('@')) return id;
  const email = await lookupUsernameEmail(id);
  if (!email) throw Object.assign(new Error('Incorrect username or password.'), { code: 'auth/invalid-credential' });
  return email;
}

export async function login(identifier, pw) {
  return signInWithEmailAndPassword(auth, await resolveEmail(identifier), pw);
}
export const logout = () => signOut(auth);

export async function resetPassword(identifier) {
  const email = await resolveEmail(identifier);
  if (email.endsWith(`@${SYNTHETIC_DOMAIN}`)) {
    throw new Error('This account has no email address. Ask an administrator to reset it.');
  }
  return sendPasswordResetEmail(auth, email);
}

/** Signed-in user changes their own password (re-checks the current one first). */
export async function changePassword(oldPw, newPw) {
  const u = auth.currentUser;
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, oldPw));
  await updatePassword(u, newPw);
}

/**
 * Admin only: create a login with a second Auth instance (so the admin stays signed in),
 * then write the profile + username mapping as the admin.
 */
export async function adminCreateUser({ name, username, email, password, role }) {
  const uname = username.trim().toLowerCase();
  if (!USERNAME_RE.test(uname)) {
    throw new Error('Username must be 3-30 characters: letters, numbers, dot, dash or underscore.');
  }
  const realEmail = (email || '').trim().toLowerCase();
  const authEmail = realEmail || `${uname}@${SYNTHETIC_DOMAIN}`;
  const second = secondaryAuth();
  const cred = await createUserWithEmailAndPassword(second, authEmail, password);
  try {
    await updateProfile(cred.user, { displayName: name });
    await createUserProfile(cred.user.uid, {
      displayName: name, username: uname, email: authEmail, role, status: 'active'
    });
  } finally {
    await signOut(second);
  }
  return cred.user.uid;
}

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Public client identifiers (not secrets). Data is protected by firestore.rules.
const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const isConfigured = Boolean(cfg.apiKey && cfg.projectId && cfg.appId);

const app = isConfigured ? initializeApp(cfg) : null;
export const auth = app ? getAuth(app) : null;
// Default in-memory cache: writes are only confirmed after the server acknowledges them.
export const db = app ? getFirestore(app) : null;

/** Separate Auth instance so an admin can create an account without being signed out. */
export function secondaryAuth() {
  const second = initializeApp(cfg, `secondary-${Date.now()}`);
  return getAuth(second);
}

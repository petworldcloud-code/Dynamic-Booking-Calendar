import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';

export const DEFAULT_RETENTION = { autoDeleteEnabled: false, retentionDays: 90 };
const ref = () => doc(db, 'settings', 'retention');

export async function getRetention() {
  const s = await getDoc(ref());
  return s.exists() ? { ...DEFAULT_RETENTION, ...s.data() } : { ...DEFAULT_RETENTION };
}

export function saveRetention(uid, { autoDeleteEnabled, retentionDays }) {
  return setDoc(ref(), {
    autoDeleteEnabled: !!autoDeleteEnabled,
    retentionDays: Math.round(Number(retentionDays)),
    updatedAt: serverTimestamp(), updatedBy: uid
  });
}

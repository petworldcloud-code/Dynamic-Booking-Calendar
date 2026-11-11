// Optional retention cleanup. Dry run by default.
// Retention is ONE global setting (settings/retention) applied to every calendar's bookings
// (calendars/{cal}/bookings, archived calendars included) and to the old single-calendar
// bookings collection while that backup copy still exists.
// Deletes only when ALL are true: settings/retention.autoDeleteEnabled == true (set by an admin
// in the app) AND CLEANUP_DELETE=true. Auth comes from Application Default Credentials
// (GitHub OIDC / Workload Identity Federation) - no key files in the repo.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const TZ = 'Asia/Kuala_Lumpur';
const BATCH = 400;

/** Every bookings collection to clean: the old root one plus one per calendar. */
export function bookingCollections(calendarIds = []) {
  return ['bookings', ...calendarIds.map((c) => `calendars/${c}/bookings`)];
}

export function cutoffISO(retentionDays, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - retentionDays);
  return dt.toISOString().slice(0, 10);
}

async function main() {
  initializeApp({ credential: applicationDefault(), projectId: process.env.GOOGLE_CLOUD_PROJECT });
  const db = getFirestore();
  const s = (await db.doc('settings/retention').get()).data() || {};
  const enabled = s.autoDeleteEnabled === true;
  const days = Number.isInteger(s.retentionDays) ? s.retentionDays : 90;
  const wantDelete = process.env.CLEANUP_DELETE === 'true';
  const cutoff = cutoffISO(days);
  console.log(`autoDeleteEnabled=${enabled} retentionDays=${days} cutoff=${cutoff} deleteRequested=${wantDelete}`);

  const calendars = (await db.collection('calendars').get()).docs.map((d) => d.id);
  const old = [];
  for (const path of bookingCollections(calendars)) {
    const snap = await db.collection(path).where('bookingDate', '<', cutoff).get();
    console.log(`${path}: ${snap.size} bookings older than cutoff`);
    old.push(...snap.docs);
  }

  if (!(enabled && wantDelete)) {
    console.log('DRY RUN - nothing deleted.' + (enabled ? '' : ' (admin has not enabled permanent deletion)'));
    return;
  }
  let deleted = 0;
  for (let i = 0; i < old.length; i += BATCH) {
    // recursiveDelete also removes each booking's attachments subcollection
    for (const d of old.slice(i, i + BATCH)) { await db.recursiveDelete(d.ref); deleted += 1; }
  }
  console.log(`Deleted ${deleted} bookings.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  main().catch((e) => { console.error('Cleanup failed:', e.message); process.exit(1); });
}

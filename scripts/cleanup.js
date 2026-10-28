// Optional retention cleanup. Dry run by default.
// Deletes only when ALL are true: settings/retention.autoDeleteEnabled == true (set by an admin
// in the app) AND CLEANUP_DELETE=true. Auth comes from Application Default Credentials
// (GitHub OIDC / Workload Identity Federation) - no key files in the repo.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const TZ = 'Asia/Kuala_Lumpur';
const BATCH = 400;

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

  const snap = await db.collection('bookings').where('bookingDate', '<', cutoff).get();
  console.log(`Bookings older than cutoff: ${snap.size}`);

  if (!(enabled && wantDelete)) {
    console.log('DRY RUN - nothing deleted.' + (enabled ? '' : ' (admin has not enabled permanent deletion)'));
    return;
  }
  let deleted = 0;
  for (let i = 0; i < snap.docs.length; i += BATCH) {
    // recursiveDelete also removes each booking's attachments subcollection
    for (const d of snap.docs.slice(i, i + BATCH)) { await db.recursiveDelete(d.ref); deleted += 1; }
  }
  console.log(`Deleted ${deleted} bookings.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  main().catch((e) => { console.error('Cleanup failed:', e.message); process.exit(1); });
}

// Rules for the multi-calendar layout. Run with: npm run test:rules  (needs Java for the Firestore emulator)
// Runs against BOTH rule sets: firestore.rules (transition: old + new paths) and firestore.rules.final (new paths only).
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, collection } from 'firebase/firestore';

const T0 = new Date();

function suite(label, rulesFile, { legacyOpen }) {
  describe(label, () => {
    let env;
    const ctx = (uid) => env.authenticatedContext(uid, { email: `${uid}@x.com`, email_verified: true }).firestore();
    const B = (cal, id) => `calendars/${cal}/bookings/${id}`;

    const booking = (uid, over = {}) => ({
      bookingDate: '2026-10-27', eventName: 'Shell', companyId: 'shell', notes: '', truckType: '40footer', truckCount: 2,
      createdBy: uid, createdByName: uid, createdAt: serverTimestamp(),
      updatedBy: uid, updatedByName: uid, updatedAt: serverTimestamp(), ...over
    });
    const upd = (uid, over = {}) => ({ notes: 'Changed', updatedBy: uid, updatedByName: uid, updatedAt: serverTimestamp(), ...over });

    beforeAll(async () => {
      env = await initializeTestEnvironment({
        projectId: `demo-dim-${label.replace(/\W+/g, '-')}`,
        firestore: { rules: readFileSync(rulesFile, 'utf8') }
      });
    });
    afterAll(() => env.cleanup());

    beforeEach(async () => {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        const user = (uid, role, status, calendar) => setDoc(doc(db, 'users', uid), {
          displayName: uid, email: `${uid}@x.com`, role, status, ...(calendar ? { calendar } : {}), createdAt: T0, updatedAt: T0
        });
        await user('admin', 'admin', 'active');
        await user('tina', 'staff', 'active', 'tg');   // TG staff
        await user('tom', 'staff', 'active', 'tg');    // second TG staff
        await user('dora', 'staff', 'active', 'dim');  // DIM staff
        await user('nobody', 'staff', 'active');       // staff with no calendar
        await user('suzy', 'staff', 'suspended', 'tg');
        await user('old', 'user', 'active');           // old company account
        for (const [c, order] of [['dim', 1], ['tg', 2]]) await setDoc(doc(db, 'calendars', c), { name: c.toUpperCase(), order, active: true, createdAt: T0, updatedAt: T0 });
        await setDoc(doc(db, 'calendars', 'nf'), { name: 'NF', order: 3, active: false, createdAt: T0, updatedAt: T0 });
        await user('nina', 'staff', 'active', 'nf');   // staff of an archived calendar
        await setDoc(doc(db, 'calendars/tg/companies', 'shell'), { name: 'Shell', color: '#1f77b4', active: true, createdAt: T0, updatedAt: T0 });
        await setDoc(doc(db, 'calendars/tg/companies', 'old-co'), { name: 'Old Co', color: '#ff7f0e', active: false, createdAt: T0, updatedAt: T0 });
        await setDoc(doc(db, 'calendars/dim/companies', 'petronas'), { name: 'Petronas', color: '#2ca02c', active: true, createdAt: T0, updatedAt: T0 });
        await setDoc(doc(db, B('tg', 'b1')), {
          bookingDate: '2026-10-27', eventName: 'Shell', companyId: 'shell', truckType: '5ton', truckCount: 1,
          createdBy: 'tina', createdByName: 'tina', createdAt: T0, updatedBy: 'tina', updatedByName: 'tina', updatedAt: T0
        });
      });
    });

    describe('calendars list', () => {
      it('every active user reads it; others do not; only admin writes', async () => {
        for (const u of ['admin', 'tina', 'nobody', 'old']) await assertSucceeds(getDocs(collection(ctx(u), 'calendars')));
        await assertFails(getDocs(collection(ctx('suzy'), 'calendars')));
        await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), 'calendars')));
        const data = { name: 'PME', order: 4, active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        await assertSucceeds(setDoc(doc(ctx('admin'), 'calendars', 'pme'), data));
        await assertFails(setDoc(doc(ctx('tina'), 'calendars', 'pme2'), data));
        await assertFails(setDoc(doc(ctx('admin'), 'calendars', 'Bad Code'), data));
      });
      it('admin can archive; nobody can delete', async () => {
        await assertSucceeds(updateDoc(doc(ctx('admin'), 'calendars', 'tg'), { active: false, updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(doc(ctx('tina'), 'calendars', 'tg'), { active: false, updatedAt: serverTimestamp() }));
        await assertFails(deleteDoc(doc(ctx('admin'), 'calendars', 'tg')));
      });
    });

    describe('who can use a calendar', () => {
      it('staff read only their own calendar; admin reads all', async () => {
        await assertSucceeds(getDoc(doc(ctx('tina'), B('tg', 'b1'))));
        await assertFails(getDoc(doc(ctx('dora'), B('tg', 'b1'))));
        await assertSucceeds(getDoc(doc(ctx('admin'), B('tg', 'b1'))));
        await assertFails(getDoc(doc(ctx('nobody'), B('tg', 'b1'))));
        await assertFails(getDoc(doc(ctx('suzy'), B('tg', 'b1'))));
        await assertFails(getDoc(doc(ctx('old'), B('tg', 'b1'))));
      });
      it('staff of an archived calendar are shut out', async () => {
        await assertFails(getDoc(doc(ctx('nina'), B('nf', 'x'))));
        await assertSucceeds(getDoc(doc(ctx('admin'), B('nf', 'x'))));
      });
      it('queries over a calendar follow the same rule', async () => {
        await assertSucceeds(getDocs(collection(ctx('tina'), 'calendars/tg/bookings')));
        await assertFails(getDocs(collection(ctx('dora'), 'calendars/tg/bookings')));
      });
    });

    describe('bookings in a calendar', () => {
      it('staff create in their own calendar for an active company of it', async () => {
        await assertSucceeds(setDoc(doc(ctx('tina'), B('tg', 'n1')), booking('tina')));
        await assertSucceeds(setDoc(doc(ctx('admin'), B('tg', 'n2')), booking('admin')));
      });
      it('staff cannot create in another calendar', async () => {
        await assertFails(setDoc(doc(ctx('dora'), B('tg', 'n3')), booking('dora')));
        await assertFails(setDoc(doc(ctx('nobody'), B('tg', 'n4')), booking('nobody')));
      });
      it('the company must be an active company of THIS calendar and match eventName', async () => {
        await assertFails(setDoc(doc(ctx('tina'), B('tg', 'c1')), booking('tina', { companyId: 'petronas', eventName: 'Petronas' }))); // DIM company
        await assertFails(setDoc(doc(ctx('tina'), B('tg', 'c2')), booking('tina', { companyId: 'old-co', eventName: 'Old Co' })));    // archived
        await assertFails(setDoc(doc(ctx('tina'), B('tg', 'c3')), booking('tina', { eventName: 'Not Shell' })));                      // name mismatch
        await assertFails(setDoc(doc(ctx('tina'), B('tg', 'c4')), booking('tina', { companyId: 'ghost', eventName: 'Ghost' })));
        const noCompany = booking('tina'); delete noCompany.companyId;
        await assertFails(setDoc(doc(ctx('tina'), B('tg', 'c5')), noCompany));
      });
      it('keeps the existing field checks', async () => {
        await assertFails(setDoc(doc(ctx('tina'), B('tg', 'f1')), booking('tina', { bookingDate: '27/10/2026' })));
        await assertFails(setDoc(doc(ctx('tina'), B('tg', 'f2')), booking('tina', { truckCount: 7 })));
        await assertFails(setDoc(doc(ctx('tina'), B('tg', 'f3')), booking('tina', { extra: 1 })));
        await assertFails(setDoc(doc(ctx('tina'), B('tg', 'f4')), booking('tom')));               // createdBy is someone else
        await assertFails(setDoc(doc(ctx('tina'), B('tg', 'f5')), booking('tina', { timeSlot: '8am' })));
      });
      it('staff edit and delete only their own; admin changes any; a colleague cannot', async () => {
        await assertSucceeds(updateDoc(doc(ctx('tina'), B('tg', 'b1')), upd('tina')));
        await assertFails(updateDoc(doc(ctx('tom'), B('tg', 'b1')), upd('tom')));
        await assertSucceeds(updateDoc(doc(ctx('admin'), B('tg', 'b1')), upd('admin')));
        await assertFails(deleteDoc(doc(ctx('tom'), B('tg', 'b1'))));
        await assertFails(deleteDoc(doc(ctx('dora'), B('tg', 'b1'))));
        await assertSucceeds(deleteDoc(doc(ctx('tina'), B('tg', 'b1'))));
      });
      it('admin can delete any booking', async () => {
        await assertSucceeds(deleteDoc(doc(ctx('admin'), B('tg', 'b1'))));
      });
      it('a booking can be moved to another active company of the same calendar, not to a foreign one', async () => {
        await env.withSecurityRulesDisabled(async (c) =>
          setDoc(doc(c.firestore(), 'calendars/tg/companies', 'bp'), { name: 'BP', color: '#9467bd', active: true, createdAt: T0, updatedAt: T0 }));
        await assertSucceeds(updateDoc(doc(ctx('tina'), B('tg', 'b1')), upd('tina', { companyId: 'bp', eventName: 'BP' })));
        await assertFails(updateDoc(doc(ctx('tina'), B('tg', 'b1')), upd('tina', { companyId: 'petronas', eventName: 'Petronas' })));
      });
      it('creation info cannot change', async () => {
        await assertFails(updateDoc(doc(ctx('tina'), B('tg', 'b1')), upd('tina', { createdBy: 'tom' })));
        await assertFails(updateDoc(doc(ctx('admin'), B('tg', 'b1')), upd('admin', { createdByName: 'admin' })));
      });
      it('an archived company keeps working on bookings already using it', async () => {
        await env.withSecurityRulesDisabled(async (c) => {
          await updateDoc(doc(c.firestore(), 'calendars/tg/companies', 'shell'), { active: false });
        });
        await assertSucceeds(updateDoc(doc(ctx('tina'), B('tg', 'b1')), upd('tina')));
        await assertFails(setDoc(doc(ctx('tina'), B('tg', 'n9')), booking('tina')));
      });
    });

    describe('blocked dates per calendar', () => {
      const block = (cal, d) => env.withSecurityRulesDisabled(async (c) =>
        setDoc(doc(c.firestore(), `calendars/${cal}/blockedDates`, d), { reason: 'Holiday', createdBy: 'admin', createdAt: T0 }));
      it('only admin writes; the calendar users read', async () => {
        const data = (uid) => ({ reason: 'Holiday', createdBy: uid, createdAt: serverTimestamp() });
        await assertSucceeds(setDoc(doc(ctx('admin'), 'calendars/tg/blockedDates', '2026-12-25'), data('admin')));
        await assertFails(setDoc(doc(ctx('tina'), 'calendars/tg/blockedDates', '2026-12-26'), data('tina')));
        await assertFails(setDoc(doc(ctx('admin'), 'calendars/tg/blockedDates', 'christmas'), data('admin')));
        await assertSucceeds(getDoc(doc(ctx('tina'), 'calendars/tg/blockedDates', '2026-12-25')));
        await assertFails(getDoc(doc(ctx('dora'), 'calendars/tg/blockedDates', '2026-12-25')));
      });
      it('nobody books a blocked date, only on that calendar', async () => {
        await block('tg', '2026-10-27');
        await assertFails(setDoc(doc(ctx('tina'), B('tg', 'k1')), booking('tina')));
        await assertFails(setDoc(doc(ctx('admin'), B('tg', 'k2')), booking('admin')));
        await assertSucceeds(setDoc(doc(ctx('dora'), B('dim', 'k3')), booking('dora', { companyId: 'petronas', eventName: 'Petronas' })));
        await assertSucceeds(updateDoc(doc(ctx('tina'), B('tg', 'b1')), upd('tina'))); // already there: still editable
        await block('tg', '2026-11-01');
        await assertFails(updateDoc(doc(ctx('tina'), B('tg', 'b1')), upd('tina', { bookingDate: '2026-11-01' }))); // cannot move onto one
      });
    });

    describe('companies', () => {
      const co = (over = {}) => ({ name: 'Petron', color: '#aabbcc', active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over });
      it('admin manages; the calendar users read; others cannot', async () => {
        await assertSucceeds(setDoc(doc(ctx('admin'), 'calendars/tg/companies', 'petron'), co()));
        await assertFails(setDoc(doc(ctx('tina'), 'calendars/tg/companies', 'petron2'), co()));
        await assertSucceeds(getDoc(doc(ctx('tina'), 'calendars/tg/companies', 'shell')));
        await assertFails(getDoc(doc(ctx('dora'), 'calendars/tg/companies', 'shell')));
      });
      it('checks name, colour and extra fields', async () => {
        await assertFails(setDoc(doc(ctx('admin'), 'calendars/tg/companies', 'x1'), co({ name: '' })));
        await assertFails(setDoc(doc(ctx('admin'), 'calendars/tg/companies', 'x2'), co({ color: 'red' })));
        await assertFails(setDoc(doc(ctx('admin'), 'calendars/tg/companies', 'x3'), co({ extra: 1 })));
        await assertFails(setDoc(doc(ctx('admin'), 'calendars/tg/companies', 'Bad Id'), co()));
      });
      it('admin can rename, recolour and archive but not delete', async () => {
        await assertSucceeds(updateDoc(doc(ctx('admin'), 'calendars/tg/companies', 'shell'), { name: 'Shell MY', color: '#112233', updatedAt: serverTimestamp() }));
        await assertSucceeds(updateDoc(doc(ctx('admin'), 'calendars/tg/companies', 'shell'), { active: false, updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(doc(ctx('tina'), 'calendars/tg/companies', 'shell'), { color: '#112233', updatedAt: serverTimestamp() }));
        await assertFails(deleteDoc(doc(ctx('admin'), 'calendars/tg/companies', 'shell')));
      });
    });

    describe('per-calendar settings and email alerts', () => {
      it('slots and notification settings: admin writes, calendar users read', async () => {
        const slots = { slots: ['08:00-10:00'], updatedBy: 'admin', updatedAt: serverTimestamp() };
        await assertSucceeds(setDoc(doc(ctx('admin'), 'calendars/tg/settings', 'slots'), slots));
        await assertFails(setDoc(doc(ctx('tina'), 'calendars/tg/settings', 'slots'), { ...slots, updatedBy: 'tina' }));
        await assertFails(setDoc(doc(ctx('admin'), 'calendars/tg/settings', 'slots'), { ...slots, slots: 'x' }));
        await assertSucceeds(getDoc(doc(ctx('tina'), 'calendars/tg/settings', 'slots')));
        await assertFails(getDoc(doc(ctx('dora'), 'calendars/tg/settings', 'slots')));
        const n = { onNew: true, dayBefore: true, twoHours: false, dayBeforeHour: 17, updatedBy: 'admin', updatedAt: serverTimestamp() };
        await assertSucceeds(setDoc(doc(ctx('admin'), 'calendars/tg/settings', 'notifications'), n));
        await assertFails(setDoc(doc(ctx('admin'), 'calendars/tg/settings', 'notifications'), { ...n, dayBeforeHour: 24 }));
      });
      it('recipients are admin only and tick company ids', async () => {
        const rec = (o = {}) => ({ email: 'a@x.co', allCompanies: false, companies: ['shell'], createdBy: 'admin', createdAt: serverTimestamp(), ...o });
        await assertSucceeds(setDoc(doc(ctx('admin'), 'calendars/tg/notifyRecipients', 'a@x.co'), rec()));
        await assertFails(getDoc(doc(ctx('tina'), 'calendars/tg/notifyRecipients', 'a@x.co')));
        await assertFails(setDoc(doc(ctx('tina'), 'calendars/tg/notifyRecipients', 'b@x.co'), rec({ email: 'b@x.co', createdBy: 'tina' })));
        await assertFails(setDoc(doc(ctx('admin'), 'calendars/tg/notifyRecipients', 'n@x.co'), rec({ email: 'n@x.co', companies: [] })));
        await assertSucceeds(deleteDoc(doc(ctx('admin'), 'calendars/tg/notifyRecipients', 'a@x.co')));
      });
      it('the notify log is closed to the app', async () => {
        await assertFails(setDoc(doc(ctx('admin'), 'calendars/tg/notifyLog', 'x'), { sentAt: serverTimestamp() }));
        await assertFails(getDoc(doc(ctx('admin'), 'calendars/tg/notifyLog', 'x')));
      });
      it('retention stays global: admin writes, active users read', async () => {
        const data = { autoDeleteEnabled: false, retentionDays: 90, updatedBy: 'admin', updatedAt: serverTimestamp() };
        await assertSucceeds(setDoc(doc(ctx('admin'), 'settings', 'retention'), data));
        await assertFails(setDoc(doc(ctx('tina'), 'settings', 'retention'), { ...data, updatedBy: 'tina' }));
        await assertSucceeds(getDoc(doc(ctx('tina'), 'settings', 'retention')));
      });
    });

    describe('attachments in a calendar', () => {
      const att = (uid, over = {}) => ({ name: 'a.jpg', type: 'image/jpeg', size: 1000, data: 'AAAA', createdBy: uid, createdAt: serverTimestamp(), ...over });
      it('creator and admin add; a colleague and other calendars cannot', async () => {
        await assertSucceeds(setDoc(doc(ctx('tina'), `${B('tg', 'b1')}/attachments`, 'x1'), att('tina')));
        await assertSucceeds(setDoc(doc(ctx('admin'), `${B('tg', 'b1')}/attachments`, 'x2'), att('admin')));
        await assertFails(setDoc(doc(ctx('tom'), `${B('tg', 'b1')}/attachments`, 'x3'), att('tom')));
        await assertFails(setDoc(doc(ctx('dora'), `${B('tg', 'b1')}/attachments`, 'x4'), att('dora')));
        await assertFails(setDoc(doc(ctx('tina'), `${B('tg', 'b1')}/attachments`, 'x5'), att('tina', { size: 700000 })));
      });
      it('read follows the calendar; delete is creator/admin', async () => {
        await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), `${B('tg', 'b1')}/attachments`, 'x6'), { name: 'a', type: 'image/jpeg', size: 1, data: 'A' }));
        await assertSucceeds(getDoc(doc(ctx('tom'), `${B('tg', 'b1')}/attachments`, 'x6')));
        await assertFails(getDoc(doc(ctx('dora'), `${B('tg', 'b1')}/attachments`, 'x6')));
        await assertFails(deleteDoc(doc(ctx('tom'), `${B('tg', 'b1')}/attachments`, 'x6')));
        await assertSucceeds(deleteDoc(doc(ctx('tina'), `${B('tg', 'b1')}/attachments`, 'x6')));
      });
    });

    describe('user profiles', () => {
      const profile = (over = {}) => ({
        displayName: 'New Staff', email: 'new@x.com', role: 'staff', status: 'active', calendar: 'tg',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over
      });
      it('admin creates staff with a calendar; staff without a valid calendar is refused', async () => {
        await assertSucceeds(setDoc(doc(ctx('admin'), 'users', 'n1'), profile()));
        const noCal = profile(); delete noCal.calendar;
        await assertFails(setDoc(doc(ctx('admin'), 'users', 'n2'), noCal));
        await assertFails(setDoc(doc(ctx('admin'), 'users', 'n3'), profile({ calendar: 'zzz' })));
        await assertFails(setDoc(doc(ctx('tina'), 'users', 'n4'), profile()));
        await assertFails(setDoc(doc(ctx('newbie'), 'users', 'newbie'), profile()));
      });
      it('staff cannot change their own calendar, role or status', async () => {
        await assertFails(updateDoc(doc(ctx('tina'), 'users', 'tina'), { calendar: 'dim', updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(doc(ctx('tina'), 'users', 'tina'), { role: 'admin', updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(doc(ctx('tina'), 'users', 'tina'), { status: 'active', calendar: 'dim', updatedAt: serverTimestamp() }));
        await assertSucceeds(updateDoc(doc(ctx('tina'), 'users', 'tina'), { displayName: 'Tina R', updatedAt: serverTimestamp() }));
      });
      it('admin can move staff to another calendar', async () => {
        await assertSucceeds(updateDoc(doc(ctx('admin'), 'users', 'tom'), { calendar: 'dim', updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(doc(ctx('admin'), 'users', 'tom'), { calendar: 'nowhere', updatedAt: serverTimestamp() }));
      });
      it('staff read only their own profile', async () => {
        await assertSucceeds(getDoc(doc(ctx('tina'), 'users', 'tina')));
        await assertFails(getDoc(doc(ctx('tina'), 'users', 'tom')));
      });
    });

    describe(legacyOpen ? 'old paths (still open in the transition rules)' : 'old paths (closed in the final rules)', () => {
      const oldBooking = (uid) => {
        const b = booking(uid, { eventName: uid }); delete b.companyId; return b;
      };
      const seedOld = () => env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'bookings', 'o1'), {
        bookingDate: '2026-10-27', eventName: 'old', truckType: '5ton', truckCount: 1, createdBy: 'old', createdByName: 'old',
        createdAt: T0, updatedBy: 'old', updatedByName: 'old', updatedAt: T0
      }));
      if (legacyOpen) {
        it('old company accounts keep working', async () => {
          await seedOld();
          await assertSucceeds(getDoc(doc(ctx('old'), 'bookings', 'o1')));
          await assertSucceeds(setDoc(doc(ctx('old'), 'bookings', 'o2'), oldBooking('old')));
          await assertSucceeds(getDoc(doc(ctx('admin'), 'bookings', 'o1')));
        });
        it('staff accounts are kept out of the old paths', async () => {
          await seedOld();
          await assertFails(getDoc(doc(ctx('tina'), 'bookings', 'o1')));
          await assertFails(setDoc(doc(ctx('tina'), 'bookings', 'o3'), oldBooking('tina')));
          await assertFails(getDoc(doc(ctx('tina'), 'blockedDates', '2026-12-25')));
        });
        it('an old-style booking cannot carry a companyId', async () => {
          await assertFails(setDoc(doc(ctx('old'), 'bookings', 'o4'), { ...oldBooking('old'), companyId: 'shell' }));
        });
      } else {
        it('nobody, admin included, can read or write the old paths', async () => {
          await seedOld();
          for (const u of ['admin', 'old', 'tina']) {
            await assertFails(getDoc(doc(ctx(u), 'bookings', 'o1')));
            await assertFails(setDoc(doc(ctx(u), 'bookings', 'o5'), oldBooking(u)));
            await assertFails(getDoc(doc(ctx(u), 'blockedDates', '2026-12-25')));
            await assertFails(getDoc(doc(ctx(u), 'notifyRecipients', 'a@x.co')));
            await assertFails(getDoc(doc(ctx(u), 'settings', 'slots')));
          }
        });
        it('retention is still readable by active users', async () => {
          await assertSucceeds(getDoc(doc(ctx('tina'), 'settings', 'retention')));
        });
      }
    });
  });
}

suite('transition rules', 'firestore.rules', { legacyOpen: true });
suite('final rules', 'firestore.rules.final', { legacyOpen: false });

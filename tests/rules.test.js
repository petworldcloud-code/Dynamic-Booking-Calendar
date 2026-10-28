// Run with: npm run test:rules  (needs Java for the Firestore emulator)
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, collection, getDocs } from 'firebase/firestore';

let env;
const ctx = (uid, extra = {}) =>
  env.authenticatedContext(uid, { email: `${uid}@x.com`, email_verified: true, ...extra }).firestore();

const booking = (uid, over = {}) => ({
  bookingDate: '2026-10-27', eventName: 'Tefal', notes: '', truckType: '40footer', truckCount: 2,
  createdBy: uid, createdByName: uid, createdAt: serverTimestamp(),
  updatedBy: uid, updatedByName: uid, updatedAt: serverTimestamp(), ...over
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-dim-calendar',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') }
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    const mk = (uid, role, status) => setDoc(doc(db, 'users', uid), {
      displayName: uid, email: `${uid}@x.com`, role, status, createdAt: new Date(), updatedAt: new Date()
    });
    await mk('admin', 'admin', 'active');
    await mk('alice', 'user', 'active');
    await mk('bob', 'user', 'active');
    await mk('pat', 'user', 'pending');
    await mk('sam', 'user', 'suspended');
    await setDoc(doc(db, 'bookings', 'b1'), {
      bookingDate: '2026-10-27', eventName: 'Seed', truckType: '5ton', truckCount: 1, createdBy: 'alice', createdByName: 'alice',
      createdAt: new Date(), updatedBy: 'alice', updatedByName: 'alice', updatedAt: new Date()
    });
  });
});

describe('bookings', () => {
  it('denies unauthenticated read', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'bookings', 'b1')));
  });
  it('denies pending, suspended and profile-less users', async () => {
    await assertFails(getDoc(doc(ctx('pat'), 'bookings', 'b1')));
    await assertFails(getDoc(doc(ctx('sam'), 'bookings', 'b1')));
    await assertFails(getDoc(doc(ctx('stranger'), 'bookings', 'b1')));
  });
  it('allows active users to read', async () => {
    await assertSucceeds(getDocs(collection(ctx('bob'), 'bookings')));
  });
  it('lets an active user create under own uid only', async () => {
    await assertSucceeds(setDoc(doc(ctx('bob'), 'bookings', 'n1'), booking('bob')));
    await assertFails(setDoc(doc(ctx('bob'), 'bookings', 'n2'), booking('alice')));
  });
  it('rejects invalid fields', async () => {
    await assertFails(setDoc(doc(ctx('bob'), 'bookings', 'n3'), booking('bob', { bookingDate: '27/10/2026' })));
    await assertFails(setDoc(doc(ctx('bob'), 'bookings', 'n4'), booking('bob', { eventName: '' })));
    await assertFails(setDoc(doc(ctx('bob'), 'bookings', 'n5'), booking('bob', { eventName: 'x'.repeat(121) })));
    await assertFails(setDoc(doc(ctx('bob'), 'bookings', 'n6'), booking('bob', { extra: 1 })));
    await assertFails(setDoc(doc(ctx('bob'), 'bookings', 'n7'), booking('bob', { truckType: '2ton' })));
    await assertFails(setDoc(doc(ctx('bob'), 'bookings', 'n8'), booking('bob', { truckCount: 7 })));
    await assertFails(setDoc(doc(ctx('bob'), 'bookings', 'n9'), booking('bob', { truckCount: 0 })));
  });
  it('creator and admin can update; others cannot', async () => {
    const upd = (uid) => ({ eventName: 'Changed', updatedBy: uid, updatedByName: uid, updatedAt: serverTimestamp() });
    await assertSucceeds(updateDoc(doc(ctx('alice'), 'bookings', 'b1'), upd('alice')));
    await assertSucceeds(updateDoc(doc(ctx('admin'), 'bookings', 'b1'), upd('admin')));
    await assertFails(updateDoc(doc(ctx('bob'), 'bookings', 'b1'), upd('bob')));
  });
  it('blocks changing creation metadata', async () => {
    await assertFails(updateDoc(doc(ctx('alice'), 'bookings', 'b1'), {
      createdBy: 'bob', updatedBy: 'alice', updatedByName: 'alice', updatedAt: serverTimestamp()
    }));
  });
  it('delete: creator/admin only', async () => {
    await assertFails(deleteDoc(doc(ctx('bob'), 'bookings', 'b1')));
    await assertSucceeds(deleteDoc(doc(ctx('alice'), 'bookings', 'b1')));
  });
  it('admin can delete any booking', async () => {
    await assertSucceeds(deleteDoc(doc(ctx('admin'), 'bookings', 'b1')));
  });
});

describe('users', () => {
  const profile = (uid, over = {}) => ({
    displayName: 'New', email: `${uid}@x.com`, role: 'user', status: 'pending',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over
  });
  it('nobody can self-register a profile', async () => {
    await assertFails(setDoc(doc(ctx('newbie'), 'users', 'newbie'), profile('newbie')));
    await assertFails(setDoc(doc(ctx('newbie'), 'users', 'newbie'), profile('newbie', { role: 'admin', status: 'active' })));
  });
  it('active standard users cannot create profiles', async () => {
    await assertFails(setDoc(doc(ctx('alice'), 'users', 'x'), profile('x', { status: 'active' })));
  });
  it('admin can create a profile for a new account', async () => {
    await assertSucceeds(setDoc(doc(ctx('admin'), 'users', 'newbie'), profile('newbie', { status: 'active' })));
  });
  it('blocks role/status escalation by the user', async () => {
    await assertFails(updateDoc(doc(ctx('pat'), 'users', 'pat'), { status: 'active', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(ctx('alice'), 'users', 'alice'), { role: 'admin', updatedAt: serverTimestamp() }));
  });
  it('lets admin approve and change roles', async () => {
    await assertSucceeds(updateDoc(doc(ctx('admin'), 'users', 'pat'), { status: 'active', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(ctx('admin'), 'users', 'bob'), { role: 'admin', updatedAt: serverTimestamp() }));
  });
  it('denies unauthenticated and cross-user reads', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users', 'alice')));
    await assertFails(getDoc(doc(ctx('bob'), 'users', 'alice')));
    await assertSucceeds(getDoc(doc(ctx('alice'), 'users', 'alice')));
  });
});

describe('settings', () => {
  it('only admin writes retention, defaults safe', async () => {
    const data = { autoDeleteEnabled: false, retentionDays: 90, updatedBy: 'admin', updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(ctx('admin'), 'settings', 'retention'), data));
    await assertFails(setDoc(doc(ctx('alice'), 'settings', 'retention'), { ...data, updatedBy: 'alice' }));
  });
});

describe('usernames', () => {
  const mapping = { email: 'bob@dim-calendar.local', uid: 'bob' };
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'usernames', 'bob'), mapping));
  });
  it('anyone can get a single mapping but not list', async () => {
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'usernames', 'bob')));
    await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), 'usernames')));
  });
  it('only admin can write, with a valid name', async () => {
    await assertSucceeds(setDoc(doc(ctx('admin'), 'usernames', 'carol'), { email: 'c@x.com', uid: 'c' }));
    await assertFails(setDoc(doc(ctx('admin'), 'usernames', 'A'), { email: 'c@x.com', uid: 'c' }));
    await assertFails(setDoc(doc(ctx('alice'), 'usernames', 'dave'), { email: 'd@x.com', uid: 'd' }));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'usernames', 'eve'), { email: 'e@x.com', uid: 'e' }));
  });
});

describe('attachments', () => {
  const att = (uid, over = {}) => ({ name: 'a.jpg', type: 'image/jpeg', size: 1000, data: 'AAAA', createdBy: uid, createdAt: serverTimestamp(), ...over });
  it('creator and admin can add; others cannot', async () => {
    await assertSucceeds(setDoc(doc(ctx('alice'), 'bookings/b1/attachments', 'x1'), att('alice')));
    await assertSucceeds(setDoc(doc(ctx('admin'), 'bookings/b1/attachments', 'x2'), att('admin')));
    await assertFails(setDoc(doc(ctx('bob'), 'bookings/b1/attachments', 'x3'), att('bob')));
  });
  it('rejects oversize files', async () => {
    await assertFails(setDoc(doc(ctx('alice'), 'bookings/b1/attachments', 'x4'), att('alice', { size: 700000 })));
  });
  it('all active users can read, outsiders cannot', async () => {
    await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'bookings/b1/attachments', 'x5'), { name: 'a', type: 'image/jpeg', size: 1, data: 'A' }));
    await assertSucceeds(getDoc(doc(ctx('bob'), 'bookings/b1/attachments', 'x5')));
    await assertFails(getDoc(doc(ctx('pat'), 'bookings/b1/attachments', 'x5')));
  });
  it('only creator/admin can delete', async () => {
    await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'bookings/b1/attachments', 'x6'), { name: 'a', type: 'image/jpeg', size: 1, data: 'A' }));
    await assertFails(deleteDoc(doc(ctx('bob'), 'bookings/b1/attachments', 'x6')));
    await assertSucceeds(deleteDoc(doc(ctx('alice'), 'bookings/b1/attachments', 'x6')));
  });
});

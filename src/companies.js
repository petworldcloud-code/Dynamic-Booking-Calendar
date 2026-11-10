import { onSnapshot, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { calCollection, calDoc } from './calendars.js';
import { cleanCompany, companyId } from './calendar-utils.js';

// calendars/{cal}/companies/{id} = { name, color, active, createdAt, updatedAt }. Admin writes.
// "Removing" a company only sets active:false, so old bookings keep their name and colour.

export function watchCompanies(cb, onError) {
  return onSnapshot(calCollection('companies'), (s) => {
    const list = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    cb(list.sort((a, b) => a.name.localeCompare(b.name)));
  }, onError);
}

export function addCompany(form, existing = []) {
  const c = cleanCompany(form, existing);
  const id = companyId(c.name, existing);
  return setDoc(calDoc('companies', id), { ...c, active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

export function updateCompany(id, form, existing = []) {
  const c = cleanCompany(form, existing, id);
  return updateDoc(calDoc('companies', id), { ...c, updatedAt: serverTimestamp() });
}

export function setCompanyActive(id, active) {
  return updateDoc(calDoc('companies', id), { active: !!active, updatedAt: serverTimestamp() });
}

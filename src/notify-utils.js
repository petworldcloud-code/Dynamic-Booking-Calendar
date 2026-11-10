// Pure helpers for the email-notification settings (unit-tested).
export const MAX_RECIPIENTS = 30;
export const DEFAULT_NOTIFY = { onNew: true, dayBefore: true, twoHours: true, dayBeforeHour: 17 };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function cleanEmail(raw) {
  const e = String(raw ?? '').trim().toLowerCase();
  if (!e) throw new Error('Enter an email address.');
  if (e.length > 120 || !EMAIL_RE.test(e)) throw new Error('That does not look like a valid email address.');
  return e;
}

/** Normalise a recipient form into the stored shape; "all companies" ignores any ticked names. */
export function cleanRecipient({ email, allCompanies, companies }) {
  const e = cleanEmail(email);
  if (allCompanies) return { email: e, allCompanies: true, companies: [] };
  const list = [...new Set((companies || []).map((c) => String(c).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!list.length) throw new Error('Tick at least one company, or choose All companies.');
  if (list.length > 100) throw new Error('Too many companies selected.');
  return { email: e, allCompanies: false, companies: list };
}

/**
 * Does this recipient get mail about a booking for this company?
 * In a calendar the ticks are company ids, so a booking matches by its companyId; the old single
 * calendar ticks company names, matched against booking.eventName.
 */
export function wantsCompany(recipient, company, companyId) {
  if (recipient.allCompanies) return true;
  const ticked = recipient.companies || [];
  return ticked.includes(company) || (!!companyId && ticked.includes(companyId));
}

export function recipientsFor(list, company, companyId) {
  return list.filter((r) => wantsCompany(r, company, companyId)).map((r) => r.email);
}

/** "All companies", or the ticked ones by name (nameOf turns a stored id into the company's name). */
export function scopeText(r, nameOf = (x) => x) {
  if (r.allCompanies) return 'All companies';
  const names = (r.companies || []).map(nameOf);
  const n = names.length;
  return n <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${n - 3} more`;
}

export function cleanNotifySettings(s) {
  const hour = Number.isInteger(s?.dayBeforeHour) && s.dayBeforeHour >= 0 && s.dayBeforeHour <= 23 ? s.dayBeforeHour : DEFAULT_NOTIFY.dayBeforeHour;
  return {
    onNew: s?.onNew !== false, dayBefore: s?.dayBefore !== false, twoHours: s?.twoHours !== false, dayBeforeHour: hour
  };
}

// Pure helpers for multiple calendars (no Firebase here, so they are unit-tested directly).

export const CAL_CODE_RE = /^[a-z][a-z0-9]{1,9}$/;

/** Calendar codes are short, lowercase and fixed once created: "dim", "tg", "nf", "pme". */
export function cleanCalendarCode(raw) {
  const code = String(raw || '').trim().toLowerCase();
  if (!CAL_CODE_RE.test(code)) throw new Error('Calendar code: 2-10 letters or digits, starting with a letter.');
  return code;
}

/** Display form of a code: "tg" -> "TG". */
export const calendarLabel = (code) => String(code || '').toUpperCase();

/**
 * Firestore path segments for a calendar's data. With no calendar (the old single-calendar app)
 * this is the root, so existing paths such as "bookings" keep working until the data is moved.
 */
export function calendarBase(cal) {
  return cal ? ['calendars', cal] : [];
}

/** Who may open a calendar: admins any; active staff only the one on their profile. */
export function canUseCalendar(profile, cal) {
  if (!profile || profile.status !== 'active' || !cal) return false;
  if (profile.role === 'admin') return true;
  return profile.calendar === cal;
}

/** Calendars the person may see, in order. Admins get every active one; staff just their own. */
export function visibleCalendars(profile, calendars) {
  return (calendars || [])
    .filter((c) => c.active !== false && canUseCalendar(profile, c.id))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
}

/** Which calendar to open first: the hash (#tg) if allowed, else the staff member's own / first for admin. */
export function pickCalendar(profile, calendars, hashCode) {
  const list = visibleCalendars(profile, calendars);
  const want = String(hashCode || '').replace(/^#/, '').toLowerCase();
  return (list.find((c) => c.id === want) || list[0] || null)?.id || null;
}

// ---------- company colours ----------
export const COMPANY_COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#0891b2',
  '#db2777', '#4d7c0f', '#ea580c', '#475569', '#0d9488', '#9333ea'
];
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Next palette colour not yet used by the given companies (cycles when all are used). */
export function nextCompanyColor(companies) {
  const used = new Set((companies || []).map((c) => String(c.color || '').toLowerCase()));
  const free = COMPANY_COLORS.find((c) => !used.has(c));
  return free || COMPANY_COLORS[(companies || []).length % COMPANY_COLORS.length];
}

export function cleanCompany({ name, color }, existing = [], selfId = null) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n) throw new Error('Enter a company name.');
  if (n.length > 120) throw new Error('Company name is too long (max 120).');
  if (existing.some((c) => c.id !== selfId && c.name.toLowerCase() === n.toLowerCase())) {
    throw new Error('That company already exists in this calendar.');
  }
  const col = color || nextCompanyColor(existing);
  if (!COLOR_RE.test(col)) throw new Error('Pick a valid colour.');
  return { name: n, color: col.toLowerCase() };
}

/** Company ids are made from the name; a numeric suffix keeps them unique. */
export function companyId(name, existing = []) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'company';
  const taken = new Set(existing.map((c) => c.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

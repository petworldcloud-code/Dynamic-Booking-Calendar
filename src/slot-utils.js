// Pure helpers for booking time slots (no Firebase here, so they are unit-testable).
// A slot is stored as the text "HH:MM-HH:MM" in 24-hour time, e.g. "08:00-10:00".

export const MAX_SLOTS = 24;
export const SLOT_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$/;
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** "08:00-10:00" -> "08:00 – 10:00" (for display). */
export const slotLabel = (s) => (s ? s.replace('-', ' – ') : '');

/** Start time of a slot ("08:00"), or '' when there is none. */
export const slotStart = (s) => (s ? s.slice(0, 5) : '');

/** Build one slot from two "HH:MM" times; throws a readable error if it is not valid. */
export function makeSlot(from, to) {
  if (!TIME_RE.test(from || '') || !TIME_RE.test(to || '')) throw new Error('Choose both a start and an end time.');
  if (toMin(to) <= toMin(from)) throw new Error('The end time must be after the start time.');
  return `${from}-${to}`;
}

/** Keep only valid slots, remove duplicates and sort by start time. */
export function cleanSlots(list) {
  const ok = [...new Set((Array.isArray(list) ? list : []).filter((s) => typeof s === 'string' && SLOT_RE.test(s)
    && toMin(s.slice(6)) > toMin(s.slice(0, 5))))];
  return ok.sort((a, b) => a.localeCompare(b));
}

/** Split [from, to] into back-to-back slots of `stepMin` minutes (the last one may be shorter). */
export function generateSlots(from, to, stepMin) {
  makeSlot(from, to); // validates
  const step = Math.round(Number(stepMin));
  if (!(step >= 15)) throw new Error('Each slot must be at least 15 minutes.');
  const out = [];
  for (let t = toMin(from); t < toMin(to); t += step) out.push(`${toTime(t)}-${toTime(Math.min(t + step, toMin(to)))}`);
  if (out.length > MAX_SLOTS) throw new Error(`That makes ${out.length} slots; the limit is ${MAX_SLOTS}. Use a longer slot length.`);
  return out;
}

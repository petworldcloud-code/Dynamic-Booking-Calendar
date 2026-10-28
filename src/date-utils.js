// Date helpers. All booking dates are date-only "YYYY-MM-DD" strings; arithmetic is done
// on UTC-midnight Date objects purely as a calendar calculator (never on local time).
export const TIMEZONE = 'Asia/Kuala_Lumpur';
export const RANGE_DAYS = 31;
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let clockOverride = null;
/** Test hook: pass a Date (or null to reset). */
export function setClock(date) { clockOverride = date; }
const now = () => clockOverride ?? new Date();

/** Today's calendar date in Malaysia, regardless of the visitor's own timezone. */
export function todayISO(date = now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
  return parts; // en-CA => YYYY-MM-DD
}

export function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid date: ${iso}`);
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Invalid date: ${iso}`);
  }
  return dt;
}

export function toISO(dt) {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function isValidISO(iso) {
  try { parseISO(iso); return true; } catch { return false; }
}

export function addDays(iso, n) {
  const dt = parseISO(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toISO(dt);
}

/** 0 = Monday ... 6 = Sunday */
export function weekdayIndex(iso) {
  return (parseISO(iso).getUTCDay() + 6) % 7;
}

export function weekdayName(iso) { return WEEKDAYS[weekdayIndex(iso)]; }

/** "27 Oct 2026" */
export function formatDisplay(iso) {
  const dt = parseISO(iso);
  return `${String(dt.getUTCDate()).padStart(2, '0')} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/**
 * Build the rolling period: 31 consecutive dates starting at `startISO`.
 * Returned as week rows of 7 cells (Mon..Sun); cells before the start date are null
 * placeholders, so no date is dropped (up to 6 rows when the start is mid-week).
 */
export function buildRange(startISO, days = RANGE_DAYS) {
  const dates = Array.from({ length: days }, (_, i) => addDays(startISO, i));
  const lead = weekdayIndex(startISO);
  const cells = [...Array(lead).fill(null), ...dates];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { start: startISO, end: dates[dates.length - 1], dates, weeks };
}

/** ms until the next Malaysian midnight (+1s safety). */
export function msUntilMidnight(date = now()) {
  const t = todayISO(date);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const g = (k) => +parts.find((p) => p.type === k).value;
  const elapsed = (g('hour') * 3600 + g('minute') * 60 + g('second')) * 1000 + date.getMilliseconds();
  void t;
  return 86400000 - elapsed + 1000;
}

/**
 * Calls onChange(newTodayISO) whenever the Malaysian date changes. Re-derives the date from the
 * timezone on every trigger (timer, tab visible, focus, coarse heartbeat for sleep/suspend).
 */
export function watchToday(onChange) {
  let last = todayISO();
  let timer;
  const check = () => {
    const t = todayISO();
    if (t !== last) { last = t; onChange(t); }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { check(); schedule(); }, Math.min(msUntilMidnight(), 6 * 3600 * 1000));
  };
  const heartbeat = setInterval(check, 60 * 1000); // cheap local check only, no network
  const onVis = () => { if (!document.hidden) { check(); schedule(); } };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', onVis);
  schedule();
  return () => {
    clearTimeout(timer); clearInterval(heartbeat);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('focus', onVis);
  };
}

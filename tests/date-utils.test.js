import { describe, it, expect, afterEach } from 'vitest';
import {
  todayISO, addDays, weekdayName, buildRange, formatDisplay, isValidISO, setClock, msUntilMidnight
} from '../src/date-utils.js';

afterEach(() => setClock(null));

describe('date utils', () => {
  it('27 Oct 2026 is a Tuesday', () => {
    expect(weekdayName('2026-10-27')).toBe('Tuesday');
  });

  it('formats display dates', () => {
    expect(formatDisplay('2026-10-27')).toBe('27 Oct 2026');
  });

  it('uses Malaysian date regardless of runtime timezone', () => {
    // 2026-10-27 17:00 UTC is already 28 Oct 01:00 in Kuala Lumpur
    expect(todayISO(new Date('2026-10-27T17:00:00Z'))).toBe('2026-10-28');
    expect(todayISO(new Date('2026-10-27T15:59:59Z'))).toBe('2026-10-27');
  });

  it('adds days across month/year/leap boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('builds 31 consecutive dates ending 30 days later, none dropped', () => {
    const r = buildRange('2026-10-27');
    expect(r.dates).toHaveLength(31);
    expect(r.end).toBe('2026-11-26');
    expect(r.weeks.flat().filter(Boolean)).toHaveLength(31);
  });

  it('places the start date under the right weekday with leading blanks', () => {
    const r = buildRange('2026-10-27'); // Tuesday
    expect(r.weeks[0][0]).toBeNull();
    expect(r.weeks[0][1]).toBe('2026-10-27');
    expect(r.weeks).toHaveLength(5);
    r.weeks.forEach((w) => w.forEach((d, i) => {
      if (d) expect(weekdayName(d)).toBe(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]);
    }));
  });

  it('Monday start gives 5 rows', () => {
    const r = buildRange('2026-10-26');
    expect(r.weeks).toHaveLength(5);
    expect(r.weeks[0][0]).toBe('2026-10-26');
  });

  it('rolling range advances when the clock passes Malaysian midnight', () => {
    setClock(new Date('2026-10-27T15:59:00Z'));
    expect(buildRange(todayISO()).start).toBe('2026-10-27');
    setClock(new Date('2026-10-27T16:00:01Z'));
    const r = buildRange(todayISO());
    expect(r.start).toBe('2026-10-28');
    expect(r.end).toBe('2026-11-27');
  });

  it('computes time to next Malaysian midnight', () => {
    // 23:59:00 MYT => 60s + 1s safety
    expect(msUntilMidnight(new Date('2026-10-27T15:59:00Z'))).toBe(61000);
  });

  it('rejects invalid dates', () => {
    expect(isValidISO('2026-02-30')).toBe(false);
    expect(isValidISO('2026-13-01')).toBe(false);
    expect(isValidISO('2026-10-27')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import {
  cleanCalendarCode, calendarBase, canUseCalendar, visibleCalendars, pickCalendar,
  nextCompanyColor, cleanCompany, companyId, COMPANY_COLORS
} from '../src/calendar-utils.js';

const admin = { role: 'admin', status: 'active' };
const tgStaff = { role: 'staff', status: 'active', calendar: 'tg' };
const cals = [
  { id: 'tg', order: 2 }, { id: 'dim', order: 1 }, { id: 'nf', order: 3 }, { id: 'old', order: 4, active: false }
];

describe('calendar codes and paths', () => {
  it('cleans codes', () => {
    expect(cleanCalendarCode(' TG ')).toBe('tg');
    expect(() => cleanCalendarCode('1a')).toThrow();
    expect(() => cleanCalendarCode('a')).toThrow();
    expect(() => cleanCalendarCode('a b')).toThrow();
  });
  it('builds paths; no calendar = old root paths', () => {
    expect(calendarBase('tg')).toEqual(['calendars', 'tg']);
    expect(calendarBase(null)).toEqual([]);
  });
});

describe('access', () => {
  it('admin can use any calendar, staff only their own', () => {
    expect(canUseCalendar(admin, 'nf')).toBe(true);
    expect(canUseCalendar(tgStaff, 'tg')).toBe(true);
    expect(canUseCalendar(tgStaff, 'dim')).toBe(false);
  });
  it('suspended, missing or calendar-less accounts get nothing', () => {
    expect(canUseCalendar({ ...tgStaff, status: 'suspended' }, 'tg')).toBe(false);
    expect(canUseCalendar({ role: 'staff', status: 'active' }, 'tg')).toBe(false);
    expect(canUseCalendar(null, 'tg')).toBe(false);
  });
  it('lists visible calendars in order, hiding archived ones', () => {
    expect(visibleCalendars(admin, cals).map((c) => c.id)).toEqual(['dim', 'tg', 'nf']);
    expect(visibleCalendars(tgStaff, cals).map((c) => c.id)).toEqual(['tg']);
  });
  it('picks a calendar from the link only if allowed', () => {
    expect(pickCalendar(admin, cals, '#nf')).toBe('nf');
    expect(pickCalendar(admin, cals, '')).toBe('dim');
    expect(pickCalendar(tgStaff, cals, '#dim')).toBe('tg');
    expect(pickCalendar({ role: 'staff', status: 'active' }, cals, '')).toBe(null);
  });
});

describe('companies', () => {
  it('gives each company a different colour first', () => {
    const a = nextCompanyColor([]);
    const b = nextCompanyColor([{ color: a }]);
    expect(b).not.toBe(a);
    expect(nextCompanyColor(COMPANY_COLORS.map((color) => ({ color })))).toBeTruthy();
  });
  it('validates and tidies a company', () => {
    expect(cleanCompany({ name: '  Tefal   Malaysia ' }, [])).toMatchObject({ name: 'Tefal Malaysia' });
    expect(() => cleanCompany({ name: '' }, [])).toThrow();
    expect(() => cleanCompany({ name: 'x', color: 'red' }, [])).toThrow();
    expect(() => cleanCompany({ name: 'tefal' }, [{ id: 'tefal', name: 'Tefal' }])).toThrow();
    expect(cleanCompany({ name: 'Tefal' }, [{ id: 'tefal', name: 'Tefal' }], 'tefal').name).toBe('Tefal');
  });
  it('makes unique ids', () => {
    expect(companyId('Tefal Malaysia', [])).toBe('tefal-malaysia');
    expect(companyId('Tefal', [{ id: 'tefal' }])).toBe('tefal-2');
    expect(companyId('!!!', [])).toBe('company');
  });
});

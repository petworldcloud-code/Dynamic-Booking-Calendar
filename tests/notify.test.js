import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanEmail, cleanRecipient, wantsCompany, recipientsFor, scopeText, cleanNotifySettings } from '../src/notify-utils.js';

describe('notify-utils', () => {
  it('normalises and validates emails', () => {
    expect(cleanEmail('  Ali@Example.COM ')).toBe('ali@example.com');
    expect(() => cleanEmail('')).toThrow(/Enter/);
    expect(() => cleanEmail('nope')).toThrow(/valid/);
    expect(() => cleanEmail('a b@x.com')).toThrow(/valid/);
  });

  it('needs companies unless All is chosen', () => {
    expect(cleanRecipient({ email: 'a@b.co', allCompanies: true, companies: ['X'] }))
      .toEqual({ email: 'a@b.co', allCompanies: true, companies: [] });
    expect(cleanRecipient({ email: 'a@b.co', allCompanies: false, companies: ['Zed', 'Acme', 'Acme'] }))
      .toEqual({ email: 'a@b.co', allCompanies: false, companies: ['Acme', 'Zed'] });
    expect(() => cleanRecipient({ email: 'a@b.co', allCompanies: false, companies: [] })).toThrow(/company/);
  });

  it('picks recipients by company, one address covering several', () => {
    const list = [
      { email: 'all@x.co', allCompanies: true, companies: [] },
      { email: 'two@x.co', allCompanies: false, companies: ['Acme', 'Tefal'] },
      { email: 'one@x.co', allCompanies: false, companies: ['Sony'] }
    ];
    expect(recipientsFor(list, 'Acme')).toEqual(['all@x.co', 'two@x.co']);
    expect(recipientsFor(list, 'Sony')).toEqual(['all@x.co', 'one@x.co']);
    expect(wantsCompany(list[1], 'Sony')).toBe(false);
  });

  it('summarises scope and defaults settings', () => {
    expect(scopeText({ allCompanies: true })).toBe('All companies');
    expect(scopeText({ allCompanies: false, companies: ['A', 'B', 'C', 'D', 'E'] })).toBe('A, B, C +2 more');
    expect(cleanNotifySettings({})).toEqual({ onNew: true, dayBefore: true, twoHours: true, dayBeforeHour: 17 });
    expect(cleanNotifySettings({ onNew: false, dayBeforeHour: 99 })).toMatchObject({ onNew: false, dayBeforeHour: 17 });
  });
});

// Load the pure helpers of the Apps Script file without running any Google services.
const gs = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const lib = new Function(`${gs}; return { slotStartMs, hourOnMs, recipientsFor, fromDoc, logKey, subjectFor, mailBody, mailText };`)();

describe('apps-script/Code.gs helpers', () => {
  it('computes slot start in Malaysia time', () => {
    expect(lib.slotStartMs('2026-11-12', '08:00-10:00')).toBe(Date.parse('2026-11-12T00:00:00Z'));
    expect(lib.slotStartMs('2026-11-12', '')).toBeNull();
    expect(lib.hourOnMs('2026-11-12', 17)).toBe(Date.parse('2026-11-12T09:00:00Z'));
  });

  it('matches recipients like the app does', () => {
    const list = [{ email: 'a@x.co', allCompanies: true }, { email: 'b@x.co', companies: ['Acme'] }];
    expect(lib.recipientsFor(list, 'Acme')).toEqual(['a@x.co', 'b@x.co']);
    expect(lib.recipientsFor(list, 'Other')).toEqual(['a@x.co']);
  });

  it('reads Firestore REST documents', () => {
    const d = lib.fromDoc({
      name: 'projects/p/databases/(default)/documents/bookings/abc',
      fields: {
        eventName: { stringValue: 'Acme' }, truckCount: { integerValue: '2' }, palletized: { booleanValue: true },
        createdAt: { timestampValue: '2026-11-05T04:00:00Z' },
        companies: { arrayValue: { values: [{ stringValue: 'A' }] } }
      }
    });
    expect(d).toMatchObject({ id: 'abc', eventName: 'Acme', truckCount: 2, palletized: true, companies: ['A'] });
    expect(d.createdAt).toBe(Date.parse('2026-11-05T04:00:00Z'));
  });

  it('keys the log by booking, date and slot, and escapes HTML in mail', () => {
    const b = { id: 'abc', bookingDate: '2026-11-12', timeSlot: '08:00-10:00', eventName: '<b>X</b>', createdByName: 'Y' };
    expect(lib.logKey('day', b)).toBe('day_abc_2026-11-12_08001000');
    expect(lib.logKey('new', { ...b, timeSlot: undefined })).toBe('new_abc_2026-11-12_noslot');
    expect(lib.subjectFor('two', b)).toMatch(/in 2 hours/);
    expect(lib.mailBody('Hi', b)).toContain('&lt;b&gt;X&lt;/b&gt;');
    const txt = lib.mailText('Hi', b);
    expect(txt).toContain('Company: <b>X</b>');
    expect(txt).toContain('Time slot: 08:00 – 10:00');
    expect(txt).not.toMatch(/<table|&lt;/);
  });

  it("matches a calendar's recipients by company id (or name for the old calendar)", () => {
    const list = [
      { email: 'all@x.co', allCompanies: true, companies: [] },
      { email: 'tg@x.co', allCompanies: false, companies: ['shell'] },
      { email: 'old@x.co', allCompanies: false, companies: ['Shell'] }
    ];
    expect(recipientsFor(list, 'Shell', 'shell')).toEqual(['all@x.co', 'tg@x.co', 'old@x.co']);
    expect(recipientsFor(list, 'Petronas', 'petronas')).toEqual(['all@x.co']);
    expect(wantsCompany(list[1], 'Shell')).toBe(false); // an id tick needs the booking's companyId
  });

  it('shows ticked companies by name', () => {
    const names = { shell: 'Shell', tg: 'TG Logistics' };
    expect(scopeText({ allCompanies: false, companies: ['shell', 'tg'] }, (id) => names[id])).toBe('Shell, TG Logistics');
    expect(scopeText({ allCompanies: true })).toBe('All companies');
  });
});

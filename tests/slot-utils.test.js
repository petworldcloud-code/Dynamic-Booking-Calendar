import { describe, it, expect } from 'vitest';
import { makeSlot, cleanSlots, generateSlots, slotLabel, slotStart, SLOT_RE, MAX_SLOTS } from '../src/slot-utils.js';

describe('slot-utils', () => {
  it('builds a slot from two times', () => {
    expect(makeSlot('08:00', '10:00')).toBe('08:00-10:00');
    expect(SLOT_RE.test(makeSlot('00:00', '23:59'))).toBe(true);
  });

  it('rejects a missing, reversed or empty range', () => {
    expect(() => makeSlot('', '10:00')).toThrow();
    expect(() => makeSlot('10:00', '08:00')).toThrow(/after the start/);
    expect(() => makeSlot('09:00', '09:00')).toThrow();
  });

  it('cleans a list: drops junk and duplicates, sorts by start time', () => {
    expect(cleanSlots(['10:00-12:00', '08:00-10:00', '08:00-10:00', 'bad', '12:00-11:00', 5, null]))
      .toEqual(['08:00-10:00', '10:00-12:00']);
    expect(cleanSlots(undefined)).toEqual([]);
  });

  it('splits a period into equal slots', () => {
    expect(generateSlots('08:00', '12:00', 60)).toEqual(['08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00']);
    expect(generateSlots('08:00', '12:00', 120)).toEqual(['08:00-10:00', '10:00-12:00']);
  });

  it('shortens the last slot when the period does not divide evenly', () => {
    expect(generateSlots('08:00', '11:00', 120)).toEqual(['08:00-10:00', '10:00-11:00']);
  });

  it('refuses too-short slots and too many slots', () => {
    expect(() => generateSlots('08:00', '12:00', 5)).toThrow(/15 minutes/);
    expect(() => generateSlots('00:00', '23:00', 15)).toThrow(new RegExp(`limit is ${MAX_SLOTS}`));
  });

  it('formats for display', () => {
    expect(slotLabel('08:00-10:00')).toBe('08:00 – 10:00');
    expect(slotStart('08:00-10:00')).toBe('08:00');
    expect(slotLabel(undefined)).toBe('');
    expect(slotStart('')).toBe('');
  });
});

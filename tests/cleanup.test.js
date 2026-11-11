import { describe, it, expect } from 'vitest';
import { bookingCollections, cutoffISO } from '../scripts/cleanup.js';

describe('scripts/cleanup.js', () => {
  it('cleans the old bookings and every calendar, with one global retention', () => {
    expect(bookingCollections(['dim', 'tg'])).toEqual(['bookings', 'calendars/dim/bookings', 'calendars/tg/bookings']);
    expect(bookingCollections()).toEqual(['bookings']);
  });
  it('cuts off by Malaysian date', () => {
    expect(cutoffISO(30, new Date('2026-11-11T17:00:00Z'))).toBe('2026-10-13'); // already 12 Nov in Malaysia
  });
});

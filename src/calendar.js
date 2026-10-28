import { WEEKDAYS, formatDisplay, buildRange } from './date-utils.js';

export const MAX_PER_DAY = 6;
const TONES = ['blue', 'lavender', 'green', 'peach', 'pink'];

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}

export function toneFor(name) {
  let n = 0;
  for (const c of name) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[n % TONES.length];
}

/**
 * Render the calendar grid into `root`.
 * handlers: { onDay(iso, list), onBooking(booking) }
 */
export function renderCalendar(root, { start, today, bookings }, handlers) {
  const range = buildRange(start);
  const byDay = new Map();
  for (const b of bookings) {
    if (!byDay.has(b.bookingDate)) byDay.set(b.bookingDate, []);
    byDay.get(b.bookingDate).push(b);
  }

  const head = h('div', { class: 'cal-row cal-head', role: 'row' },
    h('div', { class: 'cal-weeklabel' }),
    WEEKDAYS.map((d) => h('div', { class: 'cal-wd', role: 'columnheader' }, d)));

  const rows = range.weeks.map((week, wi) => {
    const nums = week.filter(Boolean);
    const dayFrom = range.dates.indexOf(nums[0]) + 1;
    const dayTo = range.dates.indexOf(nums[nums.length - 1]) + 1;
    return h('div', { class: 'cal-row', role: 'row' },
      h('div', { class: 'cal-weeklabel' }, h('strong', {}, `Week ${wi + 1}`), h('span', {}, `(Days ${dayFrom} – ${dayTo})`)),
      week.map((iso) => {
        if (!iso) return h('div', { class: 'cal-cell cal-blank', 'aria-hidden': 'true' });
        const list = byDay.get(iso) || [];
        const shown = list.slice(0, MAX_PER_DAY);
        const extra = list.length - shown.length;
        const isToday = iso === today;
        return h('div', { class: `cal-cell${isToday ? ' is-today' : ''}`, role: 'gridcell' },
          h('button', {
            class: 'cal-date', type: 'button',
            'aria-label': `${formatDisplay(iso)}${isToday ? ', today' : ''}, ${list.length} bookings`,
            onclick: () => handlers.onDay(iso, list)
          }, h('span', {}, formatDisplay(iso)), isToday ? h('span', { class: 'today-dot', title: 'Today' }) : null),
          h('div', { class: 'cal-events' },
            shown.map((b) => h('button', {
              class: `evt tone-${toneFor(b.eventName)}`, type: 'button',
              title: `${b.eventName}${b.truckType ? ` — ${b.truckType} × ${b.truckCount}` : ''}${b.attachments?.length ? ` — ${b.attachments.length} attachment(s)` : ''}`,
              onclick: () => handlers.onBooking(b)
            }, b.eventName, b.truckType ? h('span', { class: 'evt-truck' }, ` ${b.truckCount}×${b.truckType}`) : null)),
            extra > 0 ? h('button', {
              class: 'evt-more', type: 'button', onclick: () => handlers.onDay(iso, list)
            }, `+${extra} more booking${extra > 1 ? 's' : ''}`) : null));
      }));
  });

  root.replaceChildren(head, ...rows);
  return range;
}

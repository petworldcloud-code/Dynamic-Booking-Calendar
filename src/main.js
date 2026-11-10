import { api, DEMO, CONFIGURED } from './api.js';
import { renderCalendar, h } from './calendar.js';
import { prepareFile, base64ToBlobUrl, formatSize, MAX_FILES } from './attachments.js';
import { vehicleOf, vehicleText, palletText, vehicleFields, vehicleProblem } from './booking-utils.js';
import { slotLabel, slotStart, makeSlot, cleanSlots, generateSlots, MAX_SLOTS } from './slot-utils.js';
import { scopeText, DEFAULT_NOTIFY } from './notify-utils.js';
import { pickCalendar, visibleCalendars, calendarLabel, nextCompanyColor, COLOR_RE, cleanCalendarCode } from './calendar-utils.js';
import {
  todayISO, addDays, dateSpan, buildRange, formatDisplay, isValidISO, watchToday, weekdayName, RANGE_DAYS
} from './date-utils.js';

const $ = (id) => document.getElementById(id);
const PAGE = 50;

const state = {
  session: null,
  today: todayISO(),
  viewStart: null, // null => "Today" mode, range follows the Malaysian date
  tab: 'up',
  limit: PAGE,
  calBookings: [],
  listBookings: [],
  known: new Map(), // id -> latest booking seen (for conflict recovery)
  editing: null, // { id, expectedMs }
  companies: [], // admin: company names to book for
  blocked: new Map(), // closed dates: "YYYY-MM-DD" -> reason
  slots: [], // time slots admins allow, e.g. "08:00-10:00" (empty = no time slots)
  draftSlots: [], // admin: list being edited in the Time slots dialog
  recipients: [], // admin: email alert recipients
  notify: { ...DEFAULT_NOTIFY },
  editingEmail: null,
  viewing: null,
  dayISO: null,
  // Multiple calendars. multi=false means the old single-calendar site (no "calendars" yet).
  multi: false,
  calendars: [], // [{ id: "tg", name, order, active }]
  companyList: [], // this calendar's companies [{ id, name, color, active }] (multi-calendar mode)
  cal: undefined // undefined = nothing loaded, null = old single calendar, "tg" = that calendar
};
let unCos = null; let unCals = null; let unRange = null; let unList = null; let unSession = null; let unUsers = null; let unCompanies = null; let unSlots = null; let unBlocked = null; let unRecips = null; let unNotify = null;

// ---------- small UI helpers ----------
function toast(msg, kind = 'ok') {
  const t = h('div', { class: `toast ${kind}` }, (kind === 'ok' ? '✓ ' : '⚠ ') + msg);
  $('toasts').append(t);
  setTimeout(() => t.remove(), 5000);
}
const friendly = (e) => ({
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/invalid-email': 'Enter a valid username.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/requires-recent-login': 'Please log out and log in again, then retry.',
  'auth/email-already-in-use': 'That email is already registered.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
  'permission-denied': 'You do not have permission to do that.'
}[e?.code] || e?.message || 'Something went wrong.');

const isAdmin = () => state.session?.profile?.role === 'admin';
const canEdit = (b) => isAdmin() || b.createdBy === state.session?.user?.uid;
const me = () => ({ uid: state.session.user.uid, displayName: state.session.profile.displayName });

function showScreen(title, bodyNodes) {
  $('app').hidden = true;
  const s = $('screen');
  s.hidden = false;
  s.replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'logo big', 'aria-hidden': 'true' }, '▦'),
    h('h1', {}, 'Dynamic Booking Calendar'),
    title ? h('h2', {}, title) : null, ...bodyNodes));
}
function showApp() { $('screen').hidden = true; $('app').hidden = false; }

// ---------- auth screens ----------
function field(label, attrs) {
  return h('label', {}, label, h('input', attrs));
}
function authScreen(mode = 'login') {
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const fail = (e) => { err.textContent = friendly(e); err.hidden = false; };
  const switchTo = (m) => h('button', { type: 'button', class: 'link', onclick: () => authScreen(m) },
    { login: 'Back to log in', reset: 'Forgot password?' }[m]);

  let form;
  if (mode === 'login') {
    form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try { await api.login(e.target.email.value.trim(), e.target.pw.value); } catch (x) { fail(x); }
      }
    }, field('Username', { name: 'email', type: 'text', required: true, autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' }),
    field('Password', { name: 'pw', type: 'password', required: true, autocomplete: 'current-password' }),
    h('p', { class: 'meta' }, 'Accounts are created by an administrator.'),
    err, h('button', { class: 'primary', type: 'submit' }, 'Log in'),
    h('div', { class: 'links' }, switchTo('reset')));
  } else {
    form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try { await api.resetPassword(e.target.email.value.trim()); toast('If that email is registered, a reset link was sent.'); authScreen('login'); } catch (x) { fail(x); }
      }
    }, field('Username (or email)', { name: 'email', type: 'text', required: true, autocapitalize: 'none' }), err,
    h('button', { class: 'primary', type: 'submit' }, 'Send reset link'),
    h('div', { class: 'links' }, switchTo('login')));
  }
  showScreen({ login: 'Log in', reset: 'Reset password' }[mode], [form]);
}

function accountScreen(s) {
  const out = h('button', { class: 'ghost', type: 'button', onclick: () => api.logout() }, 'Log out');
  if (s.state === 'noaccess') {
    showScreen('No access', [
      h('p', {}, `${s.user.email} has no access to this calendar. Ask an administrator to set up your account.`), out]);
  } else if (s.state === 'pending') {
    showScreen('Access not enabled', [
      h('p', {}, 'Your account has not been activated yet. Ask an administrator.'), out]);
  } else if (s.state === 'suspended') {
    showScreen('Account suspended', [h('p', {}, 'Your account has been suspended. Contact an administrator.'), out]);
  } else {
    showScreen('Something went wrong', [h('p', { class: 'error' }, friendly(s.error)), out]);
  }
}

// ---------- session ----------
function onSession(s) {
  const wasActive = state.session?.state === 'active';
  state.session = s;
  if (s.state === 'active') {
    if (!wasActive) startApp(); else reconcileCalendar(); // the admin may have moved this person to another calendar
    $('user-name').textContent = s.profile.displayName;
    drawRole();
    drawAdminButtons();
    $('btn-users').hidden = $('btn-settings').hidden = $('btn-slots').hidden = $('btn-blocked').hidden = $('btn-notify').hidden = s.profile.role !== 'admin';
    return;
  }
  stopApp();
  if (s.state === 'signedOut') authScreen('login'); else accountScreen(s);
}

// ---------- data subscriptions ----------
const rangeStart = () => state.viewStart ?? state.today;

function remember(list) { list.forEach((b) => state.known.set(b.id, b)); }

function startRange() {
  unRange?.();
  const start = rangeStart();
  const end = addDays(start, RANGE_DAYS - 1);
  $('loading').hidden = false;
  unRange = api.watchRange(start, end, (list) => {
    state.calBookings = list; remember(list);
    $('loading').hidden = true;
    drawCalendar();
    if (state.dayISO && $('dlg-day').open) drawDay();
  }, (e) => { $('loading').hidden = true; toast(friendly(e), 'err'); });
  drawHeader();
  drawCalendar();
}

function startList() {
  unList?.();
  const opts = state.tab === 'up' ? { from: state.today, max: state.limit } : { before: state.today, max: state.limit };
  unList = api.watchList(opts, (list) => {
    state.listBookings = list; remember(list); drawTable();
    $('more').hidden = list.length < state.limit;
  }, (e) => toast(friendly(e), 'err'));
}

function startApp() {
  showApp();
  unCompanies?.();
  unCompanies = isAdmin() ? api.watchUsers((list) => {
    state.companies = list.filter((u) => u.status !== 'suspended').map((u) => u.displayName).sort((a, b) => a.localeCompare(b));
  }, () => {}) : null;
  startCalendars();
}

// ---------- calendars ----------
// Multi-calendar mode switches on by itself once the "calendars" list exists and the rules let us
// read it. Until then (today's live site) the app keeps using the old single-calendar paths.
function startCalendars() {
  unCals?.();
  let heard = false;
  unCals = api.watchCalendars((list) => {
    heard = true;
    state.calendars = list;
    if ($('dlg-cals').open) drawCalendarList();
    if (list.length) { state.multi = true; reconcileCalendar(); } else if (!state.multi) useSingleCalendar();
  }, (e) => {
    if (!heard && !state.multi) useSingleCalendar(); else toast(friendly(e), 'err');
  });
}

function useSingleCalendar() {
  if (state.cal === null) return;
  openCalendar(null);
}

const hashCode = () => decodeURIComponent(location.hash.replace(/^#/, '')).toLowerCase();

/** Open the calendar this person should see: the link's (#tg) if allowed, else their own / the first. */
function reconcileCalendar() {
  if (!state.multi || state.session?.state !== 'active') return;
  const visible = visibleCalendars(state.session.profile, state.calendars);
  const wanted = visible.some((c) => c.id === hashCode()) ? hashCode() : state.cal; // ignore links to other calendars
  const target = pickCalendar(state.session.profile, state.calendars, wanted);
  if (!target) { noCalendarScreen(); return; }
  if (target !== state.cal) openCalendar(target);
  else { if (hashCode() !== target) history.replaceState(null, '', `#${target}`); drawHeader(); }
}

function openCalendar(code) {
  stopCalendarData();
  state.cal = code;
  api.setCalendar(code);
  if (code && hashCode() !== code) history.replaceState(null, '', `#${code}`);
  // Dialogs show the old calendar's data, so close them.
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  showApp();
  startCalendarData();
}

function noCalendarScreen() {
  stopCalendarData();
  state.cal = undefined;
  showScreen('No calendar assigned', [
    h('p', {}, 'Your account is not linked to a calendar yet. Ask an administrator to give you access.'),
    h('button', { class: 'ghost', type: 'button', onclick: () => api.logout() }, 'Log out')]);
}

function drawSwitcher() {
  const box = $('cal-switch');
  const list = state.multi && isAdmin() ? visibleCalendars(state.session.profile, state.calendars) : [];
  box.hidden = list.length < 2;
  box.replaceChildren(...list.map((c) => h('button', {
    type: 'button', class: c.id === state.cal ? 'on' : '', 'aria-pressed': String(c.id === state.cal),
    onclick: () => { if (c.id !== state.cal) openCalendar(c.id); }
  }, calendarLabel(c.id))));
}

function drawAdminButtons() {
  $('btn-cals').hidden = $('btn-cos').hidden = !(state.multi && isAdmin());
}

function drawRole() {
  const p = state.session?.profile;
  if (!p) return;
  $('user-role').textContent = p.role === 'admin' ? 'Administrator'
    : state.multi && p.calendar ? `Staff · ${calendarLabel(p.calendar)}` : 'Standard user';
}

/** Everything that belongs to one calendar: bookings, time slots, blocked dates, email alerts. */
function startCalendarData() {
  unCos?.(); unCos = null;
  if (state.multi && state.cal) {
    unCos = api.watchCompanies((list) => {
      state.companyList = list; drawCalendar(); drawTable();
      if ($('dlg-cos').open) drawCompanyList();
      if (state.dayISO && $('dlg-day').open) drawDay();
    }, () => {});
  }
  unSlots?.();
  unSlots = api.watchSlots((list) => { state.slots = list; }, () => {});
  unBlocked?.();
  unBlocked = api.watchBlocked((map) => {
    state.blocked = map; drawCalendar();
    if (state.dayISO && $('dlg-day').open) drawDay();
    if ($('dlg-blocked').open) drawBlockedList();
  }, () => {});
  unRecips?.(); unNotify?.();
  unRecips = unNotify = null;
  if (isAdmin()) {
    unRecips = api.watchRecipients((list) => { state.recipients = list; if ($('dlg-notify').open) drawRecipients(); }, () => {});
    unNotify = api.watchNotifySettings((s) => { state.notify = s; }, () => {});
  }
  startRange();
  startList();
}
function stopCalendarData() {
  unRange?.(); unList?.(); unSlots?.(); unBlocked?.(); unRecips?.(); unNotify?.(); unCos?.();
  unRange = unList = unSlots = unBlocked = unRecips = unNotify = unCos = null;
  state.companyList = [];
  state.recipients = []; state.notify = { ...DEFAULT_NOTIFY }; state.dayISO = null; state.editing = null; state.viewing = null;
  state.calBookings = []; state.listBookings = []; state.known.clear(); state.slots = []; state.blocked = new Map();
}
function stopApp() {
  stopCalendarData();
  unCals?.(); unUsers?.(); unCompanies?.();
  unCals = unUsers = unCompanies = null;
  state.multi = false; state.calendars = []; state.cal = undefined;
  api.setCalendar(null);
}

// ---------- rendering ----------
function drawHeader() {
  const start = rangeStart();
  const r = buildRange(start);
  $('today-label').textContent = formatDisplay(state.today);
  $('range-label').textContent = `${formatDisplay(r.start)} – ${formatDisplay(r.end)}`;
  $('range-days').textContent = `(${RANGE_DAYS} days)`;
  $('nav-today').disabled = state.viewStart === null;
  const title = state.multi && state.cal ? `${calendarLabel(state.cal)} · Booking Calendar` : 'Dynamic Booking Calendar';
  $('app-title').textContent = title;
  document.title = title;
  drawSwitcher();
  drawRole();
  drawAdminButtons();
  const b = $('banner');
  b.hidden = !DEMO;
  b.textContent = DEMO ? 'DEMO MODE — sample data in memory only. Nothing is saved to Firebase.' : '';
}

/** A company's own colour (multi-calendar mode). Matches by id, else by name for older bookings. */
function colorFor(b) {
  if (!state.multi) return null;
  const c = state.companyList.find((x) => x.id === b.companyId)
    || state.companyList.find((x) => x.name.toLowerCase() === String(b.eventName).toLowerCase());
  return c?.color || null;
}
const dot = (b) => (colorFor(b) ? h('span', { class: 'co-dot', style: `background:${colorFor(b)}`, 'aria-hidden': 'true' }) : null);

function drawCalendar() {
  renderCalendar($('cal'), { start: rangeStart(), today: state.today, bookings: state.calBookings, blocked: state.blocked, colorOf: colorFor }, {
    onDay: openDay, onBooking: (b) => openView(b)
  });
}

const bookingInfo = (b) => [
  b.timeSlot ? `🕘 ${slotLabel(b.timeSlot)}` : null,
  b.deliveryType || null,
  vehicleText(b) ? `${vehicleText(b)} × ${b.truckCount}` : null,
  palletText(b) || null,
  b.plateNumber ? `🚚 ${b.plateNumber}` : null,
  b.attachments?.length ? `📎 ${b.attachments.length}` : null
].filter(Boolean).join(' · ');

function actionButtons(b) {
  if (!canEdit(b)) return h('span', { class: 'muted', title: 'Only the creator or an administrator can change this booking' }, '—');
  return h('span', { class: 'acts' },
    h('button', { class: 'icon', type: 'button', 'aria-label': `Edit ${b.eventName}`, onclick: () => openBookingDialog(b) }, 'Edit'),
    h('button', { class: 'icon danger-text', type: 'button', 'aria-label': `Delete ${b.eventName}`, onclick: () => confirmDelete(b) }, 'Delete'));
}

function drawTable() {
  const q = $('q').value.trim().toLowerCase();
  const sort = $('sort').value;
  let list = state.listBookings.filter((b) =>
    (!q || b.eventName.toLowerCase().includes(q)));
  if (sort === 'name') list = [...list].sort((a, b) => a.eventName.localeCompare(b.eventName));
  else {
    const dir = sort === 'desc' ? -1 : 1;
    list = [...list].sort((a, b) => dir * (a.bookingDate.localeCompare(b.bookingDate)
      || api.millis(a.createdAt) - api.millis(b.createdAt) || a.id.localeCompare(b.id)));
  }
  $('rows').replaceChildren(...list.map((b, i) => h('tr', {},
    h('td', { class: 'c-n' }, String(i + 1)),
    h('td', { class: 'c-d' }, formatDisplay(b.bookingDate)),
    h('td', {}, dot(b), h('button', { class: 'cell-link', type: 'button', title: `Added by ${b.createdByName}`, onclick: () => openView(b) }, b.eventName),
      h('span', { class: 'sub' }, bookingInfo(b))),
    h('td', { class: 'c-a' }, actionButtons(b)))));
  $('empty').hidden = list.length > 0;
}

// ---------- day detail ----------
function openDay(iso) { state.dayISO = iso; drawDay(); $('dlg-day').showModal(); }
function drawDay() {
  const list = state.calBookings.filter((b) => b.bookingDate === state.dayISO);
  $('day-title').textContent = `${formatDisplay(state.dayISO)} — ${list.length} booking${list.length === 1 ? '' : 's'}`;
  const closed = state.blocked.has(state.dayISO);
  $('day-closed').hidden = !closed;
  $('day-closed').textContent = closed ? `Closed for bookings${state.blocked.get(state.dayISO) ? `: ${state.blocked.get(state.dayISO)}` : ''}.` : '';
  $('day-add').hidden = closed;
  $('day-list').replaceChildren(...(list.length ? list.map((b) => h('li', {},
    h('div', {}, dot(b), h('button', { class: 'cell-link', type: 'button', onclick: () => openView(b) }, h('strong', {}, b.eventName)), h('span', { class: 'sub' }, bookingInfo(b))),
    actionButtons(b))) : [h('li', { class: 'muted' }, 'No bookings on this date.')]));
}

// ---------- company dropdown ----------
const KEEP = '__keep__'; // an old booking whose company is no longer in the list keeps it as it is
function fillCompany(current, booking) {
  const sel = $('b-company');
  if (state.multi) {
    const active = state.companyList.filter((c) => c.active !== false);
    const own = booking && !active.some((c) => c.id === booking.companyId) ? booking : null;
    sel.replaceChildren(
      h('option', { value: '' }, active.length || own ? 'Select company…' : 'No companies yet'),
      ...active.map((c) => h('option', { value: c.id }, c.name)),
      own ? h('option', { value: KEEP }, `${own.eventName} (not in list)`) : null);
    sel.value = booking ? (own ? KEEP : booking.companyId) : '';
    return;
  }
  const own = state.session.profile.displayName;
  const names = isAdmin() ? [...state.companies] : [];
  const pick = current || own;
  if (!names.includes(pick)) names.unshift(pick);
  if (!isAdmin()) names.splice(0, names.length, pick);
  sel.replaceChildren(...names.map((n) => h('option', { value: n, selected: n === pick }, n)));
  sel.value = pick;
}

// ---------- closed-date warning in the booking form ----------
function checkBookingDate() {
  const d = $('b-date').value;
  const note = $('b-date-note');
  const closed = state.blocked.has(d);
  const reason = state.blocked.get(d) ? ` (${state.blocked.get(d)})` : '';
  const unchanged = state.editing && state.known.get(state.editing.id)?.bookingDate === d;
  if (!closed || unchanged) { note.hidden = true; $('b-save').disabled = false; return; }
  note.hidden = false;
  note.textContent = `${formatDisplay(d)} is closed for bookings${reason}. Please choose another date${isAdmin() ? ' (or remove the block under Blocked dates)' : ''}.`;
  $('b-save').disabled = true;
}

// ---------- time slot dropdown ----------
function fillSlot(current) {
  const list = state.slots;
  const sel = $('b-slot');
  const retired = current && !list.includes(current); // slot was removed after this booking was made
  $('b-slot-label').hidden = !(list.length || current);
  sel.replaceChildren(
    h('option', { value: '' }, 'Select…'),
    ...list.map((s) => h('option', { value: s }, slotLabel(s))),
    retired ? h('option', { value: current }, `${slotLabel(current)} (no longer offered)`) : null);
  sel.value = current || '';
}

// ---------- booking details pop-up ----------
function openView(b) {
  state.viewing = b;
  $('v-company').textContent = b.eventName;
  $('v-company').style.borderLeft = colorFor(b) ? `6px solid ${colorFor(b)}` : '';
  $('v-company').style.paddingLeft = colorFor(b) ? '8px' : '';
  $('v-date').textContent = `${weekdayName(b.bookingDate)}, ${formatDisplay(b.bookingDate)}`;
  $('v-slot').textContent = b.timeSlot ? slotLabel(b.timeSlot) : '—';
  const vehicle = vehicleOf(b);
  $('v-delivery').textContent = b.deliveryType || '—';
  $('v-vehicle').textContent = vehicle || '—';
  $('v-truck-dt').hidden = $('v-truck').hidden = vehicle !== 'Truck';
  $('v-truck').textContent = b.truckType || '—';
  const unit = vehicle === 'Van' ? ['van', 'vans'] : ['lorry', 'lorries'];
  $('v-count').textContent = b.truckCount ? `${b.truckCount} ${b.truckCount === 1 ? unit[0] : unit[1]}` : '—';
  $('v-pallet').textContent = palletText(b) || '—';
  $('v-plate').textContent = b.plateNumber || '—';
  $('v-notes').textContent = b.notes || '—';
  const files = b.attachments || [];
  $('v-att').replaceChildren(...(files.length ? files.map((a) => {
    const isImg = a.type.startsWith('image/');
    const thumb = isImg ? h('img', { alt: '', width: 40, height: 40 }) : h('span', { class: 'ph' }, (a.name.split('.').pop() || 'file').slice(0, 4));
    if (isImg) loadThumb(b.id, a, thumb);
    return h('li', {}, thumb, h('button', { type: 'button', class: 'link nm', onclick: () => openAttachment(b.id, a) }, `${a.name} (${formatSize(a.size)})`));
  }) : [h('li', { class: 'muted' }, 'None')]));
  $('v-meta').textContent = `Booked by ${b.createdByName}. Last changed by ${b.updatedByName}.`;
  $('v-edit').hidden = $('v-delete').hidden = !canEdit(b);
  if ($('dlg-day').open) $('dlg-day').close();
  $('dlg-view').showModal();
}

// ---------- booking dialog ----------
function openBookingDialog(b, presetDate) {
  const dlg = $('dlg-booking');
  const editing = !!b;
  if (editing && !canEdit(b)) {
    $('b-error').hidden = true;
  }
  state.editing = editing ? { id: b.id, expectedMs: api.millis(b.updatedAt) } : null;
  $('dlg-booking-title').textContent = editing ? (canEdit(b) ? 'Edit Booking' : 'Booking details') : 'Add Booking';
  $('b-date').value = editing ? b.bookingDate : (presetDate || state.today);
  fillCompany(editing ? b.eventName : null, editing ? b : null);
  fillSlot(editing ? b.timeSlot : null);
  $('b-notes').value = editing ? (b.notes || '') : '';
  $('b-delivery').value = editing ? (b.deliveryType || '') : '';
  $('b-vehicle').value = editing ? vehicleOf(b) : '';
  $('b-truck').value = editing ? (b.truckType || '') : '';
  $('b-truck-label').hidden = $('b-vehicle').value !== 'Truck';
  $('b-count').value = editing && b.truckCount ? String(b.truckCount) : '';
  $('b-pallet').value = editing && typeof b.palletized === 'boolean' ? (b.palletized ? 'yes' : 'no') : '';
  $('b-plate').value = editing ? (b.plateNumber || '') : '';
  state.files = { bookingId: editing ? b.id : null, existing: editing ? [...(b.attachments || [])] : [], remove: [], add: [] };
  $('b-files').value = '';
  const ro = editing && !canEdit(b);
  ['b-date', 'b-slot', 'b-company', 'b-notes', 'b-delivery', 'b-vehicle', 'b-truck', 'b-count', 'b-pallet', 'b-plate', 'b-files'].forEach((id) => { $(id).disabled = ro; });
  // Standard users: company is fixed to their own and shown as plain text, not a choice.
  const pickCompany = isAdmin() || state.multi; // in a calendar everyone chooses from its company list
  $('b-company').hidden = !pickCompany;
  $('b-company-fixed').hidden = pickCompany;
  $('b-company-fixed').value = $('b-company').value;
  state.files.readOnly = ro;
  drawAttachments();
  $('b-save').hidden = ro;
  $('b-meta').textContent = editing ? `Created by ${b.createdByName}. Last changed by ${b.updatedByName}.` : '';
  $('b-error').hidden = true;
  checkBookingDate();
  if ($('dlg-day').open) $('dlg-day').close();
  dlg.showModal();
}

// ---------- attachments in the booking dialog ----------
const thumbCache = new Map(); // "bookingId/attId" -> object URL

async function openAttachment(bookingId, a) {
  const w = window.open('', '_blank'); // opened synchronously so pop-up blockers allow it
  try {
    const doc = await api.getAttachment(bookingId, a.id);
    if (!doc) throw new Error('Attachment not found.');
    const url = base64ToBlobUrl(doc.data, doc.type);
    if (a.type.startsWith('image/') || a.type === 'application/pdf') { if (w) w.location = url; } else {
      w?.close(); const link = h('a', { href: url, download: a.name }); document.body.append(link); link.click(); link.remove();
    }
  } catch (x) { w?.close(); toast(friendly(x), 'err'); }
}

async function loadThumb(bookingId, a, img) {
  const key = `${bookingId}/${a.id}`;
  try {
    if (!thumbCache.has(key)) {
      const doc = await api.getAttachment(bookingId, a.id);
      if (!doc) return;
      thumbCache.set(key, base64ToBlobUrl(doc.data, doc.type));
    }
    img.src = thumbCache.get(key);
  } catch { /* thumbnail is optional */ }
}

function drawAttachments() {
  const f = state.files; const ul = $('b-attlist');
  const items = [];
  for (const a of f.existing.filter((x) => !f.remove.includes(x.id))) {
    const isImg = a.type.startsWith('image/');
    const thumb = isImg ? h('img', { alt: '', width: 40, height: 40 }) : h('span', { class: 'ph' }, (a.name.split('.').pop() || 'file').slice(0, 4));
    if (isImg) loadThumb(f.bookingId, a, thumb);
    items.push(h('li', {}, thumb,
      h('button', { type: 'button', class: 'link nm', onclick: () => openAttachment(f.bookingId, a) }, `${a.name} (${formatSize(a.size)})`),
      f.readOnly ? null : h('button', { type: 'button', class: 'icon danger-text', onclick: () => { f.remove.push(a.id); drawAttachments(); } }, 'Remove')));
  }
  for (const a of f.add) {
    items.push(h('li', {}, h('span', { class: 'ph' }, (a.name.split('.').pop() || 'file').slice(0, 4)),
      h('span', { class: 'nm' }, `${a.name} (${formatSize(a.size)}) `, h('span', { class: 'new' }, 'new')),
      h('button', { type: 'button', class: 'icon danger-text', onclick: () => { f.add = f.add.filter((x) => x.id !== a.id); drawAttachments(); } }, 'Remove')));
  }
  ul.replaceChildren(...items);
  if (f.readOnly && !items.length) ul.append(h('li', { class: 'muted' }, 'No attachments.'));
}

async function addPickedFiles(fileList) {
  const f = state.files; const err = $('b-error'); err.hidden = true;
  const current = () => f.existing.filter((x) => !f.remove.includes(x.id)).length + f.add.length;
  for (const file of fileList) {
    if (current() >= MAX_FILES) { err.textContent = `You can attach up to ${MAX_FILES} files.`; err.hidden = false; break; }
    try { f.add.push(await prepareFile(file)); } catch (x) { err.textContent = x.message; err.hidden = false; }
  }
  $('b-files').value = '';
  drawAttachments();
}

/** eventName (+ companyId in a calendar) for the booking being saved. */
function companyFields() {
  const v = $('b-company').value;
  if (!state.multi) return { eventName: v };
  if (v === KEEP) { const old = state.known.get(state.editing?.id); return { eventName: old?.eventName || '', companyId: old?.companyId }; }
  const c = state.companyList.find((x) => x.id === v);
  return { eventName: c ? c.name : '', companyId: c ? c.id : undefined };
}

async function saveBooking(e) {
  e.preventDefault();
  const err = $('b-error');
  const raw = {
    deliveryType: $('b-delivery').value, vehicleType: $('b-vehicle').value, truckType: $('b-truck').value, truckCount: Number($('b-count').value),
    palletized: $('b-pallet').value, plateNumber: $('b-plate').value
  };
  const f = {
    bookingDate: $('b-date').value, ...companyFields(), notes: $('b-notes').value.trim(),
    truckCount: raw.truckCount, ...vehicleFields(raw),
    timeSlot: $('b-slot-label').hidden ? '' : $('b-slot').value
  };
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  if (!isValidISO(f.bookingDate)) return fail('Choose a valid date.');
  const dateChanged = !state.editing || state.known.get(state.editing.id)?.bookingDate !== f.bookingDate;
  if (state.blocked.has(f.bookingDate) && dateChanged) {
    return fail(`${formatDisplay(f.bookingDate)} is closed for bookings${state.blocked.get(f.bookingDate) ? ` (${state.blocked.get(f.bookingDate)})` : ''}. Please choose another date.`);
  }
  if (state.slots.length && !f.timeSlot) return fail('Choose a time slot.');
  if (!f.eventName) return fail('Choose the company.');
  const problem = vehicleProblem(raw);
  if (problem) return fail(problem);
  const btn = $('b-save'); btn.disabled = true; btn.textContent = 'Saving…'; err.hidden = true;
  try {
    const { add, remove } = state.files;
    if (state.editing) await api.updateBooking(me(), state.editing.id, state.editing.expectedMs, f, { add, remove });
    else await api.createBooking(me(), f, add);
    $('dlg-booking').close();
    toast(state.editing ? 'Booking updated.' : 'Booking added.'); // only after the server confirmed
  } catch (x) {
    if (x.code === 'conflict' || x.code === 'gone') {
      const latest = state.known.get(state.editing?.id);
      err.textContent = x.message;
      if (latest && x.code === 'conflict') {
        const reload = h('button', { type: 'button', class: 'link', onclick: () => openBookingDialog(latest) }, ' Load latest version');
        err.replaceChildren(x.message, reload);
      }
    } else err.textContent = friendly(x);
    err.hidden = false; // form data is kept
  } finally { btn.disabled = false; btn.textContent = 'Save'; }
}

function confirmDelete(b) {
  $('cf-title').textContent = 'Delete booking?';
  $('cf-text').textContent = `${b.eventName} on ${formatDisplay(b.bookingDate)} will be permanently removed.`;
  const dlg = $('dlg-confirm');
  $('cf-yes').onclick = async () => {
    $('cf-yes').disabled = true;
    try { await api.deleteBooking(b); dlg.close(); toast('Booking deleted.'); } catch (x) { toast(friendly(x), 'err'); } finally { $('cf-yes').disabled = false; }
  };
  $('cf-no').onclick = () => dlg.close();
  dlg.showModal();
}

// ---------- admin ----------
const roleOf = (u) => (u.role === 'admin' ? 'admin' : 'staff'); // older accounts have role "user"
let usersHelpLegacy = '';

function setupUsersDialog() {
  const multi = state.multi;
  if (!usersHelpLegacy) usersHelpLegacy = $('users-help').textContent;
  $('nu-title').textContent = multi ? 'Add staff or administrator' : 'Add user';
  $('nu-name').placeholder = multi ? 'Full name' : 'Company name (also the username)';
  $('nu-name').setAttribute('aria-label', multi ? 'Full name' : 'Company name');
  $('nu-email').placeholder = multi ? 'Email (they log in with it)' : 'Email (optional, enables password reset)';
  $('nu-email').required = multi;
  $('nu-role').replaceChildren(...(multi
    ? [h('option', { value: 'staff' }, 'Staff (one calendar)'), h('option', { value: 'admin' }, 'Administrator (all calendars)')]
    : [h('option', { value: 'user' }, 'Standard user'), h('option', { value: 'admin' }, 'Administrator')]));
  const cals = state.calendars.filter((c) => c.active !== false);
  $('nu-cal').replaceChildren(h('option', { value: '' }, 'Calendar…'), ...cals.map((c) => h('option', { value: c.id }, calendarLabel(c.id))));
  $('nu-cal').hidden = !multi; $('nu-cal').required = multi;
  $('nu-role').onchange = () => { const staff = $('nu-role').value === 'staff'; $('nu-cal').hidden = !staff; $('nu-cal').required = staff; };
  $('users-filter-label').hidden = !multi;
  $('users-filter').replaceChildren(h('option', { value: '*' }, 'All calendars'),
    ...state.calendars.map((c) => h('option', { value: c.id }, calendarLabel(c.id))), h('option', { value: '-' }, 'No calendar'));
  $('users-filter').onchange = () => drawUsersTable();
  $('users-help').textContent = multi
    ? 'Staff log in with their email and the initial password you set, and only see the calendar chosen here. Administrators see every calendar. Change a person\'s calendar in the table. Set Status to "suspended" to block someone. Removing a login completely is done in the Firebase Console.'
    : usersHelpLegacy;
  $('users-head').replaceChildren(h('tr', {}, ...(multi
    ? ['Name', 'Email', 'Role', 'Calendar', 'Status', 'Actions'] : ['Company', 'Username', 'Role', 'Status', 'Actions']).map((t) => h('th', {}, t))));
}

let usersList = [];
function drawUsersTable() {
  const multi = state.multi;
  const f = multi ? $('users-filter').value : '*';
  const list = usersList.filter((u) => f === '*' || (f === '-' ? !u.calendar && roleOf(u) !== 'admin' : u.calendar === f));
  $('users-rows').replaceChildren(...list.map((u) => {
    const self = u.uid === state.session.user.uid;
    const sel = (key, opts, value = u[key]) => {
      const s = h('select', { 'aria-label': `${key} for ${u.displayName}`, disabled: self }, opts.map((o) => h('option', { value: o, selected: value === o }, o)));
      s.onchange = async () => { try { await api.updateUser(u.uid, { [key]: s.value }); toast('User updated.'); } catch (x) { toast(friendly(x), 'err'); s.value = value; } };
      return s;
    };
    const acts = h('td', {}, self ? h('span', { class: 'muted' }, 'You') : h('span', { class: 'acts' },
      h('button', { class: 'icon', type: 'button', onclick: () => openEditUser(u) }, 'Edit'),
      h('button', { class: 'icon danger-text', type: 'button', onclick: () => confirmDeleteUser(u) }, multi ? 'Remove' : 'Delete')));
    if (!multi) {
      return h('tr', {}, h('td', {}, u.displayName), h('td', {}, u.username || u.displayName.trim().toLowerCase().replace(/\s+/g, '.')),
        h('td', {}, sel('role', ['user', 'admin'])), h('td', {}, sel('status', ['pending', 'active', 'suspended'])), acts);
    }
    const admin = roleOf(u) === 'admin';
    const calSel = h('select', { 'aria-label': `Calendar for ${u.displayName}`, disabled: self || admin },
      h('option', { value: '' }, admin ? 'All' : 'None'),
      ...state.calendars.map((c) => h('option', { value: c.id }, calendarLabel(c.id))));
    calSel.value = admin ? '' : (u.calendar || '');
    calSel.onchange = async () => {
      try { await api.updateUser(u.uid, { calendar: calSel.value }); toast('Calendar changed.'); }
      catch (x) { toast(friendly(x), 'err'); calSel.value = u.calendar || ''; }
    };
    return h('tr', {}, h('td', {}, u.displayName), h('td', {}, u.email?.endsWith('@dim-calendar.local') ? (u.username || '—') : (u.email || '—')),
      h('td', {}, sel('role', ['staff', 'admin'], roleOf(u))), h('td', {}, calSel), h('td', {}, sel('status', ['pending', 'active', 'suspended'])), acts);
  }));
}

function openUsers() {
  const dlg = $('dlg-users'); dlg.showModal();
  setupUsersDialog();
  unUsers?.();
  unUsers = api.watchUsers((list) => { usersList = list; drawUsersTable(); }, (e) => toast(friendly(e), 'err'));
}

const usernameOf = (u) => u.username || u.displayName.trim().toLowerCase().replace(/\s+/g, '.');

function openEditUser(u) {
  $('eu-name').value = u.displayName;
  $('dlg-edituser').querySelector('h3').textContent = state.multi ? 'Edit name' : 'Edit company';
  $('eu-username').textContent = state.multi ? 'The login email does not change.' : `Username stays "${usernameOf(u)}" (renaming the company does not change the login).`;
  $('eu-error').hidden = true;
  $('form-edituser').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('eu-name').value.trim();
    if (!name) return;
    try {
      // Keep the existing username when the display name changes.
      await api.updateUser(u.uid, { displayName: name, ...(u.username || state.multi ? {} : { username: usernameOf(u) }) });
      $('dlg-edituser').close(); toast(state.multi ? 'Name updated.' : 'Company updated.');
    } catch (x) { $('eu-error').textContent = friendly(x); $('eu-error').hidden = false; }
  };
  $('dlg-edituser').showModal();
}

function confirmDeleteUser(u) {
  $('cf-title').textContent = state.multi ? 'Remove this user?' : 'Delete company?';
  $('cf-text').textContent = `${u.displayName} will no longer be able to log in or see bookings. Their existing bookings stay on the calendar. (To remove the login completely, delete it in the Firebase Console.)`;
  const dlg = $('dlg-confirm');
  $('cf-yes').onclick = async () => {
    $('cf-yes').disabled = true;
    try { await api.deleteUser(u.uid, u.username || (state.multi ? '' : usernameOf(u))); dlg.close(); toast(state.multi ? 'User removed.' : 'Company deleted.'); } catch (x) { toast(friendly(x), 'err'); } finally { $('cf-yes').disabled = false; }
  };
  $('cf-no').onclick = () => dlg.close();
  dlg.showModal();
}

// ---------- admin: calendars ----------
function drawCalendarList() {
  const list = [...state.calendars].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  $('cal-list').replaceChildren(...list.map((c) => h('li', { class: c.active === false ? 'archived' : '' },
    h('span', {}, h('strong', {}, calendarLabel(c.id)), c.active === false ? ' — archived (hidden from staff)' : ''),
    h('button', {
      type: 'button', class: 'icon', onclick: async () => {
        try { await api.setCalendarActive(c.id, c.active === false); toast(c.active === false ? 'Calendar restored.' : 'Calendar archived.'); } catch (x) { toast(friendly(x), 'err'); }
      }
    }, c.active === false ? 'Restore' : 'Archive'))));
}

function openCalendars() { $('cal-error').hidden = true; drawCalendarList(); $('dlg-cals').showModal(); }

// ---------- admin: companies of the current calendar ----------
function drawCompanyList() {
  const msg = (m) => { const e = $('co-error'); e.textContent = m; e.hidden = !m; };
  const all = state.companyList;
  $('cos-title').textContent = `Companies — ${calendarLabel(state.cal)}`;
  if (!$('co-color').dataset.touched) $('co-color').value = nextCompanyColor(all);
  $('co-list').replaceChildren(...(all.length ? all.map((c) => {
    const name = h('input', { type: 'text', value: c.name, maxlength: 120, 'aria-label': 'Company name' });
    const color = h('input', { type: 'color', value: c.color, 'aria-label': `Colour for ${c.name}` });
    const save = async () => {
      msg('');
      try { await api.updateCompany(c.id, { name: name.value, color: color.value }, all); toast('Company saved.'); }
      catch (x) { msg(friendly(x)); name.value = c.name; color.value = c.color; }
    };
    name.onchange = save; color.onchange = save;
    return h('li', { class: `co-row${c.active === false ? ' archived' : ''}` }, color, name,
      h('button', {
        type: 'button', class: `icon${c.active === false ? '' : ' danger-text'}`, onclick: async () => {
          try { await api.setCompanyActive(c.id, c.active === false); } catch (x) { msg(friendly(x)); }
        }
      }, c.active === false ? 'Restore' : 'Remove'));
  }) : [h('li', { class: 'muted' }, 'No companies yet. Add the first one above.')]));
}

function openCompanies() { $('co-error').hidden = true; $('co-color').dataset.touched = ''; drawCompanyList(); $('dlg-cos').showModal(); }

// ---------- admin: blocked dates ----------
function blockProblem(msg) { const e = $('bl-error'); e.textContent = msg; e.hidden = !msg; }

function drawBlockedList() {
  const upcoming = [...state.blocked.entries()].filter(([d]) => d >= state.today).sort(([a], [b]) => a.localeCompare(b));
  $('bl-list').replaceChildren(...(upcoming.length ? upcoming.map(([d, reason]) => h('li', {},
    h('span', {}, h('strong', {}, `${weekdayName(d)}, ${formatDisplay(d)}`), reason ? ` — ${reason}` : ''),
    h('button', {
      type: 'button', class: 'icon danger-text', 'aria-label': `Unblock ${formatDisplay(d)}`,
      onclick: async () => { try { await api.unblockDate(d); toast('Date reopened.'); } catch (x) { toast(friendly(x), 'err'); } }
    }, 'Unblock'))) : [h('li', { class: 'muted' }, 'No blocked dates coming up.')]));
}

function openBlocked() { blockProblem(''); drawBlockedList(); $('dlg-blocked').showModal(); }

async function addBlocked(e) {
  e.preventDefault();
  const btn = $('bl-add'); blockProblem('');
  try {
    const dates = dateSpan($('bl-from').value, $('bl-to').value || $('bl-from').value);
    btn.disabled = true; btn.textContent = 'Blocking…';
    await api.blockDates(state.session.user.uid, dates, $('bl-reason').value.trim());
    e.target.reset();
    toast(`${dates.length} date${dates.length === 1 ? '' : 's'} blocked.`);
  } catch (x) { blockProblem(friendly(x)); } finally { btn.disabled = false; btn.textContent = 'Block'; }
}

// ---------- admin: email alerts ----------
function notifyProblem(msg) { const e = $('nt-error'); e.textContent = msg; e.hidden = !msg; }

function drawCompanyBoxes(ticked = []) {
  const names = [...new Set([...state.companies, ...ticked])].sort((a, b) => a.localeCompare(b));
  $('nt-companies').replaceChildren(...(names.length ? names.map((n) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', value: n, checked: ticked.includes(n) }), n)) : [h('span', { class: 'muted' }, 'No companies yet.')]));
  $('nt-companies').classList.toggle('off', $('nt-all').checked);
}

function resetNotifyForm() {
  state.editingEmail = null;
  $('form-notify').reset(); $('nt-email').readOnly = false;
  $('nt-form-title').textContent = 'Add an email address'; $('nt-save').textContent = 'Add'; $('nt-reset').hidden = true;
  notifyProblem(''); drawCompanyBoxes();
}

function drawRecipients() {
  const rows = state.recipients.map((r) => h('li', {},
    h('span', {}, h('strong', {}, r.email), ` — ${scopeText(r)}`),
    h('span', { class: 'acts' },
      h('button', { type: 'button', class: 'icon', onclick: () => editRecipient(r) }, 'Edit'),
      h('button', {
        type: 'button', class: 'icon danger-text', 'aria-label': `Remove ${r.email}`,
        onclick: async () => {
          try { await api.removeRecipient(r.email); if (state.editingEmail === r.email) resetNotifyForm(); toast('Email removed.'); } catch (x) { toast(friendly(x), 'err'); }
        }
      }, 'Remove'))));
  $('nt-list').replaceChildren(...(rows.length ? rows : [h('li', { class: 'muted' }, 'No email addresses yet — nobody is notified.')]));
}

function editRecipient(r) {
  state.editingEmail = r.email;
  $('nt-email').value = r.email; $('nt-email').readOnly = true;
  $('nt-all').checked = r.allCompanies; drawCompanyBoxes(r.companies);
  $('nt-form-title').textContent = 'Change which companies this email covers'; $('nt-save').textContent = 'Save'; $('nt-reset').hidden = false;
  notifyProblem('');
}

function openNotify() {
  $('nt-hour').replaceChildren(...Array.from({ length: 24 }, (_, i) => h('option', { value: String(i) }, `${String(i).padStart(2, '0')}:00`)));
  const s = state.notify;
  $('nt-new').checked = s.onNew; $('nt-day').checked = s.dayBefore; $('nt-two').checked = s.twoHours; $('nt-hour').value = String(s.dayBeforeHour);
  resetNotifyForm(); drawRecipients();
  $('dlg-notify').showModal();
}

async function saveNotifyForm(e) {
  e.preventDefault();
  const btn = $('nt-save'); notifyProblem('');
  try {
    const companies = [...$('nt-companies').querySelectorAll('input:checked')].map((i) => i.value);
    btn.disabled = true;
    await api.saveRecipient(state.session.user.uid,
      { email: $('nt-email').value, allCompanies: $('nt-all').checked, companies },
      state.recipients.length, !state.editingEmail);
    toast(state.editingEmail ? 'Saved.' : 'Email added.');
    resetNotifyForm();
  } catch (x) { notifyProblem(friendly(x)); } finally { btn.disabled = false; }
}

async function saveNotifyChoices() {
  const btn = $('nt-save-settings'); btn.disabled = true;
  try {
    await api.saveNotifySettings(state.session.user.uid, {
      onNew: $('nt-new').checked, dayBefore: $('nt-day').checked, twoHours: $('nt-two').checked, dayBeforeHour: Number($('nt-hour').value)
    });
    toast('Saved.');
  } catch (x) { toast(friendly(x), 'err'); } finally { btn.disabled = false; }
}

// ---------- admin: time slots ----------
function slotProblem(msg) { const e = $('sl-error'); e.textContent = msg; e.hidden = !msg; }

function drawSlotDraft() {
  const items = state.draftSlots.map((s) => h('li', {}, slotLabel(s),
    h('button', {
      type: 'button', class: 'icon danger-text', 'aria-label': `Remove ${slotLabel(s)}`,
      onclick: () => { state.draftSlots = state.draftSlots.filter((x) => x !== s); drawSlotDraft(); }
    }, '✕')));
  $('sl-list').replaceChildren(...(items.length ? items : [h('li', { class: 'muted' }, 'No time slots — bookings only need a date.')]));
}

function openSlots() {
  state.draftSlots = [...state.slots];
  slotProblem('');
  drawSlotDraft();
  $('dlg-slots').showModal();
}

function changeSlotDraft(build) {
  try {
    const next = cleanSlots(build());
    if (next.length > MAX_SLOTS) throw new Error(`At most ${MAX_SLOTS} time slots.`);
    state.draftSlots = next; slotProblem(''); drawSlotDraft();
  } catch (x) { slotProblem(x.message); }
}

async function openSettings() {
  const dlg = $('dlg-settings'); $('s-error').hidden = true;
  try {
    const r = await api.getRetention();
    $('s-enabled').checked = r.autoDeleteEnabled; $('s-days').value = r.retentionDays;
    dlg.showModal();
  } catch (x) { toast(friendly(x), 'err'); }
}

// ---------- wiring ----------
function wire() {
  $('btn-add').onclick = () => openBookingDialog(null);
  $('day-add').onclick = () => openBookingDialog(null, state.dayISO);
  $('day-close').onclick = () => $('dlg-day').close();
  $('b-cancel').onclick = () => $('dlg-booking').close();
  $('v-close').onclick = () => $('dlg-view').close();
  $('v-edit').onclick = () => { const b = state.viewing; $('dlg-view').close(); openBookingDialog(b); };
  $('v-delete').onclick = () => { const b = state.viewing; $('dlg-view').close(); confirmDelete(b); };
  $('eu-cancel').onclick = () => $('dlg-edituser').close();
  $('b-files').onchange = (e) => addPickedFiles([...e.target.files]);
  $('form-booking').onsubmit = saveBooking;
  $('b-date').addEventListener('input', checkBookingDate);
  $('b-date').addEventListener('change', checkBookingDate);
  // "Type of truck" only applies to trucks; choosing Van hides it and forgets the choice.
  $('b-vehicle').onchange = () => {
    const truck = $('b-vehicle').value === 'Truck';
    $('b-truck-label').hidden = !truck;
    if (!truck) $('b-truck').value = '';
  };
  $('btn-logout').onclick = () => api.logout();
  $('btn-password').onclick = () => { $('form-password').reset(); $('pw-error').hidden = true; $('dlg-password').showModal(); };
  $('pw-cancel').onclick = () => $('dlg-password').close();
  $('form-password').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('pw-error'); err.hidden = true;
    if ($('pw-new').value !== $('pw-new2').value) { err.textContent = 'New passwords do not match.'; err.hidden = false; return; }
    try {
      await api.changePassword($('pw-old').value, $('pw-new').value);
      $('dlg-password').close(); toast('Password changed.');
    } catch (x) { err.textContent = friendly(x); err.hidden = false; }
  };
  $('btn-cals').onclick = openCalendars;
  $('cals-close').onclick = () => $('dlg-cals').close();
  $('form-cal').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('cal-error'); err.hidden = true;
    try {
      const code = cleanCalendarCode($('cal-code').value);
      if (state.calendars.some((c) => c.id === code)) throw new Error('That calendar already exists.');
      await api.createCalendar(code, Math.max(0, ...state.calendars.map((c) => c.order ?? 0)) + 1);
      e.target.reset(); toast(`Calendar ${calendarLabel(code)} created.`);
    } catch (x) { err.textContent = friendly(x); err.hidden = false; }
  };
  $('btn-cos').onclick = openCompanies;
  $('cos-close').onclick = () => $('dlg-cos').close();
  $('co-color').oninput = () => { $('co-color').dataset.touched = '1'; };
  $('form-co').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('co-error'); err.hidden = true;
    try {
      if (!COLOR_RE.test($('co-color').value)) throw new Error('Pick a valid colour.');
      await api.addCompany({ name: $('co-name').value, color: $('co-color').value }, state.companyList);
      $('co-name').value = ''; $('co-color').dataset.touched = '';
    } catch (x) { err.textContent = friendly(x); err.hidden = false; }
  };
  $('btn-users').onclick = openUsers;
  $('users-close').onclick = () => { $('dlg-users').close(); unUsers?.(); unUsers = null; };
  $('btn-settings').onclick = openSettings;
  $('btn-slots').onclick = openSlots;
  $('btn-blocked').onclick = openBlocked;
  $('btn-notify').onclick = openNotify;
  $('nt-close').onclick = () => $('dlg-notify').close();
  $('nt-reset').onclick = resetNotifyForm;
  $('nt-all').onchange = () => $('nt-companies').classList.toggle('off', $('nt-all').checked);
  $('form-notify').onsubmit = saveNotifyForm;
  $('nt-save-settings').onclick = saveNotifyChoices;
  $('bl-close').onclick = () => $('dlg-blocked').close();
  $('form-blocked').onsubmit = addBlocked;
  $('sl-cancel').onclick = () => $('dlg-slots').close();
  $('sl-add').onclick = () => changeSlotDraft(() => [...state.draftSlots, makeSlot($('sl-from').value, $('sl-to').value)]);
  $('sg-go').onclick = () => changeSlotDraft(() => generateSlots($('sg-from').value, $('sg-to').value, $('sg-step').value));
  for (const [ids, btn] of [[['sl-from', 'sl-to'], 'sl-add'], [['sg-from', 'sg-to'], 'sg-go']]) {
    ids.forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $(btn).click(); } }));
  }
  $('form-slots').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('sl-save'); btn.disabled = true; btn.textContent = 'Saving…'; slotProblem('');
    try {
      await api.saveSlots(state.session.user.uid, state.draftSlots);
      $('dlg-slots').close(); toast(state.draftSlots.length ? 'Time slots saved.' : 'Time slots turned off.');
    } catch (x) { slotProblem(friendly(x)); } finally { btn.disabled = false; btn.textContent = 'Save'; }
  };
  $('form-newuser').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('nu-error'); const btn = $('nu-save');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Creating…';
    try {
      await api.adminCreateUser({
        name: $('nu-name').value.trim(), email: $('nu-email').value,
        password: $('nu-pw').value, role: $('nu-role').value,
        calendar: state.multi && $('nu-role').value === 'staff' ? $('nu-cal').value : undefined
      });
      e.target.reset();
      toast('User created and activated.');
    } catch (x) { err.textContent = friendly(x); err.hidden = false; } finally { btn.disabled = false; btn.textContent = 'Create'; }
  };
  $('s-cancel').onclick = () => $('dlg-settings').close();
  $('form-settings').onsubmit = async (e) => {
    e.preventDefault();
    const enabled = $('s-enabled').checked;
    if (enabled && !confirm('Permanent deletion cannot be undone. Enable it?')) return;
    try {
      await api.saveRetention(state.session.user.uid, { autoDeleteEnabled: enabled, retentionDays: $('s-days').value });
      $('dlg-settings').close(); toast('Retention settings saved.');
    } catch (x) { $('s-error').textContent = friendly(x); $('s-error').hidden = false; }
  };

  const shift = (n) => { state.viewStart = addDays(rangeStart(), n); if (state.viewStart === state.today) state.viewStart = null; startRange(); };
  $('nav-prev').onclick = () => shift(-RANGE_DAYS);
  $('nav-next').onclick = () => shift(RANGE_DAYS);
  $('nav-today').onclick = () => { state.viewStart = null; startRange(); };

  ['q', 'sort'].forEach((id) => $(id).addEventListener('input', drawTable));
  const setTab = (t) => {
    state.tab = t; state.limit = PAGE;
    $('tab-up').classList.toggle('on', t === 'up'); $('tab-hist').classList.toggle('on', t === 'hist');
    $('tab-up').setAttribute('aria-selected', t === 'up'); $('tab-hist').setAttribute('aria-selected', t === 'hist');
    startList();
  };
  $('tab-up').onclick = () => setTab('up');
  $('tab-hist').onclick = () => setTab('hist');
  $('more').onclick = () => { state.limit += PAGE; startList(); };

  // A #tg link (or the back button) opens that calendar, if this person may use it.
  window.addEventListener('hashchange', () => reconcileCalendar());

  // Midnight in Kuala Lumpur: advance "today"; keep a manually chosen period untouched.
  watchToday((t) => {
    state.today = t;
    if (state.session?.state !== 'active') return;
    drawHeader();
    if (state.viewStart === null) startRange(); else drawCalendar();
    startList();
  });
}

// ---------- boot ----------
function boot() {
  wire();
  if (!CONFIGURED) {
    showScreen('Not configured', [h('p', {}, 'Firebase settings are missing. Copy .env.example to .env and fill in your Firebase web config (see README).')]);
    return;
  }
  showScreen('', [h('p', { class: 'muted' }, 'Loading…')]);
  unSession = api.watchSession(onSession);
}
void unSession;
boot();

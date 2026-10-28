import { api, DEMO, CONFIGURED } from './api.js';
import { renderCalendar, h } from './calendar.js';
import {
  todayISO, addDays, buildRange, formatDisplay, isValidISO, watchToday, RANGE_DAYS
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
  dayISO: null
};
let unRange = null; let unList = null; let unSession = null; let unUsers = null;

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
    if (!wasActive) startApp();
    $('user-name').textContent = s.profile.displayName;
    $('user-role').textContent = s.profile.role === 'admin' ? 'Administrator' : 'Standard user';
    $('btn-users').hidden = $('btn-settings').hidden = s.profile.role !== 'admin';
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
  startRange();
  startList();
}
function stopApp() {
  unRange?.(); unList?.(); unUsers?.();
  unRange = unList = unUsers = null;
  state.calBookings = []; state.listBookings = []; state.known.clear();
}

// ---------- rendering ----------
function drawHeader() {
  const start = rangeStart();
  const r = buildRange(start);
  $('today-label').textContent = formatDisplay(state.today);
  $('range-label').textContent = `${formatDisplay(r.start)} – ${formatDisplay(r.end)}`;
  $('range-days').textContent = `(${RANGE_DAYS} days)`;
  $('nav-today').disabled = state.viewStart === null;
  const b = $('banner');
  b.hidden = !DEMO;
  b.textContent = DEMO ? 'DEMO MODE — sample data in memory only. Nothing is saved to Firebase.' : '';
}

function drawCalendar() {
  renderCalendar($('cal'), { start: rangeStart(), today: state.today, bookings: state.calBookings }, {
    onDay: openDay, onBooking: (b) => openBookingDialog(b)
  });
}

function actionButtons(b) {
  if (!canEdit(b)) return h('span', { class: 'muted', title: 'Only the creator or an administrator can change this booking' }, '—');
  return h('span', { class: 'acts' },
    h('button', { class: 'icon', type: 'button', 'aria-label': `Edit ${b.eventName}`, onclick: () => openBookingDialog(b) }, 'Edit'),
    h('button', { class: 'icon danger-text', type: 'button', 'aria-label': `Delete ${b.eventName}`, onclick: () => confirmDelete(b) }, 'Delete'));
}

function drawTable() {
  const q = $('q').value.trim().toLowerCase();
  const from = $('f-from').value; const to = $('f-to').value;
  const sort = $('sort').value;
  let list = state.listBookings.filter((b) =>
    (!q || b.eventName.toLowerCase().includes(q)) && (!from || b.bookingDate >= from) && (!to || b.bookingDate <= to));
  if (sort === 'name') list = [...list].sort((a, b) => a.eventName.localeCompare(b.eventName));
  else {
    const dir = sort === 'desc' ? -1 : 1;
    list = [...list].sort((a, b) => dir * (a.bookingDate.localeCompare(b.bookingDate)
      || api.millis(a.createdAt) - api.millis(b.createdAt) || a.id.localeCompare(b.id)));
  }
  $('rows').replaceChildren(...list.map((b, i) => h('tr', {},
    h('td', { class: 'c-n' }, String(i + 1)),
    h('td', { class: 'c-d' }, formatDisplay(b.bookingDate)),
    h('td', {}, h('button', { class: 'cell-link', type: 'button', title: `Added by ${b.createdByName}`, onclick: () => openBookingDialog(b) }, b.eventName)),
    h('td', { class: 'c-a' }, actionButtons(b)))));
  $('empty').hidden = list.length > 0;
}

// ---------- day detail ----------
function openDay(iso) { state.dayISO = iso; drawDay(); $('dlg-day').showModal(); }
function drawDay() {
  const list = state.calBookings.filter((b) => b.bookingDate === state.dayISO);
  $('day-title').textContent = `${formatDisplay(state.dayISO)} — ${list.length} booking${list.length === 1 ? '' : 's'}`;
  $('day-list').replaceChildren(...(list.length ? list.map((b) => h('li', {},
    h('div', {}, h('strong', {}, b.eventName), h('small', {}, ` · by ${b.createdByName}`)),
    actionButtons(b))) : [h('li', { class: 'muted' }, 'No bookings on this date.')]));
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
  $('b-name').value = editing ? b.eventName : '';
  $('b-notes').value = editing ? (b.notes || '') : '';
  const ro = editing && !canEdit(b);
  ['b-date', 'b-name', 'b-notes'].forEach((id) => { $(id).disabled = ro; });
  $('b-save').hidden = ro;
  $('b-meta').textContent = editing ? `Created by ${b.createdByName}. Last changed by ${b.updatedByName}.` : '';
  $('b-error').hidden = true;
  if ($('dlg-day').open) $('dlg-day').close();
  dlg.showModal();
}

async function saveBooking(e) {
  e.preventDefault();
  const err = $('b-error');
  const f = { bookingDate: $('b-date').value, eventName: $('b-name').value.trim(), notes: $('b-notes').value.trim() };
  if (!isValidISO(f.bookingDate)) { err.textContent = 'Choose a valid date.'; err.hidden = false; return; }
  if (!f.eventName) { err.textContent = 'Event name is required.'; err.hidden = false; return; }
  const btn = $('b-save'); btn.disabled = true; btn.textContent = 'Saving…'; err.hidden = true;
  try {
    if (state.editing) await api.updateBooking(me(), state.editing.id, state.editing.expectedMs, f);
    else await api.createBooking(me(), f);
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
    try { await api.deleteBooking(b.id); dlg.close(); toast('Booking deleted.'); } catch (x) { toast(friendly(x), 'err'); } finally { $('cf-yes').disabled = false; }
  };
  $('cf-no').onclick = () => dlg.close();
  dlg.showModal();
}

// ---------- admin ----------
function openUsers() {
  const dlg = $('dlg-users'); dlg.showModal();
  unUsers?.();
  unUsers = api.watchUsers((list) => {
    $('users-rows').replaceChildren(...list.map((u) => {
      const self = u.uid === state.session.user.uid;
      const sel = (key, opts) => {
        const s = h('select', { 'aria-label': `${key} for ${u.displayName}`, disabled: self }, opts.map((o) => h('option', { value: o, selected: u[key] === o }, o)));
        s.onchange = async () => { try { await api.updateUser(u.uid, { [key]: s.value }); toast('User updated.'); } catch (x) { toast(friendly(x), 'err'); s.value = u[key]; } };
        return s;
      };
      return h('tr', {}, h('td', {}, u.displayName), h('td', {}, u.username || u.email), h('td', {}, sel('role', ['user', 'admin'])), h('td', {}, sel('status', ['pending', 'active', 'suspended'])));
    }));
  }, (e) => toast(friendly(e), 'err'));
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
  $('form-booking').onsubmit = saveBooking;
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
  $('btn-users').onclick = openUsers;
  $('users-close').onclick = () => { $('dlg-users').close(); unUsers?.(); unUsers = null; };
  $('btn-settings').onclick = openSettings;
  $('form-newuser').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('nu-error'); const btn = $('nu-save');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Creating…';
    try {
      await api.adminCreateUser({
        name: $('nu-name').value.trim(), username: $('nu-username').value, email: $('nu-email').value,
        password: $('nu-pw').value, role: $('nu-role').value
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

  ['q', 'f-from', 'f-to', 'sort'].forEach((id) => $(id).addEventListener('input', drawTable));
  const setTab = (t) => {
    state.tab = t; state.limit = PAGE;
    $('tab-up').classList.toggle('on', t === 'up'); $('tab-hist').classList.toggle('on', t === 'hist');
    $('tab-up').setAttribute('aria-selected', t === 'up'); $('tab-hist').setAttribute('aria-selected', t === 'hist');
    startList();
  };
  $('tab-up').onclick = () => setTab('up');
  $('tab-hist').onclick = () => setTab('hist');
  $('more').onclick = () => { state.limit += PAGE; startList(); };

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

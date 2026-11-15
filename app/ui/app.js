// The app window. It shows the state the main process sends and asks for
// changes; the main process applies the rules and answers.
'use strict';

const api = window.focusLock;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const $ = id => document.getElementById(id);
let view = null;
let hoursDirty = false;

// ---- helpers ---------------------------------------------------------------

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'class') node.className = value;
    // Set styles through the DOM: the page's security policy blocks inline style attributes.
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

function when(ms) {
  return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function left(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d) return d + 'd ' + h + 'h';
  if (h) return h + 'h ' + m + 'm';
  return m + 'm';
}

let toastTimer = null;
function toast(text, isError) {
  const t = $('toast');
  t.textContent = text;
  t.className = isError ? 'error' : '';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 4500);
}

async function change(changeSet) {
  const result = await api.change(changeSet);
  if (!result || !result.ok) toast((result && result.error) || 'Could not save that.', true);
  else toast(result.message);
  view = await api.getState();
  render();
  return result && result.ok;
}

// ---- navigation ------------------------------------------------------------

function go(page) {
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => { p.hidden = p.id !== 'page-' + page; });
  window.scrollTo(0, 0);
}
document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => go(b.dataset.page)));
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => go(b.dataset.goto)));

// ---- week bar --------------------------------------------------------------

function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

function segmentsByDay(schedule) {
  const days = DAY_NAMES.map(() => []);
  for (const w of schedule) {
    const s = minutesOf(w.start);
    const e = minutesOf(w.end);
    for (const d of w.days) {
      if (s === e) days[d].push([0, 1440]);
      else if (s < e) days[d].push([s, e]);
      else { days[d].push([s, 1440]); days[(d + 1) % 7].push([0, e]); }
    }
  }
  return days;
}

function renderWeek(container, schedule, now) {
  const days = segmentsByDay(schedule);
  const today = new Date(now);
  container.replaceChildren();
  // Monday first.
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    const bar = el('div', { class: 'bar' });
    for (const [s, e] of days[d]) {
      bar.append(el('div', { class: 'seg', style: { left: (s / 1440) * 100 + '%', width: ((e - s) / 1440) * 100 + '%' } }));
    }
    if (today.getDay() === d) {
      const m = today.getHours() * 60 + today.getMinutes();
      bar.append(el('div', { class: 'now', style: { left: (m / 1440) * 100 + '%' }, title: 'Now' }));
    }
    container.append(el('span', {}, DAY_NAMES[d]), bar);
  }
  container.append(el('div', { class: 'axis' }, el('span', {}, '00:00'), el('span', {}, '06:00'), el('span', {}, '12:00'), el('span', {}, '18:00'), el('span', {}, '24:00')));
}

// ---- overview --------------------------------------------------------------

// Whether the service managed to write the browser policies.
function policyChip() {
  const p = view.policy || {};
  if (p.development) return el('span', { class: 'chip' }, el('span', { class: 'dot' }), 'Test mode: browsers not changed');
  if (p.ok === false) return el('span', { class: 'chip' }, el('span', { class: 'dot warn' }), 'Browser policies not written');
  if (p.ok) return el('span', { class: 'chip' }, el('span', { class: 'dot ok' }), 'Chrome, Brave and Edge following');
  return el('span', { class: 'chip' }, el('span', { class: 'dot' }), 'Starting');
}

function renderOverview() {
  const { settings, strict, blockingNow } = view;
  const hero = $('hero');
  hero.classList.toggle('strict', strict);
  let title;
  let detail;
  if (strict) {
    title = 'Strict mode is on';
    detail = settings.unlockAt
      ? 'Early unlock requested. Strict mode ends ' + when(settings.unlockAt) + '.'
      : 'Locked until ' + when(settings.strictUntil) + ' (' + left(settings.strictUntil - view.now) + ' left).';
  } else if (!settings.enabled) {
    title = 'The blocker is off';
    detail = 'Nothing is blocked.';
  } else if (!settings.schedule.length) {
    title = 'No blocking hours yet';
    detail = 'Adult and pirate sites are blocked. Add your hours to block YouTube, social media and streaming.';
  } else if (blockingNow) {
    title = 'Blocking now';
    detail = 'YouTube, social media, streaming and your sites are blocked.';
  } else {
    title = 'Outside your blocking hours';
    detail = 'Adult and pirate sites are still blocked.';
  }
  $('heroTitle').textContent = title;
  $('heroDetail').textContent = detail;
  $('heroChips').replaceChildren(...[
    view.pending.length ? el('span', { class: 'chip' }, el('span', { class: 'dot warn' }), view.pending.length + ' waiting') : null,
    policyChip()
  ].filter(Boolean));

  $('enabled').checked = settings.enabled;
  $('enabled').disabled = strict && settings.enabled;
  $('enabledNote').textContent = strict
    ? 'Locked by strict mode.'
    : settings.enabled ? 'Turning it off waits 24 hours.' : 'Turning it on happens right away.';

  renderWeek($('weekBar'), settings.schedule, view.now);

  const list = $('pendingList');
  list.replaceChildren();
  if (!view.pending.length) list.append(el('li', { class: 'empty' }, 'Nothing waiting.'));
  for (const p of view.pending) {
    list.append(el('li', {},
      el('span', { class: 'what' }, p.summary),
      el('span', { class: 'tag' }, 'in ' + left(p.applyAt - view.now)),
      el('button', { onclick: () => change({ type: 'cancelPending', id: p.id }) }, 'Cancel')));
  }

  $('sideStatus').textContent = title;
}

$('enabled').addEventListener('change', async event => {
  const on = event.target.checked;
  if (!on) {
    const ok = await api.confirm('Turn the blocker off?', 'This waits 24 hours before it happens. You can cancel it until then.');
    if (!ok) { event.target.checked = true; return; }
  }
  change({ type: 'enabled', enabled: on });
});

// ---- hours -----------------------------------------------------------------

function windowRow(w) {
  const days = el('div', { class: 'days' });
  DAY_NAMES.forEach((name, i) => {
    days.append(el('label', { class: 'day' },
      el('input', { type: 'checkbox', value: String(i), checked: (w.days || []).includes(i), onchange: markDirty }),
      el('span', {}, name)));
  });
  const start = el('input', { type: 'time', class: 'start', value: w.start || '09:00', oninput: markDirty });
  const end = el('input', { type: 'time', class: 'end', value: w.end || '17:00', oninput: markDirty });
  const row = el('div', { class: 'window' }, days, el('span', {}, start, ' to ', end),
    el('button', { class: 'danger', onclick: () => { row.remove(); markDirty(); } }, 'Remove'));
  return row;
}

function readSchedule() {
  return [...document.querySelectorAll('#windows .window')].map(row => ({
    days: [...row.querySelectorAll('.days input:checked')].map(b => Number(b.value)),
    start: row.querySelector('.start').value,
    end: row.querySelector('.end').value
  }));
}

function markDirty() {
  hoursDirty = true;
  const schedule = readSchedule().filter(w => w.days.length && w.start && w.end);
  renderWeek($('weekBarEdit'), schedule, view.now);
  $('saveHours').disabled = false;
}

function renderHours(force) {
  const { settings, strict } = view;
  if (!hoursDirty || force) {
    const box = $('windows');
    box.replaceChildren(...settings.schedule.map(w => windowRow(w)));
    if (!settings.schedule.length) box.append(el('p', { class: 'empty', id: 'noHours' }, 'No hours set yet. Add a time window to start.'));
    renderWeek($('weekBarEdit'), settings.schedule, view.now);
    $('saveHours').disabled = true;
  }
  const lock = $('hoursLock');
  lock.hidden = !strict;
  lock.textContent = 'Strict mode is on. You can add hours, but not remove or shorten them.';
}

$('addWindow').addEventListener('click', () => {
  const empty = $('noHours');
  if (empty) empty.remove();
  $('windows').append(windowRow({ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }));
  markDirty();
});

$('saveHours').addEventListener('click', async () => {
  const ok = await change({ type: 'schedule', schedule: readSchedule() });
  if (ok) { hoursDirty = false; renderHours(true); }
});

// ---- lists -----------------------------------------------------------------

function pendingFor(predicate) {
  return view.pending.find(p => predicate(p.change));
}

function renderLists() {
  const { lists, strict } = view;
  const cats = $('categories');
  cats.replaceChildren();
  for (const c of view.categories) {
    const on = lists.categories[c.id] !== false;
    const waiting = pendingFor(ch => ch.type === 'category' && ch.id === c.id);
    const input = el('input', {
      type: 'checkbox',
      checked: on,
      disabled: strict && on,
      'aria-label': 'Block ' + c.label,
      onchange: async e => {
        if (!e.target.checked) {
          const ok = await api.confirm('Stop blocking ' + c.label + '?', 'This waits 24 hours before it happens.');
          if (!ok) { e.target.checked = true; return; }
        }
        change({ type: 'category', id: c.id, on: e.target.checked });
      }
    });
    cats.append(el('div', { class: 'cat' },
      el('div', { class: 'text' }, el('div', { class: 'name' }, c.label), el('div', { class: 'muted small' }, c.detail)),
      waiting ? el('span', { class: 'tag' }, 'off in ' + left(waiting.applyAt - view.now)) : null,
      el('label', { class: 'switch' }, input, el('span', { class: 'track' }))));
  }

  $('alwaysList').replaceChildren(...view.alwaysOn.map(t => el('li', {}, t)));

  const sites = $('siteList');
  sites.replaceChildren();
  if (!lists.sites.length) sites.append(el('li', { class: 'empty' }, 'No sites of your own yet.'));
  for (const s of lists.sites) {
    const waiting = pendingFor(ch => ch.site === s.site);
    sites.append(el('li', {},
      el('span', { class: 'site' }, s.site),
      waiting ? el('span', { class: 'tag' }, waiting.summary.replace(s.site, 'it') + ' in ' + left(waiting.applyAt - view.now)) : null,
      el('label', { class: 'check' },
        el('input', {
          type: 'checkbox', checked: s.always, disabled: strict && s.always,
          onchange: e => change({ type: 'setSiteAlways', site: s.site, always: e.target.checked })
        }), 'All the time'),
      el('button', { class: 'danger', disabled: strict, onclick: () => change({ type: 'removeSite', site: s.site }) }, 'Remove')));
  }

}

$('siteForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (await change({ type: 'addSite', site: $('siteInput').value, always: $('siteAlways').checked })) {
    $('siteInput').value = '';
    $('siteAlways').checked = false;
  }
});

// ---- strict ----------------------------------------------------------------

function toLocalInput(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderStrict() {
  const { settings, strict } = view;
  $('strictHeading').textContent = strict ? 'Strict mode is on' : 'Start strict mode';
  $('strictState').textContent = strict
    ? 'Locked until ' + when(settings.strictUntil) + '. You can extend it, but not shorten it.'
    : !settings.schedule.length ? 'Set your blocking hours first.' : 'Pick how long to lock your settings.';
  $('startStrict').textContent = strict ? 'Extend strict mode' : 'Start strict mode';
  const base = strict ? settings.strictUntil : view.now;
  $('until').min = toLocalInput(base);

  const unlockAt = settings.unlockAt;
  $('unlockState').textContent = !strict
    ? (settings.lastStrictLength ? 'Strict mode is off. You can re-arm it for the same length as last time.' : 'Strict mode is not on.')
    : unlockAt ? 'Early unlock requested. Strict mode ends ' + when(unlockAt) + ' unless you cancel.' : 'No early unlock requested.';
  $('unlockCountdown').hidden = !(strict && unlockAt);
  if (strict && unlockAt) $('unlockCountdown').textContent = left(unlockAt - view.now) + ' to go';
  $('requestUnlock').hidden = !strict || Boolean(unlockAt);
  $('cancelUnlock').hidden = !strict || !unlockAt;
  $('rearm').hidden = strict || !settings.lastStrictLength;
  if (settings.lastStrictLength) {
    const hours = Math.round(settings.lastStrictLength / 3600000);
    $('rearm').textContent = 'Re-arm strict mode for ' + (hours >= 48 ? Math.round(hours / 24) + ' days' : hours + ' hours');
  }
}

document.querySelectorAll('#presets button').forEach(b => b.addEventListener('click', () => {
  const base = view.strict ? view.settings.strictUntil : view.now;
  $('until').value = toLocalInput(base + Number(b.dataset.days) * 86400000);
}));

$('startStrict').addEventListener('click', async () => {
  if (!$('until').value) return toast('Pick when strict mode should end.', true);
  if (hoursDirty) return toast('Save your blocking hours first.', true);
  const until = new Date($('until').value).getTime();
  const ok = await api.confirm(
    (view.strict ? 'Extend strict mode to ' : 'Lock your settings until ') + when(until) + '?',
    'Until then you cannot turn the blocker off, remove hours, turn off lists or remove sites. ' +
    'The only way out early is the 72 hour early unlock. Any waiting changes are cancelled.');
  if (ok) change({ type: 'startStrict', until });
});

$('requestUnlock').addEventListener('click', async () => {
  const ok = await api.confirm('Request an early unlock?', 'Strict mode ends 72 hours from now unless you cancel. Your hours and lists stay as they are.');
  if (ok) change({ type: 'requestUnlock' });
});
$('cancelUnlock').addEventListener('click', () => change({ type: 'cancelUnlock' }));
$('rearm').addEventListener('click', () => change({ type: 'rearm' }));

// ---- browsers & history ------------------------------------------------------

function renderBrowsers() {
  const p = view.policy || {};
  const status = p.development ? 'Test mode: the browsers are not changed while the app runs without the Focus Lock service.'
    : p.ok === false ? 'The service could not write the browser policies: ' + (p.error || 'unknown error') + '.'
    : p.ok ? 'Up to date. Last written ' + when(p.appliedAt) + '.'
    : 'Starting.';
  $('browserCards').replaceChildren(...['Chrome', 'Brave', 'Edge'].map(name => el('div', { class: 'card' },
    el('h2', {}, name),
    el('p', {}, el('span', { class: 'chip' }, el('span', { class: 'dot ' + (p.ok ? 'ok' : p.ok === false ? 'warn' : '') }),
      p.ok ? 'Following Focus Lock' : p.ok === false ? 'Not updated' : 'Waiting')))));
  $('policyStatus').textContent = status;
  const list = $('blockedNow');
  list.replaceChildren(...(view.blockedNow || []).map(site => el('li', {}, site)));
  $('blockedCount').textContent = (view.blockedNow || []).length + ' sites blocked right now';
}

function renderHistory() {
  const list = $('logList');
  list.replaceChildren();
  if (!view.log.length) list.append(el('li', { class: 'empty' }, 'Nothing yet.'));
  for (const entry of view.log) list.append(el('li', {}, el('time', {}, when(entry.at)), el('span', {}, entry.text)));
}

// ---- main ------------------------------------------------------------------

function render() {
  if (!view) return;
  // The service holds the settings. If it isn't answering, show that and
  // keep the last screen as it was.
  $('offline').hidden = !view.offline;
  if (view.offline) return;
  renderOverview();
  renderHours(false);
  renderLists();
  renderStrict();
  renderBrowsers();
  renderHistory();
}

// Keep the last real view when the service stops answering, so the
// screen doesn't empty out.
function receive(v) {
  if (v && v.offline && view && !view.offline) {
    $('offline').hidden = false;
    return;
  }
  view = v;
  render();
}
api.onState(receive);
api.getState().then(receive);

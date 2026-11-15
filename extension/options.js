// Settings page: blocking days and hours, the on/off switch and strict mode.
// Every change goes through the background worker, which enforces the
// strict mode rules.
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const $ = id => document.getElementById(id);
let state = null;

function send(message) {
  return new Promise(resolve => chrome.runtime.sendMessage(message, resolve));
}

function say(text, isError) {
  $('message').textContent = text || '';
  $('message').className = isError ? 'error' : '';
}

function windowRow(window, locked) {
  const row = document.createElement('div');
  row.className = 'window';

  const days = document.createElement('div');
  days.className = 'days';
  DAY_NAMES.forEach((name, index) => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = String(index);
    box.checked = (window.days || []).includes(index);
    box.disabled = locked;
    label.append(box, name);
    days.append(label);
  });

  const start = document.createElement('input');
  start.type = 'time';
  start.className = 'start';
  start.value = window.start || '09:00';
  start.disabled = locked;

  const end = document.createElement('input');
  end.type = 'time';
  end.className = 'end';
  end.value = window.end || '17:00';
  end.disabled = locked;

  const remove = document.createElement('button');
  remove.textContent = 'Remove';
  remove.className = 'danger';
  remove.disabled = locked;
  remove.addEventListener('click', () => row.remove());

  const times = document.createElement('span');
  times.append(start, ' to ', end);
  row.append(days, times, remove);
  return row;
}

// Storage can hand keys back in a different order, so compare field by field.
function canonical(schedule) {
  return JSON.stringify((schedule || []).map(w => [[...w.days].sort(), w.start, w.end]));
}

function readSchedule() {
  return [...document.querySelectorAll('.window')].map(row => ({
    days: [...row.querySelectorAll('.days input:checked')].map(box => Number(box.value)),
    start: row.querySelector('.start').value,
    end: row.querySelector('.end').value
  }));
}

function render() {
  const { settings, strict, active, managed, lastSync } = state;
  const locked = strict || managed;

  // When the desktop app manages the settings, this page only shows them.
  $('managed').hidden = !managed;
  if (managed) {
    $('managedDetail').textContent = lastSync && lastSync.ok === false
      ? 'The last update from the app was ignored because it ' + lastSync.reason + '.'
      : lastSync ? 'Last update ' + new Date(lastSync.at).toLocaleString() + '.' : '';
  }
  document.querySelectorAll('#strict, #unlock').forEach(s => { s.hidden = managed; });

  if (strict) {
    $('status').textContent = 'Strict mode is on until ' + new Date(settings.strictUntil).toLocaleString() + '.';
  } else if (!settings.enabled) {
    $('status').textContent = 'The blocker is off.';
  } else if (!settings.schedule.length) {
    $('status').textContent = 'No blocking hours set yet, so nothing is blocked.';
  } else {
    $('status').textContent = active ? 'Blocking now.' : 'Not blocking right now. Outside your blocking hours.';
  }

  $('enabled').checked = settings.enabled;
  $('enabled').disabled = locked;

  const list = $('windows');
  list.replaceChildren(...settings.schedule.map(w => windowRow(w, locked)));
  if (!settings.schedule.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.id = 'empty';
    empty.textContent = 'No hours set yet.';
    list.append(empty);
  }
  $('add').disabled = locked;
  $('save').disabled = locked;
  $('startStrict').textContent = strict ? 'Extend strict mode' : 'Start strict mode';
  const unlockAt = settings.unlockAt;
  $('unlockStatus').textContent = !strict ? 'Strict mode is not on.'
    : unlockAt ? 'Early unlock requested. Strict mode ends ' + new Date(unlockAt).toLocaleString() + '.'
    : 'No early unlock requested.';
  $('requestUnlock').hidden = !strict || Boolean(unlockAt);
  $('cancelUnlock').hidden = !strict || !unlockAt;
  $('rearm').hidden = strict || !settings.lastStrictLength;
  if (settings.lastStrictLength) {
    $('rearm').textContent = 'Re-arm strict mode for ' + Math.round(settings.lastStrictLength / 3600000) + ' hours';
  }
  document.querySelectorAll('#hours, #power').forEach(s => s.classList.toggle('locked', locked));
}

async function change(changeSet, doneText) {
  const result = await send({ type: 'changeSettings', change: changeSet });
  if (!result || !result.ok) {
    say((result && result.error) || 'Could not save.', true);
  } else {
    say(doneText);
  }
  await load();
}

async function load() {
  state = await send({ type: 'getSettings' });
  render();
}

$('add').addEventListener('click', () => {
  const empty = $('empty');
  if (empty) empty.remove();
  $('windows').append(windowRow({ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }, false));
});

$('save').addEventListener('click', () => change({ schedule: readSchedule() }, 'Blocking hours saved.'));

$('enabled').addEventListener('change', event =>
  change({ enabled: event.target.checked }, event.target.checked ? 'Blocker turned on.' : 'Blocker turned off.'));

$('startStrict').addEventListener('click', async () => {
  const value = $('until').value;
  if (!value) return say('Pick when strict mode should end.', true);
  const until = new Date(value).getTime();
  const unsaved = canonical(readSchedule()) !== canonical(state.settings.schedule);
  if (unsaved && !state.strict) return say('Save your blocking hours first.', true);
  const ok = confirm('Strict mode will lock your blocking hours and the on/off switch until ' +
    new Date(until).toLocaleString() + '. You will not be able to undo this. Continue?');
  if (ok) await change({ strictUntil: until }, 'Strict mode is on.');
});

$('requestUnlock').addEventListener('click', async () => {
  if (confirm('Strict mode will end in 72 hours unless you cancel. Request an early unlock?')) {
    await change({ requestUnlock: true }, 'Early unlock requested.');
  }
});

$('cancelUnlock').addEventListener('click', () => change({ cancelUnlock: true }, 'Early unlock cancelled.'));

$('rearm').addEventListener('click', () => change({ rearm: true }, 'Strict mode is on again.'));

load();

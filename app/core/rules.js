// The rules engine for the desktop app. Every change the user makes goes
// through apply(), which decides whether it happens now, waits 24 hours, or
// is refused. Pure functions only, so the Node tests can cover all of it.
'use strict';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const LOOSEN_DELAY = 24 * HOUR;
const UNLOCK_DELAY = 72 * HOUR;
const MAX_STRICT = 365 * DAY;
const LOG_LIMIT = 50;

// Lists the user can switch on and off. The sites in each are in
// core/blocklists.json.
const CATEGORIES = [
  { id: 'youtube', label: 'YouTube', detail: 'All of YouTube, including Shorts' },
  { id: 'social-media', label: 'Social media', detail: 'Facebook, Instagram, TikTok, X, Reddit, Snapchat and more' },
  { id: 'video-streaming', label: 'Streaming', detail: 'Netflix, Prime Video, Disney+, Hulu, Max, Twitch and more' },
  { id: 'anime-streaming', label: 'Anime streaming', detail: 'Crunchyroll, Funimation, HIDIVE' },
  { id: 'sports-streaming', label: 'Sports streaming', detail: 'DAZN, ESPN' }
];

// Always blocked while the blocker is on. Shown in the app but not editable.
const ALWAYS_ON = [
  'Adult sites, including animated (hentai) sites',
  'Pirate streaming sites, FMHY and its mirrors, and piracy subreddits',
  'SafeSearch in Google and Bing, and YouTube Restricted Mode',
  'Incognito, InPrivate and guest windows are turned off'
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function defaultState() {
  const categories = {};
  for (const c of CATEGORIES) categories[c.id] = true;
  return {
    version: 1,
    settings: { enabled: true, schedule: [], strictUntil: null, unlockAt: null, lastStrictLength: null },
    lists: { categories, sites: [] },
    pending: [],
    log: []
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Fill in anything missing from a saved state (older versions, hand edits).
function normalize(state) {
  const base = defaultState();
  const s = state && typeof state === 'object' ? state : {};
  return {
    version: 1,
    settings: { ...base.settings, ...(s.settings || {}) },
    lists: {
      categories: { ...base.lists.categories, ...((s.lists || {}).categories || {}) },
      sites: Array.isArray((s.lists || {}).sites) ? s.lists.sites : []
    },
    pending: Array.isArray(s.pending) ? s.pending : [],
    log: Array.isArray(s.log) ? s.log : []
  };
}

// ---- Schedule ------------------------------------------------------------

function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

// Which minutes of the week (Sunday 00:00 = 0) a schedule blocks. Same
// meaning everywhere in Focus Lock: a window that ends
// before it starts runs past midnight, and start === end is the whole day.
function coverage(schedule) {
  const week = new Uint8Array(7 * 1440);
  for (const w of schedule || []) {
    const start = minutesOf(w.start);
    const end = minutesOf(w.end);
    for (const day of w.days || []) {
      const base = day * 1440;
      if (start === end) {
        week.fill(1, base, base + 1440);
      } else if (start < end) {
        week.fill(1, base + start, base + end);
      } else {
        week.fill(1, base + start, base + 1440);
        const next = ((day + 1) % 7) * 1440;
        week.fill(1, next, next + end);
      }
    }
  }
  return week;
}

// True when schedule a blocks at least every minute that schedule b does.
function scheduleCovers(a, b) {
  const ca = coverage(a);
  const cb = coverage(b);
  for (let i = 0; i < cb.length; i++) if (cb[i] && !ca[i]) return false;
  return true;
}

function isBlockingActive(schedule, date) {
  const d = date || new Date();
  const minute = d.getDay() * 1440 + d.getHours() * 60 + d.getMinutes();
  return Boolean(coverage(schedule)[minute]);
}

function cleanSchedule(schedule) {
  if (!Array.isArray(schedule)) throw new Error('Schedule must be a list.');
  return schedule.map(w => {
    const days = [...new Set((w.days || []).map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort();
    if (!days.length) throw new Error('Pick at least one day for each time window.');
    if (!TIME.test(w.start) || !TIME.test(w.end)) throw new Error('Times must look like 09:00.');
    return { days, start: w.start, end: w.end };
  });
}

// ---- Lists ---------------------------------------------------------------

// "https://www.Example.com/path?x" -> "example.com/path". A bare domain
// blocks the whole site; a domain with a path blocks that part of it.
function cleanSite(input) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(s)) {
    throw new Error('That does not look like a website. Try something like example.com or example.com/videos.');
  }
  return s;
}

// ---- Strict mode ---------------------------------------------------------

function isStrict(settings, now) {
  const s = settings || {};
  if (typeof s.strictUntil !== 'number' || s.strictUntil <= now) return false;
  return !(typeof s.unlockAt === 'number' && s.unlockAt <= now);
}

// ---- Changes -------------------------------------------------------------

function when(ms) {
  return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function categoryLabel(id) {
  const c = CATEGORIES.find(x => x.id === id);
  return c ? c.label : id;
}

function log(state, now, text) {
  state.log.unshift({ at: now, text });
  state.log.length = Math.min(state.log.length, LOG_LIMIT);
}

// What a change touches. A tighter change to the same thing cancels any
// looser change to it that is still waiting.
function targetOf(change) {
  switch (change.type) {
    case 'schedule': return 'schedule';
    case 'enabled': return 'enabled';
    case 'category': return 'category:' + change.id;
    case 'addSite': case 'removeSite': case 'setSiteAlways': return 'site:' + change.site;
    default: return null;
  }
}

// Checks a change and puts it in a standard shape. Returns
// { change, loosens, summary }, or throws for an invalid change.
function classify(state, raw) {
  const { settings, lists } = state;
  const change = { ...raw };
  switch (change.type) {
    case 'schedule': {
      change.schedule = cleanSchedule(change.schedule);
      const loosens = !scheduleCovers(change.schedule, settings.schedule);
      return { change, loosens, summary: loosens ? 'Change blocking hours to fewer hours' : 'Change blocking hours' };
    }
    case 'enabled':
      change.enabled = Boolean(change.enabled);
      return { change, loosens: !change.enabled && settings.enabled, summary: change.enabled ? 'Turn the blocker on' : 'Turn the blocker off' };
    case 'category': {
      if (!CATEGORIES.some(c => c.id === change.id)) throw new Error('Unknown list.');
      change.on = Boolean(change.on);
      const loosens = !change.on && lists.categories[change.id] !== false;
      return { change, loosens, summary: (change.on ? 'Block ' : 'Stop blocking ') + categoryLabel(change.id) };
    }
    case 'addSite':
      change.site = cleanSite(change.site);
      change.always = Boolean(change.always);
      if (lists.sites.some(s => s.site === change.site)) throw new Error(change.site + ' is already on your list.');
      return { change, loosens: false, summary: 'Block ' + change.site };
    case 'removeSite':
      change.site = cleanSite(change.site);
      if (!lists.sites.some(s => s.site === change.site)) throw new Error(change.site + ' is not on your list.');
      return { change, loosens: true, summary: 'Remove ' + change.site + ' from your list' };
    case 'setSiteAlways': {
      change.site = cleanSite(change.site);
      change.always = Boolean(change.always);
      const entry = lists.sites.find(s => s.site === change.site);
      if (!entry) throw new Error(change.site + ' is not on your list.');
      return {
        change,
        loosens: entry.always && !change.always,
        summary: change.always ? 'Block ' + change.site + ' all the time' : 'Block ' + change.site + ' only during blocking hours'
      };
    }
    default:
      throw new Error('Unknown change.');
  }
}

// Makes a change take effect. Used for tighter changes right away and for
// looser changes once their 24 hours are up.
function commit(state, change) {
  const { settings, lists } = state;
  switch (change.type) {
    case 'schedule': settings.schedule = change.schedule; break;
    case 'enabled': settings.enabled = change.enabled; break;
    case 'category': lists.categories[change.id] = change.on; break;
    case 'addSite':
      if (!lists.sites.some(s => s.site === change.site)) lists.sites.push({ site: change.site, always: change.always });
      break;
    case 'removeSite': lists.sites = lists.sites.filter(s => s.site !== change.site); break;
    case 'setSiteAlways':
      lists.sites = lists.sites.map(s => (s.site === change.site ? { ...s, always: change.always } : s));
      break;
  }
}

// Brings a state up to date: applies looser changes whose wait is over and
// ends strict mode once its time (or an early unlock) has come.
function settle(input, now) {
  const state = normalize(clone(input));
  const due = state.pending.filter(p => p.applyAt <= now).sort((a, b) => a.applyAt - b.applyAt);
  for (const p of due) {
    commit(state, p.change);
    log(state, p.applyAt, 'Done after 24 hours: ' + p.summary + '.');
  }
  state.pending = state.pending.filter(p => p.applyAt > now);
  const s = state.settings;
  if (typeof s.strictUntil === 'number' && !isStrict(s, now)) {
    const early = typeof s.unlockAt === 'number' && s.unlockAt < s.strictUntil;
    log(state, Math.min(now, early ? s.unlockAt : s.strictUntil), early ? 'Strict mode ended by early unlock.' : 'Strict mode ended.');
    s.strictUntil = null;
    s.unlockAt = null;
  }
  return state;
}

let idCounter = 0;
function newId(now) {
  idCounter = (idCounter + 1) % 1e6;
  return now.toString(36) + '-' + idCounter.toString(36);
}

// The single entry point for user changes. Returns { state, outcome,
// message } where outcome is "applied" or "queued", or throws an Error
// whose message is shown to the user.
function apply(input, change, now) {
  const state = settle(input, now);
  const { settings } = state;
  const strict = isStrict(settings, now);

  switch (change && change.type) {
    case 'startStrict': {
      const until = Number(change.until);
      if (!Number.isFinite(until) || until <= now) throw new Error('Pick an end time in the future.');
      if (until - now > MAX_STRICT) throw new Error('Strict mode can be at most 365 days at a time.');
      if (strict) {
        if (until < settings.strictUntil) throw new Error('Strict mode can be extended but not shortened.');
        settings.strictUntil = until;
        log(state, now, 'Strict mode extended to ' + when(until) + '.');
        return { state, outcome: 'applied', message: 'Strict mode now runs until ' + when(until) + '.' };
      }
      if (!settings.enabled) throw new Error('Turn the blocker on before starting strict mode.');
      if (!settings.schedule.length) throw new Error('Set your blocking hours before starting strict mode.');
      settings.strictUntil = until;
      settings.unlockAt = null;
      settings.lastStrictLength = until - now;
      const dropped = state.pending.length;
      state.pending = [];
      log(state, now, 'Strict mode started, until ' + when(until) + '.');
      return {
        state,
        outcome: 'applied',
        message: 'Strict mode is on until ' + when(until) + '.' + (dropped ? ' Waiting changes were cancelled.' : '')
      };
    }
    case 'rearm': {
      if (strict) throw new Error('Strict mode is already on.');
      if (!settings.lastStrictLength) throw new Error('There is no earlier strict mode to re-arm.');
      return apply(state, { type: 'startStrict', until: now + settings.lastStrictLength }, now);
    }
    case 'requestUnlock': {
      if (!strict) throw new Error('Strict mode is not on.');
      if (settings.unlockAt) throw new Error('An early unlock is already counting down.');
      if (settings.strictUntil - now <= UNLOCK_DELAY) throw new Error('Strict mode ends within 72 hours anyway.');
      settings.unlockAt = now + UNLOCK_DELAY;
      log(state, now, 'Early unlock requested. Strict mode ends ' + when(settings.unlockAt) + '.');
      return { state, outcome: 'applied', message: 'Early unlock requested. Strict mode ends ' + when(settings.unlockAt) + ' unless you cancel.' };
    }
    case 'cancelUnlock': {
      if (!settings.unlockAt) throw new Error('No early unlock is counting down.');
      settings.unlockAt = null;
      log(state, now, 'Early unlock cancelled.');
      return { state, outcome: 'applied', message: 'Early unlock cancelled. Strict mode stays on.' };
    }
    case 'cancelPending': {
      const item = state.pending.find(p => p.id === change.id);
      if (!item) throw new Error('That change is no longer waiting.');
      state.pending = state.pending.filter(p => p.id !== change.id);
      log(state, now, 'Cancelled: ' + item.summary + '.');
      return { state, outcome: 'applied', message: 'Cancelled.' };
    }
  }

  const { change: clean, loosens, summary } = classify(state, change || {});
  const target = targetOf(clean);

  if (!loosens) {
    commit(state, clean);
    const before = state.pending.length;
    // Schedule changes replace each other, so an older waiting one would
    // undo this one when it comes due.
    state.pending = state.pending.filter(p => targetOf(p.change) !== target);
    log(state, now, summary + '.');
    const note = state.pending.length < before ? ' The waiting change to the same thing was cancelled.' : '';
    return { state, outcome: 'applied', message: 'Done: ' + summary + '.' + note };
  }

  if (strict) {
    throw new Error('Strict mode is on until ' + when(settings.strictUntil) + '. Until then you can only make the blocker stricter.');
  }
  if (state.pending.some(p => JSON.stringify(p.change) === JSON.stringify(clean))) {
    throw new Error('That change is already waiting.');
  }
  state.pending = state.pending.filter(p => targetOf(p.change) !== target);
  const applyAt = now + LOOSEN_DELAY;
  state.pending.push({ id: newId(now), change: clean, summary, requestedAt: now, applyAt });
  log(state, now, 'Requested: ' + summary + '. Takes effect ' + when(applyAt) + '.');
  return { state, outcome: 'queued', message: summary + ' will happen ' + when(applyAt) + '. Looser changes wait 24 hours. You can cancel it until then.' };
}

// Everything the window shows.
function view(state, now) {
  const s = settle(state, now);
  const strict = isStrict(s.settings, now);
  return {
    settings: s.settings,
    lists: s.lists,
    pending: s.pending.slice().sort((a, b) => a.applyAt - b.applyAt),
    log: s.log,
    strict,
    blockingNow: s.settings.enabled && isBlockingActive(s.settings.schedule, new Date(now)),
    categories: CATEGORIES,
    alwaysOn: ALWAYS_ON,
    unlockDelayHours: UNLOCK_DELAY / HOUR,
    loosenDelayHours: LOOSEN_DELAY / HOUR,
    now
  };
}

module.exports = {
  CATEGORIES,
  ALWAYS_ON,
  LOOSEN_DELAY,
  UNLOCK_DELAY,
  defaultState,
  normalize,
  coverage,
  scheduleCovers,
  isBlockingActive,
  cleanSite,
  isStrict,
  classify,
  settle,
  apply,
  view
};

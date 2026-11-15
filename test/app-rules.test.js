const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const r = require('../app/core/rules.js');
const m = require('../extension/lib/match.js');
const { createServer } = require('../app/core/server.js');
const { createStore } = require('../app/core/store.js');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 10, 16, 10, 0).getTime(); // a Monday, 10:00 local time
const WEEKDAYS = [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }];

function run(state, change, now = NOW) {
  return r.apply(state, change, now);
}

function withHours() {
  return run(r.defaultState(), { type: 'schedule', schedule: WEEKDAYS }).state;
}

test('starts with no hours and every list on', () => {
  const s = r.defaultState();
  assert.deepEqual(s.settings.schedule, []);
  assert.equal(s.settings.enabled, true);
  for (const c of r.CATEGORIES) assert.equal(s.lists.categories[c.id], true);
  assert.equal(r.view(s, NOW).blockingNow, false);
});

test('adding hours happens right away', () => {
  const { state, outcome } = run(r.defaultState(), { type: 'schedule', schedule: WEEKDAYS });
  assert.equal(outcome, 'applied');
  assert.deepEqual(state.settings.schedule, WEEKDAYS);
  assert.equal(r.view(state, NOW).blockingNow, true);
});

test('fewer hours wait 24 hours, then apply', () => {
  const shorter = [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' }];
  const { state, outcome } = run(withHours(), { type: 'schedule', schedule: shorter });
  assert.equal(outcome, 'queued');
  assert.deepEqual(state.settings.schedule, WEEKDAYS);
  assert.equal(state.pending.length, 1);
  assert.equal(state.pending[0].applyAt, NOW + DAY);
  assert.deepEqual(r.settle(state, NOW + DAY - 1).settings.schedule, WEEKDAYS);
  assert.deepEqual(r.settle(state, NOW + DAY).settings.schedule, shorter);
});

test('a longer schedule replaces a waiting shorter one', () => {
  const shorter = [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' }];
  let { state } = run(withHours(), { type: 'schedule', schedule: shorter });
  const longer = [{ days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '18:00' }];
  ({ state } = run(state, { type: 'schedule', schedule: longer }));
  assert.equal(state.pending.length, 0);
  assert.deepEqual(r.settle(state, NOW + 2 * DAY).settings.schedule, longer);
});

test('turning the blocker off waits, turning it on does not', () => {
  let { state, outcome } = run(withHours(), { type: 'enabled', enabled: false });
  assert.equal(outcome, 'queued');
  assert.equal(state.settings.enabled, true);
  state = r.settle(state, NOW + DAY);
  assert.equal(state.settings.enabled, false);
  ({ state, outcome } = run(state, { type: 'enabled', enabled: true }, NOW + DAY));
  assert.equal(outcome, 'applied');
  assert.equal(state.settings.enabled, true);
});

test('a waiting change can be cancelled', () => {
  let { state } = run(withHours(), { type: 'category', id: 'youtube', on: false });
  const id = state.pending[0].id;
  ({ state } = run(state, { type: 'cancelPending', id }));
  assert.equal(state.pending.length, 0);
  assert.equal(r.settle(state, NOW + 2 * DAY).lists.categories.youtube, true);
});

test('switching a list back on cancels the waiting switch-off', () => {
  let { state } = run(withHours(), { type: 'category', id: 'social-media', on: false });
  ({ state } = run(state, { type: 'category', id: 'social-media', on: true }));
  assert.equal(state.pending.length, 0);
});

test('sites: adding is instant, removing waits', () => {
  let { state, outcome } = run(withHours(), { type: 'addSite', site: 'https://www.Example.com/watch/' });
  assert.equal(outcome, 'applied');
  assert.deepEqual(state.lists.sites, [{ site: 'example.com/watch', always: false }]);
  assert.throws(() => run(state, { type: 'addSite', site: 'example.com/watch' }), /already/);
  assert.throws(() => run(state, { type: 'addSite', site: 'not a site' }), /does not look like/);
  ({ state, outcome } = run(state, { type: 'setSiteAlways', site: 'example.com/watch', always: true }));
  assert.equal(outcome, 'applied');
  ({ state, outcome } = run(state, { type: 'setSiteAlways', site: 'example.com/watch', always: false }));
  assert.equal(outcome, 'queued');
  ({ state, outcome } = run(state, { type: 'removeSite', site: 'example.com/watch' }));
  assert.equal(outcome, 'queued');
  // Removing replaced the waiting "only during hours" change for the same site.
  assert.equal(state.pending.length, 1);
  assert.deepEqual(r.settle(state, NOW + DAY).lists.sites, []);
});

test('keywords need 3 letters, adding is instant, removing waits', () => {
  assert.throws(() => run(withHours(), { type: 'addKeyword', keyword: 'tv' }), /3 letters/);
  let { state } = run(withHours(), { type: 'addKeyword', keyword: '  Full  Episode ' });
  assert.deepEqual(state.lists.keywords, ['full episode']);
  const result = run(state, { type: 'removeKeyword', keyword: 'full episode' });
  assert.equal(result.outcome, 'queued');
});

test('strict mode needs hours and the blocker on', () => {
  assert.throws(() => run(r.defaultState(), { type: 'startStrict', until: NOW + DAY }), /blocking hours/);
  assert.throws(() => run(withHours(), { type: 'startStrict', until: NOW - 1 }), /future/);
  assert.throws(() => run(withHours(), { type: 'startStrict', until: NOW + 400 * DAY }), /365/);
});

test('strict mode locks loosening but allows tightening and extending', () => {
  let { state } = run(withHours(), { type: 'startStrict', until: NOW + 7 * DAY });
  assert.equal(r.isStrict(state.settings, NOW), true);
  assert.throws(() => run(state, { type: 'enabled', enabled: false }), /Strict mode is on/);
  assert.throws(() => run(state, { type: 'schedule', schedule: [] }), /Strict mode is on/);
  assert.throws(() => run(state, { type: 'category', id: 'youtube', on: false }), /Strict mode is on/);
  assert.throws(() => run(state, { type: 'startStrict', until: NOW + DAY }), /not shortened/);
  const more = [...WEEKDAYS, { days: [0, 6], start: '10:00', end: '14:00' }];
  assert.equal(run(state, { type: 'schedule', schedule: more }).outcome, 'applied');
  assert.equal(run(state, { type: 'addSite', site: 'example.org' }).outcome, 'applied');
  ({ state } = run(state, { type: 'startStrict', until: NOW + 10 * DAY }));
  assert.equal(state.settings.strictUntil, NOW + 10 * DAY);
});

test('starting strict mode cancels waiting loosening changes', () => {
  let { state } = run(withHours(), { type: 'category', id: 'youtube', on: false });
  ({ state } = run(state, { type: 'startStrict', until: NOW + 2 * DAY }));
  assert.equal(state.pending.length, 0);
  assert.equal(r.settle(state, NOW + 3 * DAY).lists.categories.youtube, true);
});

test('strict mode ends on time and keeps the settings', () => {
  let { state } = run(withHours(), { type: 'startStrict', until: NOW + 2 * DAY });
  state = r.settle(state, NOW + 2 * DAY);
  assert.equal(r.isStrict(state.settings, NOW + 2 * DAY), false);
  assert.equal(state.settings.strictUntil, null);
  assert.deepEqual(state.settings.schedule, WEEKDAYS);
});

test('early unlock takes 72 hours, can be cancelled, and strict mode can be re-armed', () => {
  let { state } = run(withHours(), { type: 'startStrict', until: NOW + 30 * DAY });
  ({ state } = run(state, { type: 'requestUnlock' }));
  assert.equal(state.settings.unlockAt, NOW + 72 * HOUR);
  assert.throws(() => run(state, { type: 'requestUnlock' }), /already/);
  assert.equal(r.isStrict(r.settle(state, NOW + 71 * HOUR).settings, NOW + 71 * HOUR), true);

  const cancelled = run(state, { type: 'cancelUnlock' }, NOW + HOUR).state;
  assert.equal(cancelled.settings.unlockAt, null);
  assert.equal(r.isStrict(r.settle(cancelled, NOW + 80 * HOUR).settings, NOW + 80 * HOUR), true);

  const later = NOW + 72 * HOUR;
  state = r.settle(state, later);
  assert.equal(r.isStrict(state.settings, later), false);
  assert.deepEqual(state.settings.schedule, WEEKDAYS);
  ({ state } = run(state, { type: 'rearm' }, later));
  assert.equal(state.settings.strictUntil, later + 30 * DAY);
});

test('early unlock is refused when strict mode ends within 72 hours anyway', () => {
  const { state } = run(withHours(), { type: 'startStrict', until: NOW + DAY });
  assert.throws(() => run(state, { type: 'requestUnlock' }), /within 72 hours/);
});

test('schedule coverage matches the extension, including past midnight', () => {
  const night = [{ days: [5], start: '22:00', end: '02:00' }];
  const fri = new Date(2026, 10, 20, 23, 0);
  const sat = new Date(2026, 10, 21, 1, 0);
  const satLate = new Date(2026, 10, 21, 3, 0);
  for (const d of [fri, sat, satLate]) {
    assert.equal(r.isBlockingActive(night, d), m.isBlockingActive(night, d));
  }
  assert.equal(r.isBlockingActive(night, sat), true);
  assert.equal(r.scheduleCovers([{ days: [5, 6], start: '00:00', end: '00:00' }], night), true);
  assert.equal(r.scheduleCovers([{ days: [5], start: '22:00', end: '23:59' }], night), false);
  assert.deepEqual([...r.coverage(night)], [...m.coverage(night)]);
});

test('the payload for the extension makes a config the extension can use', () => {
  let { state } = run(withHours(), { type: 'addSite', site: 'example.com' });
  ({ state } = run(state, { type: 'addSite', site: 'always.example', always: true }));
  ({ state } = run(state, { type: 'addKeyword', keyword: 'full episode' }));
  state.lists.categories.youtube = false;
  const payload = r.extensionPayload(state, NOW);
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/default-config.json'), 'utf8'));
  const cfg = m.applyAppLists(base, payload.lists);
  const during = m.effectiveConfig(cfg, true, true);
  const outside = m.effectiveConfig(cfg, true, false);
  assert.equal(m.siteBlockReason('https://example.com/', during), 'website: example.com');
  assert.equal(m.siteBlockReason('https://example.com/', outside), null);
  assert.equal(m.siteBlockReason('https://always.example/', outside), 'website: always.example');
  assert.equal(m.siteBlockReason('https://www.youtube.com/watch?v=1', during), null);
  assert.match(m.siteBlockReason('https://www.google.com/search?q=full+episode', during), /keyword/);
  assert.equal(m.siteBlockReason('https://www.netflix.com/', during), 'genre: video-streaming');
  assert.equal(m.siteBlockReason('https://pornhub.com/', outside), 'genre: adult');
});

test('the local server answers GET only, on the right host, and records the browser', async () => {
  const seen = [];
  const srv = createServer({ getPayload: () => ({ hello: 1 }), onSeen: b => seen.push(b), port: 0 });
  const port = await srv.listen();
  try {
    const ok = await fetch(`http://127.0.0.1:${port}/v1/state?browser=Brave&version=0.3.0`);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { hello: 1 });
    assert.equal(ok.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(seen, ['Brave']);
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/state`, { method: 'POST', body: '{}' })).status, 404);
    const rebound = await new Promise((resolve, reject) => {
      require('node:http').get({ host: '127.0.0.1', port, path: '/v1/state', headers: { Host: 'evil.example' } },
        res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(rebound, 421);
  } finally {
    await srv.close();
  }
});

test('the store saves and loads, and survives a broken file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslock-'));
  const store = createStore(path.join(dir, 'state.json'));
  assert.deepEqual(store.load(), r.defaultState());
  const s = withHours();
  store.save(s);
  assert.deepEqual(store.load().settings.schedule, WEEKDAYS);
  fs.writeFileSync(store.file, '{ not json');
  assert.deepEqual(store.load(), r.defaultState());
  assert.ok(fs.readdirSync(dir).some(f => f.includes('.broken-')));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const r = require('../app/core/rules.js');
const policy = require('../app/core/policy.js');
const { createServer, CLIENT_HEADER } = require('../app/core/server.js');
const { createEngine } = require('../app/core/engine.js');
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

test('schedule coverage, including past midnight', () => {
  const night = [{ days: [5], start: '22:00', end: '02:00' }];
  assert.equal(r.isBlockingActive(night, new Date(2026, 10, 20, 23, 0)), true);
  assert.equal(r.isBlockingActive(night, new Date(2026, 10, 21, 1, 0)), true);
  assert.equal(r.isBlockingActive(night, new Date(2026, 10, 21, 3, 0)), false);
  assert.equal(r.scheduleCovers([{ days: [5, 6], start: '00:00', end: '00:00' }], night), true);
  assert.equal(r.scheduleCovers([{ days: [5], start: '22:00', end: '23:59' }], night), false);
});

test('browser block list follows the hours, the lists and your sites', () => {
  let { state } = run(withHours(), { type: 'addSite', site: 'example.com' });
  ({ state } = run(state, { type: 'addSite', site: 'https://always.example/watch', always: true }));
  ({ state } = run(state, { type: 'category', id: 'sports-streaming', on: true }));
  const during = policy.blocklist(state, NOW); // Monday 10:00, inside the hours
  const evening = NOW + 10 * HOUR; // Monday 20:00, outside
  const outside = policy.blocklist(state, evening);
  for (const site of ['youtube.com', 'netflix.com', 'instagram.com', 'crunchyroll.com', 'example.com', 'amazon.com/gp/video']) {
    assert.ok(during.includes(site), site);
    assert.ok(!outside.includes(site), site);
  }
  for (const site of ['pornhub.com', 'fmovies.to', 'reddit.com/r/piracy', 'always.example/watch']) {
    assert.ok(during.includes(site), site);
    assert.ok(outside.includes(site), site);
  }
  // A list switched off (after its 24 hours) is no longer blocked.
  ({ state } = run(state, { type: 'category', id: 'youtube', on: false }));
  assert.ok(policy.blocklist(state, NOW).includes('youtube.com'));
  assert.ok(!policy.blocklist(state, NOW + DAY).includes('youtube.com'));
  // Blocker off: nothing in the list.
  ({ state } = run(state, { type: 'enabled', enabled: false }));
  assert.deepEqual(policy.blocklist(state, NOW + 2 * DAY), []);
  // No hours set yet: only the always-on lists.
  const fresh = policy.blocklist(r.defaultState(), NOW);
  assert.ok(fresh.includes('pornhub.com') && !fresh.includes('youtube.com'));
});

test('browser policies: fixed values for each browser and a valid .reg file', () => {
  const p = policy.desiredPolicies(withHours(), NOW);
  assert.deepEqual(p.map(b => b.name), ['Chrome', 'Brave', 'Edge']);
  const chrome = p[0].values;
  assert.equal(chrome.IncognitoModeAvailability, 1);
  assert.equal(chrome.DnsOverHttpsMode, 'off');
  assert.equal(chrome.ForceGoogleSafeSearch, 1);
  assert.equal(chrome.ForceYouTubeRestrict, 2);
  assert.equal(p[1].values.TorDisabled, 1);
  assert.equal(p[2].values.InPrivateModeAvailability, 1);
  assert.equal(p[2].values.IncognitoModeAvailability, undefined);
  const reg = policy.toRegFile(p);
  assert.ok(reg.startsWith('Windows Registry Editor Version 5.00\r\n'));
  assert.ok(reg.includes('[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome]\r\n"BrowserGuestModeEnabled"=dword:00000000'));
  assert.ok(reg.includes('[-HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Edge\\URLBlocklist]'));
  assert.ok(reg.includes('"DnsOverHttpsMode"="off"'));
  assert.match(reg, /"1"="[a-z0-9./-]+"/);
  assert.ok(!/[^\r]\n/.test(reg), 'Windows line endings only');
});

test('the local server serves the app window and refuses web pages', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslock-'));
  const engine = createEngine(path.join(dir, 'state.json'), { now: () => NOW });
  const srv = createServer({ engine, port: 0 });
  const port = await srv.listen();
  const base = `http://127.0.0.1:${port}`;
  const app = { [CLIENT_HEADER]: '1' };
  try {
    assert.equal((await fetch(`${base}/v1/state`)).status, 404);

    // The app window can read the view and make changes.
    const view = await fetch(`${base}/v1/view`, { headers: app });
    assert.equal(view.status, 200);
    assert.equal(view.headers.get('access-control-allow-origin'), null);
    assert.ok((await view.json()).blockedNow.includes('pornhub.com'));
    const post = body => fetch(`${base}/v1/change`, {
      method: 'POST', headers: { ...app, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json());
    assert.deepEqual((await post({ type: 'schedule', schedule: WEEKDAYS })).ok, true);
    assert.equal((await post({ type: 'enabled', enabled: false })).outcome, 'queued');
    assert.match((await post({ type: 'nonsense' })).error, /Unknown/);
    // Saved to disk, and a new engine reading the same file sees it.
    assert.deepEqual(createEngine(engine.file).view().settings.schedule, WEEKDAYS);

    // Requests without the app header, or from a web page (Origin set), are refused.
    assert.equal((await fetch(`${base}/v1/view`)).status, 403);
    assert.equal((await fetch(`${base}/v1/change`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 403);
    assert.equal((await fetch(`${base}/v1/change`, {
      method: 'POST', headers: { ...app, 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}'
    })).status, 403);
    const rebound = await new Promise((resolve, reject) => {
      require('node:http').get({ host: '127.0.0.1', port, path: '/v1/view', headers: { Host: 'evil.example', [CLIENT_HEADER]: '1' } },
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

test('hard blocks: adult, animated adult, pirate streaming, FMHY and piracy subreddits, at any hour', () => {
  const outside = policy.blocklist(r.defaultState(), NOW + 10 * HOUR);
  for (const site of ['pornhub.com', 'xvideos.com', 'hanime.tv', 'nhentai.net', 'movy.sx', 'hianime.to', 'fmhy.net', 'fmhy.pages.dev',
    'reddit.com/r/FREEMEDIAHECKYEAH', 'reddit.com/r/Piracy', 'reddit.com/r/piracy']) {
    assert.ok(outside.includes(site), site);
  }
  // Only the piracy subreddits, not all of Reddit, outside the hours.
  assert.ok(!outside.includes('reddit.com'));
  // Ordinary sites that happen to be listed on FMHY are not hard-blocked.
  for (const site of ['justwatch.com', 'loc.gov', 'github.com', 'dailymotion.com']) assert.ok(!outside.includes(site), site);
});

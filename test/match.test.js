const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const m = require('../extension/lib/match.js');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/default-config.json'), 'utf8'));

test('website blocking covers subdomains', () => {
  assert.equal(m.siteBlockReason('https://www.netflix.com/browse', config), 'website: netflix.com');
  assert.equal(m.siteBlockReason('https://help.netflix.com/', config), 'website: netflix.com');
  assert.equal(m.siteBlockReason('https://notnetflix.com/', config), null);
});

test('URL blocking matches a path, not the whole site', () => {
  assert.equal(m.siteBlockReason('https://www.amazon.com/gp/video/storefront', config), 'url: amazon.com/gp/video');
  assert.equal(m.siteBlockReason('https://www.amazon.com/dp/B000123', config), null);
});

test('URL keywords catch mirror domains and search queries', () => {
  assert.match(m.siteBlockReason('https://fmovies.ws/home', config), /keyword: fmovies/);
  assert.match(m.siteBlockReason('https://www.google.com/search?q=watch+free+dune', config), /keyword: watch free/);
  assert.match(m.siteBlockReason('https://search.brave.com/search?q=watch%20free%20dune', config), /keyword: watch free/);
  assert.equal(m.siteBlockReason('https://www.google.com/search?q=dune+book+review', config), null);
});

test('genre blocking uses the blocked genre lists only', () => {
  assert.equal(m.siteBlockReason('https://www.peacocktv.com/', config), 'genre: video-streaming');
  const relaxed = { ...config, genres: { ...config.genres, blocked: [] } };
  assert.equal(m.siteBlockReason('https://www.peacocktv.com/', relaxed), null);
});

test('YouTube modes', () => {
  assert.equal(config.youtube.mode, 'full');
  assert.equal(m.siteBlockReason('https://www.youtube.com/watch?v=abc', config), 'website: youtube.com');
  const genres = { ...config, youtube: { ...config.youtube, mode: 'genres' } };
  assert.equal(m.siteBlockReason('https://www.youtube.com/shorts/abc', genres), 'url: youtube.com/shorts');
  assert.equal(m.siteBlockReason('https://www.youtube.com/watch?v=abc', genres), null);
  assert.equal(m.youtubeGenreBlocked('Gaming', genres), 'genre: YouTube Gaming');
  assert.equal(m.youtubeGenreBlocked('Education', genres), null);
  assert.equal(m.youtubeGenreBlocked('Film & Animation', genres), 'genre: YouTube Film & Animation');
});

test('extracts YouTube genre from watch page HTML', () => {
  assert.equal(m.extractYoutubeGenre('<meta itemprop="genre" content="Film &amp; Animation">'), 'Film & Animation');
  assert.equal(m.extractYoutubeGenre('..."category":"Education","x":1'), 'Education');
  assert.equal(m.extractYoutubeGenre('<html></html>'), null);
});

test('keyword matching is case- and spacing-insensitive', () => {
  assert.equal(m.findKeyword('Watch   FREE Movies', ['watch free']), 'watch free');
  assert.equal(m.findKeyword('A normal page', ['watch free']), null);
});

test('schedule windows, including overnight ones', () => {
  assert.equal(m.isBlockingActive(null, new Date(2026, 9, 26, 3, 0)), true);
  assert.equal(m.isBlockingActive([], new Date(2026, 9, 26, 3, 0)), false); // no hours set yet
  const allDay = [{ days: [1], start: '00:00', end: '00:00' }];
  assert.equal(m.isBlockingActive(allDay, new Date(2026, 9, 26, 23, 59)), true);
  assert.equal(m.isBlockingActive(allDay, new Date(2026, 9, 27, 0, 1)), false);
  const weekdays = [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }];
  assert.equal(m.isBlockingActive(weekdays, new Date(2026, 9, 26, 10, 0)), true); // Monday
  assert.equal(m.isBlockingActive(weekdays, new Date(2026, 9, 26, 18, 0)), false);
  assert.equal(m.isBlockingActive(weekdays, new Date(2026, 9, 25, 10, 0)), false); // Sunday
  const nights = [{ days: [1], start: '22:00', end: '02:00' }];
  assert.equal(m.isBlockingActive(nights, new Date(2026, 9, 26, 23, 0)), true); // Monday night
  assert.equal(m.isBlockingActive(nights, new Date(2026, 9, 27, 1, 0)), true); // early Tuesday
  assert.equal(m.isBlockingActive(nights, new Date(2026, 9, 27, 3, 0)), false);
});

test('builds valid network rules', () => {
  const rules = m.buildDnrRules(config, '/blocked.html');
  const ids = rules.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(rules.every(r => r.action.type === 'redirect'));
  assert.ok(rules.filter(r => !r.action.redirect.transform).every(r => r.action.redirect.extensionPath.startsWith('/blocked.html')));
  assert.ok(rules.some(r => (r.condition.requestDomains || []).includes('netflix.com')));
  assert.ok(rules.some(r => r.condition.urlFilter === '||youtube.com/shorts'));
  const full = m.buildDnrRules({ youtube: { mode: 'full' } });
  assert.deepEqual(full[0].condition.requestDomains, ['youtube.com', 'youtu.be']);
});

test('manifest references files that exist', () => {
  const dir = path.join(__dirname, '../extension');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const files = [manifest.background.service_worker, manifest.storage.managed_schema,
    manifest.options_ui.page, 'options.js',
    ...manifest.content_scripts.flatMap(c => c.js), ...manifest.web_accessible_resources.flatMap(w => w.resources)];
  for (const file of files) assert.ok(fs.existsSync(path.join(dir, file)), file + ' is missing');
});

const HOUR = 3600 * 1000;
const NOW = Date.UTC(2026, 10, 15, 12, 0);
const hours = [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '22:00' }];

test('settings start with no hours and the blocker on', () => {
  assert.deepEqual(m.defaultSettings(), { enabled: true, schedule: [], strictUntil: null, unlockAt: null, lastStrictLength: null });
});

test('hours can be changed freely outside strict mode', () => {
  const s = m.applySettingsChange(null, { schedule: hours }, NOW);
  assert.deepEqual(s.schedule, hours);
  const off = m.applySettingsChange(s, { enabled: false }, NOW);
  assert.equal(off.enabled, false);
  assert.deepEqual(m.applySettingsChange(s, { schedule: [] }, NOW).schedule, []);
});

test('bad hours are rejected', () => {
  assert.throws(() => m.applySettingsChange(null, { schedule: [{ days: [], start: '09:00', end: '10:00' }] }, NOW), /at least one day/);
  assert.throws(() => m.applySettingsChange(null, { schedule: [{ days: [1], start: '9', end: '10:00' }] }, NOW), /Times/);
});

test('strict mode needs hours, the blocker on and a future end', () => {
  assert.throws(() => m.applySettingsChange(null, { strictUntil: NOW + HOUR }, NOW), /blocking hours/);
  const s = m.applySettingsChange(null, { schedule: hours }, NOW);
  assert.throws(() => m.applySettingsChange(s, { strictUntil: NOW - HOUR }, NOW), /future/);
  const off = m.applySettingsChange(s, { enabled: false }, NOW);
  assert.throws(() => m.applySettingsChange(off, { strictUntil: NOW + HOUR }, NOW), /Turn the blocker on/);
});

test('strict mode locks hours and the on/off switch until it ends', () => {
  let s = m.applySettingsChange(null, { schedule: hours }, NOW);
  s = m.applySettingsChange(s, { strictUntil: NOW + 24 * HOUR }, NOW);
  assert.equal(m.isStrict(s, NOW), true);
  assert.throws(() => m.applySettingsChange(s, { schedule: [] }, NOW + HOUR), /locked/);
  assert.throws(() => m.applySettingsChange(s, { enabled: false }, NOW + HOUR), /cannot be turned off/);
  assert.throws(() => m.applySettingsChange(s, { strictUntil: NOW + 2 * HOUR }, NOW + HOUR), /not shortened/);
  // Saving the same hours is fine, and strict mode can be extended.
  assert.deepEqual(m.applySettingsChange(s, { schedule: hours }, NOW + HOUR).schedule, hours);
  assert.equal(m.applySettingsChange(s, { strictUntil: NOW + 48 * HOUR }, NOW + HOUR).strictUntil, NOW + 48 * HOUR);
  // Once it ends, everything unlocks.
  const after = NOW + 25 * HOUR;
  assert.equal(m.isStrict(s, after), false);
  const free = m.applySettingsChange(s, { enabled: false }, after);
  assert.equal(free.enabled, false);
  assert.equal(free.strictUntil, null);
});

test('early unlock ends strict mode after 72 hours and keeps the settings', () => {
  let s = m.applySettingsChange(null, { schedule: hours }, NOW);
  s = m.applySettingsChange(s, { strictUntil: NOW + 30 * 24 * HOUR }, NOW);
  assert.throws(() => m.applySettingsChange(m.defaultSettings(), { requestUnlock: true }, NOW), /not on/);
  s = m.applySettingsChange(s, { requestUnlock: true }, NOW + HOUR);
  assert.equal(s.unlockAt, NOW + 73 * HOUR);
  // A second request does not restart the clock.
  assert.equal(m.applySettingsChange(s, { requestUnlock: true }, NOW + 2 * HOUR).unlockAt, NOW + 73 * HOUR);
  assert.equal(m.isStrict(s, NOW + 72 * HOUR), true);
  assert.equal(m.isStrict(s, NOW + 73 * HOUR), false);
  const cancelled = m.applySettingsChange(s, { cancelUnlock: true }, NOW + 2 * HOUR);
  assert.equal(cancelled.unlockAt, null);
  assert.equal(m.isStrict(cancelled, NOW + 100 * HOUR), true);
  // After the unlock, hours are kept and strict mode re-arms for the same length.
  const after = NOW + 74 * HOUR;
  const free = m.applySettingsChange(s, {}, after);
  assert.deepEqual(free.schedule, hours);
  assert.equal(free.strictUntil, null);
  const rearmed = m.applySettingsChange(free, { rearm: true }, after);
  assert.equal(rearmed.strictUntil, after + 30 * 24 * HOUR);
  assert.equal(m.isStrict(rearmed, after + HOUR), true);
});

test('adult and pirate lists stay on outside the blocking hours', () => {
  const outside = m.effectiveConfig(config, true, false);
  assert.equal(m.siteBlockReason('https://www.pornhub.com/', outside), 'genre: adult');
  assert.match(m.siteBlockReason('https://fmovies.ws/', outside), /keyword: fmovies/);
  assert.equal(m.siteBlockReason('https://www.youtube.com/watch?v=abc', outside), null);
  assert.equal(m.siteBlockReason('https://www.instagram.com/', outside), null);
  const inside = m.effectiveConfig(config, true, true);
  assert.equal(m.siteBlockReason('https://www.youtube.com/watch?v=abc', inside), 'website: youtube.com');
  assert.equal(m.siteBlockReason('https://www.instagram.com/', inside), 'genre: social-media');
  assert.equal(m.siteBlockReason('https://www.pornhub.com/', inside), 'genre: adult');
  assert.equal(m.effectiveConfig(config, false, true), null);
});

test('SafeSearch rule only touches Google searches', () => {
  const rules = m.buildDnrRules(m.effectiveConfig(config, true, false));
  const rule = rules.find(r => r.action.redirect.transform);
  const re = new RegExp(rule.condition.regexFilter);
  assert.ok(re.test('https://www.google.com/search?q=x'));
  assert.ok(!re.test('https://example.com/?u=https://www.google.com/search?q=x'));
  assert.deepEqual(rule.action.redirect.transform.queryTransform.addOrReplaceParams, [{ key: 'safe', value: 'active' }]);
});

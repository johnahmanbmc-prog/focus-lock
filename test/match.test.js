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
  assert.equal(m.siteBlockReason('https://www.youtube.com/shorts/abc', config), 'url: youtube.com/shorts');
  assert.equal(m.siteBlockReason('https://www.youtube.com/watch?v=abc', config), null);
  const full = { ...config, youtube: { ...config.youtube, mode: 'full' } };
  assert.equal(m.siteBlockReason('https://www.youtube.com/watch?v=abc', full), 'website: youtube.com');
  assert.equal(m.youtubeGenreBlocked('Gaming', config), 'genre: YouTube Gaming');
  assert.equal(m.youtubeGenreBlocked('Education', config), null);
  assert.equal(m.youtubeGenreBlocked('Film & Animation', config), 'genre: YouTube Film & Animation');
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
  assert.ok(rules.every(r => r.action.type === 'redirect' && r.action.redirect.extensionPath.startsWith('/blocked.html')));
  assert.ok(rules.some(r => (r.condition.requestDomains || []).includes('netflix.com')));
  assert.ok(rules.some(r => r.condition.urlFilter === '||youtube.com/shorts'));
  const full = m.buildDnrRules({ youtube: { mode: 'full' } });
  assert.deepEqual(full[0].condition.requestDomains, ['youtube.com', 'youtu.be']);
});

test('manifest references files that exist', () => {
  const dir = path.join(__dirname, '../extension');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const files = [manifest.background.service_worker, manifest.storage.managed_schema,
    ...manifest.content_scripts.flatMap(c => c.js), ...manifest.web_accessible_resources.flatMap(w => w.resources)];
  for (const file of files) assert.ok(fs.existsSync(path.join(dir, file)), file + ' is missing');
});

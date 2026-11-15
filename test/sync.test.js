const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../extension/lib/match.js');

const HOUR = 3600 * 1000;
const NOW = new Date(2026, 10, 16, 10, 0).getTime();
const HOURS = [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }];

function state(settings, lists) {
  return {
    settings: { enabled: true, schedule: HOURS, strictUntil: null, unlockAt: null, ...settings },
    lists: { categories: { youtube: true, 'social-media': true }, sites: [{ site: 'a.com', always: true }], keywords: ['abc'], ...lists }
  };
}

test('outside strict mode, any settings from the app are taken', () => {
  assert.equal(m.syncAllowed(null, state({ enabled: false }), NOW).ok, true);
  assert.equal(m.syncAllowed(state(), state({ enabled: false, schedule: [] }), NOW).ok, true);
  assert.equal(m.syncAllowed(state(), null, NOW).ok, false);
});

test('during strict mode, only settings at least as strict are taken', () => {
  const strict = state({ strictUntil: NOW + 48 * HOUR });
  assert.equal(m.syncAllowed(strict, state({ strictUntil: NOW + 48 * HOUR }), NOW).ok, true);
  assert.equal(m.syncAllowed(strict, state({ strictUntil: NOW + 96 * HOUR }), NOW).ok, true);
  assert.equal(m.syncAllowed(strict, state({ strictUntil: NOW + 24 * HOUR }), NOW).ok, false);
  assert.equal(m.syncAllowed(strict, state({ strictUntil: null }), NOW).ok, false);
  assert.equal(m.syncAllowed(strict, state({ strictUntil: NOW + 48 * HOUR, enabled: false }), NOW).ok, false);
  assert.equal(m.syncAllowed(strict, state({ strictUntil: NOW + 48 * HOUR, schedule: [] }), NOW).ok, false);
  assert.equal(m.syncAllowed(strict, state({ strictUntil: NOW + 48 * HOUR }, { categories: { youtube: false } }), NOW).ok, false);
  assert.equal(m.syncAllowed(strict, state({ strictUntil: NOW + 48 * HOUR }, { sites: [] }), NOW).ok, false);
  assert.equal(m.syncAllowed(strict, state({ strictUntil: NOW + 48 * HOUR }, { sites: [{ site: 'a.com', always: false }] }), NOW).ok, false);
  assert.equal(m.syncAllowed(strict, state({ strictUntil: NOW + 48 * HOUR }, { keywords: [] }), NOW).ok, false);
});

test('during strict mode, an early unlock must carry the full 72 hour wait', () => {
  const strict = state({ strictUntil: NOW + 200 * HOUR });
  assert.equal(m.syncAllowed(strict, state({ strictUntil: NOW + 200 * HOUR, unlockAt: NOW + 72 * HOUR }), NOW).ok, true);
  assert.equal(m.syncAllowed(strict, state({ strictUntil: NOW + 200 * HOUR, unlockAt: NOW + HOUR }), NOW).ok, false);
  const requested = state({ strictUntil: NOW + 200 * HOUR, unlockAt: NOW + 10 * HOUR });
  // Keeping an unlock that was already counting down is fine, and so is cancelling it.
  assert.equal(m.syncAllowed(requested, requested, NOW).ok, true);
  assert.equal(m.syncAllowed(requested, state({ strictUntil: NOW + 200 * HOUR }), NOW).ok, true);
  // Once the unlock is due, strict mode is over and the app's settings are taken.
  assert.equal(m.syncAllowed(requested, state({ strictUntil: null }), NOW + 10 * HOUR).ok, true);
});

test('app lists switch genres and YouTube on and off', () => {
  const base = { genres: { blocked: ['social-media', 'adult'], sites: {} }, youtube: { mode: 'full', blockShorts: true } };
  const cfg = m.applyAppLists(base, { categories: { 'social-media': false, youtube: false, 'video-streaming': true }, sites: [], keywords: [] });
  assert.deepEqual(cfg.genres.blocked, ['adult', 'video-streaming']);
  assert.equal(cfg.youtube.mode, 'off');
  assert.deepEqual(base.genres.blocked, ['social-media', 'adult']);
});

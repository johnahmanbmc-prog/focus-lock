// Owns the saved state: applies changes through the rules, settles due
// changes on a timer, and saves. Run by the Windows service (service.js)
// when installed, or inside the app window process during development.
'use strict';

const rules = require('./rules');
const { createStore } = require('./store');

function createEngine(file, { now = () => Date.now(), onChange = () => {} } = {}) {
  const store = createStore(file);
  let state = store.load();

  function settle() {
    const before = JSON.stringify(state);
    state = rules.settle(state, now());
    if (JSON.stringify(state) !== before) {
      store.save(state);
      onChange();
    }
  }

  return {
    file,
    settle,
    payload: () => rules.extensionPayload(state, now()),
    view: () => rules.view(state, now()),
    change(change) {
      try {
        const result = rules.apply(state, change, now());
        state = result.state;
        store.save(state);
        onChange();
        return { ok: true, outcome: result.outcome, message: result.message };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    seen(browser, info) {
      const first = !state.browsers[browser];
      state.browsers[browser] = { lastSeen: now(), version: info.version };
      // Save the first contact right away; later ones only matter in memory.
      if (first) store.save(state);
    }
  };
}

module.exports = { createEngine };

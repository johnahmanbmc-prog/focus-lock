// Owns the saved state: applies changes through the rules, settles due
// changes on a timer, and saves. Run by the Windows service (service.js)
// when installed, or inside the app window process during development.
//
// policy: optional { apply(state, now), status() } that writes the browser
// policies. The service passes one; development mode doesn't.
'use strict';

const rules = require('./rules');
const { createStore } = require('./store');
const { blocklist } = require('./policy');

function createEngine(file, { now = () => Date.now(), policy = null } = {}) {
  const store = createStore(file);
  let state = store.load();

  // Write the browser policies for this moment. Cheap when nothing changed.
  function enforce() {
    if (policy) return policy.apply(state, now());
    return Promise.resolve(null);
  }

  // Called on a timer: applies due changes, ends strict mode on time, and
  // switches the block list when the blocking hours start or end.
  function tick() {
    const before = JSON.stringify(state);
    state = rules.settle(state, now());
    if (JSON.stringify(state) !== before) store.save(state);
    return enforce();
  }

  return {
    file,
    tick,
    view() {
      const v = rules.view(state, now());
      v.blockedNow = blocklist(state, now());
      v.policy = policy ? policy.status() : { ok: null, development: true };
      return v;
    },
    change(change) {
      try {
        const result = rules.apply(state, change, now());
        state = result.state;
        store.save(state);
        enforce();
        return { ok: true, outcome: result.outcome, message: result.message };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
  };
}

module.exports = { createEngine };

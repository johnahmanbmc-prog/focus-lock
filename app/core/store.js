// Saves the app state as JSON. Writes go to a temporary file first and are
// then renamed over the real one, so a crash never leaves half a file.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const rules = require('./rules');

function createStore(file) {
  function load() {
    try {
      return rules.normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Keep the unreadable file for inspection instead of overwriting it.
        try { fs.copyFileSync(file, file + '.broken-' + Date.now()); } catch (e) { /* ignore */ }
      }
      return rules.defaultState();
    }
  }

  function save(state) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  }

  return { load, save, file };
}

module.exports = { createStore };

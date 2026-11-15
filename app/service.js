// The Focus Lock Windows service. Runs as SYSTEM (installed by the setup
// program through WinSW). It keeps the settings in C:\ProgramData\FocusLock,
// where standard users can read but not change or delete files, writes the
// Chrome, Brave and Edge block-list policies, and serves the settings on
// 127.0.0.1:47821 to the app window.
//
// It is started as: "Focus Lock.exe" service.js, with ELECTRON_RUN_AS_NODE=1.
'use strict';

const path = require('node:path');
const { createEngine } = require('./core/engine');
const { createServer } = require('./core/server');
const { createPolicyWriter } = require('./core/winpolicy');

const dir = process.env.FOCUSLOCK_STATE_DIR || path.join(process.env.ProgramData || 'C:\\ProgramData', 'FocusLock');
// FOCUSLOCK_NO_POLICY=1 runs without touching the registry (for testing).
const policy = process.env.FOCUSLOCK_NO_POLICY ? null : createPolicyWriter({ dir });
const engine = createEngine(path.join(dir, 'state.json'), { policy });
const server = createServer({ engine });

server.listen().then(
  port => console.log(new Date().toISOString() + ' Focus Lock service listening on 127.0.0.1:' + port + ', state in ' + dir),
  error => {
    console.error('Focus Lock service could not start: ' + error.message);
    process.exit(1);
  }
);

// Every 20 seconds: apply due changes, end strict mode on time, and switch
// the block list when the blocking hours start or end.
setInterval(() => engine.tick(), 20 * 1000);
engine.tick();

// The Focus Lock Windows service. Runs as SYSTEM (installed by the setup
// program through WinSW), keeps the settings in C:\ProgramData\FocusLock,
// where standard users can read but not change or delete files, and serves
// them on 127.0.0.1:47821 to the app window and the browser extension.
//
// It is started as: "Focus Lock.exe" service.js, with ELECTRON_RUN_AS_NODE=1.
'use strict';

const path = require('node:path');
const { createEngine } = require('./core/engine');
const { createServer } = require('./core/server');

const dir = process.env.FOCUSLOCK_STATE_DIR || path.join(process.env.ProgramData || 'C:\\ProgramData', 'FocusLock');
const engine = createEngine(path.join(dir, 'state.json'));
const server = createServer({ engine });

server.listen().then(
  port => console.log(new Date().toISOString() + ' Focus Lock service listening on 127.0.0.1:' + port + ', state in ' + dir),
  error => {
    console.error('Focus Lock service could not start: ' + error.message);
    process.exit(1);
  }
);

// Apply due changes and the end of strict mode every 20 seconds.
setInterval(() => engine.settle(), 20 * 1000);
engine.settle();

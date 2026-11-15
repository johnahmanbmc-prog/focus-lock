// A small HTTP server on 127.0.0.1 that the Chrome and Brave extension
// polls for the current settings. It only answers GET requests and never
// accepts changes, so nothing outside the app window can change a setting.
'use strict';

const http = require('node:http');

const PORT = 47821;
const KNOWN_BROWSERS = ['Chrome', 'Brave'];

// getPayload() returns what to send; onSeen(browser) records which browser
// asked, so the app can show that Chrome and Brave are connected.
function createServer({ getPayload, onSeen, port = PORT, host = '127.0.0.1' }) {
  const server = http.createServer((req, res) => {
    // Refuse requests that arrive under another host name (DNS rebinding).
    const actual = server.address().port;
    const hostHeader = String(req.headers.host || '').toLowerCase();
    if (hostHeader !== '127.0.0.1:' + actual && hostHeader !== 'localhost:' + actual) {
      res.writeHead(421).end();
      return;
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/v1/state') {
      res.writeHead(404).end();
      return;
    }
    const browser = url.searchParams.get('browser');
    if (KNOWN_BROWSERS.includes(browser)) {
      onSeen(browser, { version: String(url.searchParams.get('version') || '').slice(0, 20) });
    }
    const body = JSON.stringify(getPayload());
    // No CORS headers: web pages cannot read this, only the extension can.
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(body);
  });

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address().port));
      });
    },
    close() {
      return new Promise(resolve => server.close(() => resolve()));
    }
  };
}

module.exports = { createServer, PORT };

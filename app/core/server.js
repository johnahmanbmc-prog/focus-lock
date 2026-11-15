// A small HTTP server on 127.0.0.1 that the app window uses to read the
// settings and ask for changes. Every change goes through the rules engine,
// so nothing that talks to this server can do more than the app window can.
'use strict';

const http = require('node:http');

const PORT = 47821;
const MAX_BODY = 64 * 1024;

// Header the app sends with every change. Web pages can't add custom headers
// to a request to another origin without a CORS preflight, which this server
// never approves, so a web page can't send changes.
const CLIENT_HEADER = 'x-focus-lock-client';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// engine: { view(), change(change) }
function createServer({ engine, port = PORT, host = '127.0.0.1' }) {
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    // Refuse requests that arrive under another host name (DNS rebinding).
    const actual = server.address().port;
    const hostHeader = String(req.headers.host || '').toLowerCase();
    if (hostHeader !== '127.0.0.1:' + actual && hostHeader !== 'localhost:' + actual) return send(421);

    const url = new URL(req.url, 'http://127.0.0.1');

    const fromApp = req.headers[CLIENT_HEADER] === '1' && !req.headers.origin;
    if (req.method === 'GET' && url.pathname === '/v1/view') {
      if (!fromApp) return send(403);
      return send(200, engine.view());
    }
    if (req.method === 'POST' && url.pathname === '/v1/change') {
      if (!fromApp || !/^application\/json/.test(String(req.headers['content-type'] || ''))) return send(403);
      let change;
      try {
        change = JSON.parse(await readBody(req));
      } catch (e) {
        return send(400, { ok: false, error: 'Bad request.' });
      }
      return send(200, engine.change(change));
    }
    return send(404);
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

module.exports = { createServer, PORT, CLIENT_HEADER };

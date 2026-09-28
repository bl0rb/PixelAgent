// @ts-check
// `npm run demo`: static file server for the repo (mimics the target app's
// security headers) plus the PixelAgent proxy in front of it.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProxy } from '../src/proxy/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const STATIC_PORT = 4401;
const PROXY_PORT = 4400;
const DEMO_PATH = '/examples/demo.html';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const staticServer = http.createServer((req, res) => {
  res.setHeader('content-security-policy', "script-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
  res.setHeader('x-frame-options', 'DENY');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  const parsedUrl = new URL(/** @type {string} */ (req.url), 'http://internal');
  let pathname;
  try {
    pathname = decodeURIComponent(parsedUrl.pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  const resolved = path.resolve(REPO_ROOT, '.' + pathname);
  if (resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': contentType, 'content-length': String(stat.size) });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(resolved).pipe(res);
  });
});

staticServer.listen(STATIC_PORT, () => {
  const targetUrl = `http://localhost:${STATIC_PORT}${DEMO_PATH}`;
  const out = path.join(process.cwd(), 'ui-changes.md');
  const proxy = createProxy({ target: targetUrl, out });

  proxy.listen(PROXY_PORT, () => {
    console.log(`Static server running at http://localhost:${STATIC_PORT}`);
    console.log(`PixelAgent proxy running at http://localhost:${PROXY_PORT}${DEMO_PATH} (target: ${targetUrl})`);
    console.log(`Standalone without proxy: ${targetUrl}?standalone`);
    console.log(`Changes will be exported to: ${out}`);
  });
});

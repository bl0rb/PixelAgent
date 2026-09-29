// @ts-check
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createProxy } from '../src/proxy/server.js';
import { injectScript, injectHeadScript } from '../src/proxy/inject.js';
import { stripSecurityHeaders, rewriteLocation, rewriteSetCookie, rewriteFwdLocation } from '../src/proxy/headers.js';

// ---------------------------------------------------------------------------
// Unit tests for the pure helpers
// ---------------------------------------------------------------------------

test('injectScript inserts before </body>', () => {
  const html = '<html><head></head><body><p>hi</p></body></html>';
  const result = injectScript(html, '<script>X</script>');
  assert.equal(result, '<html><head></head><body><p>hi</p><script>X</script></body></html>');
});

test('injectScript falls back to before </head> when no </body>', () => {
  const html = '<html><head><title>t</title></head></html>';
  const result = injectScript(html, '<script>X</script>');
  assert.equal(result, '<html><head><title>t</title><script>X</script></head></html>');
});

test('injectScript appends when neither </body> nor </head> exist', () => {
  const html = '<p>fragment</p>';
  const result = injectScript(html, '<script>X</script>');
  assert.equal(result, '<p>fragment</p><script>X</script>');
});

test('stripSecurityHeaders removes CSP/CSP-Report-Only/X-Frame-Options', () => {
  const headers = {
    'content-security-policy': "default-src 'self'",
    'content-security-policy-report-only': "default-src 'self'",
    'x-frame-options': 'DENY',
    'content-type': 'text/html',
  };
  stripSecurityHeaders(headers);
  assert.equal(headers['content-security-policy'], undefined);
  assert.equal(headers['content-security-policy-report-only'], undefined);
  assert.equal(headers['x-frame-options'], undefined);
  assert.equal(headers['content-type'], 'text/html');
});

test('rewriteLocation rewrites an absolute target-origin URL to the proxy origin', () => {
  const result = rewriteLocation('http://localhost:9999/foo?x=1#bar', 'http://localhost:9999', 'http://localhost:4400');
  assert.equal(result, 'http://localhost:4400/foo?x=1#bar');
});

test('rewriteLocation leaves relative and foreign URLs untouched', () => {
  assert.equal(
    rewriteLocation('/relative/path', 'http://localhost:9999', 'http://localhost:4400'),
    '/relative/path',
  );
  assert.equal(
    rewriteLocation('https://example.com/x', 'http://localhost:9999', 'http://localhost:4400'),
    'https://example.com/x',
  );
});

test('rewriteSetCookie drops the Domain attribute', () => {
  const result = rewriteSetCookie('id=1; Domain=example.com; Path=/', { targetIsHttps: false, proxyIsHttps: false });
  assert.doesNotMatch(result, /domain=/i);
  assert.match(result, /id=1/);
  assert.match(result, /Path=\//);
});

test('rewriteSetCookie drops Secure and downgrades SameSite=None to Lax for an https target behind an http proxy', () => {
  const result = rewriteSetCookie('id=1; Domain=example.com; Secure; SameSite=None; Path=/', {
    targetIsHttps: true,
    proxyIsHttps: false,
  });
  assert.doesNotMatch(result, /domain=/i);
  assert.doesNotMatch(result, /secure/i);
  assert.match(result, /SameSite=Lax/);
});

test('rewriteSetCookie keeps Secure/SameSite when the proxy is also https', () => {
  const result = rewriteSetCookie('id=1; Secure; SameSite=None', { targetIsHttps: true, proxyIsHttps: true });
  assert.match(result, /Secure/);
  assert.match(result, /SameSite=None/);
});

test('rewriteSetCookie with pathPrefix prefixes an existing Path attribute', () => {
  const result = rewriteSetCookie('sid=1; Domain=example.com; Path=/api', {
    targetIsHttps: false,
    proxyIsHttps: false,
    pathPrefix: '/__uce/fwd/http/localhost:8000',
  });
  assert.doesNotMatch(result, /domain=/i);
  assert.match(result, /Path=\/__uce\/fwd\/http\/localhost:8000\/api/);
});

test('rewriteSetCookie with pathPrefix sets Path to the prefix root when missing or "/"', () => {
  const missing = rewriteSetCookie('sid=1', { targetIsHttps: false, proxyIsHttps: false, pathPrefix: '/__uce/fwd/http/localhost:8000' });
  assert.match(missing, /Path=\/__uce\/fwd\/http\/localhost:8000$/);

  const root = rewriteSetCookie('sid=1; Path=/', { targetIsHttps: false, proxyIsHttps: false, pathPrefix: '/__uce/fwd/http/localhost:8000' });
  assert.match(root, /Path=\/__uce\/fwd\/http\/localhost:8000$/);
});

test('injectHeadScript inserts right after the opening <head> tag', () => {
  const html = '<html><head><title>t</title></head><body></body></html>';
  const result = injectHeadScript(html, '<script src="x.js"></script>');
  assert.equal(result, '<html><head><script src="x.js"></script><title>t</title></head><body></body></html>');
});

test('injectHeadScript falls back to right before the first <script> when there is no <head>', () => {
  const html = '<html><body><script>later()</script></body></html>';
  const result = injectHeadScript(html, '<script src="x.js"></script>');
  assert.equal(result, '<html><body><script src="x.js"></script><script>later()</script></body></html>');
});

test('injectHeadScript prepends the tag when neither <head> nor <script> exist', () => {
  const html = '<p>fragment</p>';
  const result = injectHeadScript(html, '<script src="x.js"></script>');
  assert.equal(result, '<script src="x.js"></script><p>fragment</p>');
});

test('rewriteFwdLocation rewrites an absolute upstream-origin URL to the proxy fwd path', () => {
  const result = rewriteFwdLocation(
    'http://localhost:8000/after?x=1#h',
    'http://localhost:8000',
    'http://localhost:3000',
    'http://localhost:4400',
    '/__uce/fwd/http/localhost:8000',
  );
  assert.equal(result, 'http://localhost:4400/__uce/fwd/http/localhost:8000/after?x=1#h');
});

test('rewriteFwdLocation also rewrites an absolute target-origin URL to the proxy fwd path', () => {
  const result = rewriteFwdLocation(
    'http://localhost:3000/after',
    'http://localhost:8000',
    'http://localhost:3000',
    'http://localhost:4400',
    '/__uce/fwd/http/localhost:8000',
  );
  assert.equal(result, 'http://localhost:4400/__uce/fwd/http/localhost:8000/after');
});

test('rewriteFwdLocation leaves relative and foreign URLs untouched', () => {
  assert.equal(
    rewriteFwdLocation('/relative', 'http://localhost:8000', 'http://localhost:3000', 'http://localhost:4400', '/__uce/fwd/http/localhost:8000'),
    '/relative',
  );
  assert.equal(
    rewriteFwdLocation('https://example.com/x', 'http://localhost:8000', 'http://localhost:3000', 'http://localhost:4400', '/__uce/fwd/http/localhost:8000'),
    'https://example.com/x',
  );
});

// ---------------------------------------------------------------------------
// Integration tests: local target server + real proxy
// ---------------------------------------------------------------------------

const DEMO_HTML = '<!doctype html><html><head><title>T</title></head><body><p>Hallo</p></body></html>';

/** @returns {Promise<import('http').Server>} */
function startTargetServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/echo') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(Buffer.concat(chunks));
        });
        return;
      }
      if (req.url === '/redirect') {
        res.writeHead(302, { location: `http://${req.headers.host}/after-redirect` });
        res.end();
        return;
      }
      if (req.url === '/data.json') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === '/set-cookie') {
        res.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'set-cookie': 'session=abc123; Domain=example.com; Path=/; HttpOnly',
        });
        res.end('cookie set');
        return;
      }
      if (req.url === '/') {
        const gz = zlib.gzipSync(Buffer.from(DEMO_HTML, 'utf-8'));
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-encoding': 'gzip',
          'content-security-policy': "default-src 'self'",
          'content-security-policy-report-only': "default-src 'self'",
          'x-frame-options': 'DENY',
        });
        res.end(gz);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    });
    server.on('upgrade', (req, socket, head) => {
      if (req.url === '/ws') {
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
        socket.on('data', (chunk) => socket.write(chunk));
        socket.on('end', () => socket.destroy());
        socket.on('error', () => {});
        return;
      }
      socket.destroy();
    });
    server.listen(0, () => resolve(server));
  });
}

/**
 * A separate local "backend" server, playing the role of e.g. a local API
 * that only allows CORS requests from the target's origin (like the real
 * Weave portal/API split this feature was built for) - forwarded to via
 * `/__uce/fwd/http/localhost:<backendPort>/...`.
 * @returns {Promise<import('http').Server>}
 */
function startBackendServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/echo') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(Buffer.concat(chunks));
        });
        return;
      }
      if (req.url === '/api/echo-headers') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ origin: req.headers.origin || null, referer: req.headers.referer || null, host: req.headers.host }));
        return;
      }
      if (req.url === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
        res.write('data: first\n\n');
        setTimeout(() => {
          res.write('data: second\n\n');
          res.end();
        }, 150);
        return;
      }
      if (req.url === '/api/redirect') {
        res.writeHead(302, { location: `http://${req.headers.host}/api/after` });
        res.end();
        return;
      }
      if (req.url === '/api/set-cookie') {
        res.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'set-cookie': 'sid=xyz; Domain=example.com; Path=/api',
        });
        res.end('cookie set');
        return;
      }
      if (req.url === '/api/no-path-cookie') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'set-cookie': 'sid=xyz' });
        res.end('cookie set');
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    });
    server.on('upgrade', (req, socket) => {
      if (req.url === '/api/ws') {
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
        socket.on('data', (chunk) => socket.write(chunk));
        socket.on('end', () => socket.destroy());
        socket.on('error', () => {});
        return;
      }
      socket.destroy();
    });
    server.listen(0, () => resolve(server));
  });
}

/** @returns {Promise<number>} a currently-free TCP port, freed right before resolving */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/**
 * @param {number} port
 * @param {{ path?: string, method?: string, headers?: Record<string, string|number>, body?: string|Buffer }} [options]
 */
function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined && headers['content-length'] === undefined) {
      headers['content-length'] = Buffer.byteLength(options.body);
    }
    const req = http.request(
      { hostname: 'localhost', port, path: options.path || '/', method: options.method || 'GET', headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
        });
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

/**
 * @param {number} port
 * @param {{ path?: string }} [options]
 */
function upgradeRequest(port, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      path: options.path || '/',
      method: 'GET',
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
      },
    });
    req.on('upgrade', (res, socket, head) => {
      resolve({ statusCode: res.statusCode, socket, head });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Like `request`, but resolves with each chunk's data and the time (ms since
 * the request was sent) it arrived at, to verify a response is streamed
 * incrementally rather than buffered until it completes.
 * @param {number} port
 * @param {{ path?: string, method?: string, headers?: Record<string, string|number> }} [options]
 */
function streamingRequest(port, options = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = http.request(
      { hostname: 'localhost', port, path: options.path || '/', method: options.method || 'GET', headers: options.headers || {} },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        /** @type {number[]} */
        const timings = [];
        res.on('data', (c) => {
          chunks.push(c);
          timings.push(Date.now() - start);
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, chunks, timings }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const targetServer = await startTargetServer();
const targetAddress = targetServer.address();
const targetPort = typeof targetAddress === 'object' && targetAddress ? targetAddress.port : 0;
const targetOrigin = `http://localhost:${targetPort}`;

const backendServer = await startBackendServer();
const backendAddress = backendServer.address();
const backendPort = typeof backendAddress === 'object' && backendAddress ? backendAddress.port : 0;

const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'uce-proxy-test-'));
const overlayDir = path.join(tmpDir, 'overlay');
await fsp.mkdir(overlayDir, { recursive: true });
await fsp.writeFile(path.join(overlayDir, 'index.js'), '// fake overlay\nexport const marker = "overlay";\n');
const outFile = path.join(tmpDir, 'ui-changes.md');

const proxy = createProxy({ target: targetOrigin, out: outFile, overlayDir, updateCheck: false });
await new Promise((resolve) => proxy.listen(0, resolve));
const proxyAddress = proxy.address();
const proxyPort = typeof proxyAddress === 'object' && proxyAddress ? proxyAddress.port : 0;
const proxyOrigin = `http://localhost:${proxyPort}`;

after(async () => {
  await new Promise((resolve) => proxy.close(resolve));
  await new Promise((resolve) => targetServer.close(resolve));
  await new Promise((resolve) => backendServer.close(resolve));
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

test('injects the overlay script exactly once into a decompressed HTML response, fixes content-length, strips security headers', async () => {
  const res = await request(proxyPort, { path: '/' });
  assert.equal(res.statusCode, 200);
  const body = res.body.toString('utf-8');

  const matches = body.match(/<script type="module" src="\/__uce\/overlay\.js\?target=/g) || [];
  assert.equal(matches.length, 1);
  const scriptIndex = body.indexOf('<script type="module" src="/__uce/overlay.js');
  const bodyCloseIndex = body.indexOf('</body>');
  assert.ok(scriptIndex > -1 && bodyCloseIndex > -1 && scriptIndex < bodyCloseIndex);
  assert.match(body, /<p>Hallo<\/p>/);

  assert.equal(res.headers['content-length'], String(res.body.length));
  assert.equal(res.headers['content-encoding'], undefined);
  assert.equal(res.headers['transfer-encoding'], undefined);
  assert.equal(res.headers['content-security-policy'], undefined);
  assert.equal(res.headers['content-security-policy-report-only'], undefined);
  assert.equal(res.headers['x-frame-options'], undefined);

  const target = new URL(body.match(/target=([^"]+)/)[1] ? decodeURIComponent(body.match(/target=([^"]+)/)[1]) : '');
  assert.equal(target.origin, targetOrigin);
});

test('injects the net-shim script right after the opening <head> tag, exactly once, alongside the body overlay tag', async () => {
  const res = await request(proxyPort, { path: '/' });
  const body = res.body.toString('utf-8');

  const netShimMatches = body.match(/<script src="\/__uce\/net-shim\.js\?target=[^"]+"><\/script>/g) || [];
  assert.equal(netShimMatches.length, 1, 'net-shim tag should be injected exactly once');

  const headOpenIndex = body.indexOf('<head>');
  const netShimIndex = body.indexOf('<script src="/__uce/net-shim.js');
  const titleIndex = body.indexOf('<title>T</title>');
  const overlayIndex = body.indexOf('<script type="module" src="/__uce/overlay.js');
  const bodyCloseIndex = body.indexOf('</body>');
  assert.ok(
    headOpenIndex > -1 && headOpenIndex < netShimIndex && netShimIndex < titleIndex,
    'net-shim tag should sit right after <head>, before existing head content',
  );
  assert.ok(
    titleIndex < overlayIndex && overlayIndex < bodyCloseIndex,
    'the body overlay module tag should still be injected right before </body>',
  );

  const netShimTargetParam = /net-shim\.js\?target=([^"]+)/.exec(body)[1];
  assert.equal(new URL(decodeURIComponent(netShimTargetParam)).origin, targetOrigin);
});

test('rewrites an absolute redirect Location header to the proxy origin', async () => {
  const res = await request(proxyPort, { path: '/redirect' });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, `${proxyOrigin}/after-redirect`);
});

test('drops the Domain attribute from Set-Cookie', async () => {
  const res = await request(proxyPort, { path: '/set-cookie' });
  const cookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [res.headers['set-cookie']];
  assert.doesNotMatch(cookies[0], /domain=/i);
  assert.match(cookies[0], /session=abc123/);
});

test('passes non-HTML responses through unchanged', async () => {
  const res = await request(proxyPort, { path: '/data.json' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body.toString('utf-8')), { ok: true });
});

test('streams the POST body through to the target', async () => {
  const payload = 'hello=world&foo=bar';
  const res = await request(proxyPort, {
    path: '/echo',
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: payload,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.toString('utf-8'), payload);
});

test('serves /__uce/overlay.js from overlayDir/index.js', async () => {
  const res = await request(proxyPort, { path: '/__uce/overlay.js' });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /text\/javascript/);
  assert.match(res.body.toString('utf-8'), /fake overlay/);
});

test('unknown /__uce/ path returns 404', async () => {
  const res = await request(proxyPort, { path: '/__uce/does-not-exist.js' });
  assert.equal(res.statusCode, 404);
});

test('blocks path traversal attempts under /__uce/', async () => {
  const res = await request(proxyPort, { path: '/__uce/%2e%2e/%2e%2e/etc/passwd.js' });
  assert.ok(res.statusCode === 404 || res.statusCode === 403);
});

test('POST /__uce/export writes the markdown to --out and returns its absolute path', async () => {
  const markdown = '# UI-Änderungen\n\nTest-Export';
  const res = await request(proxyPort, {
    path: '/__uce/export',
    method: 'POST',
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
    body: Buffer.from(markdown, 'utf-8'),
  });
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body.toString('utf-8'));
  assert.equal(json.path, outFile);
  const written = await fsp.readFile(outFile, 'utf-8');
  assert.equal(written, markdown);
});

test('responds 502 without crashing; message language follows Accept-Language (absent/en -> English, de -> German)', async () => {
  const deadPort = await getFreePort();
  const deadProxy = createProxy({
    target: `http://localhost:${deadPort}`,
    out: path.join(tmpDir, 'dead.md'),
    overlayDir,
    updateCheck: false,
  });
  await new Promise((resolve) => deadProxy.listen(0, resolve));
  const deadAddress = deadProxy.address();
  const deadPortListening = typeof deadAddress === 'object' && deadAddress ? deadAddress.port : 0;

  const resDefault = await request(deadPortListening, { path: '/' });
  assert.equal(resDefault.statusCode, 502);
  assert.match(resDefault.body.toString('utf-8'), /target server unreachable/i);

  const resEn = await request(deadPortListening, { path: '/', headers: { 'accept-language': 'en-US' } });
  assert.equal(resEn.statusCode, 502);
  assert.match(resEn.body.toString('utf-8'), /target server unreachable/i);

  const resDe = await request(deadPortListening, { path: '/', headers: { 'accept-language': 'de-DE' } });
  assert.equal(resDe.statusCode, 502);
  assert.match(resDe.body.toString('utf-8'), /Ziel-Server/);

  await new Promise((resolve) => deadProxy.close(resolve));
});

test('WebSocket upgrade: client sends upgrade request through proxy to target, receives 101, and data echoes back', async () => {
  const upgrade = await upgradeRequest(proxyPort, { path: '/ws' });
  assert.equal(upgrade.statusCode, 101);

  const writePromise = new Promise((resolve, reject) => {
    upgrade.socket.write('ping', (err) => (err ? reject(err) : resolve()));
  });
  await writePromise;

  const readPromise = new Promise((resolve, reject) => {
    upgrade.socket.once('data', (chunk) => {
      resolve(chunk.toString('utf-8'));
    });
    upgrade.socket.on('error', reject);
  });
  const echo = await readPromise;
  assert.equal(echo, 'ping');

  upgrade.socket.destroy();
});

test('WebSocket upgrade to a dead target does not crash the proxy; proxy still answers normal requests', async () => {
  const deadPort = await getFreePort();
  const deadProxy = createProxy({
    target: `http://localhost:${deadPort}`,
    out: path.join(tmpDir, 'dead-ws.md'),
    overlayDir,
    updateCheck: false,
  });
  await new Promise((resolve) => deadProxy.listen(0, resolve));
  const deadAddress = deadProxy.address();
  const deadPortListening = typeof deadAddress === 'object' && deadAddress ? deadAddress.port : 0;

  const upgradeError = await new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: deadPortListening,
      path: '/ws',
      method: 'GET',
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(null);
    });
    req.on('error', (err) => resolve(err));
    req.end();
  });
  assert.ok(upgradeError || true);

  const normalRes = await request(deadPortListening, { path: '/' });
  assert.equal(normalRes.statusCode, 502);
  assert.match(normalRes.body.toString('utf-8'), /target server unreachable/i);

  await new Promise((resolve) => deadProxy.close(resolve));
});

// ---------------------------------------------------------------------------
// /__uce/fwd/<scheme>/<host:port>/<path> - forwarding to a local backend
// ---------------------------------------------------------------------------

test('fwd GET forwards to a local backend and rewrites Origin/Referer to the target origin, Host to the upstream host', async () => {
  const res = await request(proxyPort, {
    path: `/__uce/fwd/http/localhost:${backendPort}/api/echo-headers`,
    headers: { origin: proxyOrigin, referer: `${proxyOrigin}/some/page` },
  });
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body.toString('utf-8'));
  assert.equal(json.origin, targetOrigin);
  assert.equal(json.referer, `${targetOrigin}/some/page`);
  assert.equal(json.host, `localhost:${backendPort}`);
});

test('fwd POST streams the request body to the backend and streams the response back', async () => {
  const payload = 'hello=fwd&x=1';
  const res = await request(proxyPort, {
    path: `/__uce/fwd/http/localhost:${backendPort}/api/echo`,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: payload,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.toString('utf-8'), payload);
});

test('fwd delivers a chunked/SSE-like response incrementally, not buffered until the end', async () => {
  const result = await streamingRequest(proxyPort, { path: `/__uce/fwd/http/localhost:${backendPort}/api/stream` });
  assert.equal(result.statusCode, 200);
  assert.ok(result.chunks.length >= 2, `expected at least two separate chunks, got ${result.chunks.length}`);
  assert.ok(result.timings[0] < 100, `first chunk should arrive quickly (not buffered), got ${result.timings[0]}ms`);
  assert.ok(
    result.timings[result.timings.length - 1] >= 140,
    `last chunk should arrive after the backend's delay, got ${result.timings[result.timings.length - 1]}ms`,
  );
  const combined = Buffer.concat(result.chunks).toString('utf-8');
  assert.match(combined, /first/);
  assert.match(combined, /second/);
});

test('fwd rewrites an absolute redirect Location header (upstream origin) to the proxy fwd path', async () => {
  const res = await request(proxyPort, { path: `/__uce/fwd/http/localhost:${backendPort}/api/redirect` });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, `${proxyOrigin}/__uce/fwd/http/localhost:${backendPort}/api/after`);
});

test('fwd rewrites Set-Cookie: drops Domain and prefixes Path with the fwd prefix', async () => {
  const res = await request(proxyPort, { path: `/__uce/fwd/http/localhost:${backendPort}/api/set-cookie` });
  const cookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [res.headers['set-cookie']];
  assert.doesNotMatch(cookies[0], /domain=/i);
  assert.match(cookies[0], /sid=xyz/);
  assert.match(cookies[0], new RegExp(`Path=/__uce/fwd/http/localhost:${backendPort}/api$`));
});

test('fwd rewrites a missing Set-Cookie Path to the fwd prefix root', async () => {
  const res = await request(proxyPort, { path: `/__uce/fwd/http/localhost:${backendPort}/api/no-path-cookie` });
  const cookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [res.headers['set-cookie']];
  assert.match(cookies[0], new RegExp(`Path=/__uce/fwd/http/localhost:${backendPort}$`));
});

test('fwd rejects a non-loopback, non-target host with 403', async () => {
  const res = await request(proxyPort, { path: '/__uce/fwd/http/example.com/api' });
  assert.equal(res.statusCode, 403);
});

test('fwd rejects a request whose Sec-Fetch-Site is cross-site with 403, even though it targets an allowed host', async () => {
  const res = await request(proxyPort, {
    path: `/__uce/fwd/http/localhost:${backendPort}/api/echo-headers`,
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(res.statusCode, 403);
});

test('fwd to an unreachable upstream returns 502, like the normal proxy path', async () => {
  const deadPort = await getFreePort();
  const res = await request(proxyPort, { path: `/__uce/fwd/http/localhost:${deadPort}/api/anything` });
  assert.equal(res.statusCode, 502);
});

test('WebSocket upgrade through /__uce/fwd/ws/... reaches the backend, receives 101, and data echoes back', async () => {
  const upgrade = await upgradeRequest(proxyPort, { path: `/__uce/fwd/ws/localhost:${backendPort}/api/ws` });
  assert.equal(upgrade.statusCode, 101);

  const writePromise = new Promise((resolve, reject) => {
    upgrade.socket.write('ping', (err) => (err ? reject(err) : resolve()));
  });
  await writePromise;

  const echo = await new Promise((resolve, reject) => {
    upgrade.socket.once('data', (chunk) => resolve(chunk.toString('utf-8')));
    upgrade.socket.on('error', reject);
  });
  assert.equal(echo, 'ping');

  upgrade.socket.destroy();
});

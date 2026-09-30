// @ts-check
// Launcher mode: no target at startup, GET /__uce/ launcher page, POST
// /__uce/target to set target+out at runtime, POST /__uce/quit, /__uce/state,
// and the cross-origin POST guard shared by /__uce/target, /__uce/export and
// /__uce/quit.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { JSDOM } from 'jsdom';

import { createProxy } from '../src/proxy/server.js';
import { launcherHtml } from '../src/proxy/launcher.js';
import { APPLESCRIPT } from '../src/proxy/pick-dir.js';

/** @returns {Promise<import('http').Server>} */
function startTargetServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><title>T</title></head><body><p>Ziel-App</p></body></html>');
    });
    server.listen(0, () => resolve(server));
  });
}

/**
 * @param {number} port
 * @param {{ path?: string, method?: string, headers?: Record<string, string>, body?: string }} [options]
 */
function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined && headers['content-length'] === undefined) {
      headers['content-length'] = String(Buffer.byteLength(options.body));
    }
    const req = http.request(
      { hostname: 'localhost', port, path: options.path || '/', method: options.method || 'GET', headers },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const targetServer = await startTargetServer();
const targetAddress = targetServer.address();
const targetPort = typeof targetAddress === 'object' && targetAddress ? targetAddress.port : 0;
const targetOrigin = `http://localhost:${targetPort}`;

const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'uce-launcher-test-'));
const overlayDir = path.join(tmpDir, 'overlay');
await fsp.mkdir(overlayDir, { recursive: true });
await fsp.writeFile(path.join(overlayDir, 'index.js'), '// fake overlay\nexport const marker = "overlay";\n');
const outDir = path.join(tmpDir, 'out');
await fsp.mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, 'ui-changes.md');

let quitCalls = 0;
const proxy = createProxy({
  out: outFile,
  overlayDir,
  updateCheck: false,
  onQuit: () => {
    quitCalls++;
  },
});
await new Promise((resolve) => proxy.listen(0, resolve));
const proxyAddress = proxy.address();
const proxyPort = typeof proxyAddress === 'object' && proxyAddress ? proxyAddress.port : 0;

// A second proxy instance with an injected fake picker, so pick-dir tests
// never open a real OS dialog. `fakePicker.impl` is reassigned per test.
/** @type {{ impl: (opts: { title?: string, startDir?: string }) => Promise<any> }} */
const fakePicker = { impl: async () => ({ cancelled: true }) };
const pickerProxy = createProxy({
  out: path.join(tmpDir, 'picker-ui-changes.md'),
  overlayDir,
  updateCheck: false,
  pickDirectory: (opts) => fakePicker.impl(opts),
});
await new Promise((resolve) => pickerProxy.listen(0, resolve));
const pickerAddress = pickerProxy.address();
const pickerPort = typeof pickerAddress === 'object' && pickerAddress ? pickerAddress.port : 0;

// Two more proxy instances with an injected update checker, so /__uce/update
// tests never hit the real GitHub API.
const updateInfoFixture = {
  current: '1.0.1',
  latest: '1.0.2',
  url: 'https://github.com/bl0rb/nudgit/releases/tag/v1.0.2',
};
const updateProxy = createProxy({
  out: path.join(tmpDir, 'update-ui-changes.md'),
  overlayDir,
  updateCheck: () => Promise.resolve(updateInfoFixture),
});
await new Promise((resolve) => updateProxy.listen(0, resolve));
const updateAddress = updateProxy.address();
const updatePort = typeof updateAddress === 'object' && updateAddress ? updateAddress.port : 0;

const noUpdateProxy = createProxy({
  out: path.join(tmpDir, 'no-update-ui-changes.md'),
  overlayDir,
  updateCheck: () => Promise.resolve(null),
});
await new Promise((resolve) => noUpdateProxy.listen(0, resolve));
const noUpdateAddress = noUpdateProxy.address();
const noUpdatePort = typeof noUpdateAddress === 'object' && noUpdateAddress ? noUpdateAddress.port : 0;

after(async () => {
  await new Promise((resolve) => proxy.close(resolve));
  await new Promise((resolve) => pickerProxy.close(resolve));
  await new Promise((resolve) => updateProxy.close(resolve));
  await new Promise((resolve) => noUpdateProxy.close(resolve));
  await new Promise((resolve) => targetServer.close(resolve));
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

test('without a target, any non-/__uce/ request redirects (302) to /__uce/', async () => {
  const res = await request(proxyPort, { path: '/admin' });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/__uce/');
});

test('GET /__uce/ serves the bilingual launcher page (en default, de embedded for the toggle)', async () => {
  const res = await request(proxyPort, { path: '/__uce/' });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /text\/html/);
  const html = res.body.toString('utf-8');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /nudgit/);
  assert.match(html, /Open/);
  assert.match(html, /Quit/);
  assert.match(html, /Öffnen/);
  assert.match(html, /Beenden/);
  assert.match(html, /id="uce-lang-en"/);
  assert.match(html, /id="uce-lang-de"/);
  assert.match(html, /uce-lang/);
  assert.match(html, /localhost:3000\/admin/);
  assert.match(html, /id="uce-update-banner"/);
  assert.match(html, /View release/);
  assert.match(html, /Release ansehen/);
  assert.match(html, /Download macOS app/);
  assert.match(html, /macOS-App laden/);
});

test('GET /__uce/state reports no target initially', async () => {
  const res = await request(proxyPort, { path: '/__uce/state' });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body.toString('utf-8'));
  assert.equal(data.target, null);
  assert.equal(data.out, outFile);
});

test('POST /__uce/target rejects an empty URL with 400', async () => {
  const res = await request(proxyPort, {
    path: '/__uce/target',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: '   ' }),
  });
  assert.equal(res.statusCode, 400);
});

test('POST /__uce/target rejects an unsupported protocol with 400', async () => {
  const res = await request(proxyPort, {
    path: '/__uce/target',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'ftp://example.com' }),
  });
  assert.equal(res.statusCode, 400);
});

test('POST /__uce/target rejects a missing output directory with 400', async () => {
  const res = await request(proxyPort, {
    path: '/__uce/target',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: targetOrigin, outDir: path.join(tmpDir, 'does-not-exist') }),
  });
  assert.equal(res.statusCode, 400);
});

test('POST /__uce/target rejects a cross-origin Origin header with 403', async () => {
  const res = await request(proxyPort, {
    path: '/__uce/target',
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
    body: JSON.stringify({ url: targetOrigin }),
  });
  assert.equal(res.statusCode, 403);
});

test('POST /__uce/export rejects a cross-origin Origin header with 403', async () => {
  const res = await request(proxyPort, {
    path: '/__uce/export',
    method: 'POST',
    headers: { 'content-type': 'text/markdown', origin: 'http://evil.example' },
    body: '# test',
  });
  assert.equal(res.statusCode, 403);
});

test('POST /__uce/export rejects Sec-Fetch-Site: cross-site with 403', async () => {
  const res = await request(proxyPort, {
    path: '/__uce/export',
    method: 'POST',
    headers: { 'content-type': 'text/markdown', 'sec-fetch-site': 'cross-site' },
    body: '# test',
  });
  assert.equal(res.statusCode, 403);
});

test('POST /__uce/target accepts a schemeless URL, sets target+out, and subsequent requests are proxied + injected with the new target', async () => {
  const res = await request(proxyPort, {
    path: '/__uce/target',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: `localhost:${targetPort}/foo`, outDir }),
  });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body.toString('utf-8'));
  assert.equal(data.ok, true);
  assert.equal(data.path, '/foo');

  const stateRes = await request(proxyPort, { path: '/__uce/state' });
  const state = JSON.parse(stateRes.body.toString('utf-8'));
  assert.equal(state.target, `${targetOrigin}/foo`);
  assert.equal(state.out, outFile);

  const pageRes = await request(proxyPort, { path: '/foo' });
  assert.equal(pageRes.statusCode, 200);
  const html = pageRes.body.toString('utf-8');
  assert.match(html, /<script type="module" src="\/__uce\/overlay\.js\?target=/);
  assert.match(html, /Ziel-App/);
  const tagMatch = html.match(/target=([^"]+)/);
  assert.ok(tagMatch);
  assert.equal(decodeURIComponent(tagMatch[1]), `${targetOrigin}/foo`);
});

test('POST /__uce/target with forwardHosts replaces the forward list (URLs reduced to hostnames) and passes it to the net shim', async () => {
  const res = await request(proxyPort, {
    path: '/__uce/target',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: targetOrigin, outDir, forwardHosts: 'https://API.example.com/api/v1/me, auth.example.com' }),
  });
  assert.equal(res.statusCode, 200);
  const state = JSON.parse((await request(proxyPort, { path: '/__uce/state' })).body.toString('utf-8'));
  assert.deepEqual(state.forwardHosts, ['api.example.com', 'auth.example.com']);

  const html = (await request(proxyPort, { path: '/' })).body.toString('utf-8');
  assert.match(html, /net-shim\.js\?target=[^"]*&fwd=api\.example\.com%2Cauth\.example\.com"/);

  // omitting forwardHosts keeps the current list
  await request(proxyPort, {
    path: '/__uce/target',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: targetOrigin, outDir }),
  });
  const kept = JSON.parse((await request(proxyPort, { path: '/__uce/state' })).body.toString('utf-8'));
  assert.deepEqual(kept.forwardHosts, ['api.example.com', 'auth.example.com']);
});

test('POST /__uce/target rejects an invalid caCerts value with 400', async () => {
  const res = await request(proxyPort, {
    path: '/__uce/target',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: targetOrigin, outDir, caCerts: 'not a certificate' }),
  });
  assert.equal(res.statusCode, 400);
});

test('POST /__uce/target with caCerts makes fwd trust an https backend signed by that certificate', async (t) => {
  const certFile = path.join(tmpDir, 'cert.pem');
  const keyFile = path.join(tmpDir, 'key.pem');
  try {
    await new Promise((resolve, reject) => {
      execFile(
        'openssl',
        ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1',
          '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'],
        (err) => (err ? reject(err) : resolve(undefined)),
      );
    });
  } catch {
    t.skip('openssl not available');
    return;
  }
  const cert = await fsp.readFile(certFile, 'utf-8');
  const httpsServer = https.createServer({ cert, key: await fsp.readFile(keyFile) }, (req, res) => res.end('secure-ok'));
  await new Promise((resolve) => httpsServer.listen(0, () => resolve(undefined)));
  const httpsAddress = httpsServer.address();
  const httpsPort = typeof httpsAddress === 'object' && httpsAddress ? httpsAddress.port : 0;
  /** @param {string} caCerts */
  const setTarget = (caCerts) =>
    request(proxyPort, {
      path: '/__uce/target',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: targetOrigin, outDir, caCerts }),
    });
  const fwdPath = `/__uce/fwd/https/localhost:${httpsPort}/`;

  try {
    assert.equal((await setTarget('')).statusCode, 200);
    assert.equal((await request(proxyPort, { path: fwdPath })).statusCode, 502);

    assert.equal((await setTarget(cert)).statusCode, 200);
    const trusted = await request(proxyPort, { path: fwdPath });
    assert.equal(trusted.statusCode, 200);
    assert.equal(trusted.body.toString('utf-8'), 'secure-ok');

    assert.equal((await setTarget('')).statusCode, 200);
    assert.equal((await request(proxyPort, { path: fwdPath })).statusCode, 502);
  } finally {
    httpsServer.closeAllConnections();
    await new Promise((resolve) => httpsServer.close(() => resolve(undefined)));
  }
});

test('POST /__uce/quit responds ok and then invokes onQuit', async () => {
  const res = await request(proxyPort, { path: '/__uce/quit', method: 'POST' });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body.toString('utf-8'));
  assert.equal(data.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(quitCalls, 1);
});

// ---------------------------------------------------------------------------
// POST /__uce/pick-dir + GET /__uce/state canPickDir
// ---------------------------------------------------------------------------

test('GET /__uce/state reports canPickDir as a boolean; true when a picker is injected', async () => {
  const plainState = await request(proxyPort, { path: '/__uce/state' });
  const plainData = JSON.parse(plainState.body.toString('utf-8'));
  assert.equal(typeof plainData.canPickDir, 'boolean');

  const pickerState = await request(pickerPort, { path: '/__uce/state' });
  const pickerData = JSON.parse(pickerState.body.toString('utf-8'));
  assert.equal(pickerData.canPickDir, true);
});

test('POST /__uce/pick-dir: injected picker success returns the chosen path', async () => {
  fakePicker.impl = async () => ({ path: tmpDir });
  const res = await request(pickerPort, {
    path: '/__uce/pick-dir',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startDir: tmpDir }),
  });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body.toString('utf-8'));
  assert.equal(data.path, tmpDir);
});

test('POST /__uce/pick-dir: injected picker cancel returns { cancelled: true }', async () => {
  fakePicker.impl = async () => ({ cancelled: true });
  const res = await request(pickerPort, {
    path: '/__uce/pick-dir',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body.toString('utf-8'));
  assert.equal(data.cancelled, true);
});

test('POST /__uce/pick-dir: a picked path that does not exist is rejected with an error', async () => {
  const missing = path.join(tmpDir, 'does-not-exist-xyz');
  fakePicker.impl = async () => ({ path: missing });
  const res = await request(pickerPort, {
    path: '/__uce/pick-dir',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body.toString('utf-8'));
  assert.ok(data.error);
});

test('POST /__uce/pick-dir: rejects a cross-origin Origin header with 403 (picker never invoked)', async () => {
  fakePicker.impl = async () => {
    throw new Error('picker should not be called for a blocked cross-origin request');
  };
  const res = await request(pickerPort, {
    path: '/__uce/pick-dir',
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
    body: JSON.stringify({}),
  });
  assert.equal(res.statusCode, 403);
});

test('POST /__uce/pick-dir: a second request while a dialog is open gets 409', async () => {
  let resolveDialog;
  fakePicker.impl = () => new Promise((resolve) => { resolveDialog = resolve; });

  const firstPromise = request(pickerPort, {
    path: '/__uce/pick-dir',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  // Give the first request time to mark the picker busy before firing the second.
  await new Promise((resolve) => setTimeout(resolve, 30));

  const second = await request(pickerPort, {
    path: '/__uce/pick-dir',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(second.statusCode, 409);

  resolveDialog({ cancelled: true });
  const first = await firstPromise;
  assert.equal(first.statusCode, 200);
});

// ---------------------------------------------------------------------------
// GET /__uce/update
// ---------------------------------------------------------------------------

test('GET /__uce/update returns the injected update info with checked:true when an update is available', async () => {
  const res = await request(updatePort, { path: '/__uce/update' });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body.toString('utf-8'));
  assert.deepEqual(data, { update: updateInfoFixture, checked: true });
});

test('GET /__uce/update returns update:null with checked:true when no update is available', async () => {
  const res = await request(noUpdatePort, { path: '/__uce/update' });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body.toString('utf-8'));
  assert.deepEqual(data, { update: null, checked: true });
});

test('GET /__uce/update returns update:null with checked:false when the update check is disabled', async () => {
  const res = await request(proxyPort, { path: '/__uce/update' });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body.toString('utf-8'));
  assert.deepEqual(data, { update: null, checked: false });
});

// ---------------------------------------------------------------------------
// Launcher page update banner (client-side script, driven via jsdom)
// ---------------------------------------------------------------------------

test('launcher page: shows the update banner and hides+remembers it on dismiss', async () => {
  const html = launcherHtml({ target: null, out: outFile, canPickDir: false });
  const info = { current: '1.0.1', latest: '1.0.2', url: 'https://github.com/bl0rb/nudgit/releases/tag/v1.0.2' };
  const dom = new JSDOM(html, {
    url: 'http://localhost/__uce/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (/** @type {string} */ url) => {
        if (url === '/__uce/update') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ update: info, checked: true }) });
        }
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const { window } = dom;
  const banner = /** @type {any} */ (window.document.getElementById('uce-update-banner'));
  assert.equal(banner.hidden, false);
  const text = window.document.getElementById('uce-update-text').textContent;
  assert.match(text, /1\.0\.2/);
  assert.match(text, /1\.0\.1/);
  const link = /** @type {any} */ (window.document.getElementById('uce-update-link'));
  assert.equal(link.href, info.url);
  assert.equal(link.target, '_blank');
  assert.match(link.rel, /noopener/);
  assert.equal(/** @type {any} */ (window.document.getElementById('uce-update-download')).hidden, true);

  window.document.getElementById('uce-update-dismiss').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(banner.hidden, true);
  assert.equal(window.localStorage.getItem('uce-update-dismissed'), '1.0.2');
});

test('launcher page: shows the macOS download link only when downloadUrl is present and the UA looks like macOS', async () => {
  const html = launcherHtml({ target: null, out: outFile, canPickDir: false });
  const info = {
    current: '1.0.1',
    latest: '1.0.2',
    url: 'https://github.com/bl0rb/nudgit/releases/tag/v1.0.2',
    downloadUrl: 'https://github.com/bl0rb/nudgit/releases/download/v1.0.2/nudgit-macos.zip',
  };
  const dom = new JSDOM(html, {
    url: 'http://localhost/__uce/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    resources: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15' },
    beforeParse(window) {
      window.fetch = (/** @type {string} */ url) => {
        if (url === '/__uce/update') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ update: info, checked: true }) });
        }
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const downloadLink = /** @type {any} */ (dom.window.document.getElementById('uce-update-download'));
  assert.equal(downloadLink.hidden, false);
  assert.equal(downloadLink.href, info.downloadUrl);
});

test('launcher page: prefills the forward-hosts field and sends it and the stored CA certificate with the target', async () => {
  const html = launcherHtml({ target: null, out: outFile, canPickDir: false, forwardHosts: ['api.example.com'] });
  /** @type {any[]} */
  const posted = [];
  const dom = new JSDOM(html, {
    url: 'http://localhost/__uce/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.localStorage.setItem('uce-ca-cert', JSON.stringify({ name: 'corp-ca.pem', pem: 'PEM-TEXT' }));
      window.fetch = (/** @type {string} */ url, /** @type {any} */ init) => {
        if (url === '/__uce/target') posted.push(JSON.parse(init.body));
        return new Promise(() => {});
      };
    },
  });
  const { document } = dom.window;
  const fwdInput = /** @type {any} */ (document.getElementById('uce-fwd'));
  assert.equal(fwdInput.value, 'api.example.com');
  fwdInput.value = 'api.example.com, auth.example.com';
  /** @type {any} */ (document.getElementById('uce-url')).value = 'http://localhost:4200';
  document.getElementById('uce-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].forwardHosts, 'api.example.com, auth.example.com');
  assert.equal(posted[0].caCerts, 'PEM-TEXT');
  assert.equal(document.getElementById('uce-ca-name').textContent, 'corp-ca.pem');

  // removing the certificate clears it for the next submit and in storage
  document.getElementById('uce-ca-remove').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.equal(dom.window.localStorage.getItem('uce-ca-cert'), null);
  /** @type {any} */ (document.getElementById('uce-open')).disabled = false;
  document.getElementById('uce-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(posted[1].caCerts, '');
});

test('launcher page: shows nothing when there is no update', async () => {
  const html = launcherHtml({ target: null, out: outFile, canPickDir: false });
  const dom = new JSDOM(html, {
    url: 'http://localhost/__uce/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ update: null, checked: true }) });
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(/** @type {any} */ (dom.window.document.getElementById('uce-update-banner')).hidden, true);
});

test('launcher page: shows nothing when the update check request fails', async () => {
  const html = launcherHtml({ target: null, out: outFile, canPickDir: false });
  const dom = new JSDOM(html, {
    url: 'http://localhost/__uce/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('network down'));
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(/** @type {any} */ (dom.window.document.getElementById('uce-update-banner')).hidden, true);
});

test('the macOS AppleScript source compiles (osacompile), without ever running it', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('osacompile only available on macOS');
    return;
  }
  const srcFile = path.join(tmpDir, 'uce-pick-dir-check.applescript');
  const outFile2 = path.join(tmpDir, 'uce-pick-dir-check.scpt');
  await fsp.writeFile(srcFile, APPLESCRIPT, 'utf-8');
  await new Promise((resolve, reject) => {
    execFile('osacompile', ['-o', outFile2, srcFile], (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(undefined);
    });
  });
  await fsp.rm(outFile2, { force: true });
  await fsp.rm(srcFile, { force: true });
});

test('launcher icons are served from /__uce/static/ and as /favicon.ico without a target', async () => {
  const png = await request(pickerPort, { path: '/__uce/static/favicon-32.png' });
  assert.equal(png.statusCode, 200);
  assert.equal(png.headers['content-type'], 'image/png');
  assert.deepEqual([...png.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  const svg = await request(pickerPort, { path: '/__uce/static/icon.svg' });
  assert.equal(svg.statusCode, 200);
  assert.equal(svg.headers['content-type'], 'image/svg+xml');
  const ico = await request(pickerPort, { path: '/favicon.ico' });
  assert.equal(ico.statusCode, 200);
  assert.equal(ico.headers['content-type'], 'image/png');
  assert.equal((await request(pickerPort, { path: '/__uce/static/../server.js' })).statusCode, 404);
  assert.equal((await request(pickerPort, { path: '/__uce/static/nope.png' })).statusCode, 404);
  const html = (await request(pickerPort, { path: '/__uce/' })).body.toString();
  assert.match(html, /<link rel="icon" type="image\/png" sizes="32x32" href="\/__uce\/static\/favicon-32.png">/);
});

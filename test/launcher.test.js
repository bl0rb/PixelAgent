// @ts-check
// Launcher mode: no target at startup, GET /__uce/ launcher page, POST
// /__uce/target to set target+out at runtime, POST /__uce/quit, /__uce/state,
// and the cross-origin POST guard shared by /__uce/target, /__uce/export and
// /__uce/quit.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

import { createProxy } from '../src/proxy/server.js';
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
  pickDirectory: (opts) => fakePicker.impl(opts),
});
await new Promise((resolve) => pickerProxy.listen(0, resolve));
const pickerAddress = pickerProxy.address();
const pickerPort = typeof pickerAddress === 'object' && pickerAddress ? pickerAddress.port : 0;

after(async () => {
  await new Promise((resolve) => proxy.close(resolve));
  await new Promise((resolve) => pickerProxy.close(resolve));
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
  assert.match(html, /PixelAgent/);
  assert.match(html, /Open/);
  assert.match(html, /Quit/);
  assert.match(html, /Öffnen/);
  assert.match(html, /Beenden/);
  assert.match(html, /id="uce-lang-en"/);
  assert.match(html, /id="uce-lang-de"/);
  assert.match(html, /uce-lang/);
  assert.match(html, /localhost:3000\/admin/);
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

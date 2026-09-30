// @ts-check
// Tests for src/overlay/net-shim.js: a classic (non-module) script, so it's
// loaded here via jsdom's `window.eval` (with a faked `document.currentScript`
// and `location`) rather than `import()`, which only works for ES modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHIM_SRC = fs.readFileSync(path.join(__dirname, '../src/overlay/net-shim.js'), 'utf-8');

/**
 * Create a jsdom window at `proxyUrl` with the net-shim loaded, as if the
 * proxy had injected `<script src=".../__uce/net-shim.js?target=<targetUrl>">`
 * right after `<head>`. `seed`, if given, runs before the shim loads so it can
 * pre-populate globals (fake fetch/Request/...) for the shim to wrap.
 *
 * @param {{ proxyUrl?: string, targetUrl?: string|null, fwd?: string, seed?: (window: any) => void }} [opts]
 */
function loadShim({ proxyUrl = 'http://localhost:4400/', targetUrl = 'http://localhost:3000/', fwd = '', seed } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: proxyUrl,
    runScripts: 'dangerously',
  });
  const { window } = dom;
  if (seed) seed(window);
  const scriptSrc = targetUrl
    ? `${proxyUrl}__uce/net-shim.js?target=${encodeURIComponent(targetUrl)}${fwd ? `&fwd=${encodeURIComponent(fwd)}` : ''}`
    : `${proxyUrl}__uce/net-shim.js`;
  Object.defineProperty(window.document, 'currentScript', { value: { src: scriptSrc }, configurable: true });
  window.eval(SHIM_SRC);
  return window;
}

// ---------------------------------------------------------------------------
// rewriteUrl
// ---------------------------------------------------------------------------

test('rewriteUrl: a proxy-origin URL is left unchanged', () => {
  const window = loadShim();
  const url = 'http://localhost:4400/some/path?x=1';
  assert.equal(window.__nudgitRewriteUrl(url), url);
});

test('rewriteUrl: a relative URL (resolves to the proxy origin) is left unchanged', () => {
  const window = loadShim();
  assert.equal(window.__nudgitRewriteUrl('/relative/path?x=1'), '/relative/path?x=1');
});

test('rewriteUrl: a target-origin URL is rewritten to the same path on the proxy origin', () => {
  const window = loadShim();
  assert.equal(
    window.__nudgitRewriteUrl('http://localhost:3000/foo?x=1#hash'),
    'http://localhost:4400/foo?x=1#hash',
  );
});

test('rewriteUrl: a different local backend (another localhost port) is routed through /__uce/fwd/', () => {
  const window = loadShim();
  assert.equal(
    window.__nudgitRewriteUrl('http://localhost:8000/api/v1/auth/me'),
    'http://localhost:4400/__uce/fwd/http/localhost:8000/api/v1/auth/me',
  );
});

test('rewriteUrl: 127.0.0.1 is treated as loopback', () => {
  const window = loadShim();
  assert.equal(
    window.__nudgitRewriteUrl('http://127.0.0.1:9000/x'),
    'http://localhost:4400/__uce/fwd/http/127.0.0.1:9000/x',
  );
});

test('rewriteUrl: a *.localhost hostname is treated as loopback', () => {
  const window = loadShim();
  assert.equal(
    window.__nudgitRewriteUrl('http://api.localhost:9000/x'),
    'http://localhost:4400/__uce/fwd/http/api.localhost:9000/x',
  );
});

test('rewriteUrl: a ws:// URL to a local backend becomes a ws:// fwd URL on the proxy host', () => {
  const window = loadShim();
  assert.equal(
    window.__nudgitRewriteUrl('ws://localhost:8000/socket?x=1'),
    'ws://localhost:4400/__uce/fwd/ws/localhost:8000/socket?x=1',
  );
});

test('rewriteUrl: an external (non-loopback, non-target) host is left unchanged', () => {
  const window = loadShim();
  const url = 'https://example.com/api';
  assert.equal(window.__nudgitRewriteUrl(url), url);
});

test('rewriteUrl: an external host listed in the fwd param (--forward-host) is routed through /__uce/fwd/', () => {
  const window = loadShim({ fwd: 'api.example.com,other.example.com' });
  assert.equal(
    window.__nudgitRewriteUrl('https://API.example.com/api/v1/me?x=1'),
    'http://localhost:4400/__uce/fwd/https/api.example.com/api/v1/me?x=1',
  );
  assert.equal(window.__nudgitRewriteUrl('https://example.com/api'), 'https://example.com/api');
});

test('rewriteUrl: without a target param, the target-origin branch is inactive but loopback forwarding still works', () => {
  const window = loadShim({ targetUrl: null });
  assert.equal(
    window.__nudgitRewriteUrl('http://localhost:8000/api/x'),
    'http://localhost:4400/__uce/fwd/http/localhost:8000/api/x',
  );
});

test('rewriteUrl: never throws on malformed input and falls back to the original value', () => {
  const window = loadShim();
  const bad = 'http://[not-valid';
  let result;
  assert.doesNotThrow(() => {
    result = window.__nudgitRewriteUrl(bad);
  });
  assert.equal(result, bad);
});

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

test('fetch: a string URL is rewritten before the original fetch is called', async () => {
  let seenUrl = null;
  const window = loadShim({
    seed: (w) => {
      w.fetch = (url) => {
        seenUrl = url;
        return Promise.resolve({ ok: true });
      };
    },
  });
  await window.fetch('http://localhost:8000/api/x', { method: 'GET' });
  assert.equal(seenUrl, 'http://localhost:4400/__uce/fwd/http/localhost:8000/api/x');
});

test('fetch: a URL object is rewritten before the original fetch is called', async () => {
  let seenUrl = null;
  const window = loadShim({
    seed: (w) => {
      w.fetch = (url) => {
        seenUrl = url;
        return Promise.resolve({ ok: true });
      };
    },
  });
  await window.fetch(new window.URL('http://localhost:8000/api/y'));
  assert.equal(seenUrl, 'http://localhost:4400/__uce/fwd/http/localhost:8000/api/y');
});

test('fetch: a Request input is rebuilt with the rewritten URL, preserving method/headers', async () => {
  let seenRequest = null;
  const window = loadShim({
    seed: (w) => {
      // Minimal fake Request compatible with the shim's usage (jsdom has no
      // built-in fetch/Request).
      w.Request = function (url, init) {
        this.url = url;
        this.method = (init && init.method) || 'GET';
        this.headers = (init && init.headers) || {};
        this.body = init && init.body;
        this.credentials = init && init.credentials;
        this.mode = init && init.mode;
        this.signal = init && init.signal;
      };
      w.fetch = (req) => {
        seenRequest = req;
        return Promise.resolve({ ok: true });
      };
    },
  });
  const req = new window.Request('http://localhost:8000/api/z', {
    method: 'POST',
    headers: { 'x-test': '1' },
    body: 'payload',
  });
  await window.fetch(req);
  assert.ok(seenRequest instanceof window.Request, 'rebuilt request should still be a Request instance');
  assert.equal(seenRequest.url, 'http://localhost:4400/__uce/fwd/http/localhost:8000/api/z');
  assert.equal(seenRequest.method, 'POST');
  assert.equal(seenRequest.body, 'payload');
});

test('fetch: a Request whose URL does not need rewriting is passed through as-is', async () => {
  let seenRequest = null;
  let requestCount = 0;
  const window = loadShim({
    seed: (w) => {
      w.Request = function (url, init) {
        requestCount++;
        this.url = url;
        this.method = (init && init.method) || 'GET';
      };
      w.fetch = (req) => {
        seenRequest = req;
        return Promise.resolve({ ok: true });
      };
    },
  });
  const req = new window.Request('https://example.com/api');
  requestCount = 0; // reset: only count Requests constructed by the shim itself
  await window.fetch(req);
  assert.equal(seenRequest, req, 'unrewritten Request should be forwarded unchanged, not rebuilt');
  assert.equal(requestCount, 0);
});

// ---------------------------------------------------------------------------
// XMLHttpRequest
// ---------------------------------------------------------------------------

test('XMLHttpRequest.prototype.open rewrites a local-backend URL before delegating to the original open', () => {
  let seenMethod = null;
  let seenUrl = null;
  const window = loadShim({
    seed: (w) => {
      // Replace jsdom's real open with a spy so the shim wraps *this*
      // function as "original" (jsdom's implementation would otherwise try
      // to make a real network request).
      w.XMLHttpRequest.prototype.open = function (method, url) {
        seenMethod = method;
        seenUrl = url;
      };
    },
  });
  const xhr = new window.XMLHttpRequest();
  xhr.open('GET', 'http://localhost:8000/api/x');
  assert.equal(seenMethod, 'GET');
  assert.equal(seenUrl, 'http://localhost:4400/__uce/fwd/http/localhost:8000/api/x');
});

test('XMLHttpRequest.prototype.open leaves a target-origin URL rewritten to the proxy origin, extra args preserved', () => {
  const seenArgs = [];
  const window = loadShim({
    seed: (w) => {
      w.XMLHttpRequest.prototype.open = function (...args) {
        seenArgs.push(...args);
      };
    },
  });
  const xhr = new window.XMLHttpRequest();
  xhr.open('POST', 'http://localhost:3000/api/y', true, 'user', 'pass');
  assert.deepEqual(seenArgs, ['POST', 'http://localhost:4400/api/y', true, 'user', 'pass']);
});

// ---------------------------------------------------------------------------
// WebSocket / instanceof / static constants
// ---------------------------------------------------------------------------

test('WebSocket: constructor rewrites the URL, instanceof and static constants still work', () => {
  const window = loadShim();
  assert.equal(typeof window.WebSocket.OPEN, 'number');
  assert.equal(window.WebSocket.OPEN, 1);

  let ws;
  assert.doesNotThrow(() => {
    ws = new window.WebSocket('ws://localhost:8000/socket');
  });
  assert.ok(ws instanceof window.WebSocket, 'a socket created through the patched constructor should be instanceof the patched WebSocket');
  ws.close();
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test('is idempotent: evaluating the shim twice does not wrap fetch/open a second time', () => {
  let fetchCalls = 0;
  const window = loadShim({
    seed: (w) => {
      w.fetch = () => {
        fetchCalls++;
        return Promise.resolve({ ok: true });
      };
    },
  });
  const fetchAfterFirstLoad = window.fetch;
  const openAfterFirstLoad = window.XMLHttpRequest.prototype.open;

  window.eval(SHIM_SRC); // simulate the shim being injected a second time

  assert.equal(window.fetch, fetchAfterFirstLoad, 'fetch should not be wrapped again');
  assert.equal(window.XMLHttpRequest.prototype.open, openAfterFirstLoad, 'XHR.open should not be wrapped again');
});

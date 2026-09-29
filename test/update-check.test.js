// @ts-check
// Unit tests for src/proxy/update-check.js. `checkForUpdate` always gets a
// fake `fetchImpl` so these tests never touch the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareVersions, checkForUpdate } from '../src/proxy/update-check.js';

// ---------------------------------------------------------------------------
// compareVersions
// ---------------------------------------------------------------------------

test('compareVersions: numeric comparison, not lexicographic (1.0.10 > 1.0.9)', () => {
  assert.ok(compareVersions('1.0.10', '1.0.9') > 0);
  assert.ok(compareVersions('1.0.9', '1.0.10') < 0);
});

test('compareVersions: tolerant of a leading "v" on either side', () => {
  assert.equal(compareVersions('v1.2.0', '1.2.0'), 0);
  assert.ok(compareVersions('v1.3.0', '1.2.0') > 0);
});

test('compareVersions: a pre-release suffix sorts older than the plain release', () => {
  assert.ok(compareVersions('1.2.0-rc.1', '1.2.0') < 0);
  assert.ok(compareVersions('1.2.0', '1.2.0-rc.1') > 0);
});

test('compareVersions: equal versions compare as 0; major/minor differences are ordered', () => {
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  assert.ok(compareVersions('2.0.0', '1.9.9') > 0);
  assert.ok(compareVersions('1.1.0', '1.2.0') < 0);
});

// ---------------------------------------------------------------------------
// checkForUpdate
// ---------------------------------------------------------------------------

/** @param {any} data */
function okJsonFetch(data) {
  return async () => ({ ok: true, status: 200, json: async () => data });
}

test('checkForUpdate: newer release found -> info incl. downloadUrl for the macOS asset', async () => {
  const info = await checkForUpdate({
    currentVersion: '1.0.1',
    fetchImpl: okJsonFetch({
      tag_name: 'v1.0.2',
      html_url: 'https://github.com/bl0rb/PixelAgent/releases/tag/v1.0.2',
      assets: [
        { name: 'other-asset.zip', browser_download_url: 'https://example.com/other-asset.zip' },
        { name: 'PixelAgent-macos.zip', browser_download_url: 'https://example.com/PixelAgent-macos.zip' },
      ],
    }),
  });
  assert.deepEqual(info, {
    current: '1.0.1',
    latest: '1.0.2',
    url: 'https://github.com/bl0rb/PixelAgent/releases/tag/v1.0.2',
    downloadUrl: 'https://example.com/PixelAgent-macos.zip',
  });
});

test('checkForUpdate: no macOS asset -> info without downloadUrl', async () => {
  const info = await checkForUpdate({
    currentVersion: '1.0.1',
    fetchImpl: okJsonFetch({
      tag_name: '1.0.2',
      html_url: 'https://github.com/bl0rb/PixelAgent/releases/tag/v1.0.2',
      assets: [],
    }),
  });
  assert.deepEqual(info, {
    current: '1.0.1',
    latest: '1.0.2',
    url: 'https://github.com/bl0rb/PixelAgent/releases/tag/v1.0.2',
  });
});

test('checkForUpdate: same version -> null', async () => {
  const info = await checkForUpdate({
    currentVersion: '1.0.1',
    fetchImpl: okJsonFetch({ tag_name: 'v1.0.1', html_url: 'https://example.com/1.0.1' }),
  });
  assert.equal(info, null);
});

test('checkForUpdate: older "latest" than current -> null', async () => {
  const info = await checkForUpdate({
    currentVersion: '2.0.0',
    fetchImpl: okJsonFetch({ tag_name: 'v1.9.0', html_url: 'https://example.com/1.9.0' }),
  });
  assert.equal(info, null);
});

test('checkForUpdate: 404 response -> null', async () => {
  const info = await checkForUpdate({
    currentVersion: '1.0.0',
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  });
  assert.equal(info, null);
});

test('checkForUpdate: 500 response -> null', async () => {
  const info = await checkForUpdate({
    currentVersion: '1.0.0',
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  });
  assert.equal(info, null);
});

test('checkForUpdate: malformed JSON body -> null', async () => {
  const info = await checkForUpdate({
    currentVersion: '1.0.0',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token in JSON');
      },
    }),
  });
  assert.equal(info, null);
});

test('checkForUpdate: response missing tag_name/html_url -> null', async () => {
  const info = await checkForUpdate({
    currentVersion: '1.0.0',
    fetchImpl: okJsonFetch({ foo: 'bar' }),
  });
  assert.equal(info, null);
});

test('checkForUpdate: a rejecting fetch -> null (never throws)', async () => {
  const info = await checkForUpdate({
    currentVersion: '1.0.0',
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(info, null);
});

test('checkForUpdate: a fetch that never resolves times out -> null', async () => {
  /** @type {() => any} */
  const hangingFetch = (/** @type {any} */ _url, /** @type {any} */ options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  const info = await checkForUpdate({
    currentVersion: '1.0.0',
    fetchImpl: /** @type {any} */ (hangingFetch),
    timeoutMs: 30,
  });
  assert.equal(info, null);
});

test('checkForUpdate: a fetch that ignores the abort signal still times out -> null', async () => {
  const ignoringFetch = () => new Promise(() => {});
  const info = await checkForUpdate({
    currentVersion: '1.0.0',
    fetchImpl: /** @type {any} */ (ignoringFetch),
    timeoutMs: 30,
  });
  assert.equal(info, null);
});

test('checkForUpdate: requests the expected URL/headers and nothing else (no identifiers, no query params)', async () => {
  /** @type {{ url?: string, options?: any }} */
  const captured = {};
  await checkForUpdate({
    currentVersion: '1.2.3',
    fetchImpl: /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ options) => {
      captured.url = url;
      captured.options = options;
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  });
  assert.equal(captured.url, 'https://api.github.com/repos/bl0rb/PixelAgent/releases/latest');
  assert.equal(captured.options.headers.Accept, 'application/vnd.github+json');
  assert.equal(captured.options.headers['User-Agent'], 'PixelAgent/1.2.3');
});

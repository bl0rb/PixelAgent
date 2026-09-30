// @ts-check
// extension/content/loader.js: a classic script whose last expression is the
// executeScript result. Indirect eval reproduces exactly that contract.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loaderSource = fs.readFileSync(path.join(__dirname, '../extension/content/loader.js'), 'utf-8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nudgit-loader-'));
const g = /** @type {any} */ (globalThis);

/** Runs the loader like chrome.scripting.executeScript does. */
const runLoader = () => (0, eval)(loaderSource);

/**
 * Writes a fake overlay module and points chrome.runtime.getURL at it.
 * @param {string} name
 * @param {string} body
 */
function installOverlay(name, body) {
  const file = path.join(tmp, `${name}.mjs`);
  fs.writeFileSync(file, body);
  g.document = { readyState: 'complete' };
  g.chrome = { runtime: { getURL: (/** @type {string} */ rel) => (rel === 'overlay/index.js' ? pathToFileURL(file).href : 'unexpected:' + rel) } };
}

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

afterEach(() => {
  for (const key of ['chrome', 'document', '__nudgitToggle', '__nudgitLoading', '__loads']) delete g[key];
});

test('first run imports overlay/index.js and reports it visible; later runs toggle', async () => {
  installOverlay(
    'ok',
    `globalThis.__loads = (globalThis.__loads || 0) + 1;
     let visible = true;
     globalThis.__nudgitToggle = () => (visible = !visible);`
  );

  assert.deepEqual(await runLoader(), { ok: true, visible: true });
  assert.equal(g.__loads, 1);
  assert.equal(typeof g.__nudgitToggle, 'function');

  assert.deepEqual(await runLoader(), { ok: true, visible: false });
  assert.deepEqual(await runLoader(), { ok: true, visible: true });
  assert.equal(g.__loads, 1, 'the overlay module is imported only once');
});

test('reports an error when the overlay cannot be loaded, and retries on the next run', async () => {
  installOverlay('broken', `throw new Error('boom');`);
  const first = await runLoader();
  assert.equal(first.ok, false);
  assert.match(first.error, /boom/);

  installOverlay('fixed', `globalThis.__nudgitToggle = () => true;`);
  assert.deepEqual(await runLoader(), { ok: true, visible: true });
});

test('reports an error when an overlay is already on the page (it did not expose the toggle)', async () => {
  installOverlay('already-there', `// initOverlay() bailed out: no __nudgitToggle`);
  const res = await runLoader();
  assert.equal(res.ok, false);
  assert.match(res.error, /already active/);
});

test('waits for DOMContentLoaded while the document is still parsing', async () => {
  installOverlay('late', `globalThis.__nudgitToggle = () => true;`);
  /** @type {Function|undefined} */
  let fire;
  g.document = {
    readyState: 'loading',
    addEventListener: (/** @type {string} */ type, /** @type {Function} */ fn) => {
      if (type === 'DOMContentLoaded') fire = fn;
    },
  };
  let done = false;
  const pending = (async () => {
    const res = await runLoader();
    done = true;
    return res;
  })();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false, 'still waiting');
  assert.ok(fire);
  fire();
  assert.deepEqual(await pending, { ok: true, visible: true });
});

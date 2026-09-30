// @ts-check
// Service worker logic of the browser extension, against a mocked chrome API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOADER_FILE,
  STORAGE_KEY,
  toggleTab,
  reinjectTab,
  handleTabUpdated,
  handleTabRemoved,
  handleMessage,
  registerListeners,
} from '../extension/service-worker.js';

/**
 * Minimal chrome mock. The fake loader mirrors extension/content/loader.js:
 * the first run shows the overlay, every further run in the same document
 * toggles it. `visible[tabId]` is that per-page state.
 * @param {{ failTabs?: number[], noResult?: boolean }} [opts]
 */
function createChrome(opts = {}) {
  /** @type {Record<string, any>} */
  const store = {};
  /** @type {Record<number, boolean|undefined>} */
  const visible = {};
  const calls = {
    executeScript: /** @type {any[]} */ ([]),
    badgeText: /** @type {Array<{ tabId: number, text: string }>} */ ([]),
    badgeColor: /** @type {any[]} */ ([]),
    download: /** @type {any[]} */ ([]),
  };
  /** @type {Record<string, Function[]>} */
  const listeners = {};
  const event = (/** @type {string} */ name) => ({
    addListener: (/** @type {Function} */ fn) => (listeners[name] ||= []).push(fn),
  });
  const api = {
    calls,
    visible,
    listeners,
    downloadError: /** @type {Error|null} */ (null),
    runtime: { id: 'test-ext', onMessage: event('onMessage') },
    storage: {
      session: {
        get: async (/** @type {string} */ key) => ({ [key]: store[key] === undefined ? undefined : structuredClone(store[key]) }),
        set: async (/** @type {Record<string, any>} */ items) => Object.assign(store, structuredClone(items)),
      },
    },
    action: {
      onClicked: event('onClicked'),
      setBadgeText: async (/** @type {any} */ a) => void calls.badgeText.push(a),
      setBadgeBackgroundColor: async (/** @type {any} */ a) => void calls.badgeColor.push(a),
    },
    commands: { onCommand: event('onCommand') },
    tabs: {
      onUpdated: event('onUpdated'),
      onRemoved: event('onRemoved'),
      query: async () => [{ id: 99 }],
    },
    scripting: {
      executeScript: async (/** @type {any} */ injection) => {
        calls.executeScript.push(injection);
        const tabId = injection.target.tabId;
        if (opts.failTabs && opts.failTabs.includes(tabId)) throw new Error('Cannot access contents of the page');
        if (opts.noResult) return [{ result: undefined }];
        visible[tabId] = visible[tabId] === undefined ? true : !visible[tabId];
        return [{ result: { ok: true, visible: visible[tabId] } }];
      },
    },
    downloads: {
      download: async (/** @type {any} */ options) => {
        calls.download.push(options);
        if (api.downloadError) throw api.downloadError;
        return 7;
      },
    },
    active: () => Object.keys(store[STORAGE_KEY] || {}).map(Number),
    lastBadge: (/** @type {number} */ tabId) => calls.badgeText.filter((b) => b.tabId === tabId).at(-1)?.text,
  };
  return api;
}

test('toggleTab injects the loader into the top frame, tracks the tab and sets the ON badge', async () => {
  const api = createChrome();
  const res = await toggleTab(api, 5);

  assert.deepEqual(res, { ok: true, visible: true });
  assert.equal(api.calls.executeScript.length, 1);
  assert.deepEqual(api.calls.executeScript[0], { target: { tabId: 5 }, files: [LOADER_FILE] });
  assert.equal(LOADER_FILE, 'content/loader.js');
  assert.deepEqual(api.active(), [5]);
  assert.equal(api.lastBadge(5), 'ON');
});

test('a second toggle hides nudgit again: tab untracked, badge cleared', async () => {
  const api = createChrome();
  await toggleTab(api, 5);
  const res = await toggleTab(api, 5);

  assert.deepEqual(res, { ok: true, visible: false });
  assert.deepEqual(api.active(), []);
  assert.equal(api.lastBadge(5), '');
});

test('toggleTab keeps other tabs tracked', async () => {
  const api = createChrome();
  await toggleTab(api, 1);
  await toggleTab(api, 2);
  await toggleTab(api, 1);
  assert.deepEqual(api.active(), [2]);
});

test('toggleTab on a page that cannot be scripted shows a "!" badge and tracks nothing', async () => {
  const api = createChrome({ failTabs: [3] });
  const res = await toggleTab(api, 3);

  assert.equal(res.ok, false);
  assert.match(/** @type {any} */ (res).error, /Cannot access/);
  assert.deepEqual(api.active(), []);
  assert.equal(api.lastBadge(3), '!');
});

test('toggleTab treats a missing loader result as a failure', async () => {
  const api = createChrome({ noResult: true });
  const res = await toggleTab(api, 4);
  assert.equal(res.ok, false);
  assert.deepEqual(api.active(), []);
});

test('toggleTab without a tab id does nothing', async () => {
  const api = createChrome();
  const res = await toggleTab(api, undefined);
  assert.equal(res.ok, false);
  assert.equal(api.calls.executeScript.length, 0);
});

test('tab state lives in chrome.storage.session, not in worker globals', async () => {
  const api = createChrome();
  await toggleTab(api, 8);
  const stored = await api.storage.session.get(STORAGE_KEY);
  assert.deepEqual(stored[STORAGE_KEY], { 8: true });
});

test('a finished page load re-injects into a tracked tab and keeps the badge on', async () => {
  const api = createChrome();
  await toggleTab(api, 5);
  api.visible[5] = undefined; // reload: fresh document, loader starts from scratch
  api.calls.executeScript.length = 0;

  await handleTabUpdated(api, 5, { status: 'complete' });

  assert.equal(api.calls.executeScript.length, 1);
  assert.deepEqual(api.active(), [5]);
  assert.equal(api.lastBadge(5), 'ON');
});

test('tab updates other than "complete", or for untracked tabs, are ignored', async () => {
  const api = createChrome();
  await toggleTab(api, 5);
  api.calls.executeScript.length = 0;

  await handleTabUpdated(api, 5, { status: 'loading' });
  await handleTabUpdated(api, 6, { status: 'complete' });

  assert.equal(api.calls.executeScript.length, 0);
});

test('a "complete" event in the same document (overlay still there) must not leave it hidden', async () => {
  const api = createChrome();
  await toggleTab(api, 5); // visible; the document (and the loader state) stays the same
  api.calls.executeScript.length = 0;

  const res = await reinjectTab(api, 5);

  assert.equal(api.calls.executeScript.length, 2, 'the loader toggles it off, the second run flips it back on');
  assert.deepEqual(res, { ok: true, visible: true });
  assert.deepEqual(api.active(), [5]);
});

test('a failed re-injection (access no longer granted) silently clears state and badge', async () => {
  const api = createChrome();
  await toggleTab(api, 5);
  api.calls.badgeText.length = 0;
  const failing = createChrome({ failTabs: [5] });
  // carry the tracked state over to the failing mock
  await failing.storage.session.set({ [STORAGE_KEY]: { 5: true } });

  await handleTabUpdated(failing, 5, { status: 'complete' });

  assert.deepEqual(failing.active(), []);
  assert.equal(failing.lastBadge(5), '');
});

test('closing a tab removes it from the tracked set', async () => {
  const api = createChrome();
  await toggleTab(api, 1);
  await toggleTab(api, 2);

  await handleTabRemoved(api, 1);
  await handleTabRemoved(api, 42); // unknown tab: no-op

  assert.deepEqual(api.active(), [2]);
});

test('nudgit:download saves ui-changes.md through downloads.download with a Save dialog', async () => {
  const api = createChrome();
  const md = '# UI changes\n\nÄnderung: 50% & "quotes" #1\n';
  const res = await handleMessage(api, { type: 'nudgit:download', markdown: md }, { id: 'test-ext' });

  assert.deepEqual(res, { ok: true, id: 7 });
  assert.equal(api.calls.download.length, 1);
  assert.deepEqual(api.calls.download[0], {
    url: 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md),
    filename: 'ui-changes.md',
    saveAs: true,
  });
  assert.equal(decodeURIComponent(api.calls.download[0].url.split(',')[1]), md);
});

test('nudgit:download reports failures and dismissed Save dialogs', async () => {
  const api = createChrome();
  api.downloadError = new Error('Invalid filename');
  assert.deepEqual(await handleMessage(api, { type: 'nudgit:download', markdown: 'x' }, {}), {
    ok: false,
    error: 'Invalid filename',
    canceled: false,
  });

  api.downloadError = new Error('Download canceled by the user');
  const canceled = /** @type {any} */ (await handleMessage(api, { type: 'nudgit:download', markdown: 'x' }, {}));
  assert.equal(canceled.ok, false);
  assert.equal(canceled.canceled, true);
});

test('nudgit:download without markdown is rejected without touching the downloads API', async () => {
  const api = createChrome();
  const res = /** @type {any} */ (await handleMessage(api, { type: 'nudgit:download' }, {}));
  assert.equal(res.ok, false);
  assert.equal(api.calls.download.length, 0);
});

test('messages that are not ours, or come from another extension, are not handled', () => {
  const api = createChrome();
  assert.equal(handleMessage(api, { type: 'something-else' }, {}), undefined);
  assert.equal(handleMessage(api, 'string', {}), undefined);
  assert.equal(handleMessage(api, undefined, {}), undefined);
  assert.equal(handleMessage(api, { type: 'nudgit:download', markdown: 'x' }, { id: 'other-ext' }), undefined);
  assert.equal(api.calls.download.length, 0);
});

test('nudgit:visibility from the page (x button) updates tracking and badge for the sender tab', async () => {
  const api = createChrome();
  await toggleTab(api, 5);

  await handleMessage(api, { type: 'nudgit:visibility', visible: false }, { id: 'test-ext', tab: { id: 5 } });
  assert.deepEqual(api.active(), []);
  assert.equal(api.lastBadge(5), '');

  await handleMessage(api, { type: 'nudgit:visibility', visible: true }, { id: 'test-ext', tab: { id: 5 } });
  assert.deepEqual(api.active(), [5]);
  assert.equal(api.lastBadge(5), 'ON');

  const noTab = /** @type {any} */ (await handleMessage(api, { type: 'nudgit:visibility', visible: false }, { id: 'test-ext' }));
  assert.equal(noTab.ok, false);
});

test('registerListeners wires icon click, command, tab events and messages', async () => {
  const api = createChrome();
  registerListeners(api);
  for (const name of ['onClicked', 'onCommand', 'onUpdated', 'onRemoved', 'onMessage']) {
    assert.equal(api.listeners[name]?.length, 1, `${name} listener registered`);
  }

  await api.listeners.onClicked[0]({ id: 11 });
  assert.deepEqual(api.active(), [11]);

  await api.listeners.onCommand[0]('other-command', { id: 12 });
  assert.deepEqual(api.active(), [11], 'unknown commands are ignored');

  await api.listeners.onCommand[0]('toggle-nudgit', { id: 12 });
  assert.deepEqual(api.active().sort(), [11, 12]);

  await api.listeners.onCommand[0]('toggle-nudgit', undefined); // falls back to the active tab
  assert.deepEqual(api.active().sort(), [11, 12, 99]);

  await api.listeners.onRemoved[0](11);
  assert.deepEqual(api.active().sort(), [12, 99]);

  await api.listeners.onUpdated[0](12, { status: 'complete' });
  assert.equal(api.lastBadge(12), 'ON');

  /** @type {any[]} */
  const responses = [];
  const keepOpen = api.listeners.onMessage[0]({ type: 'nudgit:download', markdown: 'hi' }, { id: 'test-ext' }, (/** @type {any} */ r) => responses.push(r));
  assert.equal(keepOpen, true, 'async response keeps the message channel open');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(responses, [{ ok: true, id: 7 }]);

  assert.equal(api.listeners.onMessage[0]({ type: 'unrelated' }, {}, () => {}), false);
});

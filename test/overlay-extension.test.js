// @ts-check
// Overlay in browser-extension mode (src/overlay/extension.js + index.js).
// The overlay decides by `import.meta.url`, so these tests load it through a
// Node module hook that serves `chrome-extension://<id>/overlay/*` from
// src/overlay — every scenario gets its own <id>, i.e. a fresh module graph.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { detectExtensionMode, downloadViaExtension, notifyVisibility } from '../src/overlay/extension.js';

const OVERLAY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/overlay');

const hooks = `
import fs from 'node:fs';
import path from 'node:path';
const OVERLAY_DIR = ${JSON.stringify(OVERLAY_DIR)};
export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || '';
  if (specifier.startsWith('chrome-extension://') || parent.startsWith('chrome-extension://')) {
    return { url: new URL(specifier, parent || undefined).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (!url.startsWith('chrome-extension://')) return nextLoad(url, context);
  const rel = new URL(url).pathname.replace(/^\\/overlay\\//, '');
  return { format: 'module', source: fs.readFileSync(path.join(OVERLAY_DIR, rel), 'utf-8'), shortCircuit: true };
}
`;
register('data:text/javascript,' + encodeURIComponent(hooks));

const GLOBAL_NAMES = [
  'window', 'document', 'location', 'localStorage', 'navigator',
  'HTMLElement', 'Node', 'Text', 'MutationObserver', 'Event', 'CustomEvent',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'CSS',
];

let scenario = 0;
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Loads the overlay as an extension content script into a fresh jsdom page.
 * @param {(env: { window: any, ctx: any, host: HTMLElement, sent: any[], blobs: string[], downloads: string[], respond: (fn: (msg: any) => any) => void }) => Promise<void>} run
 */
async function withExtensionOverlay(run) {
  const dom = new JSDOM(
    `<!doctype html><html><body><button id="save-btn" type="button">Speichern</button></body></html>`,
    { url: 'https://app.example.com/dashboard', pretendToBeVisual: true }
  );
  const { window } = dom;

  /** @type {any[]} */
  const sent = [];
  /** @type {(msg: any) => any} */
  let responder = () => ({ ok: true, id: 1 });
  /** @type {string[]} */
  const blobs = [];
  /** @type {string[]} */
  const downloads = [];

  const previous = /** @type {Record<string, PropertyDescriptor|undefined>} */ ({});
  const setGlobal = (/** @type {string} */ name, /** @type {any} */ value) => {
    previous[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: true });
  };
  for (const name of GLOBAL_NAMES) if (name in window) setGlobal(name, /** @type {any} */ (window)[name]);
  setGlobal('chrome', {
    runtime: {
      id: 'test-extension-id',
      sendMessage: async (/** @type {any} */ msg) => {
        sent.push(msg);
        return responder(msg);
      },
    },
  });
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => {
    blobs.push('blob');
    return 'blob:test';
  };
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {
    downloads.push(this.download);
  };

  try {
    await import(`chrome-extension://ext-${++scenario}/overlay/index.js`);
    const host = /** @type {HTMLElement} */ (window.document.querySelector('uce-root'));
    assert.ok(host, 'overlay host created');
    await run({
      window,
      ctx: window.__uceOverlay,
      host,
      sent,
      blobs,
      downloads,
      respond: (fn) => {
        responder = fn;
      },
    });
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    for (const name of Object.keys(previous)) {
      const desc = previous[name];
      if (desc) Object.defineProperty(globalThis, name, desc);
      else delete (/** @type {any} */ (globalThis))[name];
    }
    window.close();
  }
}

/** @param {any} env */
function addTextChange(env) {
  const button = env.window.document.getElementById('save-btn');
  const locator = env.ctx.createLocator(button);
  env.ctx.dispatch({ type: 'add', change: { type: 'text', target: locator, before: 'Speichern', after: 'Jetzt speichern' } });
  return button;
}

/** @param {any} env @param {string} text */
function toolbarButton(env, text) {
  const buttons = /** @type {HTMLButtonElement[]} */ ([...env.host.shadowRoot.querySelectorAll('.uce-toolbar button')]);
  const btn = buttons.find((b) => b.textContent === text);
  assert.ok(btn, `toolbar button "${text}"`);
  return btn;
}

test('detectExtensionMode needs an extension URL and a runtime id', () => {
  const chromeApi = { runtime: { id: 'abc' } };
  assert.equal(detectExtensionMode('chrome-extension://abc/overlay/index.js', chromeApi), true);
  assert.equal(detectExtensionMode('chrome-extension://abc/overlay/index.js', { runtime: {} }), false);
  assert.equal(detectExtensionMode('chrome-extension://abc/overlay/index.js', undefined), false);
  assert.equal(detectExtensionMode('http://localhost:4400/__uce/overlay.js?target=x', chromeApi), false);
  assert.equal(detectExtensionMode('file:///repo/src/overlay/index.js', chromeApi), false);
});

test('downloadViaExtension and notifyVisibility talk to the service worker', async () => {
  /** @type {any[]} */
  const sent = [];
  const api = { runtime: { sendMessage: async (/** @type {any} */ m) => (sent.push(m), { ok: true }) } };
  assert.deepEqual(await downloadViaExtension(api, '# md'), { canceled: false });
  assert.deepEqual(sent[0], { type: 'nudgit:download', markdown: '# md' });
  await notifyVisibility(api, false);
  assert.deepEqual(sent[1], { type: 'nudgit:visibility', visible: false });

  const cancel = { runtime: { sendMessage: async () => ({ ok: false, canceled: true }) } };
  assert.deepEqual(await downloadViaExtension(cancel, 'x'), { canceled: true });
  const fail = { runtime: { sendMessage: async () => ({ ok: false, error: 'nope' }) } };
  await assert.rejects(() => downloadViaExtension(fail, 'x'), /nope/);
  const none = { runtime: { sendMessage: async () => undefined } };
  await assert.rejects(() => downloadViaExtension(none, 'x'));
  const gone = { runtime: { sendMessage: async () => { throw new Error('Extension context invalidated.'); } } };
  await notifyVisibility(gone, true); // must not throw
});

test('extension mode: the page itself is the target, the toolbar gets a close button, no proxy UI', async () => {
  await withExtensionOverlay(async (env) => {
    assert.equal(env.ctx.extensionMode, true);
    assert.equal(env.ctx.proxyMode, false);
    assert.equal(env.ctx.targetOrigin, 'https://app.example.com');
    assert.equal(env.ctx.getLocatorUrl(), 'https://app.example.com/dashboard');
    toolbarButton(env, '×');
    const labels = [...env.host.shadowRoot.querySelectorAll('.uce-toolbar button')].map((b) => b.textContent);
    assert.ok(!labels.includes('Change URL') && !labels.includes('Andere URL'));
    assert.equal(typeof env.window.__nudgitToggle, 'function');
  });
});

test('extension mode: Export hands the markdown to the service worker instead of downloading a Blob', async () => {
  await withExtensionOverlay(async (env) => {
    addTextChange(env);
    toolbarButton(env, 'Export').click();
    await tick();

    const downloadMsgs = env.sent.filter((m) => m.type === 'nudgit:download');
    assert.equal(downloadMsgs.length, 1);
    assert.match(downloadMsgs[0].markdown, /^# UI changes/);
    assert.match(downloadMsgs[0].markdown, /Jetzt speichern/);
    assert.match(downloadMsgs[0].markdown, /Source: https:\/\/app\.example\.com\/dashboard/);
    assert.equal(env.blobs.length, 0, 'no Blob download');
    assert.match(env.host.shadowRoot.querySelector('.uce-toast').textContent, /ui-changes\.md/);
  });
});

test('extension mode: Export falls back to the Blob download when the worker fails', async () => {
  await withExtensionOverlay(async (env) => {
    env.respond(() => {
      throw new Error('Extension context invalidated.');
    });
    toolbarButton(env, 'Export').click();
    await tick();
    assert.equal(env.blobs.length, 1, 'Blob created');
    assert.deepEqual(env.downloads, ['ui-changes.md']);
  });

  await withExtensionOverlay(async (env) => {
    env.respond(() => ({ ok: false, error: 'Invalid filename' }));
    toolbarButton(env, 'Export').click();
    await tick();
    assert.deepEqual(env.downloads, ['ui-changes.md'], 'an {ok:false} answer also falls back');
  });
});

test('extension mode: a dismissed Save dialog neither falls back nor toasts', async () => {
  await withExtensionOverlay(async (env) => {
    env.respond(() => ({ ok: false, canceled: true }));
    toolbarButton(env, 'Export').click();
    await tick();
    assert.equal(env.blobs.length, 0);
    assert.ok(!env.host.shadowRoot.querySelector('.uce-toast').classList.contains('uce-visible'));
  });
});

test('setVisible(false) reverts the preview, leaves Edit mode and hides the host; changes survive', async () => {
  await withExtensionOverlay(async (env) => {
    const { ctx, window, host } = env;
    const button = addTextChange(env);
    assert.equal(button.textContent, 'Jetzt speichern');
    ctx.setMode('edit');

    ctx.setVisible(false);

    assert.equal(ctx.isVisible(), false);
    assert.equal(ctx.getMode(), 'view');
    assert.equal(button.textContent, 'Speichern', 'DOM preview reverted');
    assert.equal(host.style.getPropertyValue('display'), 'none');
    assert.equal(host.style.getPropertyPriority('display'), 'important');
    assert.equal(ctx.getState().changes.length, 1, 'state kept');
    assert.equal(JSON.parse(window.localStorage.getItem('uce:/dashboard')).changes.length, 1, 'still in localStorage');
    assert.deepEqual(env.sent.filter((m) => m.type === 'nudgit:visibility'), [{ type: 'nudgit:visibility', visible: false }]);

    // while hidden: SPA navigation must not touch the page, the E shortcut must not wake the overlay
    window.dispatchEvent(new window.Event('hashchange'));
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'e', bubbles: true }));
    assert.equal(button.textContent, 'Speichern');
    assert.equal(ctx.getMode(), 'view');

    ctx.setVisible(true);

    assert.equal(ctx.isVisible(), true);
    assert.equal(button.textContent, 'Jetzt speichern', 'full re-render re-applies the changes');
    assert.equal(host.style.getPropertyValue('display'), '');
    assert.deepEqual(env.sent.at(-1), { type: 'nudgit:visibility', visible: true });
  });
});

test('setVisible is idempotent and the page can still use E after showing again', async () => {
  await withExtensionOverlay(async (env) => {
    const { ctx, window } = env;
    ctx.setVisible(true); // already visible: nothing happens
    assert.equal(env.sent.length, 0);
    ctx.setVisible(false);
    ctx.setVisible(false);
    assert.equal(env.sent.length, 1);
    ctx.setVisible(true);
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'e', bubbles: true }));
    assert.equal(ctx.getMode(), 'edit');
  });
});

test('the x button hides the overlay', async () => {
  await withExtensionOverlay(async (env) => {
    const button = addTextChange(env);
    toolbarButton(env, '×').click();
    assert.equal(env.ctx.isVisible(), false);
    assert.equal(button.textContent, 'Speichern');
    assert.equal(env.host.style.getPropertyValue('display'), 'none');
  });
});

test('window.__nudgitToggle flips visibility and returns the new state', async () => {
  await withExtensionOverlay(async (env) => {
    const button = addTextChange(env);
    assert.equal(env.window.__nudgitToggle(), false);
    assert.equal(button.textContent, 'Speichern');
    assert.equal(env.window.__nudgitToggle(), true);
    assert.equal(button.textContent, 'Jetzt speichern');
    assert.equal(env.ctx.isVisible(), true);
  });
});

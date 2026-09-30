// @ts-check
// Smoke test for the overlay bootstrap (src/overlay/index.js + friends).
// Loads a tiny demo-like page in jsdom, imports the overlay module (which
// self-initializes on import), and checks the parts phases 2+4 are
// responsible for: the shadow-root UI gets created, and a change dispatched
// through the store is previewed in the DOM and persisted to localStorage.
//
// jsdom has no layout engine, so this drives the store directly (via the
// `window.__uceOverlay` debug hook index.js exposes) rather than simulating
// pixel-accurate double-clicks/drags through the real event pipeline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { resolveLocator } from '../src/overlay/locator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GLOBAL_NAMES = [
  'window', 'document', 'location', 'localStorage', 'navigator',
  'HTMLElement', 'Node', 'Text', 'MutationObserver', 'Event', 'CustomEvent',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'CSS',
];

test('overlay bootstraps its shadow UI and previews a dispatched text change', async () => {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <button id="save-btn" type="button">Speichern</button>
      <ul id="list"><li>One</li><li>Two</li><li>Three</li></ul>
    </body></html>`,
    { url: 'http://localhost/demo.html', pretendToBeVisual: true }
  );
  const { window } = dom;

  /** @type {Record<string, unknown>} */
  const previousGlobals = {};
  for (const name of GLOBAL_NAMES) {
    previousGlobals[name] = /** @type {any} */ (globalThis)[name];
    if (name in window) {
      // Node ≥21 exposes some of these (e.g. `navigator`) as read-only
      // getters on globalThis; redefine the property so jsdom's version
      // wins for the duration of this test.
      Object.defineProperty(globalThis, name, {
        value: /** @type {any} */ (window)[name],
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
  }

  try {
    const overlayUrl = pathToFileURL(path.join(__dirname, '../src/overlay/index.js')).href;
    await import(overlayUrl);

    const host = window.document.querySelector('uce-root');
    assert.ok(host, 'initOverlay() should append a <uce-root> host element');
    assert.ok(host.shadowRoot, 'uce-root should have an open shadow root');
    assert.ok(
      host.shadowRoot.querySelector('.uce-toolbar'),
      'the shadow root should contain the toolbar'
    );

    const ctx = /** @type {any} */ (window).__uceOverlay;
    assert.ok(ctx, 'overlay should expose its context via window.__uceOverlay for testing');
    assert.equal(ctx.getState().changes.length, 0, 'no persisted changes on a fresh page');
    assert.equal(ctx.extensionMode, false, 'a plain module URL is not extension mode');
    assert.equal(ctx.isVisible(), true);

    const button = window.document.getElementById('save-btn');
    assert.ok(button, 'demo button should exist');
    const locator = ctx.createLocator(button);
    assert.equal(locator.selector, '#save-btn');

    ctx.dispatch({
      type: 'add',
      change: { type: 'text', target: locator, before: 'Speichern', after: 'Jetzt speichern' },
    });

    assert.equal(
      button.textContent,
      'Jetzt speichern',
      'dispatching a text change should update the DOM preview'
    );
    assert.equal(ctx.getState().changes.length, 1);
    assert.equal(ctx.getState().changes[0].type, 'text');

    const storageKey = 'uce:/demo.html';
    const raw = window.localStorage.getItem(storageKey);
    assert.ok(raw, 'the change should be persisted to localStorage under uce:<pathname>');
    const saved = JSON.parse(/** @type {string} */ (raw));
    assert.equal(saved.changes.length, 1);
    assert.equal(saved.changes[0].after, 'Jetzt speichern');

    // Undo should restore the DOM preview and drop the persisted change.
    ctx.dispatch({ type: 'undo' });
    assert.equal(button.textContent, 'Speichern', 'undo should revert the DOM preview');
    const rawAfterUndo = window.localStorage.getItem(storageKey);
    const savedAfterUndo = JSON.parse(/** @type {string} */ (rawAfterUndo));
    assert.equal(savedAfterUndo.changes.length, 0);

    // --- Phase 5: Alt+ArrowDown swaps the selection with its next sibling ---
    const list = window.document.getElementById('list');
    const [oneLi, twoLi, threeLi] = Array.from(list.children);
    ctx.setMode('edit');
    ctx.setSelection(twoLi);
    window.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true })
    );

    assert.equal(list.children[0], oneLi, 'unrelated sibling stays put');
    assert.equal(list.children[1], threeLi, 'Alt+ArrowDown should move the selection past its next sibling');
    assert.equal(list.children[2], twoLi);
    const moveChange = ctx.getState().changes.find((c) => c.type === 'move');
    assert.ok(moveChange, 'Alt+ArrowDown should dispatch a move change');

    // Locators always describe the ORIGINAL DOM: even though `threeLi` now
    // sits 2nd in the live/preview DOM, its locator must still report its
    // true, original 3rd position (createLocator temporarily reverts every
    // preview move before computing the selector).
    const threeLocator = ctx.createLocator(threeLi);
    assert.match(threeLocator.selector, /:nth-of-type\(3\)/);

    // And that locator must resolve correctly against the *original*
    // source DOM (a coding agent applies these locators to the untouched
    // source, never to this live preview) — verified against a freshly
    // parsed copy of the original markup, independent of this document's
    // own live (already-moved) state.
    const originalDoc = new JSDOM(
      `<!doctype html><html><body>
        <button id="save-btn" type="button">Speichern</button>
        <ul id="list"><li>One</li><li>Two</li><li>Three</li></ul>
      </body></html>`
    ).window.document;
    const resolvedInOriginal = resolveLocator(threeLocator, originalDoc);
    assert.ok(resolvedInOriginal, 'the locator should resolve against the original DOM');
    assert.equal(resolvedInOriginal.textContent, 'Three');

    // --- Phase 5: Cmd/Ctrl+D duplicates the selection ---
    ctx.setSelection(button);
    window.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true, cancelable: true })
    );
    const insertChange = ctx.getState().changes.find((c) => c.type === 'insert');
    assert.ok(insertChange, 'Cmd+D should dispatch an insert change');
    const clone = window.document.querySelector(`[data-uce-insert="${insertChange.id}"]`);
    assert.ok(clone, 'the duplicate clone should be in the DOM');
    assert.equal(clone.tagName, button.tagName);
    assert.equal(clone.hasAttribute('id'), false, 'the clone must not carry the original id');

    // Undo removes the clone again.
    ctx.dispatch({ type: 'undo' });
    assert.equal(
      window.document.querySelector(`[data-uce-insert="${insertChange.id}"]`),
      null,
      'undo should remove the duplicated clone'
    );

    // Deleting a change reverts it (redo first to bring the clone back).
    ctx.dispatch({ type: 'redo' });
    assert.ok(window.document.querySelector(`[data-uce-insert="${insertChange.id}"]`), 'redo should recreate the clone');
    ctx.dispatch({ type: 'delete', id: insertChange.id });
    assert.equal(
      window.document.querySelector(`[data-uce-insert="${insertChange.id}"]`),
      null,
      'deleting the insert change should remove the clone'
    );
    // quick actions: shown for a selection in edit mode; rename starts inline editing
    const quickTarget = window.document.getElementById('save-btn');
    ctx.setMode('edit');
    ctx.setSelection(quickTarget);
    const quick = host.shadowRoot.querySelector('.uce-quick');
    assert.ok(quick && !quick.hidden, 'quick actions should be visible for the selection');
    assert.equal(quick.querySelectorAll('[data-quick]').length, 3);
    quick.querySelector('[data-quick="rename"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
    assert.equal(ctx.getEditingElement(), quickTarget, 'rename should start inline editing');
    assert.ok(quick.hidden, 'quick actions hide while editing');
    quickTarget.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    assert.equal(ctx.getEditingElement(), null, 'Esc should cancel the inline edit');
    ctx.setMode('view');
  } finally {
    for (const name of GLOBAL_NAMES) {
      if (previousGlobals[name] === undefined) {
        delete /** @type {any} */ (globalThis)[name];
      } else {
        Object.defineProperty(globalThis, name, {
          value: previousGlobals[name],
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
    }
    try {
      window.close();
    } catch {
      // ignore teardown errors
    }
  }
});

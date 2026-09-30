// @ts-check
import { createLocator } from './locator.js';
import { createState, apply, serialize, deserialize } from './changes.js';
import { buildDocument, toMarkdown, downloadMarkdown, postExport, copyText } from './export.js';
import { overlayStyles } from './styles.js';
import { createToolbar } from './toolbar.js';
import { createForwardNotice } from './forward-notice.js';
import { createSelection } from './select.js';
import { createPanel } from './panel.js';
import { sync as previewSync, withOriginalDom } from './preview.js';
import { createPositionTracker } from './position-tracker.js';
import { openPalettePopover } from './palette-popover.js';
import { openImportPopover } from './import-popover.js';
import { runAction } from './actions/index.js';
import { detectExtensionMode, downloadViaExtension, notifyVisibility } from './extension.js';
import { t } from './i18n.js';

/**
 * @typedef {import('./changes.js').State} State
 * @typedef {import('./locator.js').Locator} Locator
 * @typedef {'view'|'edit'} Mode
 */

/**
 * Shared context passed to every overlay module. Ephemeral UI state (mode,
 * selection, editing element, panel visibility) lives here and resets on
 * reload; `changes` data is the only part persisted, via `dispatch`.
 * @typedef {object} OverlayContext
 * @property {ShadowRoot} shadow
 * @property {HTMLElement} host
 * @property {HTMLElement} layer - the full-viewport overlay layer, for mounting transient UI (popovers, ...)
 * @property {boolean} proxyMode
 * @property {boolean} extensionMode - running as a browser-extension content script (no proxy; the page is the target)
 * @property {string} targetOrigin
 * @property {() => string} getLocatorUrl
 * @property {(el: Element) => Locator} createLocator
 * @property {() => State} getState
 * @property {(action: object) => void} dispatch
 * @property {() => Mode} getMode
 * @property {(mode: Mode) => void} setMode
 * @property {() => Element|null} getSelection
 * @property {(el: Element|null) => void} setSelection
 * @property {() => Element|null} getEditingElement
 * @property {(el: Element|null) => void} setEditingElement
 * @property {() => boolean} isPanelVisible
 * @property {() => void} togglePanel
 * @property {() => void} doExport
 * @property {() => void} doCopy
 * @property {(message: string, opts?: { error?: boolean }) => void} toast
 * @property {() => void} openPalette
 * @property {() => void} openImportPopover
 * @property {(entry: import('./palette.js').PaletteEntry) => void} startPlaceMode
 * @property {() => void} resync
 * @property {() => boolean} isVisible
 * @property {(visible: boolean) => void} setVisible - hide = Interact mode + DOM preview reverted + host hidden; show = unhide + full re-render
 */

/**
 * Bootstraps the overlay: creates `<uce-root>` with its shadow root, wires
 * up state/persistence and every UI module. Guarded against double init.
 */
function initOverlay() {
  if (document.querySelector('uce-root')) return;
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', initOverlay, { once: true });
    return;
  }

  // --- proxy detection (contract: overlay script URL carries ?target=) ---
  const overlayUrl = new URL(import.meta.url);
  const proxyMode = overlayUrl.pathname.startsWith('/__uce/');
  const extensionMode = detectExtensionMode(import.meta.url);
  const targetParam = overlayUrl.searchParams.get('target');
  const targetHref = targetParam || location.href;
  let targetOrigin = location.origin;
  let targetPathname = location.pathname;
  try {
    const targetUrl = new URL(targetHref);
    targetOrigin = targetUrl.origin;
    targetPathname = targetUrl.pathname;
  } catch {
    // keep the location.* fallbacks
  }

  /** Locator/source URLs always use the target's origin, never the proxy's. */
  function getLocatorUrl() {
    return `${targetOrigin}${location.pathname}${location.search}${location.hash}`;
  }

  const storageKey = proxyMode ? `uce:${targetOrigin}${targetPathname}` : `uce:${location.pathname}`;

  // --- shadow root + layer ---
  const host = document.createElement('uce-root');
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = overlayStyles;
  shadow.appendChild(styleEl);

  const layer = document.createElement('div');
  layer.className = 'uce-layer';
  shadow.appendChild(layer);

  // --- persisted state ---
  let state = createState();
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) state = deserialize(raw);
  } catch {
    // localStorage unavailable (private mode, disabled, ...): in-memory only
  }

  function persist() {
    try {
      localStorage.setItem(storageKey, serialize(state));
    } catch {
      // ignore quota/availability errors
    }
  }

  // --- ephemeral UI state ---
  /** @type {Mode} */
  let mode = 'view';
  /** @type {Element|null} */
  let selection = null;
  /** @type {Element|null} */
  let editingElement = null;
  let panelVisible = false;
  let overlayVisible = true;
  /** @type {import('./preview.js').PreviewResult[]} */
  let lastPreviewResults = [];

  /**
   * Refreshes the shadow-root UI (panel fields/list, toolbar, boxes) from
   * the last known preview results — no DOM resolution/mutation of the
   * target page. Safe to call from the scroll/resize/MutationObserver
   * tracker: since it never touches the page DOM, it cannot re-trigger the
   * very mutation observer that called it.
   */
  function renderUiOnly() {
    if (selection && !selection.isConnected) selection = null;
    if (editingElement && !editingElement.isConnected) editingElement = null;
    panel.update(state, lastPreviewResults);
    toolbarApi.update(state);
    selectionApi.updateBoxes();
  }

  /**
   * Re-resolves every change's locator(s) against the current page DOM and
   * re-applies the preview, then refreshes the UI. This is the only path
   * that mutates the target page — never call it from the position
   * tracker (mutation loop), only after state changes or on an explicit
   * re-sync (dispatch, mode switch into edit, hashchange/popstate,
   * "Re-apply").
   */
  function renderFull() {
    if (!overlayVisible) return; // hidden: the page stays untouched until shown again
    lastPreviewResults = previewSync(state.changes, document);
    renderUiOnly();
  }

  /** @param {object} action */
  function dispatch(action) {
    const next = apply(state, action);
    if (next !== state) {
      state = next;
      persist();
    }
    renderFull();
  }

  /** @type {OverlayContext} */
  const ctx = {
    shadow,
    host,
    layer,
    proxyMode,
    extensionMode,
    targetOrigin,
    getLocatorUrl,
    createLocator: (el) => withOriginalDom(() => createLocator(el, { url: getLocatorUrl() })),
    getState: () => state,
    dispatch,
    getMode: () => mode,
    setMode: (m) => {
      if (mode === m) return;
      mode = m;
      if (m !== 'edit') {
        selection = null;
        editingElement = null;
      }
      if (m === 'edit') renderFull();
      else renderUiOnly();
    },
    getSelection: () => selection,
    setSelection: (el) => {
      selection = el;
      renderUiOnly();
    },
    getEditingElement: () => editingElement,
    setEditingElement: (el) => {
      editingElement = el;
      renderUiOnly();
    },
    isPanelVisible: () => panelVisible,
    togglePanel: () => {
      panelVisible = !panelVisible;
      panel.setVisible(panelVisible);
      renderUiOnly();
    },
    doExport: () => {
      runExport();
    },
    doCopy: () => {
      runCopy();
    },
    toast: (message, opts) => toolbarApi.showToast(message, opts),
    openPalette: () => openPalettePopover(ctx),
    openImportPopover: () => openImportPopover(ctx),
    startPlaceMode: (entry) => selectionApi.startPlaceMode(entry),
    resync: () => renderFull(),
    isVisible: () => overlayVisible,
    setVisible: (visible) => {
      const next = Boolean(visible);
      if (next === overlayVisible) return;
      overlayVisible = next;
      if (next) {
        host.style.removeProperty('display');
        renderFull();
      } else {
        if (editingElement) runAction('text-commit', ctx, editingElement);
        ctx.setMode('view');
        selectionApi.cancelPlaceMode();
        lastPreviewResults = previewSync([], document);
        host.style.setProperty('display', 'none', 'important');
      }
      if (extensionMode) void notifyVisibility(globalThis.chrome, next);
    },
  };

  const toolbarApi = createToolbar(ctx);
  const panel = createPanel(ctx);
  const selectionApi = createSelection(ctx);

  layer.appendChild(panel.markersLayerEl);
  layer.appendChild(selectionApi.hoverBoxEl);
  layer.appendChild(selectionApi.selectionBoxEl);
  layer.appendChild(panel.panelEl);
  layer.appendChild(toolbarApi.el);
  layer.appendChild(toolbarApi.toastEl);
  if (proxyMode) layer.appendChild(createForwardNotice(ctx).el);

  // Hover/selection boxes and markers must follow their target across
  // scroll, resize and DOM mutations (re-renders can move elements).
  // Position-only: neither call here may resolve a fresh locator (e.g. via
  // ctx.createLocator/panel's "selected element" section) — that mutates
  // the target page (see preview.js's withOriginalDom) and would re-trigger
  // this very MutationObserver-driven tracker, looping forever.
  const tracker = createPositionTracker(() => {
    // The app can remove the selected/edited element outright (e.g. a
    // re-render). Detect that here too, not only in renderUiOnly, since the
    // tracker never calls renderUiOnly (see comment above) — a full
    // panel.update() is still safe in this specific branch, since a null
    // selection never reaches ctx.createLocator.
    if (selection && !selection.isConnected) {
      selection = null;
      renderUiOnly();
      return;
    }
    if (editingElement && !editingElement.isConnected) {
      editingElement = null;
    }
    selectionApi.updateBoxes();
    panel.reposition();
  });

  // Hash-based SPA routes / history navigation can swap the visible view
  // without necessarily mutating the DOM in a way the tracker observes;
  // re-resolve every locator explicitly on these events.
  window.addEventListener('hashchange', () => renderFull());
  window.addEventListener('popstate', () => renderFull());

  /**
   * @returns {{ url: string, title: string, viewport: string, createdAt: string }}
   */
  function buildSource() {
    return {
      url: `${targetOrigin}${location.pathname}${location.search}`,
      title: document.title,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      createdAt: new Date().toISOString(),
    };
  }

  async function runExport() {
    const doc = buildDocument(state.changes, buildSource());
    const md = toMarkdown(doc);
    try {
      if (proxyMode) {
        const path = await postExport('/__uce/export', md);
        ctx.toast(t('toast.saved', { name: path }));
      } else if (extensionMode) {
        try {
          const { canceled } = await downloadViaExtension(globalThis.chrome, md);
          if (canceled) return;
        } catch {
          downloadMarkdown(md, 'ui-changes.md');
        }
        ctx.toast(t('toast.downloaded'));
      } else {
        downloadMarkdown(md, 'ui-changes.md');
        ctx.toast(t('toast.downloaded'));
      }
    } catch (err) {
      const message = err && /** @type {Error} */ (err).message ? /** @type {Error} */ (err).message : String(err);
      ctx.toast(t('toast.exportFailed', { name: message }), { error: true });
    }
  }

  async function runCopy() {
    const doc = buildDocument(state.changes, buildSource());
    const md = toMarkdown(doc);
    try {
      await copyText(md);
      ctx.toast(t('toast.copied'));
    } catch {
      ctx.toast(t('toast.copyFailed'), { error: true });
    }
  }

  // avoid an "unused" warning if a checker ever inlines tracker.destroy
  void tracker;

  // Debug/test hook only: exposes the context so test/overlay.test.js can
  // dispatch store actions directly without simulating pixel-level DOM
  // events (jsdom has no layout engine). Not part of the module's contract.
  if (typeof window !== 'undefined') {
    /** @type {any} */ (window).__uceOverlay = ctx;
  }

  // Extension content-script loader (extension/content/loader.js) toggles the
  // overlay through this, in the same isolated world; returns the new state.
  if (extensionMode) {
    /** @type {any} */ (window).__nudgitToggle = () => {
      ctx.setVisible(!overlayVisible);
      return overlayVisible;
    };
  }

  renderFull();
}

initOverlay();

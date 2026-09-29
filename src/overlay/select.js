// @ts-check
import { buildSelector } from './locator.js';
import { isEditableTarget, placeFloating } from './dom-utils.js';
import { runAction } from './actions/index.js';
import { createDragDrop } from './dnd.js';
import { t } from './i18n.js';

/**
 * @typedef {import('./index.js').OverlayContext} OverlayContext
 */

/** Event types intercepted on `window` (capture phase) while in edit mode. */
const BLOCKED_EVENT_TYPES = [
  'pointerdown', 'pointerup', 'pointermove',
  'mousedown', 'mouseup',
  'click', 'dblclick', 'auxclick', 'contextmenu',
  'touchstart', 'touchend',
  'dragstart', 'submit',
  'keydown', 'keyup', 'keypress',
  'input', 'change',
];

/** Keyboard/input event types that, inside the element currently being
 * inline-edited, are only stopped from bubbling to the app (no
 * preventDefault) so native typing keeps working. */
const EDITING_PASSTHROUGH_TYPES = [
  'keydown', 'keyup', 'keypress', 'input', 'change',
  'pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'dblclick',
];

/**
 * Creates the hover/selection overlay boxes and the capture-phase event
 * interception that makes edit mode possible: hovering highlights elements,
 * clicking selects them, and everything else is kept from reaching the app.
 * Box positions are refreshed by calling `updateBoxes()` (index.js wires
 * this to its shared scroll/resize/mutation position tracker).
 * @param {OverlayContext} ctx
 * @returns {{ hoverBoxEl: HTMLElement, selectionBoxEl: HTMLElement, updateBoxes: () => void, startPlaceMode: (entry: import('./palette.js').PaletteEntry) => void, cancelPlaceMode: () => void }}
 */
export function createSelection(ctx) {
  const doc = ctx.shadow.ownerDocument;
  const win = doc.defaultView || window;

  const hoverBoxEl = createBox(doc, 'uce-hoverbox');
  const selectionBoxEl = createBox(doc, 'uce-selectionbox');
  const dnd = createDragDrop(ctx);
  const quickEl = createQuickActions(doc);

  /** @type {Element|null} */
  let hoveredEl = null;
  let suppressClick = false;

  function updateBoxes() {
    const isEdit = ctx.getMode() === 'edit';
    const sel = ctx.getSelection();
    positionBox(hoverBoxEl, isEdit && !dnd.isActive() ? hoveredEl : null, shortLabel);
    positionBox(selectionBoxEl, sel, shortLabel);
    quickEl.hidden = !isEdit || !sel || Boolean(ctx.getEditingElement()) || dnd.isActive();
    if (sel && !quickEl.hidden) {
      if (!quickEl.isConnected) ctx.layer.appendChild(quickEl);
      const rect = sel.getBoundingClientRect();
      const size = { width: quickEl.offsetWidth || 100, height: quickEl.offsetHeight || 36 };
      // above: leave room for the selection label
      const pos = placeFloating(rect, size, { width: win.innerWidth, height: win.innerHeight }, { gapAbove: 24 });
      quickEl.style.left = `${pos.left}px`;
      quickEl.style.top = `${pos.top}px`;
    }
  }

  // --- quick actions at the selection: rename, move (drag handle), comment ---
  quickEl.addEventListener('pointerdown', (e) => {
    const btn = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('[data-quick]'));
    const sel = ctx.getSelection();
    e.preventDefault(); // keep focus where it is
    if (!btn || !sel) return;
    const kind = btn.dataset.quick;
    if (kind === 'move') {
      // the handle captures the pointer and feeds the gesture into drag & drop
      btn.setPointerCapture(e.pointerId);
      dnd.armPotentialDrag(sel, e);
      return;
    }
  });
  // rename/comment fire on click, so pointerdown and pointerup both stay on the bar
  quickEl.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('[data-quick]'));
    const sel = ctx.getSelection();
    if (!btn || !sel || btn.dataset.quick === 'move') return;
    runAction(btn.dataset.quick === 'rename' ? 'text' : 'comment', ctx, sel, e);
    updateBoxes();
  });
  quickEl.addEventListener('pointermove', (e) => {
    if (dnd.handlePointerMove(e)) updateBoxes();
  });
  quickEl.addEventListener('pointerup', (e) => {
    const wasDragging = dnd.isDragging();
    dnd.handlePointerUp(e);
    const btn = /** @type {Element} */ (e.target).closest('[data-quick="move"]');
    if (btn && !wasDragging) ctx.toast(t('toast.moveHint'));
    updateBoxes();
  });

  /** @param {Element} el */
  function shortLabel(el) {
    let selector = '';
    try {
      selector = buildSelector(el);
    } catch {
      selector = '';
    }
    const tag = el.tagName.toLowerCase();
    return selector ? `${tag} · ${selector}` : tag;
  }

  /**
   * @param {Event} e
   * @returns {any[]}
   */
  function pathOf(e) {
    return typeof (/** @type {any} */ (e).composedPath) === 'function'
      ? /** @type {any} */ (e).composedPath()
      : e.target
        ? [e.target]
        : [];
  }

  /** @param {Event} e */
  function isOverlayEvent(e) {
    return pathOf(e).includes(ctx.host);
  }

  /**
   * True if the event's target is a real text-input surface inside the
   * overlay (a panel field, the palette search box, a popover textarea):
   * typing there must reach it normally. A plain focused overlay *button*
   * (e.g. right after clicking a toolbar action) does not count — global
   * keyboard shortcuts (Delete/Enter/Alt+↑↓/Cmd+D/…) must still reach the
   * page selection even though focus happens to be sitting on our own UI,
   * otherwise every shortcut breaks the moment the user clicks a button.
   * @param {Event} e
   */
  function isEditableOverlayTarget(e) {
    const target = resolveTarget(e);
    if (!target) return false;
    if (isEditableTarget(target)) return true;
    // Enter/Space have a native "activate" behaviour on a focused
    // button-like control (e.g. tabbing to "Undo" and pressing
    // Enter) — never hijack that for the page-selection shortcut.
    const key = /** @type {KeyboardEvent} */ (e).key;
    return key === 'Enter' || key === ' ';
  }

  /** @param {Event} e */
  function isWithinEditingElement(e) {
    const editingEl = ctx.getEditingElement();
    if (!editingEl) return false;
    return pathOf(e).includes(editingEl);
  }

  /**
   * @param {Event} e
   * @returns {Element|null}
   */
  function resolveTarget(e) {
    const path = pathOf(e);
    for (const node of path) {
      if (node && /** @type {Node} */ (node).nodeType === 1) return /** @type {Element} */ (node);
    }
    return null;
  }

  /** @param {Event} e */
  function handleEditingPassthrough(e) {
    if (e.type === 'keydown') {
      const ke = /** @type {KeyboardEvent} */ (e);
      if (ke.key === 'Enter' && !ke.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        runAction('text-commit', ctx, /** @type {Element} */ (ctx.getEditingElement()), e);
        return;
      }
      if (ke.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        runAction('text-cancel', ctx, /** @type {Element} */ (ctx.getEditingElement()), e);
        return;
      }
    }
    // plain typing / input / change: keep the app from seeing it, but let
    // the browser's native contenteditable behaviour run (no preventDefault)
    e.stopPropagation();
  }

  /** @param {KeyboardEvent} e */
  function handleKeydown(e) {
    if (e.key === 'Escape') {
      if (dnd.consumeEscape()) return;
      ctx.setSelection(null);
      return;
    }
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (plain && (e.key === 'e' || e.key === 'E')) {
      ctx.setMode('view');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      ctx.dispatch({ type: 'undo' });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
      ctx.dispatch({ type: 'redo' });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') {
      const selForDup = ctx.getSelection();
      if (selForDup) runAction('duplicate', ctx, selForDup, e);
      return;
    }
    if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const selForMove = ctx.getSelection();
      if (selForMove) runAction(e.key === 'ArrowUp' ? 'move-up' : 'move-down', ctx, selForMove, e);
      return;
    }
    if (plain && (e.key === 'a' || e.key === 'A')) {
      ctx.openPalette();
      return;
    }
    if (e.shiftKey && e.key === 'ArrowUp') {
      const sel = ctx.getSelection();
      if (sel && sel !== doc.body && sel.parentElement) {
        ctx.setSelection(sel.parentElement);
      }
      return;
    }
    if (e.shiftKey && e.key === 'ArrowDown') {
      const sel = ctx.getSelection();
      if (sel && sel.firstElementChild) {
        ctx.setSelection(sel.firstElementChild);
      }
      return;
    }
    const sel = ctx.getSelection();
    if (!sel) return;
    if (!plain) return;
    if (e.key === 'Enter') {
      runAction('text', ctx, sel, e);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      runAction('remove', ctx, sel, e);
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      runAction('comment', ctx, sel, e);
      return;
    }
  }

  /** @param {Event} e */
  function onIntercept(e) {
    if (ctx.getMode() !== 'edit') return;
    if (isOverlayEvent(e)) {
      // Global shortcuts (Delete/Enter/Alt+↑↓/Cmd+D/Cmd+Z/…) act on the page
      // selection, not on the overlay, so a keydown must still reach
      // handleKeydown() even when focus is stuck on a plain overlay button
      // (e.g. right after clicking a toolbar action) — only bail out here
      // when the focused overlay element is itself a text input that needs
      // the keystroke (a panel field, the palette search box, a popover).
      if (e.type !== 'keydown' || isEditableOverlayTarget(e)) return;
    }

    if (EDITING_PASSTHROUGH_TYPES.includes(e.type) && isWithinEditingElement(e)) {
      handleEditingPassthrough(e);
      return;
    }
    // pointer down outside the inline editor commits the running edit
    if (e.type === 'pointerdown' && ctx.getEditingElement()) {
      runAction('text-commit', ctx, /** @type {Element} */ (ctx.getEditingElement()), e);
    }

    e.preventDefault();
    e.stopPropagation();

    if (e.type === 'pointerdown') {
      suppressClick = false;
      const el = resolveTarget(e);
      if (el && el === ctx.getSelection()) {
        dnd.armPotentialDrag(el, /** @type {PointerEvent} */ (e));
      }
      return;
    }
    if (e.type === 'pointerup') {
      // the click after a drop lands on a common ancestor – don't select it
      suppressClick = dnd.isDragging();
      dnd.handlePointerUp(/** @type {PointerEvent} */ (e));
      return;
    }
    if (e.type === 'pointermove') {
      if (dnd.handlePointerMove(/** @type {PointerEvent} */ (e))) return;
      const el = resolveTarget(e);
      if (el !== hoveredEl) {
        hoveredEl = el;
        updateBoxes();
      }
      return;
    }
    if (e.type === 'click') {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (dnd.isPlacing()) {
        dnd.placeAt(/** @type {PointerEvent} */ (e));
        return;
      }
      const el = resolveTarget(e);
      if (el) ctx.setSelection(el);
      return;
    }
    if (e.type === 'dblclick') {
      const el = resolveTarget(e) || ctx.getSelection();
      if (el) {
        ctx.setSelection(el);
        runAction('text', ctx, el, e);
      }
      return;
    }
    if (e.type === 'keydown') {
      handleKeydown(/** @type {KeyboardEvent} */ (e));
    }
  }

  for (const type of BLOCKED_EVENT_TYPES) {
    win.addEventListener(type, onIntercept, true);
  }

  return {
    hoverBoxEl,
    selectionBoxEl,
    updateBoxes,
    startPlaceMode: dnd.startPlaceMode,
    cancelPlaceMode: dnd.cancel,
  };
}

/**
 * @param {Document} doc
 * @param {string} className
 * @returns {HTMLElement}
 */
function createBox(doc, className) {
  const box = doc.createElement('div');
  box.className = className;
  const label = doc.createElement('div');
  label.className = 'uce-box-label';
  box.appendChild(label);
  return box;
}

/**
 * Small icon bar attached to the selection box. The titles are read via
 * `t()` here (not as a module-level constant) so they pick up the language
 * in effect when the overlay initializes.
 * @param {Document} doc
 * @returns {HTMLElement}
 */
function createQuickActions(doc) {
  const bar = doc.createElement('div');
  bar.className = 'uce-quick';
  bar.hidden = true;
  const quickActions = [
    { kind: 'rename', title: t('quick.rename'), icon: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>' },
    { kind: 'move', title: t('quick.move'), icon: '<path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>' },
    { kind: 'comment', title: t('quick.comment'), icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
  ];
  for (const { kind, title, icon } of quickActions) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.className = 'uce-quick-btn';
    btn.dataset.quick = kind;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
    bar.appendChild(btn);
  }
  return bar;
}

/**
 * @param {HTMLElement} box
 * @param {Element|null} el
 * @param {(el: Element) => string} labelText
 */
function positionBox(box, el, labelText) {
  if (!el || !el.isConnected) {
    box.style.display = 'none';
    return;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
  const label = box.firstElementChild;
  if (label) {
    label.textContent = labelText(el);
    label.classList.toggle('uce-box-label-inside', rect.top < 22);
  }
}

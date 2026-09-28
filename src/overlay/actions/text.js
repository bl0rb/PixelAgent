// @ts-check
import { setElementText, getInsertRoot } from '../dom-utils.js';

/**
 * @typedef {import('../index.js').OverlayContext} OverlayContext
 */

/** @type {{ el: Element, before: string, locator: import('../locator.js').Locator|null, insertId: number|null }|null} */
let activeEdit = null;

/**
 * @param {string|null|undefined} s
 * @returns {string}
 */
function normalizeText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve the element that should become contenteditable: for a dblclick,
 * the parent of the exact text node under the pointer (via
 * caretRangeFromPoint/caretPositionFromPoint); otherwise the already
 * selected element itself.
 * @param {Element} el
 * @param {Event} [event]
 * @returns {Element}
 */
function resolveEditTarget(el, event) {
  if (event && event.type === 'dblclick') {
    const me = /** @type {MouseEvent} */ (event);
    const doc = el.ownerDocument;
    try {
      if (typeof (/** @type {any} */ (doc).caretRangeFromPoint) === 'function') {
        const range = /** @type {any} */ (doc).caretRangeFromPoint(me.clientX, me.clientY);
        const node = range && range.startContainer;
        const parent = node && (node.nodeType === 3 ? node.parentElement : node);
        if (parent) return parent;
      } else if (typeof (/** @type {any} */ (doc).caretPositionFromPoint) === 'function') {
        const pos = /** @type {any} */ (doc).caretPositionFromPoint(me.clientX, me.clientY);
        const node = pos && pos.offsetNode;
        const parent = node && (node.nodeType === 3 ? node.parentElement : node);
        if (parent) return parent;
      }
    } catch {
      // fall through to the given element
    }
  }
  return el;
}

/**
 * @param {Element} target
 */
function applyContentEditable(target) {
  const el = /** @type {HTMLElement} */ (target);
  try {
    el.contentEditable = 'plaintext-only';
  } catch {
    // ignore; checked below
  }
  if (el.contentEditable !== 'plaintext-only' && el.contentEditable !== 'true') {
    el.setAttribute('contenteditable', 'true');
  }
}

/**
 * @param {Element} target
 */
function selectAllText(target) {
  const doc = target.ownerDocument;
  const win = doc.defaultView;
  if (!win || typeof win.getSelection !== 'function') return;
  const range = doc.createRange();
  range.selectNodeContents(target);
  const sel = win.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Starts inline text editing, triggered by double-click or Enter on a
 * selection. No-op if already editing something.
 * @param {OverlayContext} ctx
 * @param {Element} el
 * @param {Event} [event]
 */
export function startTextEdit(ctx, el, event) {
  if (ctx.getEditingElement()) return;
  const target = resolveEditTarget(el, event);
  const before = normalizeText(target.textContent);
  // Preview clones (insert changes) have no locator of their own — the edit
  // maps to that change's `text` field instead (see commitTextEdit).
  const insertRoot = getInsertRoot(target);
  const insertId = insertRoot ? Number(insertRoot.getAttribute('data-uce-insert')) : null;
  // capture the locator before editing so name/text/html describe the original
  const locator = insertRoot ? null : ctx.createLocator(target);
  applyContentEditable(target);
  /** @type {HTMLElement} */ (target).focus();
  selectAllText(target);
  ctx.setEditingElement(target);
  activeEdit = { el: target, before, locator, insertId };
}

/**
 * @param {OverlayContext} ctx
 * @param {Element|null} target
 */
function finishEditing(ctx, target) {
  if (target) {
    target.removeAttribute('contenteditable');
  }
  ctx.setEditingElement(null);
  activeEdit = null;
}

/**
 * Commits the inline edit (Enter): dispatches a `text` change if the
 * normalized text actually changed, then removes contenteditable.
 * @param {OverlayContext} ctx
 */
export function commitTextEdit(ctx) {
  const target = ctx.getEditingElement();
  if (!target || !activeEdit || activeEdit.el !== target) {
    finishEditing(ctx, target);
    return;
  }
  const { before, locator, insertId } = activeEdit;
  const after = normalizeText(target.textContent);
  finishEditing(ctx, target);
  if (after === before) return;
  if (insertId != null) {
    ctx.dispatch({ type: 'update', id: insertId, patch: { text: after } });
    return;
  }
  ctx.dispatch({ type: 'add', change: { type: 'text', target: locator, before, after } });
}

/**
 * Cancels the inline edit (Esc): restores the original text.
 * @param {OverlayContext} ctx
 */
export function cancelTextEdit(ctx) {
  const target = ctx.getEditingElement();
  if (target && activeEdit && activeEdit.el === target) {
    setElementText(target, activeEdit.before);
  }
  finishEditing(ctx, target);
}

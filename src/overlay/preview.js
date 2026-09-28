// @ts-check
import { resolveLocator } from './locator.js';
import { findLabelElement, setElementText, findTextBearingElement, isBeingEdited } from './dom-utils.js';

/**
 * @typedef {import('./changes.js').Change} Change
 * @typedef {{ change: Change, el: Element|null, found: boolean }} PreviewResult
 */

/** @type {Array<() => void>} */
let pendingReverts = [];

/** Clones created for `insert` changes, keyed by change id, reused across
 * syncs so element identity (selection, in-progress edits) survives a
 * revert+reapply cycle instead of being recreated from scratch. */
/** @type {Map<number, Element>} */
const cloneCache = new Map();

/** Last changes/doc passed to `sync`, used by `withOriginalDom` to restore
 * the preview after it reverts everything. */
let lastChanges = /** @type {Change[]} */ ([]);
let lastDoc = /** @type {Document|undefined} */ (undefined);

/**
 * Revert everything currently applied to the DOM, in reverse order.
 */
function revertAll() {
  for (let i = pendingReverts.length - 1; i >= 0; i--) {
    try {
      pendingReverts[i]();
    } catch {
      // target may have been removed/replaced by the app itself; ignore
    }
  }
  pendingReverts = [];
}

/**
 * Re-apply every change to the live DOM as a preview. Elements are resolved
 * fresh on every call (the app may have re-rendered between syncs), after
 * first reverting whatever the previous sync applied.
 * @param {Change[]} changes
 * @param {Document} [doc]
 * @returns {PreviewResult[]}
 */
export function sync(changes, doc = document) {
  lastChanges = changes;
  lastDoc = doc;
  revertAll();
  return applyAll(changes, doc);
}

/**
 * Temporarily reverts every preview mutation (moves back to their original
 * DOM position, insert clones removed), runs `fn()` synchronously against
 * the plain original DOM, then re-applies the current changes again. Used by
 * `ctx.createLocator` (design decision: locators always describe the
 * original DOM, never a moved/preview state) — safe for moves, since moved
 * nodes keep their identity; never called on insert-preview clones, which
 * have no original-DOM position at all.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function withOriginalDom(fn) {
  revertAll();
  try {
    return fn();
  } finally {
    applyAll(lastChanges, lastDoc || document);
  }
}

/**
 * @param {Change[]} changes
 * @param {Document} doc
 * @returns {PreviewResult[]}
 */
function applyAll(changes, doc) {
  // resolve every locator against the untouched original DOM first: earlier
  // moves would otherwise shift the nth-of-type selectors of later changes
  const resolved = changes.map((change) => {
    const targetLocator = change.type === 'insert' ? change.template : change.target;
    return {
      targetEl: targetLocator ? resolveLocator(targetLocator, doc) : null,
      anchorEl: 'anchor' in change && change.anchor ? resolveLocator(change.anchor, doc) : null,
    };
  });
  return changes.map((change, i) => applyOne(change, resolved[i]));
}

/**
 * @param {Change} change
 * @param {{ targetEl: Element|null, anchorEl: Element|null }} resolved
 * @returns {PreviewResult}
 */
function applyOne(change, { targetEl, anchorEl }) {
  const type = change.type;
  if (!targetEl) return { change, el: null, found: false };

  try {
    if (type === 'text') {
      applyText(targetEl, change.before, change.after);
      return { change, el: targetEl, found: true };
    }
    if (type === 'attr') {
      applyAttr(targetEl, change.attr, change.before, change.after);
      return { change, el: targetEl, found: true };
    }
    if (type === 'move') {
      if (!anchorEl) return { change, el: targetEl, found: false };
      applyMove(targetEl, anchorEl, change.position);
      return { change, el: targetEl, found: true };
    }
    if (type === 'insert') {
      if (!anchorEl) return { change, el: null, found: false };
      const clone = applyInsert(change, targetEl, anchorEl);
      return { change, el: clone, found: true };
    }
  } catch {
    // a single bad change should never break the rest of the preview
    return { change, el: type === 'insert' ? null : targetEl, found: false };
  }
  // 'remove' → never mutates the target; the tracked overlay box drawn by
  //   panel.js's marker layer (from this function's return value) shows it.
  // 'comment' → nothing in the DOM.
  return { change, el: targetEl, found: true };
}

/**
 * Reverts to the change's own `before` value rather than a DOM snapshot
 * taken at apply-time: for text edits in particular, the live contenteditable
 * interaction already mutates the target's real text node as the user types,
 * so by the time this runs the "current" DOM no longer reflects the true
 * original — only the change object still knows it.
 * @param {Element} el
 * @param {string} before
 * @param {string} after
 */
function applyText(el, before, after) {
  if (!isBeingEdited(el)) setElementText(el, after);
  pendingReverts.push(() => {
    if (!isBeingEdited(el)) setElementText(el, before);
  });
}

/**
 * @param {Element} el
 * @param {string} attr
 * @param {string} before
 * @param {string} after
 */
function applyAttr(el, attr, before, after) {
  if (attr === 'value') {
    /** @type {HTMLInputElement} */ (el).value = after;
    pendingReverts.push(() => {
      /** @type {HTMLInputElement} */ (el).value = before;
    });
    return;
  }
  if (attr === 'label') {
    const label = findLabelElement(el);
    if (!label) return;
    setElementText(label, after);
    pendingReverts.push(() => setElementText(label, before));
    return;
  }
  // placeholder | title | aria-label | alt
  setOrRemoveAttr(el, attr, after);
  pendingReverts.push(() => setOrRemoveAttr(el, attr, before));
}

/**
 * @param {Element} el
 * @param {string} attr
 * @param {string} value
 */
function setOrRemoveAttr(el, attr, value) {
  if (value === '' || value == null) el.removeAttribute(attr);
  else el.setAttribute(attr, value);
}

/**
 * Inserts `el` relative to `anchorEl` per `position`. Shared by move and
 * insert previews.
 * @param {Element} el
 * @param {Element} anchorEl
 * @param {import('./changes.js').Position} position
 */
function insertRelative(el, anchorEl, position) {
  if (position === 'before' || position === 'after') {
    const parent = anchorEl.parentNode;
    if (!parent) throw new Error('anchor detached');
    parent.insertBefore(el, position === 'before' ? anchorEl : anchorEl.nextSibling);
    return;
  }
  if (position === 'inside-start') {
    anchorEl.insertBefore(el, anchorEl.firstChild);
    return;
  }
  // inside-end
  anchorEl.appendChild(el);
}

/**
 * Moves an already-in-DOM element for the preview (`move` changes never
 * clone — the node keeps its identity). Reverts to its exact previous
 * parent + next-sibling.
 * @param {Element} el
 * @param {Element} anchorEl
 * @param {import('./changes.js').Position} position
 */
function applyMove(el, anchorEl, position) {
  if (el === anchorEl || el.contains(anchorEl)) return;
  const parent = el.parentNode;
  if (!parent) return;
  const nextSibling = el.nextSibling;
  insertRelative(el, anchorEl, position);
  pendingReverts.push(() => {
    if (nextSibling && nextSibling.parentNode === parent) {
      parent.insertBefore(el, nextSibling);
    } else {
      parent.appendChild(el);
    }
  });
}

/**
 * Creates (or reuses) the preview clone for an `insert` change: deep clone
 * of the resolved template, all `id` attributes stripped, marked with
 * `data-uce-insert="<change id>"`, text set on the text-bearing element.
 * The clone is cached by change id so repeated syncs reuse the same node
 * (identity matters: it may be selected or mid-inline-edit).
 * @param {Extract<Change, {type:'insert'}>} change
 * @param {Element} templateEl
 * @param {Element} anchorEl
 * @returns {Element}
 */
function applyInsert(change, templateEl, anchorEl) {
  let clone = cloneCache.get(change.id);
  if (!clone || clone.ownerDocument !== templateEl.ownerDocument) {
    clone = /** @type {Element} */ (templateEl.cloneNode(true));
    stripIds(clone);
    clone.setAttribute('data-uce-insert', String(change.id));
    cloneCache.set(change.id, clone);
  }
  const textEl = findTextBearingElement(clone) || clone;
  if (!isBeingEdited(textEl)) setElementText(textEl, change.text);
  insertRelative(clone, anchorEl, change.position);
  pendingReverts.push(() => {
    if (clone && clone.parentNode) clone.parentNode.removeChild(clone);
  });
  return clone;
}

/**
 * @param {Element} root
 */
function stripIds(root) {
  root.removeAttribute('id');
  for (const el of Array.from(root.querySelectorAll('[id]'))) el.removeAttribute('id');
}

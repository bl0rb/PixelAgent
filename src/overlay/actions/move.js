// @ts-check
import { getInsertRoot } from '../dom-utils.js';
import { t } from '../i18n.js';

/**
 * @typedef {import('../index.js').OverlayContext} OverlayContext
 * @typedef {import('../changes.js').Position} Position
 */

/**
 * Swaps the selection with its previous sibling (`Alt+↑`).
 * @param {OverlayContext} ctx
 * @param {Element} el
 */
export function moveUp(ctx, el) {
  const sibling = el.previousElementSibling;
  if (!sibling) return;
  dispatchMove(ctx, el, sibling, 'before');
}

/**
 * Swaps the selection with its next sibling (`Alt+↓`).
 * @param {OverlayContext} ctx
 * @param {Element} el
 */
export function moveDown(ctx, el) {
  const sibling = el.nextElementSibling;
  if (!sibling) return;
  dispatchMove(ctx, el, sibling, 'after');
}

/**
 * Dispatches a structural move: for a plain element this is a `move` change
 * (reducer merges repeated moves of the same target); for an insert-preview
 * clone there is no `move` change at all — the owning `insert` change's own
 * anchor/position is updated instead. Used by both the keyboard shortcuts
 * above and drag & drop (dnd.js).
 * @param {OverlayContext} ctx
 * @param {Element} el
 * @param {Element} anchorEl
 * @param {Position} position
 */
export function dispatchMove(ctx, el, anchorEl, position) {
  const anchorInsertRoot = getInsertRoot(anchorEl);
  if (anchorInsertRoot && anchorInsertRoot !== el) {
    // The drop anchor is itself an unresolvable preview clone: nothing in
    // the original DOM to point at. Known gap — silently ignored.
    ctx.toast(t('toast.moveNextToNewElementImpossible'), { error: true });
    return;
  }
  const anchor = ctx.createLocator(anchorEl);
  const ownInsertRoot = getInsertRoot(el);
  if (ownInsertRoot) {
    const id = Number(ownInsertRoot.getAttribute('data-uce-insert'));
    ctx.dispatch({ type: 'update', id, patch: { anchor, position } });
    return;
  }
  const target = ctx.createLocator(el);
  ctx.dispatch({ type: 'add', change: { type: 'move', target, anchor, position } });
}

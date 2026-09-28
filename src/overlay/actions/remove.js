// @ts-check
import { findChange } from '../changes.js';
import { getInsertRoot } from '../dom-utils.js';

/**
 * @typedef {import('../index.js').OverlayContext} OverlayContext
 */

/**
 * Entf/Backspace toggles a `remove` change on the selected element: adds one
 * if none exists yet, deletes the existing one otherwise. Never touches the
 * DOM directly (preview.js draws the dimmed overlay box instead). On an
 * insert-preview clone there is nothing to strike through — it was never
 * "real" — so this deletes the owning `insert` change outright, which drops
 * the clone from the preview entirely.
 * @param {OverlayContext} ctx
 * @param {Element} el
 */
export function toggleRemove(ctx, el) {
  const insertRoot = getInsertRoot(el);
  if (insertRoot) {
    const id = Number(insertRoot.getAttribute('data-uce-insert'));
    ctx.setSelection(null);
    ctx.dispatch({ type: 'delete', id });
    return;
  }
  const locator = ctx.createLocator(el);
  const existing = findChange(ctx.getState(), 'remove', locator);
  if (existing) {
    ctx.dispatch({ type: 'delete', id: existing.id });
  } else {
    ctx.dispatch({ type: 'add', change: { type: 'remove', target: locator } });
  }
}

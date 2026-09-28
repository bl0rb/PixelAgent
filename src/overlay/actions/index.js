// @ts-check
import { startTextEdit, commitTextEdit, cancelTextEdit } from './text.js';
import { openCommentPopover } from './comment.js';
import { toggleRemove } from './remove.js';
import { moveUp, moveDown } from './move.js';
import { duplicateElement } from './duplicate.js';

/**
 * @typedef {import('../index.js').OverlayContext} OverlayContext
 */

/**
 * Registry of edit-mode actions available on the current selection, keyed by
 * name. select.js's central event interceptor owns *when* an action fires
 * (which key or gesture triggers it); this registry owns *what* happens.
 *
 * This is the extension point for phase 5 (move/duplicate/insert/palette):
 * new entries get added here (e.g. `move`, `duplicate`, `insert`) without
 * changing select.js's dispatch mechanism.
 * @type {Record<string, (ctx: OverlayContext, el: Element, event?: Event) => void>}
 */
export const actionRegistry = {
  text: startTextEdit,
  'text-commit': (ctx) => commitTextEdit(ctx),
  'text-cancel': (ctx) => cancelTextEdit(ctx),
  comment: openCommentPopover,
  remove: toggleRemove,
  'move-up': moveUp,
  'move-down': moveDown,
  duplicate: duplicateElement,
  // insert: handled by palette.js's own place-mode, not the selection registry
};

/**
 * @param {string} name
 * @param {OverlayContext} ctx
 * @param {Element} el
 * @param {Event} [event]
 */
export function runAction(name, ctx, el, event) {
  const action = actionRegistry[name];
  if (action) action(ctx, el, event);
}

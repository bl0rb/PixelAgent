// @ts-check
import { startTextEdit } from './text.js';
import { getInsertRoot, findTextBearingElement } from '../dom-utils.js';
import { t } from '../i18n.js';

/**
 * @typedef {import('../index.js').OverlayContext} OverlayContext
 */

/**
 * `Cmd/Ctrl+D`: duplicates the selection right after itself (template =
 * anchor = the original element), then immediately starts inline text
 * editing on the clone with all text selected. Not possible on an
 * already-inserted clone (it has no original-DOM locator to serve as a
 * template).
 * @param {OverlayContext} ctx
 * @param {Element} el
 */
export function duplicateElement(ctx, el) {
  if (getInsertRoot(el)) {
    ctx.toast(t('toast.notPossibleForNewElements'), { error: true });
    return;
  }
  const locator = ctx.createLocator(el);
  const text = locator.text || '';
  ctx.dispatch({
    type: 'add',
    change: { type: 'insert', template: locator, anchor: locator, position: 'after', text },
  });

  const { changes } = ctx.getState();
  const created = changes[changes.length - 1];
  if (!created || created.type !== 'insert') return;
  const doc = el.ownerDocument;
  const clone = doc.querySelector(`[data-uce-insert="${created.id}"]`);
  if (!clone) return;
  ctx.setSelection(clone);
  const textEl = findTextBearingElement(clone) || clone;
  startTextEdit(ctx, textEl);
}

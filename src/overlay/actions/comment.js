// @ts-check
import { findChange } from '../changes.js';
import { getInsertRoot } from '../dom-utils.js';
import { t } from '../i18n.js';

/**
 * @typedef {import('../index.js').OverlayContext} OverlayContext
 */

/** @type {HTMLElement|null} */
let openPopoverEl = null;

/**
 * Closes the currently open comment popover, if any.
 */
export function closeCommentPopover() {
  if (openPopoverEl && openPopoverEl.parentNode) {
    openPopoverEl.parentNode.removeChild(openPopoverEl);
  }
  openPopoverEl = null;
}

/**
 * Opens a small popover with a textarea near the element (key `C`),
 * prefilled with an existing comment. Save (Cmd/Ctrl+Enter) dispatches a
 * `comment` change; Cancel (Esc) discards.
 * @param {OverlayContext} ctx
 * @param {Element} el
 */
export function openCommentPopover(ctx, el) {
  if (getInsertRoot(el)) {
    ctx.toast(t('toast.notPossibleForNewElements'), { error: true });
    return;
  }
  closeCommentPopover();
  const doc = ctx.shadow.ownerDocument;
  const locator = ctx.createLocator(el);
  const existing = findChange(ctx.getState(), 'comment', locator);

  const popover = doc.createElement('div');
  popover.className = 'uce-popover';

  const textarea = doc.createElement('textarea');
  textarea.value = existing ? existing.note : '';
  textarea.placeholder = t('comment.placeholder');

  const actionsRow = doc.createElement('div');
  actionsRow.className = 'uce-popover-actions';
  const cancelBtn = doc.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'uce-btn';
  cancelBtn.textContent = t('common.cancel');
  const saveBtn = doc.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'uce-btn uce-primary';
  saveBtn.textContent = t('common.save');

  function save() {
    const note = textarea.value;
    const target = ctx.createLocator(el);
    ctx.dispatch({ type: 'add', change: { type: 'comment', target, note } });
    closeCommentPopover();
  }

  saveBtn.addEventListener('click', save);
  cancelBtn.addEventListener('click', () => closeCommentPopover());
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeCommentPopover();
    }
  });

  actionsRow.append(cancelBtn, saveBtn);
  popover.append(textarea, actionsRow);

  const rect = el.getBoundingClientRect();
  popover.style.left = `${Math.max(8, rect.left)}px`;
  popover.style.top = `${rect.bottom + 6}px`;

  ctx.layer.appendChild(popover);
  openPopoverEl = popover;
  textarea.focus();
  textarea.select();
}

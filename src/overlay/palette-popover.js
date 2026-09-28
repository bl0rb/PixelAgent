// @ts-check
import { scanPalette } from './palette.js';
import { t } from './i18n.js';

/**
 * @typedef {import('./index.js').OverlayContext} OverlayContext
 */

/** @type {HTMLElement|null} */
let openPopoverEl = null;

/**
 * Closes the currently open palette popover, if any.
 */
export function closePalettePopover() {
  if (openPopoverEl && openPopoverEl.parentNode) {
    openPopoverEl.parentNode.removeChild(openPopoverEl);
  }
  openPopoverEl = null;
}

/**
 * Opens the searchable "Add" palette (toolbar button or key `A`): scans the
 * page for elements of the same kind, lets the user search/pick one, then
 * hands off to place mode (dnd.js) so the next click on the page positions
 * the new element.
 * @param {OverlayContext} ctx
 */
export function openPalettePopover(ctx) {
  closePalettePopover();
  const doc = ctx.shadow.ownerDocument;
  const entries = scanPalette(doc);

  const popover = doc.createElement('div');
  popover.className = 'uce-popover uce-palette-popover';

  const search = doc.createElement('input');
  search.type = 'text';
  search.placeholder = t('palette.searchPlaceholder');

  const list = doc.createElement('ul');
  list.className = 'uce-palette-list';

  /** @param {string} filter */
  function render(filter) {
    list.innerHTML = '';
    const f = filter.trim().toLowerCase();
    const filtered = f ? entries.filter((entry) => entry.label.toLowerCase().includes(f)) : entries;
    if (filtered.length === 0) {
      const empty = doc.createElement('li');
      empty.className = 'uce-empty';
      empty.textContent = t('palette.noResults');
      list.appendChild(empty);
      return;
    }
    for (const entry of filtered) {
      const li = doc.createElement('li');
      li.textContent = entry.label;
      li.addEventListener('click', () => {
        closePalettePopover();
        ctx.startPlaceMode(entry);
        ctx.toast(t('toast.placeHint'));
      });
      list.appendChild(li);
    }
  }

  search.addEventListener('input', () => render(search.value));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePalettePopover();
    }
  });

  popover.append(search, list);
  ctx.layer.appendChild(popover);
  openPopoverEl = popover;
  render('');
  search.focus();

  if (entries.length === 0) {
    ctx.toast(t('toast.noSimilarElements'));
  }
}

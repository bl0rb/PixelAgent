// @ts-check
import { dispatchMove } from './actions/move.js';
import { startTextEdit } from './actions/text.js';
import { findTextBearingElement } from './dom-utils.js';
import { t } from './i18n.js';

/**
 * @typedef {import('./index.js').OverlayContext} OverlayContext
 * @typedef {import('./changes.js').Position} Position
 * @typedef {import('./palette.js').PaletteEntry} PaletteEntry
 */

const VOID_TAGS = new Set(['input', 'img', 'br', 'hr', 'area', 'base', 'col', 'embed', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const NO_INSIDE_TAGS = new Set(['input', 'textarea', 'select', 'option', 'button', 'img', 'br', 'hr']);

/** @param {Element} el */
function canContainChildren(el) {
  const tag = el.tagName.toLowerCase();
  return !VOID_TAGS.has(tag) && !NO_INSIDE_TAGS.has(tag);
}

/**
 * @param {Element} el
 */
function placeholderTextFor(el) {
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'select' || tag === 'textarea' ? '' : t('type.insert');
}

/**
 * Drag & drop (moving the selection) and palette "place mode" (positioning a
 * new element) both need the same mechanics: track the pointer, find the
 * element underneath it, compute before/after/inside from where in its box
 * the pointer sits, and show an insertion marker in the shadow root. This
 * module owns that shared state machine; select.js feeds it pointer events.
 * @param {OverlayContext} ctx
 * @returns {{
 *   armPotentialDrag: (el: Element, e: PointerEvent) => void,
 *   startPlaceMode: (entry: PaletteEntry) => void,
 *   isActive: () => boolean,
 *   isPlacing: () => boolean,
 *   cancel: () => void,
 *   handlePointerMove: (e: PointerEvent) => boolean,
 *   handlePointerUp: (e: PointerEvent) => boolean,
 *   placeAt: (e: PointerEvent) => boolean,
 *   consumeEscape: () => boolean,
 * }}
 */
export function createDragDrop(ctx) {
  const doc = ctx.shadow.ownerDocument;

  const markerEl = doc.createElement('div');
  markerEl.className = 'uce-dnd-marker';
  markerEl.style.display = 'none';
  ctx.layer.appendChild(markerEl);

  /** @type {{ el: Element, startX: number, startY: number }|null} */
  let armed = null;
  /** @type {{ el: Element }|null} */
  let dragging = null;
  /** @type {{ entry: PaletteEntry }|null} */
  let placing = null;

  function hideMarker() {
    markerEl.style.display = 'none';
  }

  /**
   * @param {Element} targetEl
   * @param {number} clientY
   * @returns {Position}
   */
  function positionForPoint(targetEl, clientY) {
    const rect = targetEl.getBoundingClientRect();
    const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
    if (ratio < 0.25) return 'before';
    if (ratio > 0.75) return 'after';
    if (canContainChildren(targetEl)) return 'inside-end';
    return ratio < 0.5 ? 'before' : 'after';
  }

  /**
   * @param {Element} targetEl
   * @param {Position} position
   */
  function showMarker(targetEl, position) {
    const rect = targetEl.getBoundingClientRect();
    if (position === 'inside-end' || position === 'inside-start') {
      markerEl.className = 'uce-dnd-marker uce-dnd-box';
      Object.assign(markerEl.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    } else {
      markerEl.className = 'uce-dnd-marker uce-dnd-line';
      const y = position === 'before' ? rect.top : rect.bottom;
      Object.assign(markerEl.style, {
        left: `${rect.left}px`,
        top: `${y - 1}px`,
        width: `${rect.width}px`,
        height: '2px',
      });
    }
    markerEl.style.display = 'block';
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @param {Element|null} excludeEl
   * @returns {Element|null}
   */
  function resolveDropTarget(clientX, clientY, excludeEl) {
    const list =
      typeof doc.elementsFromPoint === 'function'
        ? doc.elementsFromPoint(clientX, clientY)
        : doc.elementFromPoint
          ? [doc.elementFromPoint(clientX, clientY)]
          : [];
    for (const node of list) {
      if (!node || node.nodeType !== 1) continue;
      if (typeof node.tagName === 'string' && node.tagName.toLowerCase() === 'uce-root') continue;
      if (typeof node.getRootNode === 'function' && node.getRootNode() === ctx.shadow) continue;
      if (excludeEl && (node === excludeEl || excludeEl.contains(node))) continue;
      return /** @type {Element} */ (node);
    }
    return null;
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @param {Element|null} excludeEl
   */
  function updateMarkerAt(clientX, clientY, excludeEl) {
    const target = resolveDropTarget(clientX, clientY, excludeEl);
    if (!target) {
      hideMarker();
      return null;
    }
    const position = positionForPoint(target, clientY);
    showMarker(target, position);
    return { target, position };
  }

  function reset() {
    armed = null;
    dragging = null;
    placing = null;
    hideMarker();
  }

  /**
   * @param {Element} el
   * @param {PointerEvent} e
   */
  function armPotentialDrag(el, e) {
    if (placing) return;
    armed = { el, startX: e.clientX, startY: e.clientY };
  }

  /** @param {PaletteEntry} entry */
  function startPlaceMode(entry) {
    armed = null;
    dragging = null;
    placing = { entry };
  }

  function isActive() {
    return Boolean(armed || dragging || placing);
  }

  function isDragging() {
    return Boolean(dragging);
  }

  function isPlacing() {
    return Boolean(placing);
  }

  function cancel() {
    reset();
  }

  /**
   * @param {PointerEvent} e
   * @returns {boolean} true if this move was consumed by an armed/active drag
   */
  function handlePointerMove(e) {
    if (placing) {
      updateMarkerAt(e.clientX, e.clientY, null);
      return true;
    }
    if (!armed && !dragging) return false;
    if (armed && !dragging) {
      const dx = e.clientX - armed.startX;
      const dy = e.clientY - armed.startY;
      if (Math.hypot(dx, dy) < 5) return true;
      dragging = { el: armed.el };
      armed = null;
    }
    if (dragging) updateMarkerAt(e.clientX, e.clientY, dragging.el);
    return true;
  }

  /**
   * @param {PointerEvent} e
   * @returns {boolean} true if this pointerup ended a drag/place gesture
   */
  function handlePointerUp(e) {
    if (dragging) {
      const el = dragging.el;
      const drop = resolveDropTarget(e.clientX, e.clientY, el);
      reset();
      if (drop) dispatchMove(ctx, el, drop, positionForPoint(drop, e.clientY));
      return true;
    }
    if (armed) {
      reset();
      return true;
    }
    return false;
  }

  /**
   * Finalizes palette place mode on click (design: "click places").
   * @param {PointerEvent} e
   * @returns {boolean}
   */
  function placeAt(e) {
    if (!placing) return false;
    const entry = placing.entry;
    const drop = resolveDropTarget(e.clientX, e.clientY, null);
    reset();
    if (drop) createInsertFromPalette(ctx, entry, drop, positionForPoint(drop, e.clientY));
    return true;
  }

  function consumeEscape() {
    if (!isActive()) return false;
    reset();
    return true;
  }

  return { armPotentialDrag, startPlaceMode, isActive, isDragging, isPlacing, cancel, handlePointerMove, handlePointerUp, placeAt, consumeEscape };
}

/**
 * @param {OverlayContext} ctx
 * @param {PaletteEntry} entry
 * @param {Element} anchorEl
 * @param {Position} position
 */
function createInsertFromPalette(ctx, entry, anchorEl, position) {
  const template = ctx.createLocator(entry.template);
  const anchor = ctx.createLocator(anchorEl);
  const text = placeholderTextFor(entry.template);
  ctx.dispatch({ type: 'add', change: { type: 'insert', template, anchor, position, text } });

  const { changes } = ctx.getState();
  const created = changes[changes.length - 1];
  if (!created || created.type !== 'insert') return;
  const doc = anchorEl.ownerDocument;
  const clone = doc.querySelector(`[data-uce-insert="${created.id}"]`);
  if (!clone) return;
  ctx.setSelection(clone);
  const textEl = findTextBearingElement(clone) || clone;
  startTextEdit(ctx, textEl);
}

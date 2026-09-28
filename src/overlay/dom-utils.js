// @ts-check

/**
 * Small DOM helpers shared by preview.js (applying changes) and panel.js
 * (reading current values into the edit fields). Kept separate from
 * locator.js, which owns read-only locator/identification concerns.
 */

/**
 * Escape a value for use inside an attribute selector when `CSS.escape` is
 * unavailable (e.g. some jsdom setups).
 * @param {string} s
 * @returns {string}
 */
function escapeAttrValue(s) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s);
  }
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

/**
 * Find the `<label>` associated with a form field: explicit `for`/`id` link
 * first, then the nearest wrapping `<label>`.
 * @param {Element} el
 * @returns {HTMLLabelElement|null}
 */
export function findLabelElement(el) {
  const doc = el.ownerDocument;
  const id = el.getAttribute('id');
  if (id) {
    try {
      const explicit = doc.querySelector(`label[for="${escapeAttrValue(id)}"]`);
      if (explicit) return /** @type {HTMLLabelElement} */ (explicit);
    } catch {
      // invalid id for a selector; fall through to the wrapping-label check
    }
  }
  const wrapping = el.closest('label');
  return /** @type {HTMLLabelElement|null} */ (wrapping);
}

/**
 * Current visible text of the field's associated/wrapping label, or ''.
 * @param {Element} el
 * @returns {string}
 */
export function getLabelText(el) {
  const label = findLabelElement(el);
  if (!label) return '';
  return (label.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Set an element's visible text without touching element children (icons,
 * wrapped inputs, ...): if it has element children, only the direct
 * non-whitespace text nodes are replaced; otherwise textContent is set.
 * @param {Element} el
 * @param {string} text
 */
export function setElementText(el, text) {
  const hasElementChildren = Array.from(el.childNodes).some((n) => n.nodeType === 1);
  if (!hasElementChildren) {
    el.textContent = text;
    return;
  }
  const textNodes = Array.from(el.childNodes).filter(
    (n) => n.nodeType === 3 && /** @type {Text} */ (n).data.trim() !== ''
  );
  if (textNodes.length > 0) {
    /** @type {Text} */ (textNodes[0]).data = text;
    for (let i = 1; i < textNodes.length; i++) {
      /** @type {Text} */ (textNodes[i]).data = '';
    }
  } else {
    el.appendChild(el.ownerDocument.createTextNode(text));
  }
}

/**
 * Whether the given element is a form control or contenteditable host,
 * i.e. a place where keystrokes/shortcuts should not be hijacked.
 * @param {Element|null} el
 * @returns {boolean}
 */
export function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(/** @type {HTMLElement} */ (el).isContentEditable);
}

/**
 * True for `<input type="button|submit|reset">`, where the visible label is
 * the `value` attribute rather than text content.
 * @param {Element} el
 * @returns {boolean}
 */
export function isValueButton(el) {
  if (el.tagName !== 'INPUT') return false;
  const type = (el.getAttribute('type') || '').toLowerCase();
  return type === 'button' || type === 'submit' || type === 'reset';
}

/**
 * The nearest `data-uce-insert` host (the clone itself or an ancestor within
 * it), or `null` if `el` is not part of an insert-preview clone. Elements
 * inside a clone have no locator of their own (phase 5 design: preview
 * clones cannot be located in the original DOM), so every action needs to
 * check this first and branch to updating the owning `insert` change instead.
 * @param {Element} el
 * @returns {Element|null}
 */
export function getInsertRoot(el) {
  return typeof el.closest === 'function' ? el.closest('[data-uce-insert]') : null;
}

/**
 * The element whose text `setElementText`/inline editing should target: the
 * node itself if it has direct non-whitespace text, else the first
 * descendant (document order) that does, else `null` (e.g. an empty icon
 * button) so callers can fall back to the node itself.
 * @param {Element} el
 * @returns {Element|null}
 */
export function findTextBearingElement(el) {
  const hasDirectText = Array.from(el.childNodes).some(
    (n) => n.nodeType === 3 && /** @type {Text} */ (n).data.trim() !== ''
  );
  if (hasDirectText) return el;
  for (const child of Array.from(el.children)) {
    const found = findTextBearingElement(child);
    if (found) return found;
  }
  return null;
}

/**
 * True while `el` is the live inline-edit target (contenteditable applied):
 * a preview re-sync must never overwrite text the user is currently typing.
 * @param {Element} el
 * @returns {boolean}
 */
export function isBeingEdited(el) {
  return el.hasAttribute('contenteditable');
}

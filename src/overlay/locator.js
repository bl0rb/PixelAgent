// @ts-check
// Pure, DOM-read-only helpers to identify elements in the target page and
// describe them well enough for a coding agent to find them in source.
// Must run in browsers and jsdom: no CSS.escape, no innerText, no layout reads.

/**
 * @typedef {{selector:string, tag:string, role?:string, name?:string, text?:string,
 *   classes?:string[], html?:string, breadcrumb?:string, url?:string}} Locator
 */

const UCE_ROOT_TAG = 'uce-root';
const HEADING_RE = /^H[1-6]$/;
const BREADCRUMB_HEADING_RE = /^H[1-3]$/;

/** @param {Element} node */
function isUceRoot(node) {
  return !!node.tagName && node.tagName.toLowerCase() === UCE_ROOT_TAG;
}

/** @param {string} s */
function normalizeWs(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Own CSS.escape-equivalent (CSSOM spec algorithm), since CSS.escape is not
 * guaranteed to exist in every host (and not in jsdom).
 * @param {string} value
 * @returns {string}
 */
export function cssEscape(value) {
  const string = String(value);
  const length = string.length;
  let result = '';
  let index = -1;
  const firstCodeUnit = string.charCodeAt(0);
  while (++index < length) {
    const codeUnit = string.charCodeAt(index);
    if (codeUnit === 0x0000) {
      result += '�';
      continue;
    }
    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
    ) {
      result += '\\' + codeUnit.toString(16) + ' ';
      continue;
    }
    if (index === 0 && length === 1 && codeUnit === 0x002d) {
      result += '\\' + string.charAt(index);
      continue;
    }
    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += string.charAt(index);
      continue;
    }
    result += '\\' + string.charAt(index);
  }
  return result;
}

/** @param {string} v */
function escapeAttrValue(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * @param {Document} doc
 * @param {string} selector
 * @param {Element} el
 */
function isUniqueSelector(doc, selector, el) {
  let matches;
  try {
    matches = doc.querySelectorAll(selector);
  } catch {
    return false;
  }
  return matches.length === 1 && matches[0] === el;
}

/** @param {Element} el */
function tagOf(el) {
  return el.tagName.toLowerCase();
}

/** @param {Element} el */
function classSetOf(el) {
  return new Set(Array.from(el.classList));
}

/**
 * @param {Element} el
 * @param {Set<string>} set
 */
function sameClassSet(el, set) {
  const s2 = classSetOf(el);
  if (s2.size !== set.size) return false;
  for (const c of set) if (!s2.has(c)) return false;
  return true;
}

/** @param {Element} el */
function needsNth(el) {
  const parent = el.parentElement;
  if (!parent) return false;
  const tag = el.tagName;
  const set = classSetOf(el);
  let count = 0;
  for (const sib of parent.children) {
    if (sib.tagName === tag && sameClassSet(sib, set)) count++;
  }
  return count > 1;
}

/** @param {Element} el */
function nthOfType(el) {
  let i = 1;
  let sib = el.previousElementSibling;
  while (sib) {
    if (sib.tagName === el.tagName) i++;
    sib = sib.previousElementSibling;
  }
  return i;
}

/**
 * @param {Element} node
 * @param {boolean} forceNth
 */
function classSegment(node, forceNth) {
  let seg = tagOf(node);
  for (const c of Array.from(node.classList)) seg += '.' + cssEscape(c);
  if (forceNth || needsNth(node)) seg += `:nth-of-type(${nthOfType(node)})`;
  return seg;
}

/** @param {Element} el */
function findAnchor(el) {
  const doc = el.ownerDocument;
  let node = el.parentElement;
  while (node && !isUceRoot(node)) {
    if (node.id && isUniqueSelector(doc, `#${cssEscape(node.id)}`, node)) return node;
    for (const attr of ['data-testid', 'data-test']) {
      const v = node.getAttribute(attr);
      if (v) {
        const sel = `[${attr}="${escapeAttrValue(v)}"]`;
        if (isUniqueSelector(doc, sel, node)) return node;
      }
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * @param {Element} root
 */
function rootSelectorFor(root) {
  if (root.id) return `#${cssEscape(root.id)}`;
  for (const attr of ['data-testid', 'data-test']) {
    const v = root.getAttribute(attr);
    if (v) return `[${attr}="${escapeAttrValue(v)}"]`;
  }
  return tagOf(root);
}

/**
 * @param {Element} el
 * @param {Element|null} root
 */
function collectMiddle(el, root) {
  /** @type {Element[]} */
  const middle = [];
  let node = el.parentElement;
  while (node && node !== root && !isUceRoot(node)) {
    middle.unshift(node);
    node = node.parentElement;
  }
  return middle;
}

/**
 * @param {string} rootSel
 * @param {Element[]} middleNodes
 * @param {Element} el
 * @param {boolean} forceNth
 */
function composeSelector(rootSel, middleNodes, el, forceNth) {
  let sel = rootSel;
  for (const n of middleNodes) sel += ' ' + classSegment(n, forceNth);
  sel += ' > ' + classSegment(el, forceNth);
  return sel;
}

/**
 * Guaranteed-unique fallback: real parent/child chain, nth-of-type forced at
 * every level.
 * @param {string} rootSel
 * @param {Element[]} middleNodes
 * @param {Element} el
 */
function composeSelectorStrict(rootSel, middleNodes, el) {
  let sel = rootSel;
  for (const n of middleNodes) sel += ' > ' + classSegment(n, true);
  sel += ' > ' + classSegment(el, true);
  return sel;
}

/** @param {Element} el */
function buildClassPath(el) {
  const doc = el.ownerDocument;
  const anchor = findAnchor(el) || doc.body || doc.documentElement;
  const rootSel = rootSelectorFor(anchor);
  const middle = collectMiddle(el, anchor);
  for (let drop = middle.length; drop >= 0; drop--) {
    const used = middle.slice(drop);
    const sel = composeSelector(rootSel, used, el, false);
    if (isUniqueSelector(doc, sel, el)) return sel;
  }
  return composeSelectorStrict(rootSel, middle, el);
}

/**
 * Unique CSS selector for `el`, as short as possible. Priority: id →
 * data-testid/data-test → name → aria-label → class path anchored at the
 * nearest ancestor with a unique id/testid. Never includes `uce-root`.
 * @param {Element} el
 * @returns {string}
 */
export function buildSelector(el) {
  const doc = el.ownerDocument;
  if (el.id && isUniqueSelector(doc, `#${cssEscape(el.id)}`, el)) {
    return `#${cssEscape(el.id)}`;
  }
  for (const attr of ['data-testid', 'data-test']) {
    const v = el.getAttribute(attr);
    if (v) {
      const sel = `[${attr}="${escapeAttrValue(v)}"]`;
      if (isUniqueSelector(doc, sel, el)) return sel;
    }
  }
  const name = el.getAttribute('name');
  if (name) {
    const sel = `${tagOf(el)}[name="${escapeAttrValue(name)}"]`;
    if (isUniqueSelector(doc, sel, el)) return sel;
  }
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const sel = `${tagOf(el)}[aria-label="${escapeAttrValue(ariaLabel)}"]`;
    if (isUniqueSelector(doc, sel, el)) return sel;
  }
  return buildClassPath(el);
}

const IMPLICIT_ROLES = /** @type {Record<string,string>} */ ({
  nav: 'navigation',
  main: 'main',
  dialog: 'dialog',
  table: 'table',
  tr: 'row',
  td: 'cell',
  th: 'columnheader',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  form: 'form',
  p: 'paragraph',
  textarea: 'textbox',
  button: 'button',
});

const INPUT_TYPE_ROLES = /** @type {Record<string,string>} */ ({
  text: 'textbox',
  email: 'textbox',
  tel: 'textbox',
  url: 'textbox',
  search: 'searchbox',
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  number: 'spinbutton',
  button: 'button',
  submit: 'button',
  reset: 'button',
});

/**
 * Explicit or implicit ARIA role.
 * @param {Element} el
 * @returns {string}
 */
export function getRole(el) {
  const explicit = el.getAttribute('role');
  if (explicit && explicit.trim()) return explicit.trim().split(/\s+/)[0];
  const tag = tagOf(el);
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : '';
  if (tag === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return INPUT_TYPE_ROLES[type] || 'textbox';
  }
  if (tag === 'select') {
    const multiple = el.hasAttribute('multiple');
    const size = parseInt(el.getAttribute('size') || '1', 10);
    return multiple || size > 1 ? 'listbox' : 'combobox';
  }
  if (HEADING_RE.test(el.tagName)) return 'heading';
  if (tag === 'img') return el.getAttribute('alt') === '' ? 'presentation' : 'img';
  if (tag === 'section') {
    if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) return 'region';
    return '';
  }
  return IMPLICIT_ROLES[tag] || '';
}

/**
 * Visible text content, script/style/template excluded, whitespace
 * collapsed, trimmed, truncated to 80 chars (79 + '…').
 * @param {Element} el
 * @returns {string}
 */
export function getVisibleText(el) {
  let text = '';
  /** @param {Node} node */
  const walk = (node) => {
    if (node.nodeType === 3) {
      text += /** @type {any} */ (node).data;
      return;
    }
    if (node.nodeType === 1) {
      const child = /** @type {Element} */ (node);
      const tag = child.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') return;
      // nested controls (e.g. a select inside its label), tooltips and hidden parts are not visible text
      if (tag === 'SELECT' || tag === 'TEXTAREA' || child.hasAttribute('hidden')
        || child.getAttribute('aria-hidden') === 'true' || child.getAttribute('role') === 'tooltip') return;
      text += ' ';
      node.childNodes.forEach(walk);
      text += ' ';
    }
  };
  el.childNodes.forEach(walk);
  text = normalizeWs(text);
  if (text.length > 80) text = text.slice(0, 79) + '…';
  return text;
}

/**
 * @param {Element} el
 */
function findAssociatedLabel(el) {
  const doc = el.ownerDocument;
  if (el.id) {
    const labels = doc.querySelectorAll('label[for]');
    for (const l of labels) {
      if (l.getAttribute('for') === el.id) return l;
    }
  }
  let node = el.parentElement;
  while (node) {
    if (tagOf(node) === 'label') return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Accessible name (simplified): aria-label → aria-labelledby → associated or
 * wrapping <label> → alt (img) / value (input button/submit) → visible text
 * → title/placeholder. Whitespace normalized.
 * @param {Element} el
 * @returns {string}
 */
export function getAccessibleName(el) {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return normalizeWs(ariaLabel);

  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const doc = el.ownerDocument;
    const text = labelledby
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => {
        const ref = doc.getElementById(id);
        return ref ? getVisibleText(ref) : '';
      })
      .filter(Boolean)
      .join(' ');
    if (text) return normalizeWs(text);
  }

  const tag = tagOf(el);
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const label = findAssociatedLabel(el);
    if (label) {
      const t = getVisibleText(label);
      if (t) return normalizeWs(t);
    }
  }

  if (tag === 'img') {
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return normalizeWs(alt);
  }
  if (tag === 'input') {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'button' || type === 'submit' || type === 'reset') {
      const value = el.getAttribute('value');
      if (value && value.trim()) return normalizeWs(value);
    }
  }

  const text = getVisibleText(el);
  if (text) return text;

  const title = el.getAttribute('title');
  if (title && title.trim()) return normalizeWs(title);
  const placeholder = el.getAttribute('placeholder');
  if (placeholder && placeholder.trim()) return normalizeWs(placeholder);
  return '';
}

/**
 * Opening tag only, attributes escaped, contenteditable/data-uce-* skipped,
 * truncated to 200 chars (199 + '…').
 * @param {Element} el
 * @returns {string}
 */
export function getOpeningTag(el) {
  let out = '<' + tagOf(el);
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'contenteditable' || attr.name.startsWith('data-uce-')) continue;
    const value = String(attr.value).replace(/"/g, '&quot;');
    out += ` ${attr.name}="${value}"`;
  }
  out += '>';
  if (out.length > 200) out = out.slice(0, 199) + '…';
  return out;
}

/** @param {Element} node */
function isLandmark(node) {
  const tag = tagOf(node);
  if (tag === 'section' && (node.hasAttribute('aria-labelledby') || node.hasAttribute('aria-label'))) return true;
  if (tag === 'nav') return true;
  if (tag === 'dialog' || node.getAttribute('role') === 'dialog') return true;
  return false;
}

/** @param {Element} node */
function sectionLabel(node) {
  const al = node.getAttribute('aria-label');
  if (al && al.trim()) return normalizeWs(al);
  const lb = node.getAttribute('aria-labelledby');
  if (lb) {
    const ref = node.ownerDocument.getElementById(lb.split(/\s+/)[0]);
    if (ref) {
      const t = getVisibleText(ref);
      if (t) return t;
    }
  }
  return '';
}

/** @param {Element} node */
function landmarkLabel(node) {
  const tag = tagOf(node);
  if (tag === 'section') return sectionLabel(node);
  if (tag === 'nav') {
    const al = node.getAttribute('aria-label');
    return al && al.trim() ? normalizeWs(al) : 'Navigation';
  }
  const al = node.getAttribute('aria-label');
  if (al && al.trim()) return normalizeWs(al);
  const lb = node.getAttribute('aria-labelledby');
  if (lb) {
    const ref = node.ownerDocument.getElementById(lb.split(/\s+/)[0]);
    if (ref) {
      const t = getVisibleText(ref);
      if (t) return t;
    }
  }
  const heading = node.querySelector('h1,h2,h3,h4,h5,h6');
  if (heading) {
    const t = getVisibleText(heading);
    if (t) return t;
  }
  return 'Dialog';
}

/** @param {Element} node */
function precedingHeading(node) {
  let sib = node.previousElementSibling;
  while (sib) {
    if (BREADCRUMB_HEADING_RE.test(sib.tagName)) return getVisibleText(sib);
    // only look inside title blocks (header/hgroup or a wrapper without controls),
    // never inside sibling content such as other cards or list items
    const isTitleBlock = /^(HEADER|HGROUP)$/.test(sib.tagName)
      || (sib.tagName === 'DIV' && !sib.querySelector('button,a,input,select,textarea'));
    const headings = isTitleBlock ? sib.querySelectorAll('h1,h2,h3') : [];
    if (headings.length) return getVisibleText(headings[headings.length - 1]);
    sib = sib.previousElementSibling;
  }
  return '';
}

/**
 * Breadcrumb of nearest headings/landmarks, outside → inside, ' › '-joined,
 * deduped, max 4 entries (innermost kept).
 * @param {Element} el
 * @returns {string}
 */
export function getBreadcrumb(el) {
  const elIsHeading = HEADING_RE.test(el.tagName);
  const elText = elIsHeading ? getVisibleText(el) : null;
  /** @type {string[]} */
  const crumbs = [];
  let node = /** @type {Element|null} */ (el);
  while (node && node.nodeType === 1) {
    const label = isLandmark(node) ? landmarkLabel(node) : precedingHeading(node);
    if (label && !(elIsHeading && label === elText)) crumbs.push(label);
    node = node.parentElement;
  }
  const seen = new Set();
  const deduped = [];
  for (const c of crumbs) {
    if (!seen.has(c)) {
      seen.add(c);
      deduped.push(c);
    }
  }
  const limited = deduped.slice(0, 4);
  limited.reverse();
  return limited.join(' › ');
}

/**
 * @param {Element} el
 * @param {{url?:string}} [options]
 * @returns {Locator}
 */
export function createLocator(el, options = {}) {
  const doc = el.ownerDocument;
  const url = options.url || (doc.location ? doc.location.href : '');
  /** @type {Locator} */
  const loc = { selector: buildSelector(el), tag: tagOf(el) };
  const role = getRole(el);
  if (role) loc.role = role;
  const name = getAccessibleName(el);
  if (name) loc.name = name;
  const text = getVisibleText(el);
  if (text) loc.text = text;
  const classes = Array.from(el.classList);
  if (classes.length) loc.classes = classes;
  const html = getOpeningTag(el);
  if (html) loc.html = html;
  const breadcrumb = getBreadcrumb(el);
  if (breadcrumb) loc.breadcrumb = breadcrumb;
  if (url) loc.url = url;
  return loc;
}

/**
 * Resolves a Locator back to an Element. Falls back to a unique element with
 * the same tag and visible text if the selector no longer matches.
 * @param {Locator} loc
 * @param {Document} [doc]
 * @returns {Element|null}
 */
export function resolveLocator(loc, doc = document) {
  if (loc && loc.selector) {
    let el = null;
    try {
      el = doc.querySelector(loc.selector);
    } catch {
      el = null;
    }
    if (el) return el;
  }
  if (loc && loc.tag) {
    const candidates = Array.from(doc.getElementsByTagName(loc.tag));
    const wanted = loc.text || '';
    const matches = candidates.filter((c) => getVisibleText(c) === wanted);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

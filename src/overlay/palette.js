// @ts-check
// Pure, DOM-read-only scan of the page for "elements of the same kind" the
// user can insert a copy of. Must work in jsdom.
import { getVisibleText } from './locator.js';
import { getLang } from './i18n.js';

/**
 * @typedef {{ signature: string, label: string, count: number, examples: string[], template: Element }} PaletteEntry
 */

/** Tags meaningful enough to offer even when they occur only once. */
const SIMPLE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'tr']);

/** @param {Element} el */
function signatureOf(el) {
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).sort().join('.');
  const type = (el.getAttribute('type') || '').toLowerCase();
  const role = el.getAttribute('role') || '';
  let sig = tag;
  if (classes) sig += '.' + classes;
  if (type) sig += `[type=${type}]`;
  if (role) sig += `[role=${role}]`;
  return sig;
}

/** @param {Element} el */
function isEligible(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'template') return false;
  if (tag === 'uce-root') return false;
  if (typeof el.closest === 'function') {
    if (el.closest('uce-root')) return false;
    if (el.closest('[data-uce-insert]')) return false;
    if (el.closest('[hidden]')) return false;
  }
  return true;
}

/**
 * Scans `doc` and groups elements by signature (tagName + sorted classes +
 * type/role). Only "meaningful" kinds are returned: the fixed list of simple
 * tags (any count), plus any class-bearing element whose signature occurs at
 * least twice (cards, badges, notices, …). Sorted by count, descending.
 * @param {Document} doc
 * @returns {PaletteEntry[]}
 */
export function scanPalette(doc) {
  /** @type {Map<string, { signature: string, tag: string, simple: boolean, count: number, examples: string[], moreExamples: boolean, template: Element }>} */
  const groups = new Map();

  const root = doc.body || doc.documentElement;
  const all = root ? root.querySelectorAll('*') : [];
  for (const el of all) {
    if (!isEligible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const simple = SIMPLE_TAGS.has(tag);
    const hasClasses = el.classList.length > 0;
    if (!simple && !hasClasses) continue;

    const sig = signatureOf(el);
    let group = groups.get(sig);
    if (!group) {
      group = { signature: sig, tag, simple, count: 0, examples: [], moreExamples: false, template: el };
      groups.set(sig, group);
    }
    group.count++;
    const full = getVisibleText(el);
    const text = full.length > 30 ? `${full.slice(0, 29)}…` : full;
    if (text && !group.examples.includes(text)) {
      if (group.examples.length < 3) group.examples.push(text);
      else group.moreExamples = true;
    }
  }

  /** @type {PaletteEntry[]} */
  const result = [];
  for (const g of groups.values()) {
    if (!g.simple && g.count < 2) continue;
    result.push({ signature: g.signature, label: buildLabel(g), count: g.count, examples: g.examples, template: g.template });
  }
  result.sort((a, b) => b.count - a.count);
  return result;
}

/**
 * @param {{ signature: string, count: number, examples: string[], moreExamples: boolean }} g
 */
function buildLabel(g) {
  if (!g.examples.length) return `${g.signature} (${g.count}×)`;
  const parts = g.examples.map((e) => (getLang() === 'de' ? `„${e}“` : `"${e}"`));
  if (g.moreExamples) parts.push('…');
  return `${g.signature} (${g.count}×) — ${parts.join(', ')}`;
}

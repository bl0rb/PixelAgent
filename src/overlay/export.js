// @ts-check
// Pure markdown/JSON export building, plus browser helpers (download, POST,
// clipboard). No import-time side effects: browser globals are only touched
// inside the helper function bodies.
import { t } from './i18n.js';

/** @typedef {import('./locator.js').Locator} Locator */
/** @typedef {import('./changes.js').Change} Change */
/** @typedef {{url:string, title:string, viewport:string, createdAt:string}} Source */
/** @typedef {{version:1, source:Source, changes:Change[]}} Doc */

/** i18n keys for change type labels, identical to panel.js's. Export text is always English. */
const TYPE_KEYS = {
  text: 'type.text',
  attr: 'type.attr',
  move: 'type.move',
  insert: 'type.insert',
  remove: 'type.remove',
  comment: 'type.comment',
};

/** i18n keys for `move`/`insert` positions, identical to panel.js's. */
const POSITION_KEYS = {
  before: 'position.before',
  after: 'position.after',
  'inside-start': 'position.insideStart',
  'inside-end': 'position.insideEnd',
};

/** Singular/plural nouns for the per-type counts line, e.g. "3 comments, 1 text change". */
const COUNT_LABELS = {
  text: ['text change', 'text changes'],
  attr: ['description change', 'description changes'],
  move: ['move', 'moves'],
  insert: ['new element', 'new elements'],
  remove: ['removal', 'removals'],
  comment: ['comment', 'comments'],
};

/** Canonical type order, used to break ties in the counts line. */
const TYPE_ORDER = ['text', 'attr', 'move', 'insert', 'remove', 'comment'];

const INSTRUCTION =
  '> **Instructions for the coding agent:** Implement the changes below in the source code.\n' +
  '> Each change states *what* to do first, then *where*: locate the element via selector,\n' +
  '> HTML snippet, text and location. Comments are free-text requests (possibly in another\n' +
  '> language) — apply them to the named element and its immediate context. New elements are\n' +
  '> copies of the named template: same component, same classes, same structure. Use texts\n' +
  '> exactly as given; if there is an i18n system, add or update keys instead of hard-coding\n' +
  '> text. Implement only these changes, ask if anything is ambiguous, and report the status\n' +
  '> per change number (numbers match the JSON `id`s).';

/** @param {string} type */
function typeLabel(type) {
  const key = TYPE_KEYS[type];
  return key ? t(key, undefined, 'en') : type;
}

/** @param {string} position */
function positionLabel(position) {
  const key = POSITION_KEYS[position];
  return key ? t(key, undefined, 'en') : position;
}

/** @param {unknown} value */
function inlineCode(value) {
  const s = String(value);
  return s.includes('`') ? '`` ' + s + ' ``' : '`' + s + '`';
}

/** Straight quotes (export is always English). @param {string} text */
function quote(text) {
  return `"${text}"`;
}

/** @param {string|undefined} value */
function quotedOrEmpty(value) {
  return value === '' || value == null ? t('common.empty', undefined, 'en') : quote(value);
}

/**
 * True when `selector` is exactly an id selector (`#foo`), not a compound or
 * descendant selector that merely starts with one.
 * @param {string} selector
 */
function isIdSelector(selector) {
  return typeof selector === 'string' && /^#(?:[^\s.>+~[\]:,]|\\.)+$/.test(selector);
}

/**
 * `tag "name"` → `tag "text"` → `tag#id` → `tag.firstClass` → `tag in {breadcrumb}` → `tag`.
 * @param {Locator|undefined} loc
 */
function subject(loc) {
  if (!loc) return '';
  const tag = loc.tag || '';
  if (loc.name && loc.name.length <= 60) return `${tag} ${quote(loc.name)}`;
  if (loc.text && loc.text.length <= 40) return `${tag} ${quote(loc.text)}`;
  if (isIdSelector(loc.selector)) return `${tag}${loc.selector}`;
  if (loc.classes && loc.classes.length) return `${tag}.${loc.classes[0]}`;
  if (loc.breadcrumb) {
    const parts = loc.breadcrumb.split(' › ');
    return `${tag} in ${parts[parts.length - 1]}`;
  }
  return tag;
}

/** @param {string|undefined} url */
function urlPathPart(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
}

/**
 * The locator that identifies "where" a change happens: `target` for every
 * type except `insert`, which has no target and uses its `anchor` instead.
 * @param {Change} change
 * @returns {Locator|undefined}
 */
function locatorOf(change) {
  const c = /** @type {any} */ (change);
  return c.type === 'insert' ? c.anchor : c.target;
}

/**
 * `- Location: …`, `- Selector: …`, `- HTML: …` (Location/HTML omitted when empty).
 * @param {Locator|undefined} loc
 */
function whereLines(loc) {
  if (!loc) return [];
  /** @type {string[]} */
  const lines = [];
  const path = urlPathPart(loc.url);
  if (loc.breadcrumb && path) lines.push(`- Location: ${loc.breadcrumb} (${inlineCode(path)})`);
  else if (loc.breadcrumb) lines.push(`- Location: ${loc.breadcrumb}`);
  else if (path) lines.push(`- Location: ${inlineCode(path)}`);
  lines.push(`- Selector: ${inlineCode(loc.selector)}`);
  if (loc.html) lines.push(`- HTML: ${inlineCode(loc.html)}`);
  return lines;
}

/**
 * "What to do" lines, per change type (comment is handled separately by the caller).
 * @param {Change} change
 */
function whatLines(change) {
  const c = /** @type {any} */ (change);
  switch (c.type) {
    case 'text':
      return [`- Before: ${quote(c.before)}`, `- After: ${quote(c.after)}`];
    case 'attr': {
      const attrLabel = c.attr === 'label' ? t('common.fieldLabel', undefined, 'en') : inlineCode(c.attr);
      return [`- Attribute: ${attrLabel}`, `- Before: ${quotedOrEmpty(c.before)}`, `- After: ${quotedOrEmpty(c.after)}`];
    }
    case 'move': {
      const pos = positionLabel(c.position);
      return [`- Move to: **${pos}** ${subject(c.anchor)} (${inlineCode(c.anchor.selector)})`];
    }
    case 'insert': {
      const pos = positionLabel(c.position);
      return [
        `- Text: ${quote(c.text)}`,
        `- Insert: **${pos}** ${subject(c.anchor)} (${inlineCode(c.anchor.selector)})`,
        `- Template: ${inlineCode(c.template.selector)} · ${inlineCode(c.template.html)}`,
      ];
    }
    case 'remove':
    default:
      return [];
  }
}

/**
 * @param {Change} change
 * @param {number} n heading number (matches the JSON `id`)
 * @param {string} headingPrefix `##` (no view groups) or `###` (inside a view group)
 */
function buildBlock(change, n, headingPrefix) {
  const c = /** @type {any} */ (change);
  const label = typeLabel(c.type);
  const loc = locatorOf(c);
  const subjectText = c.type === 'insert' ? `copy of ${subject(c.template)}` : subject(loc);
  const heading = `${headingPrefix} ${n}. ${label} — ${subjectText}`;
  const where = whereLines(loc);

  if (c.type === 'comment') {
    const noteLines = String(c.note).split('\n').map((line) => `> ${line}`);
    return [heading, ...noteLines, '', ...where].join('\n');
  }

  return [heading, ...whatLines(c), ...where].join('\n');
}

/**
 * Groups changes by "view" (path+search+hash of their target/anchor url),
 * preserving relative order within a group; groups are ordered by first
 * appearance.
 * @param {Change[]} changes
 * @returns {{key:string, changes:Change[]}[]}
 */
function groupByView(changes) {
  /** @type {Map<string, Change[]>} */
  const map = new Map();
  for (const c of changes) {
    const loc = locatorOf(c);
    const key = urlPathPart(loc && loc.url);
    const list = map.get(key);
    if (list) list.push(c);
    else map.set(key, [c]);
  }
  return Array.from(map.entries(), ([key, list]) => ({ key, changes: list }));
}

/**
 * First breadcrumb's first segment among a group's changes, if any.
 * @param {Change[]} changes
 */
function firstBreadcrumbSegment(changes) {
  for (const c of changes) {
    const loc = locatorOf(c);
    if (loc && loc.breadcrumb) return loc.breadcrumb.split(' › ')[0];
  }
  return '';
}

/** @param {{key:string, changes:Change[]}} group */
function groupHeading(group) {
  const title = firstBreadcrumbSegment(group.changes);
  return title ? `## ${title} (${inlineCode(group.key)})` : `## ${inlineCode(group.key)}`;
}

/**
 * "3 comments, 1 text change", ordered by count (descending), ties broken by
 * the canonical type order.
 * @param {Change[]} changes
 */
function countsLine(changes) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const c of changes) counts[c.type] = (counts[c.type] || 0) + 1;
  const types = Object.keys(counts).sort((a, b) => {
    const byCount = counts[b] - counts[a];
    return byCount !== 0 ? byCount : TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b);
  });
  return types
    .map((type) => {
      const n = counts[type];
      const labels = COUNT_LABELS[type] || [type, `${type}s`];
      return `${n} ${n === 1 ? labels[0] : labels[1]}`;
    })
    .join(', ');
}

/**
 * Renumbers `changes` to sequential ids `1…n` in export order (grouped by
 * view, stable within a group, groups in order of first appearance), so
 * Markdown section `n` == JSON `id` `n`. Returns copies; `changes` and its
 * entries are left untouched.
 * @param {Change[]} changes
 * @param {Source} source
 * @returns {Doc}
 */
export function buildDocument(changes, source) {
  const groups = groupByView(changes || []);
  const ordered = groups.flatMap((g) => g.changes);
  const renumbered = ordered.map((c, i) => ({ ...c, id: i + 1 }));
  return { version: 1, source, changes: renumbered };
}

/**
 * `YYYY-MM-DD HH:MM`, local time. Export is always English.
 * @param {string} iso
 * @returns {string}
 */
export function formatDate(iso) {
  const d = new Date(iso);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * @param {Doc} doc
 * @returns {string}
 */
export function toMarkdown(doc) {
  const { source, changes } = doc;
  const list = changes || [];
  const groups = groupByView(list);
  const multiView = groups.length > 1;
  const headingPrefix = multiView ? '###' : '##';

  const totalLabel = `${list.length} change${list.length === 1 ? '' : 's'}`;
  const counts = list.length ? ` (${countsLine(list)})` : '';
  const sourceLine = `Source: ${source.url} · ${formatDate(source.createdAt)} · Viewport ${source.viewport} · ${totalLabel}${counts}`;
  const header = `# UI changes\n\n${sourceLine}\n\n${INSTRUCTION}`;

  let body;
  if (list.length === 0) {
    body = '_No changes._';
  } else {
    /** @type {string[]} */
    const sections = [];
    for (const g of groups) {
      if (multiView) sections.push(groupHeading(g));
      for (const c of g.changes) sections.push(buildBlock(c, /** @type {any} */ (c).id, headingPrefix));
    }
    body = sections.join('\n\n');
  }

  const jsonBlock = '<details><summary>JSON</summary>\n\n```json\n' + JSON.stringify(doc, null, 2) + '\n```\n</details>';

  return `${header}\n\n${body}\n\n${jsonBlock}`;
}

/**
 * Triggers a browser download of the markdown (no proxy available).
 * @param {string} md
 * @param {string} [filename]
 */
export function downloadMarkdown(md, filename = 'ui-changes.md') {
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * POSTs the markdown to the proxy's export endpoint.
 * @param {string} endpointUrl
 * @param {string} md
 * @returns {Promise<string>}
 */
export async function postExport(endpointUrl, md) {
  const res = await fetch(endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    body: md,
  });
  const data = await res.json();
  return data.path;
}

/**
 * Copies text to the clipboard, falling back to a hidden textarea.
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall back to execCommand (e.g. document not focused, insecure context)
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}

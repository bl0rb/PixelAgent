// @ts-check
// Pure markdown/JSON export building, plus browser helpers (download, POST,
// clipboard). No import-time side effects: browser globals are only touched
// inside the helper function bodies.
import { t } from './i18n.js';

/** @typedef {import('./locator.js').Locator} Locator */
/** @typedef {import('./changes.js').Change} Change */
/** @typedef {import('./i18n.js').Lang} Lang */
/** @typedef {{url:string, title:string, viewport:string, createdAt:string}} Source */
/** @typedef {{version:1, source:Source, changes:Change[]}} Doc */

/** i18n keys for change type labels, identical to panel.js's. */
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

/**
 * @param {string} type
 * @param {Lang} lang
 */
function typeLabel(type, lang) {
  const key = TYPE_KEYS[type];
  return key ? t(key, undefined, lang) : type;
}

/**
 * @param {string} position
 * @param {Lang} lang
 */
function positionLabel(position, lang) {
  const key = POSITION_KEYS[position];
  return key ? t(key, undefined, lang) : position;
}

/** @param {unknown} value */
function inlineCode(value) {
  const s = String(value);
  return s.includes('`') ? '`` ' + s + ' ``' : '`' + s + '`';
}

/**
 * Straight quotes in English, „…“ in German.
 * @param {string} text
 * @param {Lang} lang
 */
function quote(text, lang) {
  return lang === 'de' ? `„${text}“` : `"${text}"`;
}

/**
 * @param {Locator|undefined} loc
 * @param {Lang} lang
 */
function subject(loc, lang) {
  if (!loc) return '';
  const tag = loc.tag || '';
  if (loc.name) return `${tag} ${quote(loc.name, lang)}`;
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
 * @param {Locator} loc
 * @param {Lang} lang
 */
function ortLine(loc, lang) {
  const path = urlPathPart(loc.url);
  const label = t('export.location', undefined, lang);
  if (loc.breadcrumb && path) return `- ${label}: ${loc.breadcrumb} (${inlineCode(path)})`;
  if (loc.breadcrumb) return `- ${label}: ${loc.breadcrumb}`;
  if (path) return `- ${label}: ${inlineCode(path)}`;
  return null;
}

/**
 * @param {Locator} loc
 * @param {Lang} lang
 */
function targetLines(loc, lang) {
  /** @type {string[]} */
  const lines = [];
  const ort = ortLine(loc, lang);
  if (ort) lines.push(ort);
  lines.push(`- ${t('export.selector', undefined, lang)}: ${inlineCode(loc.selector)}`);
  if (loc.html) lines.push(`- ${t('export.html', undefined, lang)}: ${inlineCode(loc.html)}`);
  return lines;
}

/**
 * @param {string|undefined} value
 * @param {Lang} lang
 */
function quotedOrEmpty(value, lang) {
  return value === '' || value == null ? t('common.empty', undefined, lang) : quote(value, lang);
}

/**
 * @param {Change} change
 * @param {number} n
 * @param {Lang} lang
 */
function buildBlock(change, n, lang) {
  const c = /** @type {any} */ (change);
  const label = typeLabel(c.type, lang);
  /** @type {string[]} */
  const lines = [];
  let heading = `## ${n}. ${label} — ${subject(c.target, lang)}`;

  switch (c.type) {
    case 'text':
      lines.push(...targetLines(c.target, lang));
      lines.push(`- ${t('export.before', undefined, lang)}: ${quote(c.before, lang)}`);
      lines.push(`- ${t('export.after', undefined, lang)}: ${quote(c.after, lang)}`);
      break;
    case 'attr': {
      lines.push(...targetLines(c.target, lang));
      const attrLabel = c.attr === 'label' ? t('common.fieldLabel', undefined, lang) : inlineCode(c.attr);
      lines.push(`- ${t('export.attribute', undefined, lang)}: ${attrLabel}`);
      lines.push(`- ${t('export.before', undefined, lang)}: ${quotedOrEmpty(c.before, lang)}`);
      lines.push(`- ${t('export.after', undefined, lang)}: ${quotedOrEmpty(c.after, lang)}`);
      break;
    }
    case 'move': {
      lines.push(...targetLines(c.target, lang));
      const pos = positionLabel(c.position, lang);
      lines.push(`- ${t('export.newPosition', undefined, lang)}: **${pos}** ${subject(c.anchor, lang)} (${inlineCode(c.anchor.selector)})`);
      break;
    }
    case 'remove':
      lines.push(...targetLines(c.target, lang));
      break;
    case 'comment': {
      lines.push(...targetLines(c.target, lang));
      const noteLines = String(c.note).split('\n');
      lines.push(`- ${t('export.note', undefined, lang)}: ${noteLines[0]}`);
      for (let i = 1; i < noteLines.length; i++) lines.push(`  ${noteLines[i]}`);
      break;
    }
    case 'insert': {
      heading = `## ${n}. ${label} — ${t('export.copyOf', { name: subject(c.template, lang) }, lang)}`;
      const pos = positionLabel(c.position, lang);
      const anchorBreadcrumb = c.anchor.breadcrumb ? `${c.anchor.breadcrumb}, ` : '';
      lines.push(`- ${t('export.location', undefined, lang)}: ${anchorBreadcrumb}**${pos}** ${subject(c.anchor, lang)}`);
      lines.push(`- ${t('export.anchor', undefined, lang)}: ${inlineCode(c.anchor.selector)}`);
      lines.push(`- ${t('export.template', undefined, lang)}: ${inlineCode(c.template.selector)} · ${inlineCode(c.template.html)}`);
      lines.push(`- ${t('export.text', undefined, lang)}: ${quote(c.text, lang)}`);
      break;
    }
    default:
      break;
  }

  return [heading, ...lines].join('\n');
}

/**
 * @param {Change[]} changes
 * @param {Source} source
 * @returns {Doc}
 */
export function buildDocument(changes, source) {
  return { version: 1, source, changes };
}

/**
 * `YYYY-MM-DD HH:MM` in English, `DD.MM.YYYY HH:MM` in German, local time.
 * @param {string} iso
 * @param {Lang} [lang]
 * @returns {string}
 */
export function formatDate(iso, lang = 'en') {
  const d = new Date(iso);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const datePart =
    lang === 'de'
      ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${datePart} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * @param {Doc} doc
 * @param {Lang} [lang]
 * @returns {string}
 */
export function toMarkdown(doc, lang = 'en') {
  const { source, changes } = doc;
  const title = t('export.title', undefined, lang);
  const sourceLabel = t('export.source', undefined, lang);
  const instruction = t('export.instruction', undefined, lang);
  const header = `# ${title}\n\n${sourceLabel}: ${source.url} · ${formatDate(source.createdAt, lang)} · Viewport ${source.viewport}\n\n${instruction}`;

  const body =
    !changes || changes.length === 0
      ? t('export.noChanges', undefined, lang)
      : changes.map((c, i) => buildBlock(c, i + 1, lang)).join('\n\n');

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

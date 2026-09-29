// @ts-check
// Pure parsing of a saved work state back into a validated changes list. No
// DOM access, fully testable. Accepts three input shapes: an exported
// `ui-changes.md` (the JSON is read from the last ```json block inside
// `<details><summary>JSON</summary>`), a raw JSON document
// `{version:1, source, changes}`, or a bare changes array.

/** @typedef {import('./locator.js').Locator} Locator */
/** @typedef {import('./changes.js').Change} Change */
/** @typedef {import('./export.js').Source} Source */

/** @typedef {{changes: Change[], source: Source|undefined, skipped: number}} ImportResult */

const KNOWN_TYPES = new Set(['text', 'attr', 'move', 'insert', 'remove', 'comment']);
const POSITIONS = new Set(['before', 'after', 'inside-start', 'inside-end']);

/** @param {unknown} v @returns {v is string} */
function isString(v) {
  return typeof v === 'string';
}

/** @param {unknown} v @returns {v is Locator} */
function isLocator(v) {
  return Boolean(v) && typeof v === 'object' && isString(/** @type {any} */ (v).selector);
}

/**
 * @param {any} c
 * @returns {c is Change}
 */
function isValidChange(c) {
  if (!c || typeof c !== 'object') return false;
  if (!KNOWN_TYPES.has(c.type)) return false;
  switch (c.type) {
    case 'text':
      return isLocator(c.target) && isString(c.before) && isString(c.after);
    case 'attr':
      return isLocator(c.target) && isString(c.attr) && isString(c.before) && isString(c.after);
    case 'move':
      return isLocator(c.target) && isLocator(c.anchor) && POSITIONS.has(c.position);
    case 'insert':
      return isLocator(c.template) && isLocator(c.anchor) && POSITIONS.has(c.position) && isString(c.text);
    case 'remove':
      return isLocator(c.target);
    case 'comment':
      return isLocator(c.target) && isString(c.note);
    default:
      return false;
  }
}

/**
 * Finds the last ```json fenced block inside a
 * `<details><summary>JSON</summary>` section, as produced by export.js's
 * `toMarkdown`. Returns `null` when there is no such section/block.
 * @param {string} text
 * @returns {string|null}
 */
function extractJsonBlockFromMarkdown(text) {
  const marker = '<details><summary>JSON</summary>';
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return null;
  const after = text.slice(markerIndex);
  const blocks = Array.from(after.matchAll(/```json\n([\s\S]*?)\n```/g));
  if (blocks.length === 0) return null;
  return blocks[blocks.length - 1][1];
}

/**
 * Parses a saved work state back into `{ changes, source, skipped }`.
 * Invalid changes are dropped and counted in `skipped` rather than failing
 * the whole import. Throws a clear `Error` when the input cannot be
 * interpreted at all, or when it declares a `version` other than `1`.
 * @param {string} text
 * @returns {ImportResult}
 */
export function parseImport(text) {
  if (!isString(text) || !text.trim()) {
    throw new Error('Nothing to import: the file is empty.');
  }

  const fromMarkdown = extractJsonBlockFromMarkdown(text);
  const jsonText = fromMarkdown != null ? fromMarkdown : text.trim();

  /** @type {any} */
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Could not parse the file: not valid JSON.');
  }

  /** @type {any[]} */
  let rawChanges;
  /** @type {Source|undefined} */
  let source;

  if (Array.isArray(data)) {
    rawChanges = data;
  } else if (data && typeof data === 'object') {
    if (data.version !== 1) {
      throw new Error(`Unsupported version: ${data.version === undefined ? '(missing)' : data.version}`);
    }
    if (!Array.isArray(data.changes)) {
      throw new Error('Could not parse the file: missing "changes" array.');
    }
    rawChanges = data.changes;
    source = data.source;
  } else {
    throw new Error('Could not parse the file: unrecognized import format.');
  }

  /** @type {Change[]} */
  const changes = [];
  let skipped = 0;
  for (const c of rawChanges) {
    if (isValidChange(c)) changes.push(c);
    else skipped++;
  }

  return { changes, source, skipped };
}

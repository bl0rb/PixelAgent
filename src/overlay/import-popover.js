// @ts-check
import { parseImport } from './import.js';
import { placeAboveToolbar } from './dom-utils.js';
import { t } from './i18n.js';

/**
 * @typedef {import('./index.js').OverlayContext} OverlayContext
 * @typedef {import('./import.js').ImportResult} ImportResult
 * @typedef {import('./export.js').Source} Source
 */

/** @type {HTMLElement|null} */
let openPopoverEl = null;

/**
 * Closes the currently open import popover, if any.
 */
export function closeImportPopover() {
  if (openPopoverEl && openPopoverEl.parentNode) {
    openPopoverEl.parentNode.removeChild(openPopoverEl);
  }
  openPopoverEl = null;
}

/**
 * Opens the "Import" popover (toolbar button): lets the user pick a saved
 * `ui-changes.md`/JSON file, or (in proxy mode) load the proxy's last
 * export, parses it, and either applies it right away (current list empty)
 * or asks whether to replace or append. Esc closes the popover.
 * @param {OverlayContext} ctx
 */
export function openImportPopover(ctx) {
  closeImportPopover();
  const doc = ctx.shadow.ownerDocument;

  const popover = doc.createElement('div');
  popover.className = 'uce-popover uce-import-popover';

  const chooseBtn = doc.createElement('button');
  chooseBtn.type = 'button';
  chooseBtn.className = 'uce-btn';
  chooseBtn.textContent = t('import.chooseFile');

  const fileInput = doc.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.md,.json,application/json,text/markdown';
  fileInput.hidden = true;

  chooseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const text = typeof file.text === 'function' ? await file.text() : await readFileAsText(file);
      handleParsed(parseImport(text));
    } catch (err) {
      reportError(err);
    }
  });

  popover.append(chooseBtn, fileInput);

  if (ctx.proxyMode) {
    const loadBtn = doc.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'uce-btn';
    loadBtn.textContent = t('import.loadLastExport');
    loadBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/__uce/export');
        if (res.status === 404) {
          ctx.toast(t('toast.importNoExport'), { error: true });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        handleParsed(parseImport(text));
      } catch (err) {
        reportError(err);
      }
    });
    popover.append(loadBtn);
  }

  const countsEl = doc.createElement('div');
  countsEl.className = 'uce-import-counts';
  countsEl.hidden = true;

  const confirmRow = doc.createElement('div');
  confirmRow.className = 'uce-popover-actions';
  confirmRow.hidden = true;

  const cancelBtn = doc.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'uce-btn';
  cancelBtn.textContent = t('common.cancel');
  cancelBtn.addEventListener('click', () => closeImportPopover());

  const appendBtn = doc.createElement('button');
  appendBtn.type = 'button';
  appendBtn.className = 'uce-btn';
  appendBtn.textContent = t('import.append');

  const replaceBtn = doc.createElement('button');
  replaceBtn.type = 'button';
  replaceBtn.className = 'uce-btn uce-primary';
  replaceBtn.textContent = t('import.replace');

  confirmRow.append(cancelBtn, appendBtn, replaceBtn);
  popover.append(countsEl, confirmRow);

  /** @type {ImportResult|null} */
  let pending = null;

  /** @param {Source|undefined} source */
  function originHint(source) {
    if (!source || !source.url) return '';
    try {
      const origin = new URL(source.url).origin;
      if (origin !== ctx.targetOrigin) return t('toast.importFromOrigin', { origin });
    } catch {
      // unparsable source.url: no hint
    }
    return '';
  }

  /**
   * @param {ImportResult} result
   * @param {'replace'|'append'} mode
   */
  function commit(result, mode) {
    ctx.dispatch({ type: 'import', changes: result.changes, mode });
    let msg = t('toast.imported', { count: result.changes.length });
    if (result.skipped > 0) msg += ` (${t('toast.importSkipped', { count: result.skipped })})`;
    const hint = originHint(result.source);
    if (hint) msg += ` — ${hint}`;
    ctx.toast(msg);
    closeImportPopover();
  }

  /** @param {ImportResult} result */
  function handleParsed(result) {
    if (result.changes.length === 0) {
      let msg = t('toast.imported', { count: 0 });
      if (result.skipped > 0) msg += ` (${t('toast.importSkipped', { count: result.skipped })})`;
      ctx.toast(msg, { error: result.skipped > 0 });
      closeImportPopover();
      return;
    }
    const current = ctx.getState().changes.length;
    if (current === 0) {
      commit(result, 'replace');
      return;
    }
    pending = result;
    countsEl.textContent = t('import.counts', { current, imported: result.changes.length });
    countsEl.hidden = false;
    confirmRow.hidden = false;
  }

  /** @param {unknown} err */
  function reportError(err) {
    const message = err && /** @type {Error} */ (err).message ? /** @type {Error} */ (err).message : String(err);
    ctx.toast(t('toast.importFailed', { name: message }), { error: true });
  }

  replaceBtn.addEventListener('click', () => {
    if (pending) commit(pending, 'replace');
  });
  appendBtn.addEventListener('click', () => {
    if (pending) commit(pending, 'append');
  });

  popover.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeImportPopover();
    }
  });

  ctx.layer.appendChild(popover);
  placeAboveToolbar(ctx.shadow, popover);
  openPopoverEl = popover;
}

/**
 * FileReader-based fallback for hosts without `File.prototype.text`.
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsText(file);
  });
}

// @ts-check
import { isEditableTarget } from './dom-utils.js';
import { t, getLang, setLang } from './i18n.js';

/**
 * @typedef {import('./changes.js').State} State
 * @typedef {import('./index.js').OverlayContext} OverlayContext
 */

/**
 * Draggable, collapsible toolbar: mode toggle, undo/redo, change count
 * (toggles the side panel), export, copy, discard-all, language toggle.
 * Also owns the toast used for feedback ("Saved: …", "Copied", errors) and
 * the global `E` shortcut for entering edit mode.
 * @param {OverlayContext} ctx
 * @returns {{ el: HTMLElement, toastEl: HTMLElement, update: (state: State) => void, showToast: (message: string, opts?: { error?: boolean }) => void }}
 */
export function createToolbar(ctx) {
  const doc = ctx.shadow.ownerDocument;
  const win = doc.defaultView || window;

  const el = doc.createElement('div');
  el.className = 'uce-toolbar';

  const handle = doc.createElement('span');
  handle.className = 'uce-toolbar-handle';
  handle.textContent = '⠿';
  handle.title = t('toolbar.dragHandle');

  const collapseBtn = doc.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'uce-btn';
  collapseBtn.textContent = '—';
  collapseBtn.title = t('toolbar.collapse');
  collapseBtn.addEventListener('click', () => {
    el.classList.toggle('uce-collapsed');
  });

  const body = doc.createElement('div');
  body.className = 'uce-toolbar-body';

  const modeBtn = button(doc, '', () => {
    ctx.setMode(ctx.getMode() === 'edit' ? 'view' : 'edit');
  });
  modeBtn.title = t('toolbar.modeToggleTitle');

  const undoBtn = button(doc, t('toolbar.undo'), () => ctx.dispatch({ type: 'undo' }));
  const redoBtn = button(doc, t('toolbar.redo'), () => ctx.dispatch({ type: 'redo' }));
  const addBtn = button(doc, t('toolbar.add'), () => {
    // Place mode only works while edit mode intercepts page clicks.
    ctx.setMode('edit');
    ctx.openPalette();
  });
  addBtn.title = t('toolbar.addTitle');
  const changesBtn = button(doc, t('changes.title'), () => ctx.togglePanel());
  const exportBtn = button(doc, t('toolbar.export'), () => ctx.doExport());
  exportBtn.classList.add('uce-primary');
  const copyBtn = button(doc, t('toolbar.copy'), () => ctx.doCopy());
  const discardBtn = button(doc, t('toolbar.discardAll'), () => {
    const view = doc.defaultView;
    const confirmed = view && typeof view.confirm === 'function' ? view.confirm(t('toolbar.discardConfirm')) : true;
    if (confirmed) ctx.dispatch({ type: 'clear' });
  });
  discardBtn.classList.add('uce-danger');

  const langBtn = button(doc, getLang().toUpperCase(), () => {
    setLang(getLang() === 'de' ? 'en' : 'de');
    win.location.reload();
  });
  langBtn.title = t('toolbar.language');
  langBtn.setAttribute('aria-label', t('toolbar.language'));

  body.append(modeBtn, sep(doc), undoBtn, redoBtn, sep(doc), addBtn, changesBtn, sep(doc), exportBtn, copyBtn, sep(doc), discardBtn, sep(doc), langBtn);
  if (ctx.proxyMode) {
    const otherUrlBtn = button(doc, t('toolbar.changeUrl'), () => {
      win.location.href = '/__uce/';
    });
    body.append(sep(doc), otherUrlBtn);
  }
  el.append(handle, collapseBtn, body);

  // --- dragging (handle only) ---
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    const rect = el.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    e.preventDefault();
  });
  win.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    el.style.left = `${e.clientX - offsetX}px`;
    el.style.top = `${e.clientY - offsetY}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  });
  win.addEventListener('mouseup', () => {
    dragging = false;
  });

  // --- toast ---
  const toastEl = doc.createElement('div');
  toastEl.className = 'uce-toast';
  /** @type {ReturnType<typeof setTimeout>|null} */
  let toastTimer = null;
  /**
   * @param {string} message
   * @param {{ error?: boolean }} [opts]
   */
  function showToast(message, opts = {}) {
    toastEl.textContent = message;
    toastEl.classList.toggle('uce-error', Boolean(opts.error));
    toastEl.classList.add('uce-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('uce-visible'), 2600);
  }

  // --- E shortcut: only leaves "Interact" mode, never the reverse, and
  // never while typing anywhere (not just inside the overlay) ---
  win.addEventListener('keydown', (e) => {
    if (e.key !== 'e' && e.key !== 'E') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (ctx.getMode() !== 'view') return;
    if (isEditableTarget(doc.activeElement)) return;
    ctx.setMode('edit');
  });

  /** @param {State} state */
  function update(state) {
    const mode = ctx.getMode();
    modeBtn.textContent = mode === 'edit' ? t('mode.edit') : t('mode.view');
    modeBtn.classList.toggle('uce-active', mode === 'edit');
    undoBtn.disabled = state.past.length === 0;
    redoBtn.disabled = state.future.length === 0;
    changesBtn.classList.toggle('uce-active', ctx.isPanelVisible());
    changesBtn.textContent = '';
    changesBtn.append(t('changes.title'));
    const count = doc.createElement('span');
    count.className = 'uce-count';
    count.textContent = String(state.changes.length);
    changesBtn.append(count);
    langBtn.textContent = getLang().toUpperCase();
    langBtn.title = t('toolbar.language');
  }

  return { el, toastEl, update, showToast };
}

/**
 * @param {Document} doc
 * @param {string} label
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
function button(doc, label, onClick) {
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'uce-btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * @param {Document} doc
 * @returns {HTMLElement}
 */
function sep(doc) {
  const s = doc.createElement('div');
  s.className = 'uce-sep';
  return s;
}

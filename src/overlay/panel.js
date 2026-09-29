// @ts-check
import { getLabelText, isValueButton, getInsertRoot } from './dom-utils.js';
import { t, getLang } from './i18n.js';

/**
 * @typedef {import('./changes.js').Change} Change
 * @typedef {import('./changes.js').State} State
 * @typedef {import('./locator.js').Locator} Locator
 * @typedef {import('./preview.js').PreviewResult} PreviewResult
 * @typedef {import('./index.js').OverlayContext} OverlayContext
 */

/** i18n keys for change type labels, identical to export.js's headings. */
const TYPE_KEYS = {
  text: 'type.text',
  attr: 'type.attr',
  move: 'type.move',
  insert: 'type.insert',
  remove: 'type.remove',
  comment: 'type.comment',
};

/** i18n keys for `move`/`insert` positions, identical to export.js's. */
const POSITION_KEYS = {
  before: 'position.before',
  after: 'position.after',
  'inside-start': 'position.insideStart',
  'inside-end': 'position.insideEnd',
};

/**
 * @param {string} type
 * @returns {string}
 */
function typeLabel(type) {
  const key = TYPE_KEYS[type];
  return key ? t(key) : type;
}

/**
 * @param {string} position
 * @returns {string}
 */
function positionLabel(position) {
  const key = POSITION_KEYS[position];
  return key ? t(key) : position;
}

/**
 * Straight quotes in English, „…“ in German.
 * @param {string} text
 * @returns {string}
 */
function quote(text) {
  return getLang() === 'de' ? `„${text}“` : `"${text}"`;
}

/**
 * `{tag} {quoted name}` if the locator has a name, else `{tag} in {last
 * breadcrumb item}`, else just `{tag}`. Mirrors export.js's `subject()`.
 * @param {Locator|undefined} loc
 * @returns {string}
 */
function subject(loc) {
  if (!loc) return '';
  if (loc.name) return `${loc.tag} ${quote(loc.name)}`;
  if (loc.breadcrumb) {
    const parts = loc.breadcrumb.split(' › ');
    return `${loc.tag} in ${parts[parts.length - 1]}`;
  }
  return loc.tag;
}

/**
 * @param {Change} change
 * @returns {string}
 */
function diffText(change) {
  if (change.type === 'text') {
    return t('diff.text', { before: change.before, after: change.after });
  }
  if (change.type === 'attr') {
    const attrLabel = change.attr === 'label' ? t('common.fieldLabel') : change.attr;
    const before = change.before === '' ? t('common.empty') : quote(change.before);
    const after = change.after === '' ? t('common.empty') : quote(change.after);
    return `${attrLabel}: ${before} → ${after}`;
  }
  if (change.type === 'comment') {
    return change.note;
  }
  if (change.type === 'remove') {
    return t('common.willBeRemoved');
  }
  if (change.type === 'move') {
    const pos = positionLabel(change.position);
    return `${pos} ${subject(change.anchor)}`;
  }
  if (change.type === 'insert') {
    return t('diff.insertText', { text: change.text });
  }
  return '';
}

/**
 * Field definitions for the selected element's editable "description"
 * attributes (§4.2): placeholder, title, aria-label, alt, value (buttons),
 * label (form fields). Only the fields relevant to the element are shown.
 * @param {Element} el
 * @returns {Array<{ attr: string, label: string, value: string }>}
 */
function fieldsFor(el) {
  const tag = el.tagName;
  /** @type {Array<{ attr: string, label: string, value: string }>} */
  const fields = [];
  fields.push({ attr: 'title', label: t('field.title'), value: el.getAttribute('title') || '' });
  fields.push({ attr: 'aria-label', label: t('field.ariaLabel'), value: el.getAttribute('aria-label') || '' });
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    fields.push({ attr: 'placeholder', label: t('field.placeholder'), value: el.getAttribute('placeholder') || '' });
  }
  if (tag === 'IMG' || (tag === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'image')) {
    fields.push({ attr: 'alt', label: t('field.altText'), value: el.getAttribute('alt') || '' });
  }
  if (isValueButton(el) || tag === 'BUTTON') {
    fields.push({ attr: 'value', label: t('field.value'), value: /** @type {HTMLInputElement} */ (el).value || '' });
  }
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    fields.push({ attr: 'label', label: t('field.label'), value: getLabelText(el) });
  }
  return fields;
}

/**
 * Builds the side panel (selected-element fields + numbered change list) and
 * the change-marker layer (number badges + remove overlay boxes). Both are
 * driven by `update(state, previewResults)`, called after every dispatch.
 * @param {OverlayContext} ctx
 * @returns {{ panelEl: HTMLElement, markersLayerEl: HTMLElement, update: (state: State, previewResults: PreviewResult[]) => void, reposition: () => void, setVisible: (visible: boolean) => void }}
 */
export function createPanel(ctx) {
  const doc = ctx.shadow.ownerDocument;

  const panelEl = doc.createElement('div');
  panelEl.className = 'uce-panel';
  panelEl.hidden = true;

  const selectedSection = doc.createElement('div');
  selectedSection.className = 'uce-panel-section';

  const listSection = doc.createElement('div');
  listSection.className = 'uce-panel-section';
  listSection.style.flex = '1';
  listSection.style.display = 'flex';
  listSection.style.flexDirection = 'column';
  const listHeadingRow = doc.createElement('div');
  listHeadingRow.className = 'uce-panel-heading-row';
  const listHeading = doc.createElement('h3');
  listHeading.textContent = t('changes.title');
  const resyncBtn = doc.createElement('button');
  resyncBtn.type = 'button';
  resyncBtn.className = 'uce-btn uce-resync-btn';
  resyncBtn.textContent = t('panel.reapply');
  resyncBtn.hidden = true;
  resyncBtn.addEventListener('click', () => ctx.resync());
  listHeadingRow.appendChild(listHeading);
  listHeadingRow.appendChild(resyncBtn);
  const listContainer = doc.createElement('div');
  listContainer.style.overflow = 'auto';
  listContainer.style.flex = '1';
  listSection.appendChild(listHeadingRow);
  listSection.appendChild(listContainer);

  panelEl.appendChild(selectedSection);
  panelEl.appendChild(listSection);

  const markersLayerEl = doc.createElement('div');
  markersLayerEl.className = 'uce-markers-layer';

  /**
   * @param {Element|null} el
   */
  function renderSelectedSection(el) {
    selectedSection.innerHTML = '';
    const heading = doc.createElement('h3');
    heading.textContent = t('panel.selectedHeading');
    selectedSection.appendChild(heading);

    if (!el) {
      const empty = doc.createElement('div');
      empty.className = 'uce-empty';
      empty.textContent = t('panel.noSelection');
      selectedSection.appendChild(empty);
      return;
    }

    // Preview clones (insert changes) have no locator of their own (design:
    // locators always describe the original DOM). Show what they are
    // instead of resolving one, and disable the description fields — an
    // attr/comment change on a clone is meaningless (there's nothing in
    // source yet to point at); text is still edited via double-click/Enter.
    const insertRoot = getInsertRoot(el);
    const summary = doc.createElement('div');
    summary.className = 'uce-locator-summary';
    if (insertRoot) {
      summary.innerHTML = `<div><strong>${escapeHtml(el.tagName.toLowerCase())}</strong> · <em>${escapeHtml(t('panel.newElementInline'))}</em></div>`;
    } else {
      const locator = ctx.createLocator(el);
      summary.innerHTML =
        `<div><strong>${escapeHtml(locator.tag)}</strong> · <code>${escapeHtml(locator.selector)}</code></div>` +
        (locator.breadcrumb ? `<div>${escapeHtml(locator.breadcrumb)}</div>` : '');
    }
    selectedSection.appendChild(summary);

    for (const field of fieldsFor(el)) {
      const wrap = doc.createElement('div');
      wrap.className = 'uce-field';
      const label = doc.createElement('label');
      label.textContent = field.label;
      const input = doc.createElement('input');
      input.type = 'text';
      input.value = field.value;
      if (insertRoot) {
        input.disabled = true;
      } else {
        const commit = () => {
          const after = input.value;
          if (after === field.value) return;
          const target = ctx.createLocator(el);
          ctx.dispatch({
            type: 'add',
            change: { type: 'attr', target, attr: field.attr, before: field.value, after },
          });
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        });
      }
      wrap.appendChild(label);
      wrap.appendChild(input);
      selectedSection.appendChild(wrap);
    }
  }

  /**
   * @param {State} state
   * @param {PreviewResult[]} previewResults
   */
  function renderChangeList(state, previewResults) {
    listContainer.innerHTML = '';
    if (state.changes.length === 0) {
      const empty = doc.createElement('div');
      empty.className = 'uce-empty';
      empty.textContent = t('panel.noChanges');
      listContainer.appendChild(empty);
      return;
    }
    const ul = doc.createElement('ul');
    ul.className = 'uce-change-list';
    state.changes.forEach((change, index) => {
      const result = previewResults.find((r) => r.change.id === change.id);
      const li = doc.createElement('li');
      li.className = 'uce-change-item';

      const num = doc.createElement('span');
      num.className = 'uce-change-num';
      num.textContent = String(index + 1);

      const body = doc.createElement('div');
      body.className = 'uce-change-body';
      const typeEl = doc.createElement('div');
      typeEl.className = 'uce-change-type';
      typeEl.textContent = typeLabel(change.type);
      const subjectEl = doc.createElement('div');
      subjectEl.className = 'uce-change-subject';
      subjectEl.textContent =
        change.type === 'insert' ? t('panel.copyOf', { name: subject(change.template) }) : subject(change.target);
      const diffEl = doc.createElement('div');
      diffEl.className = 'uce-change-diff';
      diffEl.textContent = diffText(change);
      body.appendChild(typeEl);
      body.appendChild(subjectEl);
      body.appendChild(diffEl);
      if (result && !result.found) {
        const missing = doc.createElement('div');
        missing.className = 'uce-change-missing';
        missing.textContent = t('panel.notFound');
        body.appendChild(missing);
      }

      const del = doc.createElement('button');
      del.type = 'button';
      del.className = 'uce-change-del';
      del.setAttribute('aria-label', t('panel.deleteChange'));
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        ctx.dispatch({ type: 'delete', id: change.id });
      });

      li.addEventListener('click', () => {
        if (result && result.found && result.el) {
          ctx.setSelection(result.el);
          result.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      });

      li.appendChild(num);
      li.appendChild(body);
      li.appendChild(del);
      ul.appendChild(li);
    });
    listContainer.appendChild(ul);
  }

  /**
   * @param {State} state
   * @param {PreviewResult[]} previewResults
   */
  function renderMarkers(state, previewResults) {
    markersLayerEl.innerHTML = '';
    state.changes.forEach((change, index) => {
      const result = previewResults.find((r) => r.change.id === change.id);
      if (!result || !result.found || !result.el) return;
      const rect = result.el.getBoundingClientRect();
      // element not rendered (e.g. in a hidden view/tab): no marker at 0,0
      if (rect.width === 0 && rect.height === 0) return;

      if (change.type === 'remove') {
        const box = doc.createElement('div');
        box.className = 'uce-removebox';
        box.style.display = 'block';
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
        markersLayerEl.appendChild(box);
      }

      const marker = doc.createElement('div');
      marker.className = 'uce-marker';
      marker.style.display = 'block';
      marker.style.left = `${rect.left}px`;
      marker.style.top = `${rect.top}px`;
      marker.textContent = String(index + 1);
      marker.title = typeLabel(change.type);
      const targetEl = result.el;
      marker.addEventListener('click', () => {
        ctx.setSelection(targetEl);
        targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      markersLayerEl.appendChild(marker);
    });
  }

  /** @type {State|null} */
  let lastState = null;
  /** @type {PreviewResult[]} */
  let lastPreviewResults = [];

  /**
   * @param {State} state
   * @param {PreviewResult[]} previewResults
   */
  function update(state, previewResults) {
    lastState = state;
    lastPreviewResults = previewResults;
    // Re-render unconditionally: field values (e.g. after undo) or the
    // selection itself may have changed since the last render, and a
    // focused input's own blur/Enter handler already committed its edit
    // before this runs.
    renderSelectedSection(ctx.getSelection());
    renderChangeList(state, previewResults);
    renderMarkers(state, previewResults);
    resyncBtn.hidden = !previewResults.some((r) => !r.found);
  }

  /**
   * Re-reads marker positions only (scroll/resize/app re-render), reusing
   * the last known preview results. Deliberately never touches
   * `renderSelectedSection` — that calls `ctx.createLocator`, which itself
   * mutates the page DOM (see preview.js's `withOriginalDom`) and would
   * re-trigger the very MutationObserver that drives this path, looping
   * forever.
   */
  function reposition() {
    if (!lastState) return;
    renderMarkers(lastState, lastPreviewResults);
  }

  /** @param {boolean} visible */
  function setVisible(visible) {
    panelEl.hidden = !visible;
  }

  return { panelEl, markersLayerEl, update, reposition, setVisible };
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

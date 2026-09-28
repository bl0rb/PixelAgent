// @ts-check
// Overlay i18n: language detection/persistence and a tiny `t(key, params)`
// lookup. English is the default/fallback language; German values are kept
// byte-identical to the original German-only UI. No import-time side
// effects beyond building the constant message tables below.

/** @typedef {'en'|'de'} Lang */

const STORAGE_KEY = 'uce-lang';

/** @type {Record<Lang, Record<string, string>>} */
const MESSAGES = {
  en: {
    'toolbar.dragHandle': 'Move',
    'toolbar.collapse': 'Expand/Collapse',
    'toolbar.modeToggleTitle': 'Toggle Interact/Edit (E)',
    'mode.view': 'Interact',
    'mode.edit': 'Edit',
    'toolbar.undo': 'Undo',
    'toolbar.redo': 'Redo',
    'toolbar.add': 'Add',
    'toolbar.addTitle': 'Insert similar element (A)',
    'changes.title': 'Changes',
    'toolbar.export': 'Export',
    'toolbar.copy': 'Copy',
    'toolbar.discardAll': 'Discard all',
    'toolbar.discardConfirm': 'Really discard all changes?',
    'toolbar.changeUrl': 'Change URL',
    'toolbar.language': 'Language',

    'toast.saved': 'Saved: {name}',
    'toast.downloaded': 'Downloaded: ui-changes.md',
    'toast.exportFailed': 'Export failed: {name}',
    'toast.copied': 'Copied',
    'toast.copyFailed': 'Copy failed',
    'toast.moveHint': 'Drag to move – or Alt+↑/↓',
    'toast.notPossibleForNewElements': 'Not possible for new elements',
    'toast.moveNextToNewElementImpossible': 'Moving next to a new element is not possible',
    'toast.placeHint': 'Click where to insert it (Esc to cancel)',
    'toast.noSimilarElements': 'No similar elements found',

    'quick.rename': 'Rename (Enter)',
    'quick.move': 'Move – drag or Alt+↑/↓',
    'quick.comment': 'Comment (C)',

    'panel.selectedHeading': 'Selected element',
    'panel.noSelection': 'No element selected.',
    'panel.newElementInline': 'new element',
    'panel.reapply': 'Re-apply',
    'panel.noChanges': 'No changes yet.',
    'panel.notFound': 'Element not found',
    'panel.deleteChange': 'Delete change',
    'panel.copyOf': 'Copy of {name}',

    'field.title': 'Title',
    'field.ariaLabel': 'Aria label',
    'field.placeholder': 'Placeholder',
    'field.altText': 'Alt text',
    'field.value': 'Value',
    'field.label': 'Label',

    'type.text': 'Change text',
    'type.attr': 'Change description',
    'type.move': 'Move',
    'type.insert': 'New element',
    'type.remove': 'Remove',
    'type.comment': 'Comment',

    'position.before': 'before',
    'position.after': 'after',
    'position.insideStart': 'at the start of',
    'position.insideEnd': 'at the end of',

    'common.empty': '(empty)',
    'common.fieldLabel': 'Field label',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.willBeRemoved': 'will be removed',

    'diff.text': '"{before}" → "{after}"',
    'diff.insertText': 'Text: "{text}"',

    'comment.placeholder': 'Comment …',

    'palette.searchPlaceholder': 'Search element …',
    'palette.noResults': 'No matches.',
  },
  de: {
    'toolbar.dragHandle': 'Verschieben',
    'toolbar.collapse': 'Ein-/Ausklappen',
    'toolbar.modeToggleTitle': 'Bedienen/Bearbeiten umschalten (E)',
    'mode.view': 'Bedienen',
    'mode.edit': 'Bearbeiten',
    'toolbar.undo': 'Rückgängig',
    'toolbar.redo': 'Wiederholen',
    'toolbar.add': 'Hinzufügen',
    'toolbar.addTitle': 'Gleichartiges Element einfügen (A)',
    'changes.title': 'Änderungen',
    'toolbar.export': 'Export',
    'toolbar.copy': 'Kopieren',
    'toolbar.discardAll': 'Alles verwerfen',
    'toolbar.discardConfirm': 'Alle Änderungen wirklich verwerfen?',
    'toolbar.changeUrl': 'Andere URL',
    'toolbar.language': 'Sprache',

    'toast.saved': 'Gespeichert: {name}',
    'toast.downloaded': 'Heruntergeladen: ui-changes.md',
    'toast.exportFailed': 'Export fehlgeschlagen: {name}',
    'toast.copied': 'Kopiert',
    'toast.copyFailed': 'Kopieren fehlgeschlagen',
    'toast.moveHint': 'Zum Verschieben ziehen – oder Alt+↑/↓',
    'toast.notPossibleForNewElements': 'Für neue Elemente nicht möglich',
    'toast.moveNextToNewElementImpossible': 'Verschieben neben ein neues Element ist nicht möglich',
    'toast.placeHint': 'Einfügeort anklicken (Esc zum Abbrechen)',
    'toast.noSimilarElements': 'Keine gleichartigen Elemente gefunden',

    'quick.rename': 'Umbenennen (Enter)',
    'quick.move': 'Verschieben – ziehen oder Alt+↑/↓',
    'quick.comment': 'Kommentar (C)',

    'panel.selectedHeading': 'Ausgewähltes Element',
    'panel.noSelection': 'Kein Element ausgewählt.',
    'panel.newElementInline': 'neues Element',
    'panel.reapply': 'Erneut anwenden',
    'panel.noChanges': 'Noch keine Änderungen.',
    'panel.notFound': 'Element nicht gefunden',
    'panel.deleteChange': 'Änderung löschen',
    'panel.copyOf': 'Kopie von {name}',

    'field.title': 'Title',
    'field.ariaLabel': 'Aria-Label',
    'field.placeholder': 'Placeholder',
    'field.altText': 'Alt-Text',
    'field.value': 'Wert',
    'field.label': 'Label',

    'type.text': 'Text ändern',
    'type.attr': 'Beschreibung ändern',
    'type.move': 'Verschieben',
    'type.insert': 'Neues Element',
    'type.remove': 'Entfernen',
    'type.comment': 'Kommentar',

    'position.before': 'vor',
    'position.after': 'nach',
    'position.insideStart': 'am Anfang von',
    'position.insideEnd': 'am Ende von',

    'common.empty': '(leer)',
    'common.fieldLabel': 'Label des Feldes',
    'common.cancel': 'Abbrechen',
    'common.save': 'Speichern',
    'common.willBeRemoved': 'wird entfernt',

    'diff.text': '„{before}“ → „{after}“',
    'diff.insertText': 'Text: „{text}“',

    'comment.placeholder': 'Kommentar …',

    'palette.searchPlaceholder': 'Element suchen …',
    'palette.noResults': 'Keine Treffer.',
  },
};

/** Exposed for tests (key-completeness checks) and export.js's English-pinned lookups. */
export const messages = MESSAGES;

/**
 * Detects the language from `navigator.language` alone (no storage lookup):
 * `'de'` if it starts with `'de'`, else `'en'`.
 * @returns {Lang}
 */
export function detectLang() {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator.language : '';
    return typeof nav === 'string' && nav.toLowerCase().startsWith('de') ? 'de' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Current language: `localStorage['uce-lang']` if it holds `'en'`/`'de'`,
 * else `detectLang()`.
 * @returns {Lang}
 */
export function getLang() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'de') return stored;
  } catch {
    // localStorage unavailable (private mode, disabled, ...): fall through
  }
  return detectLang();
}

/**
 * Persists the language choice for `getLang()`/the launcher page to pick up.
 * @param {Lang} lang
 */
export function setLang(lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore quota/availability errors
  }
}

/**
 * Looks up `key` in `lang` (default: `getLang()`), falling back to English,
 * then to the key itself if still missing. `{name}`-style placeholders in
 * `params` are interpolated.
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @param {Lang} [lang]
 * @returns {string}
 */
export function t(key, params, lang) {
  const l = lang || getLang();
  const table = MESSAGES[l] || MESSAGES.en;
  let msg = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : MESSAGES.en[key];
  if (msg == null) return key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      msg = msg.split(`{${name}}`).join(String(value));
    }
  }
  return msg;
}

// @ts-check
// Server-side text table (JSON error messages, 502/403/404 pages). Language is
// picked per request from Accept-Language: 'de*' -> German, everything else
// (including a missing header) -> English (default/fallback).

const MESSAGES = {
  en: {
    gatewayError: '502 Bad Gateway: target server unreachable.',
    crossOriginError: '403 Forbidden: request origin not allowed.',
    fwdHostNotAllowed: (/** @type {string} */ host) => `403 Forbidden: forwarding to ${host} is not allowed.`,
    exportTooLarge: 'Export too large (limit 5 MB).',
    writeFailed: 'Could not write file.',
    invalidRequest: 'Invalid request.',
    missingUrl: 'Please provide a target URL.',
    invalidUrl: (/** @type {string} */ url) => `Invalid URL: ${url}`,
    unsupportedScheme: 'Only http and https are supported.',
    dirNotFound: (/** @type {string} */ dir) => `Directory not found: ${dir}`,
    notADir: (/** @type {string} */ dir) => `Not a directory: ${dir}`,
    targetMaybeUnreachable: 'Target may be unreachable.',
    notFound: 'Not Found',
    pickDirPrompt: 'Choose the save location for ui-changes.md',
    pickDirUnsupported: 'Folder picker not available on this system.',
    pickDirBusy: 'A folder dialog is already open.',
    pickDirFailed: 'Could not open the folder dialog.',
  },
  de: {
    gatewayError: '502 Bad Gateway: Ziel-Server nicht erreichbar.',
    crossOriginError: '403 Verboten: Anfrage-Herkunft nicht erlaubt.',
    fwdHostNotAllowed: (/** @type {string} */ host) => `403 Verboten: Weiterleitung an ${host} ist nicht erlaubt.`,
    exportTooLarge: 'Export zu groß (Limit 5 MB).',
    writeFailed: 'Konnte Datei nicht schreiben.',
    invalidRequest: 'Ungültige Anfrage.',
    missingUrl: 'Bitte eine Ziel-URL angeben.',
    invalidUrl: (/** @type {string} */ url) => `Ungültige URL: ${url}`,
    unsupportedScheme: 'Nur http und https werden unterstützt.',
    dirNotFound: (/** @type {string} */ dir) => `Verzeichnis nicht gefunden: ${dir}`,
    notADir: (/** @type {string} */ dir) => `Kein Verzeichnis: ${dir}`,
    targetMaybeUnreachable: 'Ziel evtl. nicht erreichbar.',
    notFound: 'Nicht gefunden',
    pickDirPrompt: 'Speicherort für ui-changes.md wählen',
    pickDirUnsupported: 'Ordnerauswahl auf diesem System nicht verfügbar.',
    pickDirBusy: 'Es ist bereits eine Ordnerauswahl geöffnet.',
    pickDirFailed: 'Ordnerauswahl konnte nicht geöffnet werden.',
  },
};

/**
 * Pick the server-side language from an Accept-Language header value.
 * @param {string | string[] | undefined} acceptLanguage
 * @returns {'en'|'de'}
 */
export function pickLang(acceptLanguage) {
  const value = Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage;
  return typeof value === 'string' && /^\s*de/i.test(value) ? 'de' : 'en';
}

/**
 * @param {'en'|'de'} lang
 * @returns {typeof MESSAGES.en}
 */
export function messages(lang) {
  return MESSAGES[lang] || MESSAGES.en;
}

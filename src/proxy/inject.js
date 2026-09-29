// @ts-check
// Pure helpers for injecting a script tag into an HTML document.

/**
 * Inject an HTML tag into a document string.
 * Prefers right before `</body>`, falls back to right before `</head>`,
 * otherwise appends the tag to the end of the document.
 * The search is case-insensitive but the original casing of the document is preserved.
 *
 * @param {string} html
 * @param {string} tag
 * @returns {string}
 */
export function injectScript(html, tag) {
  const bodyMatch = /<\/body\s*>/i.exec(html);
  if (bodyMatch) {
    return html.slice(0, bodyMatch.index) + tag + html.slice(bodyMatch.index);
  }
  const headMatch = /<\/head\s*>/i.exec(html);
  if (headMatch) {
    return html.slice(0, headMatch.index) + tag + html.slice(headMatch.index);
  }
  return html + tag;
}

/**
 * Inject an HTML tag right after the opening `<head ...>` tag, so it runs
 * before any other head content (used for the network shim, which must patch
 * fetch/XHR/WebSocket/etc. before app code runs).
 * Falls back to right before the first `<script` tag, then to prepending the
 * tag at the very start of the document.
 *
 * @param {string} html
 * @param {string} tag
 * @returns {string}
 */
export function injectHeadScript(html, tag) {
  const headMatch = /<head[^>]*>/i.exec(html);
  if (headMatch) {
    const insertAt = headMatch.index + headMatch[0].length;
    return html.slice(0, insertAt) + tag + html.slice(insertAt);
  }
  const scriptMatch = /<script/i.exec(html);
  if (scriptMatch) {
    return html.slice(0, scriptMatch.index) + tag + html.slice(scriptMatch.index);
  }
  return tag + html;
}

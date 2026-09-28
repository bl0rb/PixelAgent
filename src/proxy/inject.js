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

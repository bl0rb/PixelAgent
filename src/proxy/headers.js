// @ts-check
// Pure helpers for rewriting/stripping HTTP headers between target and proxy origin.

const STRIP_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
];

/**
 * Remove headers that would block the overlay from running in the proxy origin
 * (CSP / CSP-Report-Only / X-Frame-Options). Mutates and returns the given headers object.
 *
 * @param {import('http').IncomingHttpHeaders} headers
 * @returns {import('http').IncomingHttpHeaders}
 */
export function stripSecurityHeaders(headers) {
  for (const name of STRIP_HEADERS) {
    delete headers[name];
  }
  return headers;
}

/**
 * Rewrite a `Location` header from the target origin to the proxy origin.
 * Absolute URLs pointing at the target origin are rewritten; relative URLs and
 * URLs pointing elsewhere are returned unchanged.
 *
 * @param {string} location
 * @param {string} targetOrigin
 * @param {string} proxyOrigin
 * @returns {string}
 */
export function rewriteLocation(location, targetOrigin, proxyOrigin) {
  let url;
  try {
    // No base: only absolute URLs are rewritten, relative ones already
    // resolve correctly against the proxy origin in the browser.
    url = new URL(location);
  } catch {
    return location;
  }
  if (url.origin === targetOrigin) {
    return proxyOrigin + url.pathname + url.search + url.hash;
  }
  return location;
}

/**
 * Rewrite a single `Set-Cookie` header value for the proxy:
 * - drop the `Domain` attribute (so the cookie applies to the proxy host)
 * - if the target is https and the proxy is http, drop `Secure` and
 *   downgrade `SameSite=None` to `SameSite=Lax` (browsers reject
 *   `SameSite=None` without `Secure`)
 * - when `pathPrefix` is given (used for `/__uce/fwd/...` forwarding), prefix
 *   the `Path` attribute with it so the cookie only applies under the fwd
 *   path the cookie actually came from (`Path=/api` -> `Path=<prefix>/api`;
 *   a missing or root `Path` becomes `Path=<prefix>`)
 *
 * @param {string} cookie
 * @param {{ targetIsHttps: boolean, proxyIsHttps: boolean, pathPrefix?: string }} opts
 * @returns {string}
 */
export function rewriteSetCookie(cookie, { targetIsHttps, proxyIsHttps, pathPrefix }) {
  const parts = cookie.split(';').map((p) => p.trim());
  const downgrade = targetIsHttps && !proxyIsHttps;
  let sawPath = false;
  const result = [];
  for (const part of parts) {
    const [rawName] = part.split('=');
    const name = rawName.trim().toLowerCase();
    if (name === 'domain') continue;
    if (downgrade && name === 'secure') continue;
    if (downgrade && name === 'samesite') {
      const value = part.slice(part.indexOf('=') + 1).trim();
      if (value.toLowerCase() === 'none') {
        result.push('SameSite=Lax');
        continue;
      }
    }
    if (pathPrefix !== undefined && name === 'path') {
      sawPath = true;
      const value = part.slice(part.indexOf('=') + 1).trim();
      result.push(`Path=${value === '' || value === '/' ? pathPrefix : pathPrefix + value}`);
      continue;
    }
    result.push(part);
  }
  if (pathPrefix !== undefined && !sawPath) {
    result.push(`Path=${pathPrefix}`);
  }
  return result.join('; ');
}

/**
 * Rewrite a `Location` header from a `/__uce/fwd/...` response: absolute URLs
 * pointing at the upstream origin (the actual host the request was forwarded
 * to) or at the main target's origin (some backends echo back the rewritten
 * `Origin`) are rewritten to the proxy origin under the fwd path prefix.
 * Relative URLs and URLs pointing elsewhere are returned unchanged.
 *
 * @param {string} location
 * @param {string} upstreamOrigin
 * @param {string} targetOrigin
 * @param {string} proxyOrigin
 * @param {string} fwdPrefix
 * @returns {string}
 */
export function rewriteFwdLocation(location, upstreamOrigin, targetOrigin, proxyOrigin, fwdPrefix) {
  let url;
  try {
    url = new URL(location);
  } catch {
    return location;
  }
  if (url.origin === upstreamOrigin || url.origin === targetOrigin) {
    return proxyOrigin + fwdPrefix + url.pathname + url.search + url.hash;
  }
  return location;
}

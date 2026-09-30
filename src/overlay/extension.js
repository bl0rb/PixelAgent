// @ts-check
// Helpers for running the overlay as a browser-extension content script
// (extension/ in this repo). No import-time side effects.

/**
 * Extension mode: the overlay module was loaded from the extension's own
 * origin (web-accessible resource) and the extension runtime is available.
 * @param {string} moduleUrl - `import.meta.url` of the overlay entry
 * @param {any} [chromeApi]
 * @returns {boolean}
 */
export function detectExtensionMode(moduleUrl, chromeApi = /** @type {any} */ (globalThis).chrome) {
  return moduleUrl.startsWith('chrome-extension://') && Boolean(chromeApi?.runtime?.id);
}

/**
 * Asks the extension's service worker to save the markdown through the
 * downloads API (Save dialog). Resolves `{ canceled: true }` if the user
 * dismissed the dialog; throws on any other failure so the caller can fall
 * back to a plain Blob download.
 * @param {any} chromeApi
 * @param {string} markdown
 * @returns {Promise<{ canceled: boolean }>}
 */
export async function downloadViaExtension(chromeApi, markdown) {
  const res = await chromeApi.runtime.sendMessage({ type: 'nudgit:download', markdown });
  if (res && res.ok) return { canceled: false };
  if (res && res.canceled) return { canceled: true };
  throw new Error((res && res.error) || 'download failed');
}

/**
 * Tells the service worker whether the overlay is shown, so its badge and
 * tracking follow a close (×) click. Fire and forget.
 * @param {any} chromeApi
 * @param {boolean} visible
 * @returns {Promise<void>}
 */
export async function notifyVisibility(chromeApi, visible) {
  try {
    await chromeApi.runtime.sendMessage({ type: 'nudgit:visibility', visible });
  } catch {
    // service worker unreachable (extension reloaded): nothing to update
  }
}

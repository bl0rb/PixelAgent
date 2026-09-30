// Content script (classic, isolated world), injected on demand by the service
// worker via chrome.scripting.executeScript. Idempotent: the first run loads
// the overlay, later runs toggle it. The value of the last expression is the
// executeScript result: { ok, visible } or { ok: false, error }.
(async () => {
  try {
    if (typeof globalThis.__nudgitToggle === 'function') {
      return { ok: true, visible: Boolean(globalThis.__nudgitToggle()) };
    }
    if (document.readyState === 'loading') {
      await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    if (!globalThis.__nudgitLoading) {
      // Dynamic import of a web-accessible extension module: runs in this
      // isolated world and is not subject to the page's CSP.
      globalThis.__nudgitLoading = import(chrome.runtime.getURL('overlay/index.js'));
    }
    await globalThis.__nudgitLoading;
    if (typeof globalThis.__nudgitToggle !== 'function') {
      // initOverlay() bailed out: a <uce-root> is already on the page (e.g. nudgit through the proxy)
      return { ok: false, error: 'nudgit is already active on this page' };
    }
    return { ok: true, visible: true };
  } catch (err) {
    globalThis.__nudgitLoading = undefined;
    return { ok: false, error: String((err && err.message) || err) };
  }
})();

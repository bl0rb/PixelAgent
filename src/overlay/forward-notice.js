// @ts-check
import { t } from './i18n.js';

/**
 * @typedef {import('./index.js').OverlayContext} OverlayContext
 */

const IGNORED_KEY = 'uce-fwd-ignored';

/**
 * Persistent notice next to the toolbar (proxy mode): when the net shim reports
 * a cross-origin request it could not route through the proxy and that failed
 * (`nudgit:forward-blocked`, usually a CORS block), offers to forward that host
 * through nudgit (`POST /__uce/forward-host`, then reload) or to ignore it for
 * the rest of the browser session. One host is shown at a time.
 *
 * @param {OverlayContext} ctx
 * @param {{ fetch?: (url: string, init: object) => Promise<{ ok: boolean }>, reload?: () => void }} [deps] test seams
 * @returns {{ el: HTMLElement, report: (host: string) => void }}
 */
export function createForwardNotice(ctx, deps = {}) {
  const doc = ctx.shadow.ownerDocument;
  const win = /** @type {any} */ (doc.defaultView || window);
  const doFetch = deps.fetch || ((url, init) => win.fetch(url, init));
  const reload = deps.reload || (() => win.location.reload());

  const el = doc.createElement('div');
  el.className = 'uce-forward-notice';
  el.setAttribute('role', 'status');
  el.hidden = true;
  const text = doc.createElement('span');
  const forwardBtn = doc.createElement('button');
  forwardBtn.type = 'button';
  forwardBtn.className = 'uce-btn uce-primary';
  const ignoreBtn = doc.createElement('button');
  ignoreBtn.type = 'button';
  ignoreBtn.className = 'uce-btn';
  el.append(text, forwardBtn, ignoreBtn);

  /** @type {Set<string>} */
  const ignored = new Set();
  try {
    for (const host of JSON.parse(win.sessionStorage.getItem(IGNORED_KEY) || '[]')) ignored.add(String(host));
  } catch {
    // sessionStorage unavailable: ignoring then only lasts until the next reload
  }
  /** @type {string[]} */
  const queue = [];
  /** @type {string|null} */
  let current = null;

  function showNext() {
    current = queue.shift() || null;
    el.hidden = !current;
    if (!current) return;
    text.textContent = t('forward.notice', { host: current });
    forwardBtn.textContent = t('forward.forward');
    ignoreBtn.textContent = t('forward.ignore');
    forwardBtn.disabled = false;
    // sit right above the toolbar (it wraps and can be dragged)
    const toolbar = ctx.shadow.querySelector('.uce-toolbar');
    const rect = toolbar ? toolbar.getBoundingClientRect() : null;
    if (rect && rect.height > 0) {
      el.style.left = `${Math.max(8, rect.left)}px`;
      el.style.bottom = `${Math.max(8, win.innerHeight - rect.top + 8)}px`;
    }
  }

  /** @param {string} host */
  function report(host) {
    if (!host || ignored.has(host) || host === current || queue.includes(host)) return;
    queue.push(host);
    if (!current) showNext();
  }

  ignoreBtn.addEventListener('click', () => {
    if (current) ignored.add(current);
    try {
      win.sessionStorage.setItem(IGNORED_KEY, JSON.stringify([...ignored]));
    } catch {
      // ignore storage errors
    }
    showNext();
  });

  forwardBtn.addEventListener('click', async () => {
    const host = current;
    if (!host) return;
    forwardBtn.disabled = true;
    try {
      const res = await doFetch('/__uce/forward-host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host }),
      });
      if (!res.ok) throw new Error(String(/** @type {any} */ (res).status || ''));
      reload();
    } catch (err) {
      forwardBtn.disabled = false;
      ctx.toast(t('forward.failed', { name: host }), { error: true });
    }
  });

  win.addEventListener('nudgit:forward-blocked', (/** @type {CustomEvent} */ e) => report(e.detail && e.detail.host));
  // failures that happened before this module loaded
  for (const host of win.__nudgitBlockedHosts || []) report(host);

  return { el, report };
}

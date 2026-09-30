// @ts-check
// Tests for src/overlay/forward-notice.js: the notice shown when the net shim
// reports a host the browser blocks (`nudgit:forward-blocked`). fetch and
// reload are mocked; jsdom can't navigate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createForwardNotice } from '../src/overlay/forward-notice.js';

/**
 * Builds a jsdom page with a `uce-root` shadow root, runs `fn` with the notice
 * (language pinned through a fake localStorage, as i18n reads the global one).
 * @param {(env: { window: any, notice: ReturnType<typeof createForwardNotice>, el: HTMLElement, calls: { fetch: any[], reload: number, toasts: any[] }, respond: (res: { ok: boolean }) => void }) => Promise<void>|void} fn
 * @param {{ lang?: 'en'|'de', seed?: (window: any) => void }} [opts]
 */
async function withNotice(fn, { lang = 'en', seed } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:4400/' });
  const { window } = dom;
  if (seed) seed(window);
  const host = window.document.createElement('uce-root');
  window.document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const store = new Map([['uce-lang', lang]]);
  const hadStorage = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const prevStorage = /** @type {any} */ (globalThis).localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (/** @type {string} */ k) => store.get(k) ?? null, setItem: () => {} },
    writable: true,
    configurable: true,
  });

  const calls = { fetch: /** @type {any[]} */ ([]), reload: 0, toasts: /** @type {any[]} */ ([]) };
  let response = { ok: true };
  const notice = createForwardNotice(
    /** @type {any} */ ({ shadow, toast: (/** @type {string} */ message, /** @type {object} */ opts) => calls.toasts.push({ message, opts }) }),
    {
      fetch: async (url, init) => {
        calls.fetch.push({ url, init });
        return response;
      },
      reload: () => {
        calls.reload++;
      },
    },
  );
  shadow.appendChild(notice.el);
  try {
    await fn({ window, notice, el: notice.el, calls, respond: (res) => (response = res) });
  } finally {
    if (hadStorage) Object.defineProperty(globalThis, 'localStorage', { value: prevStorage, writable: true, configurable: true });
    else delete (/** @type {any} */ (globalThis).localStorage);
    window.close();
  }
}

/** @param {any} window @param {string} host */
function blocked(window, host) {
  window.dispatchEvent(new window.CustomEvent('nudgit:forward-blocked', { detail: { host } }));
}

/** @param {HTMLElement} el @returns {HTMLButtonElement[]} [forward, ignore] */
function buttons(el) {
  return /** @type {HTMLButtonElement[]} */ (Array.from(el.querySelectorAll('button')));
}

test('notice: hidden until a host is blocked, then names the host; Forward POSTs it and reloads', async () => {
  await withNotice(async ({ window, el, calls }) => {
    assert.equal(el.hidden, true);
    blocked(window, 'api.example.com');
    assert.equal(el.hidden, false);
    assert.equal(
      el.querySelector('span')?.textContent,
      'The app calls api.example.com, which the browser blocks (CORS). Forward it through nudgit?',
    );
    const [forward, ignore] = buttons(el);
    assert.equal(forward.textContent, 'Forward');
    assert.equal(ignore.textContent, 'Ignore');

    forward.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.fetch.length, 1);
    assert.equal(calls.fetch[0].url, '/__uce/forward-host');
    assert.equal(calls.fetch[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls.fetch[0].init.body), { host: 'api.example.com' });
    assert.equal(calls.reload, 1);
  });
});

test('notice: German texts', async () => {
  await withNotice(
    ({ window, el }) => {
      blocked(window, 'api.example.com');
      assert.equal(
        el.querySelector('span')?.textContent,
        'Die App ruft api.example.com auf – der Browser blockiert das (CORS). Über nudgit weiterleiten?',
      );
      assert.deepEqual(buttons(el).map((b) => b.textContent), ['Weiterleiten', 'Ignorieren']);
    },
    { lang: 'de' },
  );
});

test('notice: a failed forward keeps the notice, shows an error toast and does not reload', async () => {
  await withNotice(async ({ window, el, calls, respond }) => {
    respond({ ok: false });
    blocked(window, 'api.example.com');
    const [forward] = buttons(el);
    forward.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.reload, 0);
    assert.equal(el.hidden, false);
    assert.equal(forward.disabled, false);
    assert.equal(calls.toasts.length, 1);
    assert.equal(calls.toasts[0].opts.error, true);
  });
});

test('notice: Ignore hides it for that host for the session; other hosts are queued and shown next', async () => {
  await withNotice(async ({ window, el, calls }) => {
    blocked(window, 'a.example.com');
    blocked(window, 'a.example.com'); // duplicate while shown
    blocked(window, 'b.example.com'); // queued
    assert.match(el.querySelector('span')?.textContent || '', /a\.example\.com/);

    buttons(el)[1].click();
    assert.equal(el.hidden, false);
    assert.match(el.querySelector('span')?.textContent || '', /b\.example\.com/);

    buttons(el)[1].click();
    assert.equal(el.hidden, true);

    blocked(window, 'a.example.com');
    blocked(window, 'b.example.com');
    assert.equal(el.hidden, true, 'ignored hosts stay hidden');
    assert.equal(calls.fetch.length, 0);
    assert.deepEqual(JSON.parse(window.sessionStorage.getItem('uce-fwd-ignored')), ['a.example.com', 'b.example.com']);
  });
});

test('notice: hosts blocked before the overlay loaded (window.__nudgitBlockedHosts) and ignored hosts from sessionStorage are honoured', async () => {
  await withNotice(
    ({ el }) => {
      assert.equal(el.hidden, false);
      assert.match(el.querySelector('span')?.textContent || '', /early\.example\.com/);
    },
    {
      seed: (window) => {
        window.__nudgitBlockedHosts = ['skipped.example.com', 'early.example.com'];
        window.sessionStorage.setItem('uce-fwd-ignored', JSON.stringify(['skipped.example.com']));
      },
    },
  );
});

// Service worker (module). Holds no state in globals: the set of tabs where
// nudgit is active lives in chrome.storage.session. Every handler takes the
// chrome API as its first parameter so it can be tested with a mock.

export const LOADER_FILE = 'content/loader.js';
export const STORAGE_KEY = 'nudgitActiveTabs';
const BADGE_ON = { text: 'ON', color: '#635bff' };
const BADGE_ERROR = { text: '!', color: '#d92d20' };

/**
 * @param {any} api - the chrome namespace
 * @returns {Promise<Record<string, true>>} active tab ids as keys
 */
export async function getActiveTabs(api) {
  try {
    const data = await api.storage.session.get(STORAGE_KEY);
    return data[STORAGE_KEY] || {};
  } catch (err) {
    console.warn('nudgit: could not read session state', err);
    return {};
  }
}

/**
 * @param {any} api
 * @param {number} tabId
 * @param {boolean} active
 */
export async function setTabActive(api, tabId, active) {
  try {
    const tabs = await getActiveTabs(api);
    if (active) tabs[tabId] = true;
    else delete tabs[tabId];
    await api.storage.session.set({ [STORAGE_KEY]: tabs });
  } catch (err) {
    console.warn('nudgit: could not write session state', err);
  }
}

/**
 * @param {any} api
 * @param {number} tabId
 * @param {{ text: string, color?: string }|null} badge - null clears it
 */
export async function setBadge(api, tabId, badge) {
  try {
    await api.action.setBadgeText({ tabId, text: badge ? badge.text : '' });
    if (badge && badge.color) await api.action.setBadgeBackgroundColor({ tabId, color: badge.color });
  } catch {
    // the tab may be gone already
  }
}

/**
 * Runs the loader in the tab's top frame. The loader loads the overlay on
 * the first run and toggles it afterwards.
 * @param {any} api
 * @param {number} tabId
 * @returns {Promise<{ ok: true, visible: boolean } | { ok: false, error: string }>}
 */
export async function injectLoader(api, tabId) {
  try {
    const results = await api.scripting.executeScript({ target: { tabId }, files: [LOADER_FILE] });
    const result = results && results[0] && results[0].result;
    if (result && result.ok) return { ok: true, visible: Boolean(result.visible) };
    return { ok: false, error: (result && result.error) || 'no result from content script' };
  } catch (err) {
    return { ok: false, error: String((err && /** @type {Error} */ (err).message) || err) };
  }
}

/**
 * Toggles nudgit in a tab (icon click / shortcut) and records the outcome.
 * @param {any} api
 * @param {number|undefined} tabId
 */
export async function toggleTab(api, tabId) {
  if (tabId == null) return { ok: false, error: 'no tab' };
  const res = await injectLoader(api, tabId);
  if (!res.ok) {
    await setTabActive(api, tabId, false);
    await setBadge(api, tabId, BADGE_ERROR); // e.g. chrome:// pages cannot be scripted
    return res;
  }
  await setTabActive(api, tabId, res.visible);
  await setBadge(api, tabId, res.visible ? BADGE_ON : null);
  return res;
}

/**
 * Re-injects into a tracked tab after a page load. The loader toggles when
 * the overlay already lives in the page, so flip it back if it was hidden.
 * On failure (Chrome no longer grants access) state and badge are cleared.
 * @param {any} api
 * @param {number} tabId
 */
export async function reinjectTab(api, tabId) {
  let res = await injectLoader(api, tabId);
  if (res.ok && !res.visible) res = await injectLoader(api, tabId);
  if (!res.ok || !res.visible) {
    await setTabActive(api, tabId, false);
    await setBadge(api, tabId, null);
    return res;
  }
  await setBadge(api, tabId, BADGE_ON);
  return res;
}

/**
 * @param {any} api
 * @param {number} tabId
 * @param {{ status?: string }} changeInfo
 */
export async function handleTabUpdated(api, tabId, changeInfo) {
  if (changeInfo.status !== 'complete') return;
  const tabs = await getActiveTabs(api);
  if (tabs[tabId]) await reinjectTab(api, tabId);
}

/**
 * @param {any} api
 * @param {number} tabId
 */
export async function handleTabRemoved(api, tabId) {
  const tabs = await getActiveTabs(api);
  if (tabs[tabId]) await setTabActive(api, tabId, false);
}

/**
 * Saves the markdown through the downloads API (Save dialog).
 * @param {any} api
 * @param {string} markdown
 * @returns {Promise<{ ok: true, id: number } | { ok: false, error: string, canceled?: boolean }>}
 */
export async function downloadMarkdown(api, markdown) {
  try {
    const id = await api.downloads.download({
      url: 'data:text/markdown;charset=utf-8,' + encodeURIComponent(markdown),
      filename: 'ui-changes.md',
      saveAs: true,
    });
    return { ok: true, id };
  } catch (err) {
    const error = String((err && /** @type {Error} */ (err).message) || err);
    return { ok: false, error, canceled: /cancel/i.test(error) };
  }
}

/**
 * @param {any} api
 * @param {any} message
 * @param {{ id?: string, tab?: { id?: number } }} sender
 * @returns {Promise<object>|undefined} undefined when the message is not ours
 */
export function handleMessage(api, message, sender) {
  if (!message || typeof message.type !== 'string') return undefined;
  if (sender && sender.id && sender.id !== api.runtime.id) return undefined;
  if (message.type === 'nudgit:download') {
    if (typeof message.markdown !== 'string') return Promise.resolve({ ok: false, error: 'markdown missing' });
    return downloadMarkdown(api, message.markdown);
  }
  if (message.type === 'nudgit:visibility') {
    // the overlay was closed (×) or shown from inside the page
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId == null) return Promise.resolve({ ok: false, error: 'no tab' });
    return (async () => {
      await setTabActive(api, tabId, Boolean(message.visible));
      await setBadge(api, tabId, message.visible ? BADGE_ON : null);
      return { ok: true };
    })();
  }
  return undefined;
}

/**
 * All listeners are registered synchronously at the top level so Chrome can
 * wake the worker for them.
 * @param {any} api
 */
export function registerListeners(api) {
  api.action.onClicked.addListener(async (tab) => {
    await toggleTab(api, tab && tab.id);
  });

  api.commands.onCommand.addListener(async (command, tab) => {
    if (command !== 'toggle-nudgit') return;
    let tabId = tab && tab.id;
    if (tabId == null) {
      try {
        const [active] = await api.tabs.query({ active: true, currentWindow: true });
        tabId = active && active.id;
      } catch (err) {
        console.warn('nudgit: could not find the active tab', err);
      }
    }
    await toggleTab(api, tabId);
  });

  api.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    await handleTabUpdated(api, tabId, changeInfo);
  });

  api.tabs.onRemoved.addListener(async (tabId) => {
    await handleTabRemoved(api, tabId);
  });

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const pending = handleMessage(api, message, sender);
    if (!pending) return false;
    (async () => {
      try {
        sendResponse(await pending);
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true; // keep the channel open for the async response
  });
}

if (globalThis.chrome && globalThis.chrome.runtime && globalThis.chrome.runtime.id) {
  registerListeners(globalThis.chrome);
}

// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, getLang, setLang, t, messages } from '../src/overlay/i18n.js';

/**
 * Temporarily overrides a (possibly non-configurable) global for the
 * duration of `fn`, then restores it exactly as it was.
 * @param {string} name
 * @param {unknown} value
 * @param {() => void} fn
 */
function withGlobal(name, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, name);
  const prev = /** @type {any} */ (globalThis)[name];
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: true });
  try {
    fn();
  } finally {
    if (had) {
      Object.defineProperty(globalThis, name, { value: prev, writable: true, configurable: true, enumerable: true });
    } else {
      delete /** @type {any} */ (globalThis)[name];
    }
  }
}

/** In-memory localStorage stand-in. */
function fakeStorage() {
  const store = new Map();
  return {
    getItem: (/** @type {string} */ k) => (store.has(k) ? store.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => store.set(k, String(v)),
    removeItem: (/** @type {string} */ k) => store.delete(k),
  };
}

// --- detectLang: navigator.language only, no storage ---

test('detectLang returns "de" for navigator.language "de-DE"', () => {
  withGlobal('navigator', { language: 'de-DE' }, () => {
    assert.equal(detectLang(), 'de');
  });
});

test('detectLang returns "en" for navigator.language "en-US"', () => {
  withGlobal('navigator', { language: 'en-US' }, () => {
    assert.equal(detectLang(), 'en');
  });
});

test('detectLang falls back to "en" for an unrelated language ("fr")', () => {
  withGlobal('navigator', { language: 'fr' }, () => {
    assert.equal(detectLang(), 'en');
  });
});

// --- getLang: storage overrides navigator.language ---

test('getLang prefers a stored language over navigator.language', () => {
  const storage = fakeStorage();
  storage.setItem('uce-lang', 'de');
  withGlobal('localStorage', storage, () => {
    withGlobal('navigator', { language: 'en-US' }, () => {
      assert.equal(getLang(), 'de');
    });
  });
});

test('getLang falls back to detectLang() when nothing is stored', () => {
  withGlobal('localStorage', fakeStorage(), () => {
    withGlobal('navigator', { language: 'de-AT' }, () => {
      assert.equal(getLang(), 'de');
    });
  });
});

test('getLang ignores a stored value that is not "en"/"de"', () => {
  const storage = fakeStorage();
  storage.setItem('uce-lang', 'fr');
  withGlobal('localStorage', storage, () => {
    withGlobal('navigator', { language: 'de-DE' }, () => {
      assert.equal(getLang(), 'de');
    });
  });
});

test('setLang persists the language for getLang() to pick up', () => {
  withGlobal('localStorage', fakeStorage(), () => {
    withGlobal('navigator', { language: 'en-US' }, () => {
      setLang('de');
      assert.equal(getLang(), 'de');
    });
  });
});

// --- t(): interpolation, fallback, explicit lang override ---

test('t() interpolates {name}-style parameters per language', () => {
  assert.equal(t('toast.saved', { name: 'ui-changes.md' }, 'en'), 'Saved: ui-changes.md');
  assert.equal(t('toast.saved', { name: 'ui-changes.md' }, 'de'), 'Gespeichert: ui-changes.md');
});

test('t() interpolates the same placeholder used more than once', () => {
  assert.equal(t('diff.text', { before: 'a', after: 'b' }, 'en'), '"a" → "b"');
  assert.equal(t('diff.text', { before: 'a', after: 'b' }, 'de'), '„a“ → „b“');
});

test('t() returns the plain message when no params are given', () => {
  assert.equal(t('toast.copied', undefined, 'en'), 'Copied');
  assert.equal(t('toast.copied', undefined, 'de'), 'Kopiert');
});

test('t() falls back to English for an unsupported language', () => {
  assert.equal(t('toolbar.undo', undefined, /** @type {any} */ ('fr')), 'Undo');
});

test('t() falls back to the key itself for an unknown key', () => {
  assert.equal(t('nonexistent.key', undefined, 'en'), 'nonexistent.key');
});

// --- key completeness ---

test('every message key exists in both en and de', () => {
  const enKeys = Object.keys(messages.en).sort();
  const deKeys = Object.keys(messages.de).sort();
  assert.deepEqual(deKeys, enKeys, 'en and de must define exactly the same set of keys');
});

test('no message value is empty in either language', () => {
  for (const lang of /** @type {const} */ (['en', 'de'])) {
    for (const [key, value] of Object.entries(messages[lang])) {
      assert.ok(typeof value === 'string' && value.length > 0, `${lang}.${key} must be a non-empty string`);
    }
  }
});

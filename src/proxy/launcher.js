// @ts-check
// Self-contained launcher page served at GET /__uce/: lets the user pick a
// target URL and output directory without any CLI argument. Inline CSS/JS,
// no build step; light/dark via prefers-color-scheme.
//
// Bilingual (en/de): both languages are embedded in the page and the client
// picks one (localStorage 'uce-lang', else navigator.language, default 'en')
// and applies it to the DOM; a small EN/DE toggle updates the same
// localStorage key the overlay reads (same origin).

import path from 'node:path';

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #f5f5f7; color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1c1e; color: #f0f0f0; }
  }
  .uce-card {
    position: relative;
    width: 100%; max-width: 440px; margin: 16px; padding: 32px;
    background: rgba(127,127,127,0.06); border: 1px solid rgba(127,127,127,0.25);
    border-radius: 14px;
  }
  h1 { font-size: 19px; font-weight: 600; margin: 0 0 22px; padding-right: 60px; }
  label { display: block; font-size: 12px; opacity: 0.7; margin: 16px 0 6px; }
  input[type="text"] {
    width: 100%; padding: 10px 12px; font-size: 14px; border-radius: 8px;
    border: 1px solid rgba(127,127,127,0.4); background: transparent; color: inherit;
  }
  input[type="text"]:focus { outline: 2px solid #2563eb; outline-offset: 1px; }
  button {
    cursor: pointer; border: none; border-radius: 8px; font-size: 14px;
    font-family: inherit; padding: 10px 16px;
  }
  .uce-row { display: flex; gap: 8px; align-items: stretch; }
  .uce-row input[type="text"] { flex: 1; min-width: 0; }
  .uce-choose {
    flex: none; white-space: nowrap; background: transparent; color: inherit;
    border: 1px solid rgba(127,127,127,0.4); padding: 10px 12px;
  }
  .uce-choose:disabled { opacity: 0.6; cursor: default; }
  .uce-pickdir-hint { min-height: 14px; margin-top: 6px; font-size: 12px; opacity: 0.75; }
  .uce-primary { width: 100%; margin-top: 22px; background: #2563eb; color: #fff; }
  .uce-primary:disabled { opacity: 0.6; cursor: default; }
  .uce-quit {
    width: 100%; margin-top: 10px; background: transparent; color: #c0392b;
    border: 1px solid rgba(127,127,127,0.4);
  }
  .uce-error { min-height: 16px; margin-top: 8px; font-size: 12px; color: #c0392b; }
  .uce-state {
    margin-top: 22px; padding-top: 14px; border-top: 1px solid rgba(127,127,127,0.25);
    font-size: 12px; opacity: 0.75; line-height: 1.7; word-break: break-all;
  }
  .uce-recent { list-style: none; margin: 4px 0 0; padding: 0; }
  .uce-recent li {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 6px 0; border-bottom: 1px solid rgba(127,127,127,0.15);
    font-size: 13px;
  }
  .uce-recent a {
    color: inherit; text-decoration: none; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; flex: 1;
  }
  .uce-recent a:hover { text-decoration: underline; }
  .uce-recent button {
    background: transparent; color: inherit; opacity: 0.6; padding: 0 6px; font-size: 15px;
    line-height: 1;
  }
  .uce-recent button:hover { opacity: 1; }
  .uce-recent:empty { display: none; }
  .uce-langtoggle {
    position: absolute; top: 28px; right: 32px; display: flex; gap: 4px;
  }
  .uce-langtoggle button {
    padding: 3px 7px; font-size: 11px; font-weight: 600; opacity: 0.55;
    background: transparent; color: inherit; border: 1px solid rgba(127,127,127,0.4);
  }
  .uce-langtoggle button.uce-lang-active { opacity: 1; background: rgba(127,127,127,0.15); }
`;

const SCRIPT = `
(function () {
  var STRINGS = {
    en: {
      title: 'PixelAgent',
      urlLabel: 'Target URL',
      outLabel: 'Save location for ui-changes.md',
      openBtn: 'Open',
      quitBtn: 'Quit',
      quitConfirm: 'Really quit PixelAgent?',
      quitDoneText: 'Stopped. This window can be closed.',
      stateTargetLabel: 'Current target',
      stateOutLabel: 'Output file',
      none: '(none)',
      removeTitle: 'Remove',
      chooseBtn: 'Choose…',
      pickDirHint: 'Folder dialog is open… (it may appear behind the browser)',
      pickDirError: 'Could not open the folder dialog.',
      errMissingUrl: 'Please provide a target URL.',
      errUnreachable: 'Server unreachable.',
      errUnknown: 'Unknown error.'
    },
    de: {
      title: 'PixelAgent',
      urlLabel: 'Ziel-URL',
      outLabel: 'Speicherort für ui-changes.md',
      openBtn: 'Öffnen',
      quitBtn: 'Beenden',
      quitConfirm: 'PixelAgent wirklich beenden?',
      quitDoneText: 'Beendet. Dieses Fenster kann geschlossen werden.',
      stateTargetLabel: 'Aktuelles Ziel',
      stateOutLabel: 'Ausgabedatei',
      none: '(keins)',
      removeTitle: 'Entfernen',
      chooseBtn: 'Auswählen…',
      pickDirHint: 'Ordnerauswahl ist geöffnet … (erscheint eventuell hinter dem Browser)',
      pickDirError: 'Ordnerauswahl konnte nicht geöffnet werden.',
      errMissingUrl: 'Bitte eine Ziel-URL angeben.',
      errUnreachable: 'Server nicht erreichbar.',
      errUnknown: 'Unbekannter Fehler.'
    }
  };
  var LANG_KEY = 'uce-lang';

  var initial = window.__UCE_INITIAL__ || {};
  var form = document.getElementById('uce-form');
  var urlInput = document.getElementById('uce-url');
  var outDirInput = document.getElementById('uce-outdir');
  var chooseDirBtn = document.getElementById('uce-choose-dir');
  var pickDirHintEl = document.getElementById('uce-pickdir-hint');
  var errEl = document.getElementById('uce-error');
  var openBtn = document.getElementById('uce-open');
  var quitBtn = document.getElementById('uce-quit');
  var recentEl = document.getElementById('uce-recent');
  var stateTargetEl = document.getElementById('uce-state-target');
  var stateOutEl = document.getElementById('uce-state-out');
  var titleEl = document.getElementById('uce-title');
  var urlLabelEl = document.getElementById('uce-url-label');
  var outLabelEl = document.getElementById('uce-outdir-label');
  var stateTargetLabelEl = document.getElementById('uce-state-target-label');
  var stateOutLabelEl = document.getElementById('uce-state-out-label');
  var langEnBtn = document.getElementById('uce-lang-en');
  var langDeBtn = document.getElementById('uce-lang-de');

  var lang = 'en';

  function pickInitialLang() {
    try {
      var stored = localStorage.getItem(LANG_KEY);
      if (stored === 'en' || stored === 'de') return stored;
    } catch (e) {}
    var nav = (navigator.language || '').toLowerCase();
    return nav.indexOf('de') === 0 ? 'de' : 'en';
  }

  function applyLang(next) {
    lang = next;
    var s = STRINGS[lang] || STRINGS.en;
    document.documentElement.lang = lang;
    document.title = s.title;
    titleEl.textContent = s.title;
    urlLabelEl.textContent = s.urlLabel;
    outLabelEl.textContent = s.outLabel;
    openBtn.textContent = s.openBtn;
    quitBtn.textContent = s.quitBtn;
    chooseDirBtn.textContent = s.chooseBtn;
    if (pickDirHintEl.getAttribute('data-active') === '1') {
      pickDirHintEl.textContent = s.pickDirHint;
    }
    stateTargetLabelEl.textContent = s.stateTargetLabel;
    stateOutLabelEl.textContent = s.stateOutLabel;
    stateTargetEl.textContent = initial.target || s.none;
    langEnBtn.classList.toggle('uce-lang-active', lang === 'en');
    langDeBtn.classList.toggle('uce-lang-active', lang === 'de');
    renderRecent();
  }

  function setLang(next) {
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch (e) {
      // localStorage unavailable; the choice just won't persist
    }
    applyLang(next);
  }

  outDirInput.value = initial.outDir || '';
  stateOutEl.textContent = initial.out || '';
  if (!initial.canPickDir) {
    chooseDirBtn.hidden = true;
  }

  var RECENT_KEY = 'uce-recent-urls';

  function loadRecent() {
    try {
      var raw = localStorage.getItem(RECENT_KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      var result = [];
      list.forEach(function (item) {
        // Migrate legacy entries (plain URL strings) to { url, outDir }.
        if (typeof item === 'string' && item) {
          result.push({ url: item, outDir: '' });
        } else if (item && typeof item.url === 'string' && item.url) {
          result.push({ url: item.url, outDir: typeof item.outDir === 'string' ? item.outDir : '' });
        }
      });
      return result;
    } catch (e) {
      return [];
    }
  }

  function saveRecent(list) {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
    } catch (e) {
      // localStorage unavailable; recent list just won't persist
    }
  }

  function addRecent(url, outDir) {
    var list = loadRecent().filter(function (entry) { return entry.url !== url; });
    list.unshift({ url: url, outDir: outDir || '' });
    saveRecent(list);
    renderRecent();
  }

  function renderRecent() {
    var s = STRINGS[lang] || STRINGS.en;
    var list = loadRecent();
    recentEl.innerHTML = '';
    list.forEach(function (entry) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#';
      a.textContent = entry.url;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        urlInput.value = entry.url;
        if (entry.outDir) outDirInput.value = entry.outDir;
        submitForm();
      });
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '\\u00d7';
      rm.title = s.removeTitle;
      rm.addEventListener('click', function (e) {
        e.preventDefault();
        saveRecent(loadRecent().filter(function (other) { return other.url !== entry.url; }));
        renderRecent();
      });
      li.appendChild(a);
      li.appendChild(rm);
      recentEl.appendChild(li);
    });
  }

  function submitForm() {
    var s = STRINGS[lang] || STRINGS.en;
    errEl.textContent = '';
    var url = urlInput.value.trim();
    if (!url) {
      errEl.textContent = s.errMissingUrl;
      return;
    }
    openBtn.disabled = true;
    var outDir = outDirInput.value.trim();
    fetch('/__uce/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, outDir: outDir }),
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) {
          errEl.textContent = (result.data && result.data.error) || s.errUnknown;
          openBtn.disabled = false;
          return;
        }
        addRecent(url, outDir);
        location.href = result.data.path || '/';
      })
      .catch(function () {
        errEl.textContent = s.errUnreachable;
        openBtn.disabled = false;
      });
  }

  function chooseDir() {
    var s = STRINGS[lang] || STRINGS.en;
    errEl.textContent = '';
    chooseDirBtn.disabled = true;
    pickDirHintEl.setAttribute('data-active', '1');
    pickDirHintEl.textContent = s.pickDirHint;
    fetch('/__uce/pick-dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDir: outDirInput.value.trim() }),
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) {
          errEl.textContent = (result.data && result.data.error) || s.pickDirError;
          return;
        }
        if (result.data && result.data.path) {
          outDirInput.value = result.data.path;
        }
      })
      .catch(function () {
        errEl.textContent = s.pickDirError;
      })
      .then(function () {
        chooseDirBtn.disabled = false;
        pickDirHintEl.removeAttribute('data-active');
        pickDirHintEl.textContent = '';
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    submitForm();
  });

  chooseDirBtn.addEventListener('click', function (e) {
    e.preventDefault();
    chooseDir();
  });

  quitBtn.addEventListener('click', function () {
    var s = STRINGS[lang] || STRINGS.en;
    if (!window.confirm(s.quitConfirm)) return;
    quitBtn.disabled = true;
    fetch('/__uce/quit', { method: 'POST' })
      .catch(function () {})
      .then(function () {
        document.querySelector('.uce-card').innerHTML =
          '<h1>' + s.title + '</h1><p>' + s.quitDoneText + '</p>';
      });
  });

  langEnBtn.addEventListener('click', function () { setLang('en'); });
  langDeBtn.addEventListener('click', function () { setLang('de'); });

  applyLang(pickInitialLang());
})();
`;

/**
 * @param {{ target: string|null, out: string, canPickDir?: boolean }} state
 * @returns {string}
 */
export function launcherHtml(state) {
  const initial = {
    target: state.target,
    out: state.out,
    outDir: path.dirname(state.out),
    canPickDir: !!state.canPickDir,
  };
  const initialJson = JSON.stringify(initial).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PixelAgent</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJwYWJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjNjM1YmZmIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjYzAyNmQzIi8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9InVybCgjcGFiZykiLz48ZyBmaWxsPSJub25lIiBzdHJva2U9IiNlOWUzZmYiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InNxdWFyZSI+PHBhdGggZD0iTTEyIDIwIFYxMiBIMjAiLz48cGF0aCBkPSJNMzQgMTIgSDQyIFYyMCIvPjxwYXRoIGQ9Ik0xMiAzNCBWNDIgSDIwIi8+PC9nPjxnIGZpbGw9IiMyYTFhN2EiIG9wYWNpdHk9Ii40NSI+PHJlY3QgeD0iMjUuNSIgeT0iMTkuNSIgd2lkdGg9IjMiIGhlaWdodD0iMy4yIi8+PHJlY3QgeD0iMjUuNSIgeT0iMjIuNSIgd2lkdGg9IjYiIGhlaWdodD0iMy4yIi8+PHJlY3QgeD0iMjUuNSIgeT0iMjUuNSIgd2lkdGg9IjkiIGhlaWdodD0iMy4yIi8+PHJlY3QgeD0iMjUuNSIgeT0iMjguNSIgd2lkdGg9IjEyIiBoZWlnaHQ9IjMuMiIvPjxyZWN0IHg9IjI1LjUiIHk9IjMxLjUiIHdpZHRoPSIxNSIgaGVpZ2h0PSIzLjIiLz48cmVjdCB4PSIyNS41IiB5PSIzNC41IiB3aWR0aD0iMTgiIGhlaWdodD0iMy4yIi8+PHJlY3QgeD0iMjUuNSIgeT0iMzcuNSIgd2lkdGg9IjIxIiBoZWlnaHQ9IjMuMiIvPjxyZWN0IHg9IjI1LjUiIHk9IjQwLjUiIHdpZHRoPSIyNCIgaGVpZ2h0PSIzLjIiLz48cmVjdCB4PSIyNS41IiB5PSI0My41IiB3aWR0aD0iMTUiIGhlaWdodD0iMy4yIi8+PHJlY3QgeD0iMjUuNSIgeT0iNDYuNSIgd2lkdGg9IjYiIGhlaWdodD0iMy4yIi8+PHJlY3QgeD0iMzQuNSIgeT0iNDYuNSIgd2lkdGg9IjYiIGhlaWdodD0iMy4yIi8+PHJlY3QgeD0iMjUuNSIgeT0iNDkuNSIgd2lkdGg9IjMiIGhlaWdodD0iMy4yIi8+PHJlY3QgeD0iMzcuNSIgeT0iNDkuNSIgd2lkdGg9IjYiIGhlaWdodD0iMy4yIi8+PHJlY3QgeD0iNDAuNSIgeT0iNTIuNSIgd2lkdGg9IjYiIGhlaWdodD0iMy4yIi8+PC9nPjxnIGZpbGw9IiNmZmZmZmYiPjxyZWN0IHg9IjI0IiB5PSIxOCIgd2lkdGg9IjMiIGhlaWdodD0iMy4yIi8+PHJlY3QgeD0iMjQiIHk9IjIxIiB3aWR0aD0iNiIgaGVpZ2h0PSIzLjIiLz48cmVjdCB4PSIyNCIgeT0iMjQiIHdpZHRoPSI5IiBoZWlnaHQ9IjMuMiIvPjxyZWN0IHg9IjI0IiB5PSIyNyIgd2lkdGg9IjEyIiBoZWlnaHQ9IjMuMiIvPjxyZWN0IHg9IjI0IiB5PSIzMCIgd2lkdGg9IjE1IiBoZWlnaHQ9IjMuMiIvPjxyZWN0IHg9IjI0IiB5PSIzMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjMuMiIvPjxyZWN0IHg9IjI0IiB5PSIzNiIgd2lkdGg9IjIxIiBoZWlnaHQ9IjMuMiIvPjxyZWN0IHg9IjI0IiB5PSIzOSIgd2lkdGg9IjI0IiBoZWlnaHQ9IjMuMiIvPjxyZWN0IHg9IjI0IiB5PSI0MiIgd2lkdGg9IjE1IiBoZWlnaHQ9IjMuMiIvPjxyZWN0IHg9IjI0IiB5PSI0NSIgd2lkdGg9IjYiIGhlaWdodD0iMy4yIi8+PHJlY3QgeD0iMzMiIHk9IjQ1IiB3aWR0aD0iNiIgaGVpZ2h0PSIzLjIiLz48cmVjdCB4PSIyNCIgeT0iNDgiIHdpZHRoPSIzIiBoZWlnaHQ9IjMuMiIvPjxyZWN0IHg9IjM2IiB5PSI0OCIgd2lkdGg9IjYiIGhlaWdodD0iMy4yIi8+PHJlY3QgeD0iMzkiIHk9IjUxIiB3aWR0aD0iNiIgaGVpZ2h0PSIzLjIiLz48L2c+PHBhdGggZD0iTTUwIDcgTDUxLjc1IDEyLjI1IEw1NyAxNCBMNTEuNzUgMTUuNzUgTDUwIDIxIEw0OC4yNSAxNS43NSBMNDMgMTQgTDQ4LjI1IDEyLjI1IFoiIGZpbGw9IiNmZmZmZmYiLz48cGF0aCBkPSJNNTcgMjEuNSBMNTcuODc1IDI0LjEyNSBMNjAuNSAyNSBMNTcuODc1IDI1Ljg3NSBMNTcgMjguNSBMNTYuMTI1IDI1Ljg3NSBMNTMuNSAyNSBMNTYuMTI1IDI0LjEyNSBaIiBmaWxsPSIjZjVkMGZlIi8+PC9zdmc+">
<style>${STYLE}</style>
</head>
<body>
  <div class="uce-card">
    <div class="uce-langtoggle">
      <button type="button" id="uce-lang-en">EN</button>
      <button type="button" id="uce-lang-de">DE</button>
    </div>
    <h1 id="uce-title">PixelAgent</h1>
    <form id="uce-form">
      <label for="uce-url" id="uce-url-label">Target URL</label>
      <input type="text" id="uce-url" name="url" autofocus autocomplete="off" placeholder="http://localhost:3000/admin">
      <label for="uce-outdir" id="uce-outdir-label">Save location for ui-changes.md</label>
      <div class="uce-row">
        <input type="text" id="uce-outdir" name="outDir" autocomplete="off">
        <button type="button" class="uce-choose" id="uce-choose-dir">Choose…</button>
      </div>
      <div class="uce-pickdir-hint" id="uce-pickdir-hint"></div>
      <div class="uce-error" id="uce-error"></div>
      <button type="submit" class="uce-primary" id="uce-open">Open</button>
    </form>
    <ul class="uce-recent" id="uce-recent"></ul>
    <button type="button" class="uce-quit" id="uce-quit">Quit</button>
    <div class="uce-state">
      <div><span id="uce-state-target-label">Current target</span>: <span id="uce-state-target"></span></div>
      <div><span id="uce-state-out-label">Output file</span>: <span id="uce-state-out"></span></div>
    </div>
  </div>
<script>
window.__UCE_INITIAL__ = ${initialJson};
${SCRIPT}
</script>
</body>
</html>
`;
}

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
  h1 { font-size: 19px; font-weight: 600; margin: 0; padding-right: 60px; }
  .uce-tagline { font-size: 12.5px; opacity: 0.7; margin: 4px 0 22px; }
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
  .uce-ca-name {
    flex: 1; min-width: 0; padding: 10px 12px; font-size: 14px; border-radius: 8px;
    border: 1px solid rgba(127,127,127,0.4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .uce-ca-name[data-empty="1"] { opacity: 0.6; }
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
  .uce-update-banner {
    position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px;
    margin: 0 0 18px; padding: 10px 30px 10px 12px;
    background: rgba(37,99,235,0.12); border: 1px solid rgba(37,99,235,0.35);
    border-radius: 8px; font-size: 12.5px; line-height: 1.5;
  }
  .uce-update-banner[hidden] { display: none; }
  .uce-update-banner a { color: inherit; font-weight: 600; text-decoration: underline; }
  .uce-update-dismiss {
    position: absolute; top: 4px; right: 4px; background: transparent; color: inherit;
    opacity: 0.6; padding: 2px 7px; font-size: 14px; line-height: 1; border: none;
  }
  .uce-update-dismiss:hover { opacity: 1; }
`;

const SCRIPT = `
(function () {
  var STRINGS = {
    en: {
      title: 'nudgit',
      urlLabel: 'Target URL',
      outLabel: 'Save location for ui-changes.md',
      fwdLabel: 'Forward API hosts (optional, against CORS errors)',
      caLabel: 'CA certificate (optional, for internal HTTPS servers)',
      caNone: 'No certificate',
      caReadError: 'Could not read the certificate file.',
      openBtn: 'Open',
      quitBtn: 'Quit',
      quitConfirm: 'Really quit nudgit?',
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
      errUnknown: 'Unknown error.',
      updateAvailable: function (latest, current) {
        return 'New version ' + latest + ' available (installed: ' + current + ')';
      },
      viewRelease: 'View release',
      downloadMacApp: 'Download macOS app',
      dismissUpdate: 'Dismiss'
    },
    de: {
      title: 'nudgit',
      urlLabel: 'Ziel-URL',
      outLabel: 'Speicherort für ui-changes.md',
      fwdLabel: 'API-Hosts weiterleiten (optional, gegen CORS-Fehler)',
      caLabel: 'CA-Zertifikat (optional, für interne HTTPS-Server)',
      caNone: 'Kein Zertifikat',
      caReadError: 'Zertifikatsdatei konnte nicht gelesen werden.',
      openBtn: 'Öffnen',
      quitBtn: 'Beenden',
      quitConfirm: 'nudgit wirklich beenden?',
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
      errUnknown: 'Unbekannter Fehler.',
      updateAvailable: function (latest, current) {
        return 'Neue Version ' + latest + ' verfügbar (installiert: ' + current + ')';
      },
      viewRelease: 'Release ansehen',
      downloadMacApp: 'macOS-App laden',
      dismissUpdate: 'Schließen'
    }
  };
  var LANG_KEY = 'uce-lang';

  var initial = window.__UCE_INITIAL__ || {};
  var form = document.getElementById('uce-form');
  var urlInput = document.getElementById('uce-url');
  var outDirInput = document.getElementById('uce-outdir');
  var fwdInput = document.getElementById('uce-fwd');
  var fwdLabelEl = document.getElementById('uce-fwd-label');
  var caLabelEl = document.getElementById('uce-ca-label');
  var caNameEl = document.getElementById('uce-ca-name');
  var caFileInput = document.getElementById('uce-ca-file');
  var caChooseBtn = document.getElementById('uce-ca-choose');
  var caRemoveBtn = document.getElementById('uce-ca-remove');
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
  var updateBannerEl = document.getElementById('uce-update-banner');
  var updateTextEl = document.getElementById('uce-update-text');
  var updateLinkEl = document.getElementById('uce-update-link');
  var updateDownloadEl = document.getElementById('uce-update-download');
  var updateDismissBtn = document.getElementById('uce-update-dismiss');

  var lang = 'en';
  var updateInfo = null;
  var UPDATE_DISMISS_KEY = 'uce-update-dismissed';

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
    fwdLabelEl.textContent = s.fwdLabel;
    caLabelEl.textContent = s.caLabel;
    caChooseBtn.textContent = s.chooseBtn;
    caRemoveBtn.textContent = s.removeTitle;
    renderCaCert();
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
    applyUpdateBanner();
  }

  function isMac() {
    try {
      return /Mac/i.test(navigator.userAgent || '');
    } catch (e) {
      return false;
    }
  }

  function isUpdateDismissed(version) {
    try {
      return localStorage.getItem(UPDATE_DISMISS_KEY) === version;
    } catch (e) {
      return false;
    }
  }

  function applyUpdateBanner() {
    var s = STRINGS[lang] || STRINGS.en;
    if (!updateInfo) {
      updateBannerEl.hidden = true;
      return;
    }
    updateTextEl.textContent = s.updateAvailable(updateInfo.latest, updateInfo.current);
    updateLinkEl.textContent = s.viewRelease;
    updateLinkEl.href = updateInfo.url;
    updateDismissBtn.title = s.dismissUpdate;
    updateDismissBtn.setAttribute('aria-label', s.dismissUpdate);
    if (updateInfo.downloadUrl && isMac()) {
      updateDownloadEl.textContent = s.downloadMacApp;
      updateDownloadEl.href = updateInfo.downloadUrl;
      updateDownloadEl.hidden = false;
    } else {
      updateDownloadEl.hidden = true;
    }
    updateBannerEl.hidden = false;
  }

  function dismissUpdate() {
    if (!updateInfo) return;
    try {
      localStorage.setItem(UPDATE_DISMISS_KEY, updateInfo.latest);
    } catch (e) {
      // localStorage unavailable; the dismissal just won't persist
    }
    updateInfo = null;
    applyUpdateBanner();
  }

  function fetchUpdate() {
    fetch('/__uce/update')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.update || isUpdateDismissed(data.update.latest)) return;
        updateInfo = data.update;
        applyUpdateBanner();
      })
      .catch(function () {
        // Update check failed or is unavailable; show nothing.
      });
  }

  updateDismissBtn.addEventListener('click', function (e) {
    e.preventDefault();
    dismissUpdate();
  });

  function setLang(next) {
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch (e) {
      // localStorage unavailable; the choice just won't persist
    }
    applyLang(next);
  }

  outDirInput.value = initial.outDir || '';
  fwdInput.value = (initial.forwardHosts || []).join(', ');
  stateOutEl.textContent = initial.out || '';
  if (!initial.canPickDir) {
    chooseDirBtn.hidden = true;
  }

  // Extra CA certificate (PEM) for internal HTTPS servers. Kept in
  // localStorage and sent with every POST /__uce/target (the proxy only holds
  // it in memory), so it survives restarts.
  var CA_KEY = 'uce-ca-cert';
  var caCert = null;
  try {
    var rawCa = JSON.parse(localStorage.getItem(CA_KEY) || 'null');
    if (rawCa && typeof rawCa.pem === 'string') caCert = { name: String(rawCa.name || ''), pem: rawCa.pem };
  } catch (e) {}

  function setCaCert(next) {
    caCert = next;
    try {
      if (next) localStorage.setItem(CA_KEY, JSON.stringify(next));
      else localStorage.removeItem(CA_KEY);
    } catch (e) {
      // localStorage unavailable; the certificate is only used for this page
    }
    renderCaCert();
  }

  function renderCaCert() {
    var s = STRINGS[lang] || STRINGS.en;
    caNameEl.textContent = caCert ? caCert.name || 'CA' : s.caNone;
    caNameEl.setAttribute('data-empty', caCert ? '0' : '1');
    caRemoveBtn.hidden = !caCert;
  }

  // Accepts PEM text as is and wraps binary DER (.cer/.der) as PEM.
  function toPem(bytes) {
    var text = new TextDecoder().decode(bytes);
    if (text.indexOf('-----BEGIN CERTIFICATE-----') !== -1) return text;
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return '-----BEGIN CERTIFICATE-----\\n' + btoa(bin).replace(/(.{64})/g, '$1\\n') + '\\n-----END CERTIFICATE-----\\n';
  }

  caChooseBtn.addEventListener('click', function () { caFileInput.click(); });
  caRemoveBtn.addEventListener('click', function () { setCaCert(null); });
  caFileInput.addEventListener('change', function () {
    var file = caFileInput.files && caFileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      setCaCert({ name: file.name, pem: toPem(new Uint8Array(reader.result)) });
      caFileInput.value = '';
    };
    reader.onerror = function () {
      errEl.textContent = (STRINGS[lang] || STRINGS.en).caReadError;
    };
    reader.readAsArrayBuffer(file);
  });

  var RECENT_KEY = 'uce-recent-urls';

  function loadRecent() {
    try {
      var raw = localStorage.getItem(RECENT_KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      var result = [];
      list.forEach(function (item) {
        // Migrate legacy entries (plain URL strings) to { url, outDir, fwd }.
        if (typeof item === 'string' && item) {
          result.push({ url: item, outDir: '', fwd: '' });
        } else if (item && typeof item.url === 'string' && item.url) {
          result.push({
            url: item.url,
            outDir: typeof item.outDir === 'string' ? item.outDir : '',
            fwd: typeof item.fwd === 'string' ? item.fwd : '',
          });
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

  function addRecent(url, outDir, fwd) {
    var list = loadRecent().filter(function (entry) { return entry.url !== url; });
    list.unshift({ url: url, outDir: outDir || '', fwd: fwd || '' });
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
        if (entry.fwd) fwdInput.value = entry.fwd;
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
    var fwd = fwdInput.value.trim();
    fetch('/__uce/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, outDir: outDir, forwardHosts: fwd, caCerts: caCert ? caCert.pem : '' }),
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
        addRecent(url, outDir, fwd);
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
  fetchUpdate();
})();
`;

/**
 * @param {{ target: string|null, out: string, canPickDir?: boolean, forwardHosts?: string[] }} state
 * @returns {string}
 */
export function launcherHtml(state) {
  const initial = {
    target: state.target,
    out: state.out,
    outDir: path.dirname(state.out),
    canPickDir: !!state.canPickDir,
    forwardHosts: state.forwardHosts || [],
  };
  const initialJson = JSON.stringify(initial).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>nudgit</title>
<link rel="icon" type="image/png" sizes="32x32" href="/__uce/static/favicon-32.png">
<link rel="icon" type="image/svg+xml" href="/__uce/static/icon.svg">
<link rel="apple-touch-icon" href="/__uce/static/apple-touch-icon.png">
<style>${STYLE}</style>
</head>
<body>
  <div class="uce-card">
    <div class="uce-langtoggle">
      <button type="button" id="uce-lang-en">EN</button>
      <button type="button" id="uce-lang-de">DE</button>
    </div>
    <h1 id="uce-title">nudgit</h1>
    <p class="uce-tagline">Your UI. Your feedback. Agent-ready.</p>
    <div class="uce-update-banner" id="uce-update-banner" hidden>
      <span id="uce-update-text"></span>
      <a id="uce-update-link" href="#" target="_blank" rel="noopener"></a>
      <a id="uce-update-download" href="#" target="_blank" rel="noopener" hidden></a>
      <button type="button" class="uce-update-dismiss" id="uce-update-dismiss" aria-label="Dismiss">&times;</button>
    </div>
    <form id="uce-form">
      <label for="uce-url" id="uce-url-label">Target URL</label>
      <input type="text" id="uce-url" name="url" autofocus autocomplete="off" placeholder="http://localhost:3000/admin">
      <label for="uce-outdir" id="uce-outdir-label">Save location for ui-changes.md</label>
      <div class="uce-row">
        <input type="text" id="uce-outdir" name="outDir" autocomplete="off">
        <button type="button" class="uce-choose" id="uce-choose-dir">Choose…</button>
      </div>
      <div class="uce-pickdir-hint" id="uce-pickdir-hint"></div>
      <label for="uce-fwd" id="uce-fwd-label">Forward API hosts (optional, against CORS errors)</label>
      <input type="text" id="uce-fwd" name="forwardHosts" autocomplete="off" placeholder="api-dev.example.com, auth.example.com">
      <label for="uce-ca-choose" id="uce-ca-label">CA certificate (optional, for internal HTTPS servers)</label>
      <div class="uce-row">
        <span class="uce-ca-name" id="uce-ca-name" data-empty="1">No certificate</span>
        <button type="button" class="uce-choose" id="uce-ca-choose">Choose…</button>
        <button type="button" class="uce-choose" id="uce-ca-remove" hidden>Remove</button>
      </div>
      <input type="file" id="uce-ca-file" accept=".pem,.crt,.cer,.der" hidden>
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

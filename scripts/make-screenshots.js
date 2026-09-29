#!/usr/bin/env node
// @ts-check
// Generates the marketing/documentation screenshots in docs/images/.
// macOS + Google Chrome only (uses Chrome's CLI screenshot mode and, for the
// launcher page, its DevTools protocol directly over the built-in
// fetch/WebSocket globals — no extra dependencies).
//
// Usage: npm run screenshots

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { createProxy } from '../src/proxy/server.js';
import { createLocator } from '../src/overlay/locator.js';
import { buildDocument, toMarkdown } from '../src/overlay/export.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'images');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const APP_WIDTH = 1440;
const APP_HEIGHT = 900;
const CAPTURE_SCALE = 2;
const FRAME_PADDING = 80;
const TITLEBAR_HEIGHT = 40;

// ---------------------------------------------------------------- env checks

function checkEnv() {
  if (process.platform !== 'darwin') {
    console.error('make-screenshots.js only runs on macOS (drives Google Chrome directly). Aborting.');
    process.exit(1);
  }
  if (!fs.existsSync(CHROME_PATH)) {
    console.error(`Google Chrome not found at "${CHROME_PATH}". Install it or edit CHROME_PATH in scripts/make-screenshots.js. Aborting.`);
    process.exit(1);
  }
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error('ImageMagick ("magick") not found on PATH (e.g. `brew install imagemagick`). Aborting.');
    process.exit(1);
  }
}

// -------------------------------------------------------------------- utils

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function killTree(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ------------------------------------------------------- static demo server
// Mirrors examples/serve.js's static file server (same security headers,
// same path-traversal guard) so the CSS/JS/overlay files the demo needs are
// served exactly like they are for `npm run demo`.

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function createStaticServer(rootDir) {
  return http.createServer((req, res) => {
    res.setHeader('content-security-policy', "script-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    res.setHeader('x-frame-options', 'DENY');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    const parsedUrl = new URL(/** @type {string} */ (req.url), 'http://internal');
    let pathname;
    try {
      pathname = decodeURIComponent(parsedUrl.pathname);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    const resolved = path.resolve(rootDir, '.' + pathname);
    if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    fs.stat(resolved, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': contentType, 'content-length': String(stat.size) });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(resolved).pipe(res);
    });
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(undefined));
  });
}

// --------------------------------------------------- Chrome CLI screenshots

/**
 * Waits for `file` to exist and its size to stop changing (Chrome writes the
 * PNG once virtual time runs out; there is no separate "done" signal on the
 * CLI, so a couple of stable size samples is the practical readiness check).
 */
async function waitForStableFile(file, timeoutMs) {
  const start = Date.now();
  let lastSize = -1;
  let stable = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const st = fs.statSync(file);
      if (st.size > 0) {
        if (st.size === lastSize) {
          stable++;
          if (stable >= 2) return true;
        } else {
          stable = 0;
        }
        lastSize = st.size;
      }
    } catch {
      // not written yet
    }
    await sleep(120);
  }
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

const CHROME_BASE_ARGS = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-sandbox',
  '--disable-breakpad',
  '--disable-crash-reporter',
  '--disable-background-networking',
  '--disable-component-update',
  '--no-first-run',
  '--no-default-browser-check',
];

/**
 * Takes a screenshot of `url` using Chrome's `--screenshot` CLI mode.
 */
async function chromeScreenshot(url, outFile, { width, height, scale = 1, profileDir, timeoutMs = 20000 }) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  try {
    fs.unlinkSync(outFile);
  } catch {
    // didn't exist
  }
  const args = [
    ...CHROME_BASE_ARGS,
    `--user-data-dir=${profileDir}`,
    `--screenshot=${outFile}`,
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${scale}`,
    '--virtual-time-budget=3000',
    url,
  ];
  const child = spawn(CHROME_PATH, args, { detached: true, stdio: 'ignore' });
  child.unref();
  const ok = await waitForStableFile(outFile, timeoutMs);
  if (child.pid) killTree(child.pid);
  if (!ok) throw new Error(`Chrome did not produce a screenshot at ${outFile} in time (url: ${url})`);
}

// --------------------------------------------------- Chrome DevTools (CDP)
// Only the launcher screenshot needs scripted interaction (pre-seeding
// localStorage before the page's own script runs, then typing into the URL
// field) that the plain --screenshot CLI mode can't do.

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function waitForDevtools(port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Error('Chrome DevTools port never became ready');
}

/**
 * Launches a throwaway headless Chrome with the DevTools protocol enabled,
 * hands a connected CdpSession to `fn`, and always tears the process down
 * afterwards.
 */
async function withCdpPage(fn, { profileDir }) {
  const debugPort = await getFreePort();
  const child = spawn(
    CHROME_PATH,
    [
      ...CHROME_BASE_ARGS,
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${debugPort}`,
      '--remote-allow-origins=*',
      `--window-size=${APP_WIDTH},${APP_HEIGHT}`,
      'about:blank',
    ],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
  try {
    await waitForDevtools(debugPort, 10000);
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new CdpSession(ws);
    try {
      return await fn(cdp);
    } finally {
      ws.close();
    }
  } finally {
    if (child.pid) killTree(child.pid);
  }
}

async function waitForReadyState(cdp, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (res && res.result && res.result.value === 'complete') return;
    await sleep(50);
  }
}

/**
 * Captures the launcher page (`/__uce/`) with a target URL typed into the
 * field and a "recent" entry already present — both need live scripting
 * (pre-seeded localStorage, a typed input value), which the plain
 * `--screenshot` CLI mode has no hook for.
 */
async function captureLauncherScreenshot(launcherUrl, outFile, profileDir) {
  await withCdpPage(async (cdp) => {
    await cdp.send('Page.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        localStorage.setItem('uce-lang', 'en');
        localStorage.setItem('uce-recent-urls', JSON.stringify([
          { url: 'https://staging.example.com/checkout', outDir: '' }
        ]));
      `,
    });
    await cdp.send('Page.navigate', { url: launcherUrl });
    await waitForReadyState(cdp);
    await sleep(150);
    await cdp.send('Runtime.evaluate', {
      expression: `
        (function () {
          var input = document.getElementById('uce-url');
          input.value = 'http://localhost:3000/admin';
          input.focus();
        })();
      `,
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: APP_WIDTH,
      height: APP_HEIGHT,
      deviceScaleFactor: CAPTURE_SCALE,
      mobile: false,
    });
    await sleep(150);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
  }, { profileDir });
}

// ----------------------------------------------------------- HTML "frames"
// Raw app screenshots are composited into a macOS-style browser window on
// the brand gradient by rendering a small HTML page (with the raw
// screenshot embedded as a data: URI) and screenshotting *that* — much
// easier to get gradients/shadows/rounded corners right than a chain of
// `magick` composite operations.

function macWindowFrameHtml({ imageDataUri, urlText, contentWidth, contentHeight }) {
  const canvasWidth = contentWidth + FRAME_PADDING * 2;
  const canvasHeight = contentHeight + TITLEBAR_HEIGHT + FRAME_PADDING * 2;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${canvasWidth}px; height: ${canvasHeight}px;
    background: linear-gradient(135deg, #635bff 0%, #c026d3 100%);
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  }
  .window {
    width: ${contentWidth}px;
    border-radius: 12px;
    overflow: hidden;
    background: #fff;
    box-shadow: 0 40px 90px rgba(20, 10, 60, .45), 0 10px 26px rgba(20, 10, 60, .3);
  }
  .titlebar {
    height: ${TITLEBAR_HEIGHT}px;
    display: flex; align-items: center;
    background: linear-gradient(#efeff1, #e4e4e7);
    border-bottom: 1px solid #d8d8dc;
    padding: 0 14px;
    position: relative;
  }
  .dots { display: flex; gap: 8px; z-index: 1; }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot.red { background: #ff5f57; }
  .dot.yellow { background: #febc2e; }
  .dot.green { background: #28c840; }
  .urlbar {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    background: #fff; border-radius: 6px;
    padding: 5px 18px;
    font-size: 12.5px; color: #57576b;
    max-width: 62%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    box-shadow: inset 0 0 0 1px rgba(0,0,0,.07);
  }
  img { display: block; width: ${contentWidth}px; height: ${contentHeight}px; }
</style></head>
<body>
  <div class="window">
    <div class="titlebar">
      <div class="dots"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span></div>
      <div class="urlbar">${escapeHtml(urlText)}</div>
    </div>
    <img src="${imageDataUri}">
  </div>
</body></html>`;
}

function darkEditorFrameHtml({ linesHtml, lineCount, contentWidth }) {
  const lineHeight = 20;
  const editorPadding = 20;
  const contentHeight = lineCount * lineHeight + editorPadding * 2;
  const canvasWidth = contentWidth + FRAME_PADDING * 2;
  const canvasHeight = contentHeight + TITLEBAR_HEIGHT + FRAME_PADDING * 2;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${canvasWidth}px; height: ${canvasHeight}px;
    background: linear-gradient(135deg, #635bff 0%, #c026d3 100%);
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  }
  .window {
    width: ${contentWidth}px;
    border-radius: 12px;
    overflow: hidden;
    background: #1e1e1e;
    box-shadow: 0 40px 90px rgba(20, 10, 60, .45), 0 10px 26px rgba(20, 10, 60, .3);
  }
  .titlebar {
    height: ${TITLEBAR_HEIGHT}px;
    display: flex; align-items: center;
    background: #323233;
    border-bottom: 1px solid #1a1a1a;
    padding: 0 14px;
    position: relative;
  }
  .dots { display: flex; gap: 8px; z-index: 1; }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot.red { background: #ff5f57; }
  .dot.yellow { background: #febc2e; }
  .dot.green { background: #28c840; }
  .tab {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    color: #c9c9c9; font-size: 12.5px;
    font-family: "SF Mono", Menlo, Consolas, monospace;
  }
  .editor {
    padding: ${editorPadding}px 0;
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: ${lineHeight}px;
    color: #d4d4d4;
    white-space: pre;
  }
  .row { display: flex; }
  .lineno {
    flex: none; width: 44px; text-align: right; padding-right: 16px;
    color: #5a5a68; user-select: none;
  }
  .ln { flex: 1; padding-right: 24px; overflow: hidden; text-overflow: ellipsis; white-space: pre; }
  .ln.h1 { color: #4fc1ff; font-weight: 700; font-size: 15px; }
  .ln.h2 { color: #c586c0; font-weight: 700; }
  .ln.h3 { color: #9a7bd1; font-weight: 700; }
  .ln.quote { color: #8b949e; font-style: italic; border-left: 3px solid #4a4a55; padding-left: 8px; margin-left: -3px; }
  .tok-key { color: #9cdcfe; }
  .tok-code { color: #ce9178; background: rgba(255,255,255,.06); padding: 0 3px; border-radius: 3px; }
  .tok-bold { color: #e5c07b; font-weight: 700; }
</style></head>
<body>
  <div class="window">
    <div class="titlebar">
      <div class="dots"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span></div>
      <div class="tab">ui-changes.md</div>
    </div>
    <div class="editor">${linesHtml}</div>
  </div>
</body></html>`;
}

function highlightInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<span class="tok-code">$1</span>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<span class="tok-bold">$1</span>');
  return out;
}

function highlightMarkdownLine(line) {
  if (/^# /.test(line)) return `<span class="ln h1">${highlightInline(line)}</span>`;
  if (/^### /.test(line)) return `<span class="ln h3">${highlightInline(line)}</span>`;
  if (/^## /.test(line)) return `<span class="ln h2">${highlightInline(line)}</span>`;
  if (/^> /.test(line)) return `<span class="ln quote">${highlightInline(line)}</span>`;
  const listKeyMatch = /^(- [A-Za-z][\w ]*:)(.*)$/.exec(line);
  if (listKeyMatch) {
    return `<span class="ln"><span class="tok-key">${escapeHtml(listKeyMatch[1])}</span>${highlightInline(listKeyMatch[2])}</span>`;
  }
  if (line.trim() === '') return `<span class="ln">&nbsp;</span>`;
  return `<span class="ln">${highlightInline(line)}</span>`;
}

function markdownToEditorLinesHtml(markdown, maxLines) {
  const lines = markdown.split('\n').slice(0, maxLines);
  return lines
    .map((line, i) => `<div class="row"><span class="lineno">${i + 1}</span>${highlightMarkdownLine(line)}</div>`)
    .join('');
}

/** Renders `html` (a self-contained document with an explicit body size) via Chrome, at that exact size. */
async function renderHtmlToPng(html, outFile, { width, height, scratchDir, profileDir }) {
  const htmlFile = path.join(scratchDir, `frame-${path.basename(outFile, '.png')}.html`);
  fs.writeFileSync(htmlFile, html, 'utf-8');
  await chromeScreenshot(`file://${htmlFile}`, outFile, { width, height, scale: 1, profileDir, timeoutMs: 15000 });
}

// -------------------------------------------------------------- PNG output

function optimizePng(file, maxBytes) {
  execFileSync('magick', [file, '-strip', '-define', 'png:compression-level=9', '-define', 'png:compression-filter=5', file]);
  let size = fs.statSync(file).size;
  if (size <= maxBytes) return size;
  // Flat UI colours compress fine with a reduced, dithered palette; fall
  // back to it only if lossless compression wasn't enough.
  execFileSync('magick', [file, '-strip', '-dither', 'FloydSteinberg', '-colors', '256', file]);
  size = fs.statSync(file).size;
  return size;
}

// ------------------------------------------------------------- fixture data
// The same six changes (one of each type) showcase.js builds live in the
// browser, computed here with the real locator algorithm via jsdom so the
// exported ui-changes.md screenshot is authentic, not hand-typed.

function buildFixtureChanges(baseUrl) {
  const demoHtmlPath = path.join(REPO_ROOT, 'examples', 'demo.html');
  const html = fs.readFileSync(demoHtmlPath, 'utf-8');
  const dom = new JSDOM(html, { url: baseUrl });
  const doc = dom.window.document;

  const cardsUrl = `${baseUrl}#cards`;
  const formUrl = `${baseUrl}#form`;
  const loc = (el, url) => createLocator(el, { url });

  const cards = Array.from(doc.querySelectorAll('#cards-view .item-card'));
  const [card1, , card3] = cards;
  const heading1 = card1.querySelector('h3');
  const button1 = card1.querySelector('button');
  const button3 = card3.querySelector('button');
  const email = doc.getElementById('email');
  const submit = doc.querySelector('#demo-form button[type="submit"]');

  const template = loc(button1, cardsUrl);

  return [
    { type: 'text', target: loc(heading1, cardsUrl), before: heading1.textContent.trim(), after: 'Starter Plan' },
    { type: 'remove', target: loc(button3, cardsUrl) },
    { type: 'move', target: loc(card3, cardsUrl), anchor: loc(card1, cardsUrl), position: 'before' },
    { type: 'insert', template, anchor: template, position: 'after', text: 'Compare' },
    {
      type: 'attr',
      target: loc(email, formUrl),
      attr: 'placeholder',
      before: email.getAttribute('placeholder') || '',
      after: 'you@company.com',
    },
    {
      type: 'comment',
      target: loc(submit, formUrl),
      note: 'Right-align next to Cancel and make it the primary action.',
    },
  ].map((c, i) => ({ ...c, id: i + 1 }));
}

// --------------------------------------------------------------------- main

async function main() {
  checkEnv();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nudgit-screenshots-'));
  const profileDir = path.join(scratchRoot, 'profile');
  const rawDir = path.join(scratchRoot, 'raw');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });

  /** @type {import('node:http').Server[]} */
  const servers = [];

  try {
    // --- static demo server + main proxy (for the demo/showcase scenes) ---
    const staticServer = createStaticServer(REPO_ROOT);
    const staticPort = await getFreePort();
    await listen(staticServer, staticPort);
    servers.push(staticServer);

    const proxyOut = path.join(scratchRoot, 'ui-changes.md');
    const proxy = createProxy({ target: `http://localhost:${staticPort}/examples/demo.html`, out: proxyOut, updateCheck: false });
    const proxyPort = await getFreePort();
    await listen(proxy, proxyPort);
    servers.push(proxy);

    // --- separate launcher-mode proxy (no target) ---
    const launcherProxy = createProxy({ out: path.join(scratchRoot, 'launcher-ui-changes.md'), updateCheck: false });
    const launcherPort = await getFreePort();
    await listen(launcherProxy, launcherPort);
    servers.push(launcherProxy);

    // --- 1) the four overlay scenes ---
    const SCENES = [
      { name: 'select', hash: 'cards' },
      { name: 'panel', hash: 'cards' },
      { name: 'palette', hash: 'cards' },
      { name: 'comment', hash: 'form' },
    ];

    for (const scene of SCENES) {
      console.log(`Capturing scene: ${scene.name}`);
      const url = `http://localhost:${proxyPort}/examples/demo.html?showcase=${scene.name}`;
      const rawFile = path.join(rawDir, `${scene.name}.png`);
      await chromeScreenshot(url, rawFile, { width: APP_WIDTH, height: APP_HEIGHT, scale: CAPTURE_SCALE, profileDir, timeoutMs: 20000 });

      const imageDataUri = `data:image/png;base64,${fs.readFileSync(rawFile).toString('base64')}`;
      const urlText = `localhost:4400/examples/demo.html#${scene.hash}`; // default port, not the ephemeral one
      const html = macWindowFrameHtml({ imageDataUri, urlText, contentWidth: APP_WIDTH, contentHeight: APP_HEIGHT });
      const outFile = path.join(OUT_DIR, `${scene.name}.png`);
      await renderHtmlToPng(html, outFile, {
        width: APP_WIDTH + FRAME_PADDING * 2,
        height: APP_HEIGHT + TITLEBAR_HEIGHT + FRAME_PADDING * 2,
        scratchDir: rawDir,
        profileDir,
      });
      const size = optimizePng(outFile, 600 * 1024);
      console.log(`  -> docs/images/${scene.name}.png (${Math.round(size / 1024)} KB)`);
    }

    // --- 2) launcher screenshot ---
    console.log('Capturing scene: launcher');
    const launcherRaw = path.join(rawDir, 'launcher.png');
    await captureLauncherScreenshot(`http://localhost:${launcherPort}/__uce/`, launcherRaw, profileDir);
    {
      const imageDataUri = `data:image/png;base64,${fs.readFileSync(launcherRaw).toString('base64')}`;
      const urlText = 'localhost:4400/__uce/';
      const html = macWindowFrameHtml({ imageDataUri, urlText, contentWidth: APP_WIDTH, contentHeight: APP_HEIGHT });
      const outFile = path.join(OUT_DIR, 'launcher.png');
      await renderHtmlToPng(html, outFile, {
        width: APP_WIDTH + FRAME_PADDING * 2,
        height: APP_HEIGHT + TITLEBAR_HEIGHT + FRAME_PADDING * 2,
        scratchDir: rawDir,
        profileDir,
      });
      const size = optimizePng(outFile, 600 * 1024);
      console.log(`  -> docs/images/launcher.png (${Math.round(size / 1024)} KB)`);
    }

    // --- 3) ui-changes.md rendered as a dark editor mockup ---
    console.log('Rendering ui-changes.md preview');
    {
      const baseUrl = 'http://localhost:4400/examples/demo.html'; // as users would see it
      const changes = buildFixtureChanges(baseUrl);
      const source = { url: baseUrl, title: 'nudgit Demo App', viewport: '1440×900', createdAt: '2025-01-15T09:30:00.000Z' };
      const doc = buildDocument(changes, source);
      const md = toMarkdown(doc);

      const MAX_LINES = 45;
      const linesHtml = markdownToEditorLinesHtml(md, MAX_LINES);
      const lineCount = Math.min(MAX_LINES, md.split('\n').length);
      const html = darkEditorFrameHtml({ linesHtml, lineCount, contentWidth: APP_WIDTH });
      const contentHeight = lineCount * 20 + 40;
      const outFile = path.join(OUT_DIR, 'ui-changes-md.png');
      await renderHtmlToPng(html, outFile, {
        width: APP_WIDTH + FRAME_PADDING * 2,
        height: contentHeight + TITLEBAR_HEIGHT + FRAME_PADDING * 2,
        scratchDir: rawDir,
        profileDir,
      });
      const size = optimizePng(outFile, 600 * 1024);
      console.log(`  -> docs/images/ui-changes-md.png (${Math.round(size / 1024)} KB)`);
    }

    // --- 4) GitHub social preview (exactly 1280x640) ---
    console.log('Rendering social preview');
    {
      const iconSvg = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'icon.svg'), 'utf-8');
      const selectFramePath = path.join(OUT_DIR, 'select.png');
      const selectDataUri = `data:image/png;base64,${fs.readFileSync(selectFramePath).toString('base64')}`;
      const html = socialPreviewHtml({ iconSvg, screenshotDataUri: selectDataUri });
      const outFile = path.join(OUT_DIR, 'social-preview.png');
      await renderHtmlToPng(html, outFile, { width: 1280, height: 640, scratchDir: rawDir, profileDir });
      const size = optimizePng(outFile, 600 * 1024);
      console.log(`  -> docs/images/social-preview.png (${Math.round(size / 1024)} KB)`);
    }

    console.log('\nDone. Images written to docs/images/.');
  } finally {
    for (const server of servers) {
      try {
        server.close();
      } catch {
        // ignore
      }
    }
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
}

function socialPreviewHtml({ iconSvg, screenshotDataUri }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; overflow: hidden; }
  body {
    width: 1280px; height: 640px;
    background: linear-gradient(135deg, #635bff 0%, #c026d3 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    position: relative;
  }
  .content {
    position: absolute; left: 88px; top: 0; bottom: 0;
    display: flex; flex-direction: column; justify-content: center;
    width: 640px;
  }
  .icon { width: 84px; height: 84px; border-radius: 18px; overflow: hidden; box-shadow: 0 12px 30px rgba(0,0,0,.25); margin-bottom: 28px; }
  .icon svg { display: block; width: 100%; height: 100%; }
  .title { font-size: 64px; font-weight: 800; color: #fff; margin: 0 0 14px; letter-spacing: -0.02em; }
  .tagline { font-size: 24px; color: rgba(255,255,255,.92); margin: 0; line-height: 1.4; max-width: 480px; }
  .shot {
    position: absolute; right: -170px; top: 90px;
    width: 760px;
    transform: rotate(-7deg);
    border-radius: 14px;
    box-shadow: 0 50px 100px rgba(15, 5, 40, .5);
  }
</style></head>
<body>
  <div class="content">
    <div class="icon">${iconSvg}</div>
    <p class="title">nudgit</p>
    <p class="tagline">Your UI. Your feedback. Agent-ready.<br>Turn visual edits into a change list your coding agent can implement.</p>
  </div>
  <img class="shot" src="${screenshotDataUri}">
</body></html>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// @ts-check
// Reverse proxy that sits between the browser and a target web app, injects the
// nudgit overlay script into HTML responses, and serves the overlay + export routes
// under the reserved /__uce/ prefix. Also serves a launcher page (GET /__uce/)
// so the target and output directory can be picked/changed at runtime, without
// a URL argument on the CLI ("launcher mode").

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { injectScript, injectHeadScript } from './inject.js';
import { stripSecurityHeaders, rewriteLocation, rewriteSetCookie, rewriteFwdLocation } from './headers.js';
import { launcherHtml } from './launcher.js';
import { pickLang, messages } from './i18n.js';

/** Launcher icons served under /__uce/static/ (whitelist → content type). */
const STATIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');
/** @type {Record<string, string>} */
const STATIC_FILES = {
  'favicon-32.png': 'image/png',
  'apple-touch-icon.png': 'image/png',
  'icon.svg': 'image/svg+xml',
};
import { pickDirectory as defaultPickDirectory, isSupported as isPickDirSupported } from './pick-dir.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OVERLAY_DIR = path.join(REPO_ROOT, 'src', 'overlay');
const MAX_EXPORT_BYTES = 5 * 1024 * 1024;
const MAX_JSON_BODY_BYTES = 64 * 1024;
const REACHABILITY_TIMEOUT_MS = 700;
const UPDATE_CHECK_TIMEOUT_MS = 4000;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
/** Path prefix for `/__uce/fwd/<scheme>/<host:port>/<path>` requests (see `resolveFwd`). */
const FWD_PREFIX = '/__uce/fwd/';
/** Matches a fwd pathname; groups: scheme, host(:port), rest-of-path (with leading slash, or undefined for root). */
const FWD_PATH_RE = /^\/__uce\/fwd\/(https?|wss?)\/([^/]+)(\/.*)?$/;

/**
 * Create the nudgit proxy server. The caller is responsible for calling `.listen(...)`.
 *
 * @param {{ target?: string, out?: string, overlayDir?: string, onQuit?: () => void,
 *   pickDirectory?: (opts: { title?: string, startDir?: string }) => Promise<{path: string}|{cancelled: true}>,
 *   updateCheck?: false | (() => Promise<{current: string, latest: string, url: string, downloadUrl?: string}|null>) }} [options]
 *   `target` is the full target URL (e.g. http://localhost:8787/admin). When
 *   omitted, the proxy starts in launcher mode: every non-/__uce/ request
 *   redirects to the launcher page until a target is set via POST /__uce/target.
 *   `out` is the export file path (default: `<cwd>/ui-changes.md`).
 *   `overlayDir` is the directory the /__uce/ overlay modules are served from
 *   (default: `src/overlay` relative to this repo).
 *   `onQuit` is invoked (after the response is flushed) when POST /__uce/quit
 *   is called; the CLI wires this to close the server and exit the process.
 *   `pickDirectory` overrides the OS-native folder chooser used by POST
 *   /__uce/pick-dir (tests inject a fake so no real dialog opens). When
 *   provided, /__uce/state reports `canPickDir: true` unconditionally.
 *   `updateCheck`, when a function, is called once at creation (its promise
 *   is not awaited, so startup never blocks on it) and its result is served
 *   from GET /__uce/update. Omitted or `false` disables the check entirely
 *   (`/__uce/update` then always answers `{ update: null, checked: false }`).
 * @returns {import('http').Server}
 */
export function createProxy({ target, out, overlayDir, onQuit, pickDirectory, updateCheck } = {}) {
  /** @type {URL|null} */
  let currentTargetUrl = target ? new URL(target) : null;
  let currentOut = path.resolve(out || path.join(process.cwd(), 'ui-changes.md'));
  const resolvedOverlayDir = path.resolve(overlayDir || DEFAULT_OVERLAY_DIR);
  const pickDirFn = pickDirectory || defaultPickDirectory;
  const canPickDir = pickDirectory ? true : isPickDirSupported();
  let pickDirBusy = false;

  const updateCheckEnabled = typeof updateCheck === 'function';
  /** @type {Promise<{current: string, latest: string, url: string, downloadUrl?: string}|null>} */
  const updateCheckPromise = updateCheckEnabled
    ? Promise.resolve()
        .then(() => /** @type {() => Promise<any>} */ (updateCheck)())
        .then((info) => info || null)
        .catch(() => null)
    : Promise.resolve(null);

  const server = http.createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch {
      if (!res.headersSent) {
        send(res, 502, 'text/plain; charset=utf-8', messages(pickLang(req.headers['accept-language'])).gatewayError);
      }
    }
  });

  server.on('upgrade', (req, clientSocket, head) => {
    clientSocket.on('error', () => {});
    const parsedUrl = new URL(/** @type {string} */ (req.url), 'http://internal');
    if (parsedUrl.pathname.startsWith(FWD_PREFIX)) {
      try {
        handleFwdUpgrade(req, clientSocket, head, parsedUrl);
      } catch {
        clientSocket.destroy();
      }
      return;
    }
    if (!currentTargetUrl) {
      clientSocket.destroy();
      return;
    }
    try {
      handleUpgrade(req, clientSocket, head, currentTargetUrl);
    } catch {
      clientSocket.destroy();
    }
  });

  /** @type {any} */ (server).uce = {
    getTarget: () => (currentTargetUrl ? currentTargetUrl.href : null),
    setTarget: (/** @type {string} */ url) => {
      currentTargetUrl = new URL(url);
    },
    getOut: () => currentOut,
    setOut: (/** @type {string} */ p) => {
      currentOut = path.resolve(p);
    },
    getUpdateInfo: () => updateCheckPromise,
  };

  return server;

  /** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
  function handleRequest(req, res) {
    const parsedUrl = new URL(/** @type {string} */ (req.url), 'http://internal');
    if (parsedUrl.pathname.startsWith('/__uce/')) {
      return handleUceRoute(req, res, parsedUrl);
    }
    if (!currentTargetUrl) {
      // browsers (Safari in particular) ask for /favicon.ico regardless of <link rel="icon">
      if (parsedUrl.pathname === '/favicon.ico') return serveStaticFile(req, res, 'favicon-32.png');
      res.writeHead(302, { location: '/__uce/' });
      res.end();
      return;
    }
    return proxyRequest(req, res, currentTargetUrl);
  }

  /**
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {URL} parsedUrl
   */
  function handleUceRoute(req, res, parsedUrl) {
    const proxyOrigin = `http://${req.headers.host}`;
    if (parsedUrl.pathname.startsWith(FWD_PREFIX)) {
      return handleFwd(req, res, parsedUrl, proxyOrigin);
    }
    if (parsedUrl.pathname === '/__uce/') {
      if (req.method === 'GET') {
        return send(res, 200, 'text/html; charset=utf-8', launcherHtml(currentState()));
      }
      return notFound(req, res);
    }
    if (parsedUrl.pathname === '/__uce/state') {
      if (req.method === 'GET') return sendJson(res, 200, currentState());
      return notFound(req, res);
    }
    if (parsedUrl.pathname === '/__uce/update') {
      if (req.method === 'GET') return handleUpdateCheck(res);
      return notFound(req, res);
    }
    if (parsedUrl.pathname === '/__uce/export') {
      if (req.method !== 'POST') return notFound(req, res);
      if (isCrossOriginPost(req, proxyOrigin)) return forbidden(req, res);
      return handleExport(req, res);
    }
    if (parsedUrl.pathname === '/__uce/target') {
      if (req.method !== 'POST') return notFound(req, res);
      if (isCrossOriginPost(req, proxyOrigin)) return forbidden(req, res);
      return handleSetTarget(req, res);
    }
    if (parsedUrl.pathname === '/__uce/quit') {
      if (req.method !== 'POST') return notFound(req, res);
      if (isCrossOriginPost(req, proxyOrigin)) return forbidden(req, res);
      return handleQuit(req, res);
    }
    if (parsedUrl.pathname === '/__uce/pick-dir') {
      if (req.method !== 'POST') return notFound(req, res);
      if (isCrossOriginPost(req, proxyOrigin)) return forbidden(req, res);
      return handlePickDir(req, res);
    }
    if (req.method === 'GET' && parsedUrl.pathname.startsWith('/__uce/static/')) {
      return serveStaticFile(req, res, parsedUrl.pathname.slice('/__uce/static/'.length));
    }
    if (req.method === 'GET' && parsedUrl.pathname.endsWith('.js')) {
      const relPath =
        parsedUrl.pathname === '/__uce/overlay.js'
          ? 'index.js'
          : parsedUrl.pathname.slice('/__uce/'.length);
      return serveOverlayFile(req, res, relPath);
    }
    return notFound(req, res);
  }

  /** @returns {{ target: string|null, out: string, canPickDir: boolean }} */
  function currentState() {
    return { target: currentTargetUrl ? currentTargetUrl.href : null, out: currentOut, canPickDir };
  }

  /** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res @param {string} relPath */
  function serveOverlayFile(req, res, relPath) {
    const resolved = path.resolve(resolvedOverlayDir, relPath);
    const root = resolvedOverlayDir + path.sep;
    if (!resolved.startsWith(root)) return notFound(req, res);
    fs.readFile(resolved, (err, data) => {
      if (err) return notFound(req, res);
      send(res, 200, 'text/javascript; charset=utf-8', data);
    });
  }

  /** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res @param {string} name */
  function serveStaticFile(req, res, name) {
    const type = STATIC_FILES[name];
    if (!type) return notFound(req, res);
    fs.readFile(path.join(STATIC_DIR, name), (err, data) => {
      if (err) return notFound(req, res);
      res.writeHead(200, { 'content-type': type, 'content-length': String(data.length), 'cache-control': 'max-age=86400' });
      res.end(data);
    });
  }

  /** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
  function handleExport(req, res) {
    const t = messages(pickLang(req.headers['accept-language']));
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      total += chunk.length;
      if (total > MAX_EXPORT_BYTES) {
        rejected = true;
        send(res, 413, 'text/plain; charset=utf-8', t.exportTooLarge);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      const markdown = Buffer.concat(chunks).toString('utf-8');
      fs.writeFile(currentOut, markdown, 'utf-8', (err) => {
        if (err) return send(res, 500, 'text/plain; charset=utf-8', t.writeFailed);
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ path: currentOut }));
      });
    });
    req.on('error', () => {});
  }

  /** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
  function handleSetTarget(req, res) {
    const t = messages(pickLang(req.headers['accept-language']));
    readJsonBody(req, (err, data) => {
      if (err) return sendJson(res, 400, { error: t.invalidRequest });
      const rawUrl = typeof data?.url === 'string' ? data.url.trim() : '';
      if (!rawUrl) return sendJson(res, 400, { error: t.missingUrl });

      const withScheme = SCHEME_RE.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
      /** @type {URL} */
      let parsed;
      try {
        parsed = new URL(withScheme);
      } catch {
        return sendJson(res, 400, { error: t.invalidUrl(rawUrl) });
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return sendJson(res, 400, { error: t.unsupportedScheme });
      }

      const rawOutDir = typeof data?.outDir === 'string' ? data.outDir.trim() : '';
      const outDir = path.resolve(rawOutDir || path.dirname(currentOut));
      let stat;
      try {
        stat = fs.statSync(outDir);
      } catch {
        return sendJson(res, 400, { error: t.dirNotFound(outDir) });
      }
      if (!stat.isDirectory()) return sendJson(res, 400, { error: t.notADir(outDir) });

      checkReachable(parsed, (reachable) => {
        currentTargetUrl = parsed;
        currentOut = path.join(outDir, 'ui-changes.md');
        const openPath = `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
        /** @type {{ ok: true, path: string, warning?: string }} */
        const body = { ok: true, path: openPath };
        if (!reachable) body.warning = t.targetMaybeUnreachable;
        sendJson(res, 200, body);
      });
    });
  }

  /**
   * Answers with the pending update-check result, waiting at most
   * UPDATE_CHECK_TIMEOUT_MS for it to settle (never rejects/throws).
   * @param {import('http').ServerResponse} res
   */
  function handleUpdateCheck(res) {
    if (!updateCheckEnabled) return sendJson(res, 200, { update: null, checked: false });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sendJson(res, 200, { update: null, checked: false });
    }, UPDATE_CHECK_TIMEOUT_MS);
    updateCheckPromise.then((info) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sendJson(res, 200, { update: info, checked: true });
    });
  }

  /** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
  function handleQuit(req, res) {
    sendJson(res, 200, { ok: true });
    res.on('finish', () => {
      if (onQuit) onQuit();
    });
  }

  /** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
  function handlePickDir(req, res) {
    const t = messages(pickLang(req.headers['accept-language']));
    if (pickDirBusy) return sendJson(res, 409, { error: t.pickDirBusy });
    pickDirBusy = true;
    readJsonBody(req, (err, data) => {
      if (err) {
        pickDirBusy = false;
        return sendJson(res, 400, { error: t.invalidRequest });
      }
      const startDir = typeof data?.startDir === 'string' ? data.startDir.trim() : '';
      Promise.resolve()
        .then(() => pickDirFn({ title: t.pickDirPrompt, startDir }))
        .then((result) => {
          pickDirBusy = false;
          if (!result || /** @type {any} */ (result).cancelled) return sendJson(res, 200, { cancelled: true });
          const chosen = /** @type {{path: string}} */ (result).path;
          let stat;
          try {
            stat = fs.statSync(chosen);
          } catch {
            return sendJson(res, 400, { error: t.dirNotFound(chosen) });
          }
          if (!stat.isDirectory()) return sendJson(res, 400, { error: t.notADir(chosen) });
          sendJson(res, 200, { path: chosen });
        })
        .catch((error) => {
          pickDirBusy = false;
          const msg = error && typeof error.message === 'string' && error.message ? error.message : t.pickDirFailed;
          sendJson(res, 500, { error: msg });
        });
    });
  }

  /**
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {URL} targetUrl
   */
  function proxyRequest(req, res, targetUrl) {
    const targetIsHttps = targetUrl.protocol === 'https:';
    const proxyOrigin = `http://${req.headers.host}`;
    const headers = { ...req.headers };
    headers.host = targetUrl.host;
    rewriteOriginReferer(headers, proxyOrigin, targetUrl.origin);

    const requestModule = targetIsHttps ? https : http;
    const proxyReq = requestModule.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetIsHttps ? 443 : 80),
        path: req.url,
        method: req.method,
        headers,
      },
      (proxyRes) => handleProxyResponse(req, res, proxyRes, proxyOrigin, targetUrl),
    );

    proxyReq.on('error', () => {
      if (!res.headersSent) {
        send(res, 502, 'text/plain; charset=utf-8', messages(pickLang(req.headers['accept-language'])).gatewayError);
      } else {
        res.destroy();
      }
    });
    req.on('error', () => proxyReq.destroy());
    req.pipe(proxyReq);
  }

  /**
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {import('http').IncomingMessage} proxyRes
   * @param {string} proxyOrigin
   * @param {URL} targetUrl
   */
  function handleProxyResponse(req, res, proxyRes, proxyOrigin, targetUrl) {
    const headers = prepareResponseHeaders(proxyRes.headers, proxyOrigin, targetUrl);
    const contentType = String(headers['content-type'] || '').toLowerCase().split(';')[0].trim();
    const isHtml = contentType === 'text/html';
    const skipBody = req.method === 'HEAD' || proxyRes.statusCode === 204 || proxyRes.statusCode === 304;

    if (!isHtml || skipBody) {
      res.writeHead(/** @type {number} */ (proxyRes.statusCode), headers);
      proxyRes.pipe(res);
      return;
    }

    /** @type {Buffer[]} */
    const chunks = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('error', () => res.destroy());
    proxyRes.on('end', () => {
      const raw = Buffer.concat(chunks);
      let html;
      try {
        html = decompress(raw, proxyRes.headers['content-encoding']);
      } catch {
        // Could not decompress; forward the original bytes unmodified.
        res.writeHead(/** @type {number} */ (proxyRes.statusCode), proxyRes.headers);
        res.end(raw);
        return;
      }
      const netShimTag = `<script src="/__uce/net-shim.js?target=${encodeURIComponent(targetUrl.href)}"></script>`;
      const overlayTag = `<script type="module" src="/__uce/overlay.js?target=${encodeURIComponent(targetUrl.href)}"></script>`;
      let htmlStr = injectHeadScript(html.toString('utf-8'), netShimTag);
      htmlStr = injectScript(htmlStr, overlayTag);
      const body = Buffer.from(htmlStr, 'utf-8');
      delete headers['content-encoding'];
      delete headers['transfer-encoding'];
      headers['content-length'] = String(Buffer.byteLength(body));
      res.writeHead(/** @type {number} */ (proxyRes.statusCode), headers);
      res.end(body);
    });
  }

  /**
   * @param {import('http').IncomingHttpHeaders} rawHeaders
   * @param {string} proxyOrigin
   * @param {URL} targetUrl
   * @returns {import('http').OutgoingHttpHeaders}
   */
  function prepareResponseHeaders(rawHeaders, proxyOrigin, targetUrl) {
    const headers = /** @type {import('http').OutgoingHttpHeaders} */ ({ ...rawHeaders });
    stripSecurityHeaders(headers);
    if (headers.location) {
      const loc = Array.isArray(headers.location) ? headers.location[0] : headers.location;
      headers.location = rewriteLocation(String(loc), targetUrl.origin, proxyOrigin);
    }
    if (headers['set-cookie']) {
      const cookies = Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [String(headers['set-cookie'])];
      const targetIsHttps = targetUrl.protocol === 'https:';
      headers['set-cookie'] = cookies.map((c) => rewriteSetCookie(c, { targetIsHttps, proxyIsHttps: false }));
    }
    return headers;
  }

  /**
   * @param {import('http').IncomingMessage} req
   * @param {import('stream').Duplex} clientSocket
   * @param {Buffer} head
   * @param {URL} targetUrl
   */
  function handleUpgrade(req, clientSocket, head, targetUrl) {
    const targetIsHttps = targetUrl.protocol === 'https:';
    const proxyOrigin = `http://${req.headers.host}`;
    const headers = { ...req.headers };
    headers.host = targetUrl.host;
    rewriteOriginReferer(headers, proxyOrigin, targetUrl.origin);

    const requestModule = targetIsHttps ? https : http;
    const proxyReq = requestModule.request({
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetIsHttps ? 443 : 80),
      path: req.url,
      method: req.method,
      headers,
    });

    proxyReq.on('upgrade', (proxyRes, targetSocket, targetHead) => {
      targetSocket.on('error', () => clientSocket.destroy());
      const statusLine = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`;
      const headerLines = Object.entries(proxyRes.headers)
        .flatMap(([k, v]) => (Array.isArray(v) ? v.map((vv) => `${k}: ${vv}`) : [`${k}: ${v}`]))
        .join('\r\n');
      clientSocket.write(statusLine + headerLines + '\r\n\r\n');
      if (targetHead && targetHead.length) targetSocket.unshift(targetHead);
      if (head && head.length) clientSocket.unshift(head);
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
    });
    proxyReq.on('error', () => clientSocket.destroy());
    proxyReq.end();
  }

  /**
   * Validate and resolve a `/__uce/fwd/<scheme>/<host:port>/<path>` pathname
   * against the current target. Only loopback hosts (localhost, *.localhost,
   * 127.0.0.0/8, ::1) or a host matching the current target's hostname are
   * allowed, so the proxy can't be used as an open relay to arbitrary hosts.
   *
   * @param {string} pathname
   * @returns {{ ok: true, scheme: 'http'|'https'|'ws'|'wss', host: string, hostname: string, port: number,
   *   upstreamPath: string, isHttpsUpstream: boolean, upstreamOrigin: string, fwdPrefix: string } | { ok: false }}
   */
  function resolveFwd(pathname) {
    if (!currentTargetUrl) return { ok: false };
    const m = FWD_PATH_RE.exec(pathname);
    if (!m) return { ok: false };
    const scheme = /** @type {'http'|'https'|'ws'|'wss'} */ (m[1]);
    const host = m[2];
    const upstreamPath = m[3] || '/';
    /** @type {URL} */
    let hostUrl;
    try {
      hostUrl = new URL(`http://${host}`);
    } catch {
      return { ok: false };
    }
    const hostname = hostUrl.hostname;
    if (!isAllowedFwdHost(hostname, currentTargetUrl.hostname)) return { ok: false };
    const isHttpsUpstream = scheme === 'https' || scheme === 'wss';
    const port = hostUrl.port ? Number(hostUrl.port) : isHttpsUpstream ? 443 : 80;
    return {
      ok: true,
      scheme,
      host,
      hostname,
      port,
      upstreamPath,
      isHttpsUpstream,
      upstreamOrigin: `${isHttpsUpstream ? 'https' : 'http'}://${host}`,
      fwdPrefix: `/__uce/fwd/${scheme}/${host}`,
    };
  }

  /**
   * Build the outgoing headers for a fwd request: same as the incoming
   * request's headers, but with `Host` set to the upstream host and
   * `Origin`/`Referer` rewritten to the main target's origin (what the
   * backend's CORS/CSRF checks expect), not the proxy origin the browser
   * actually sent the request from.
   *
   * @param {import('http').IncomingHttpHeaders} reqHeaders
   * @param {string} host
   * @param {string} proxyOrigin
   * @param {string} targetOrigin
   * @returns {import('http').OutgoingHttpHeaders}
   */
  function buildFwdRequestHeaders(reqHeaders, host, proxyOrigin, targetOrigin) {
    const headers = /** @type {import('http').OutgoingHttpHeaders} */ ({ ...reqHeaders });
    headers.host = host;
    if (typeof headers.origin === 'string') headers.origin = targetOrigin;
    if (typeof headers.referer === 'string' && headers.referer.startsWith(proxyOrigin)) {
      headers.referer = targetOrigin + headers.referer.slice(proxyOrigin.length);
    }
    return headers;
  }

  /**
   * Handle a `GET/POST/... /__uce/fwd/<scheme>/<host:port>/<path>` request:
   * forward it to the given local backend and stream the response back
   * unmodified except for security headers, Location and Set-Cookie (never
   * buffered, so SSE/chat streaming responses work).
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {URL} parsedUrl
   * @param {string} proxyOrigin
   */
  function handleFwd(req, res, parsedUrl, proxyOrigin) {
    const t = messages(pickLang(req.headers['accept-language']));
    if (req.headers['sec-fetch-site'] === 'cross-site') return forbidden(req, res);
    const resolved = resolveFwd(parsedUrl.pathname);
    if (!resolved.ok) {
      const m = FWD_PATH_RE.exec(parsedUrl.pathname);
      return send(res, 403, 'text/plain; charset=utf-8', t.fwdHostNotAllowed(m ? m[2] : parsedUrl.pathname));
    }
    const { hostname, port, upstreamPath, isHttpsUpstream, upstreamOrigin, fwdPrefix } = resolved;
    const targetOrigin = /** @type {URL} */ (currentTargetUrl).origin;
    const headers = buildFwdRequestHeaders(req.headers, resolved.host, proxyOrigin, targetOrigin);

    const requestModule = isHttpsUpstream ? https : http;
    const proxyReq = requestModule.request(
      {
        hostname,
        port,
        path: upstreamPath + parsedUrl.search,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        const respHeaders = /** @type {import('http').OutgoingHttpHeaders} */ ({ ...proxyRes.headers });
        stripSecurityHeaders(respHeaders);
        if (respHeaders.location) {
          const loc = Array.isArray(respHeaders.location) ? respHeaders.location[0] : respHeaders.location;
          respHeaders.location = rewriteFwdLocation(String(loc), upstreamOrigin, targetOrigin, proxyOrigin, fwdPrefix);
        }
        if (respHeaders['set-cookie']) {
          const cookies = Array.isArray(respHeaders['set-cookie'])
            ? respHeaders['set-cookie']
            : [String(respHeaders['set-cookie'])];
          respHeaders['set-cookie'] = cookies.map((c) =>
            rewriteSetCookie(c, { targetIsHttps: isHttpsUpstream, proxyIsHttps: false, pathPrefix: fwdPrefix }),
          );
        }
        res.writeHead(/** @type {number} */ (proxyRes.statusCode), respHeaders);
        proxyRes.on('error', () => res.destroy());
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', () => {
      if (!res.headersSent) {
        send(res, 502, 'text/plain; charset=utf-8', t.gatewayError);
      } else {
        res.destroy();
      }
    });
    req.on('error', () => proxyReq.destroy());
    req.pipe(proxyReq);
  }

  /**
   * Handle a WebSocket upgrade on a `/__uce/fwd/ws(s)/<host:port>/<path>` URL:
   * same host allow-list and Origin/Referer rewriting as `handleFwd`, then
   * pipe the raw sockets together once the upstream accepts the upgrade.
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('stream').Duplex} clientSocket
   * @param {Buffer} head
   * @param {URL} parsedUrl
   */
  function handleFwdUpgrade(req, clientSocket, head, parsedUrl) {
    const reject = () => {
      try {
        clientSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      } catch {
        // socket may already be gone; destroy() below covers it
      }
      clientSocket.destroy();
    };
    if (req.headers['sec-fetch-site'] === 'cross-site') return reject();
    const resolved = resolveFwd(parsedUrl.pathname);
    if (!resolved.ok) return reject();
    const { hostname, port, upstreamPath, isHttpsUpstream } = resolved;
    const proxyOrigin = `http://${req.headers.host}`;
    const targetOrigin = /** @type {URL} */ (currentTargetUrl).origin;
    const headers = buildFwdRequestHeaders(req.headers, resolved.host, proxyOrigin, targetOrigin);

    const requestModule = isHttpsUpstream ? https : http;
    const proxyReq = requestModule.request({
      hostname,
      port,
      path: upstreamPath + parsedUrl.search,
      method: req.method,
      headers,
    });

    proxyReq.on('upgrade', (proxyRes, targetSocket, targetHead) => {
      targetSocket.on('error', () => clientSocket.destroy());
      const statusLine = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`;
      const headerLines = Object.entries(proxyRes.headers)
        .flatMap(([k, v]) => (Array.isArray(v) ? v.map((vv) => `${k}: ${vv}`) : [`${k}: ${v}`]))
        .join('\r\n');
      clientSocket.write(statusLine + headerLines + '\r\n\r\n');
      if (targetHead && targetHead.length) targetSocket.unshift(targetHead);
      if (head && head.length) clientSocket.unshift(head);
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
    });
    proxyReq.on('error', () => clientSocket.destroy());
    proxyReq.end();
  }
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopbackHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) return Number(m[1]) === 127;
  return false;
}

/**
 * @param {string} hostname
 * @param {string} targetHostname
 * @returns {boolean}
 */
function isAllowedFwdHost(hostname, targetHostname) {
  return isLoopbackHost(hostname) || hostname.toLowerCase() === targetHostname.toLowerCase();
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {string} proxyOrigin
 * @returns {boolean}
 */
function isCrossOriginPost(req, proxyOrigin) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== proxyOrigin) return true;
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') return true;
  return false;
}

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
function forbidden(req, res) {
  send(res, 403, 'text/plain; charset=utf-8', messages(pickLang(req.headers['accept-language'])).crossOriginError);
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {(err: Error|null, data?: any) => void} cb
 */
function readJsonBody(req, cb) {
  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;
  let rejected = false;
  req.on('data', (chunk) => {
    if (rejected) return;
    total += chunk.length;
    if (total > MAX_JSON_BODY_BYTES) {
      rejected = true;
      cb(new Error('body too large'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (rejected) return;
    try {
      const raw = Buffer.concat(chunks).toString('utf-8');
      cb(null, raw ? JSON.parse(raw) : {});
    } catch (err) {
      cb(/** @type {Error} */ (err));
    }
  });
  req.on('error', () => {});
}

/**
 * Best-effort reachability check with a short timeout; never rejects, only
 * reports true/false via the callback (used for a warning, not a hard failure).
 * @param {URL} url
 * @param {(reachable: boolean) => void} cb
 */
function checkReachable(url, cb) {
  const mod = url.protocol === 'https:' ? https : http;
  let done = false;
  /** @param {boolean} ok */
  const finish = (ok) => {
    if (done) return;
    done = true;
    cb(ok);
  };
  try {
    const reqCheck = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: '/',
        method: 'HEAD',
        timeout: REACHABILITY_TIMEOUT_MS,
      },
      (r) => {
        r.resume();
        finish(true);
      },
    );
    reqCheck.on('timeout', () => {
      reqCheck.destroy();
      finish(false);
    });
    reqCheck.on('error', () => finish(false));
    reqCheck.end();
  } catch {
    finish(false);
  }
}

/**
 * @param {import('http').OutgoingHttpHeaders} headers
 * @param {string} proxyOrigin
 * @param {string} targetOrigin
 */
function rewriteOriginReferer(headers, proxyOrigin, targetOrigin) {
  if (typeof headers.origin === 'string' && headers.origin === proxyOrigin) {
    headers.origin = targetOrigin;
  }
  if (typeof headers.referer === 'string' && headers.referer.startsWith(proxyOrigin)) {
    headers.referer = targetOrigin + headers.referer.slice(proxyOrigin.length);
  }
}

/**
 * @param {Buffer} buffer
 * @param {string | string[] | undefined} encoding
 * @returns {Buffer}
 */
function decompress(buffer, encoding) {
  const enc = String(Array.isArray(encoding) ? encoding[0] : encoding || '').toLowerCase();
  switch (enc) {
    case 'gzip':
      return zlib.gunzipSync(buffer);
    case 'deflate':
      return zlib.inflateSync(buffer);
    case 'br':
      return zlib.brotliDecompressSync(buffer);
    default:
      return buffer;
  }
}

/**
 * @param {import('http').ServerResponse} res
 * @param {number} statusCode
 * @param {string} contentType
 * @param {string | Buffer} body
 */
function send(res, statusCode, contentType, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf-8');
  res.writeHead(statusCode, { 'content-type': contentType, 'content-length': String(buf.length) });
  res.end(buf);
}

/**
 * @param {import('http').ServerResponse} res
 * @param {number} statusCode
 * @param {object} obj
 */
function sendJson(res, statusCode, obj) {
  send(res, statusCode, 'application/json; charset=utf-8', JSON.stringify(obj));
}

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
function notFound(req, res) {
  send(res, 404, 'text/plain; charset=utf-8', messages(pickLang(req.headers['accept-language'])).notFound);
}

// @ts-check
// Network shim: a classic (non-module) script the proxy injects right after
// the opening <head> tag, before any app code runs. Many apps call a local
// backend by absolute URL (e.g. a Vite dev server on :3000 calling an API on
// :8000). Running behind the proxy, the browser's real origin is the proxy
// origin, not the app's original origin, so such a direct request sends
// `Origin: <proxy origin>` and gets rejected by the backend's CORS policy
// (which only allows the app's original origin). This shim rewrites those
// URLs so the request goes through the proxy's `/__uce/fwd/...` route
// instead, which forwards it with `Origin`/`Referer` set to the target's
// origin (see src/proxy/server.js `resolveFwd`/`handleFwd`).
//
// Deliberately a classic script (not `type="module"`): `document.currentScript`
// is only populated for classic scripts, and it must run before any other
// head content so fetch/XHR/WebSocket/etc. are already patched when app code
// starts making requests. The module overlay (`/__uce/overlay.js`, injected
// before `</body>`) is unrelated and unaffected by this file.
(function () {
  try {
    if (window.__nudgitNetShimInstalled) return;
    window.__nudgitNetShimInstalled = true;
  } catch (err) {
    return;
  }

  var proxyOrigin = location.origin;
  var targetOrigin = '';
  var targetHostname = '';
  /** @type {string[]} extra hosts the proxy forwards to (`--forward-host`) */
  var extraHosts = [];
  try {
    var scriptSrc = document.currentScript && /** @type {HTMLScriptElement} */ (document.currentScript).src;
    var params = new URL(String(scriptSrc), location.href).searchParams;
    var target = params.get('target');
    if (target) {
      var targetUrl = new URL(target);
      targetOrigin = targetUrl.origin;
      targetHostname = targetUrl.hostname;
    }
    var fwd = params.get('fwd');
    if (fwd) extraHosts = fwd.toLowerCase().split(',');
  } catch (err) {
    // Target undetectable; rewriteUrl below only ever returns the input unchanged.
  }

  /**
   * @param {string} hostname
   * @returns {boolean}
   */
  function isLoopbackHost(hostname) {
    var h = String(hostname).toLowerCase();
    if (h === 'localhost' || /\.localhost$/.test(h)) return true;
    if (h === '::1') return true;
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (m) return Number(m[1]) === 127;
    return false;
  }

  /**
   * Rewrite a URL so a request the page makes to its own local backend goes
   * through the proxy instead of hitting the backend directly from the
   * browser. Never throws; unrecognized/foreign/relative-same-origin URLs are
   * returned unchanged (as originally given, not re-serialized).
   * @param {string} url
   * @returns {string}
   */
  function rewriteUrl(url) {
    try {
      var u = new URL(String(url), location.href);
      if (u.origin === proxyOrigin) return url;
      if (targetOrigin && u.origin === targetOrigin) {
        return proxyOrigin + u.pathname + u.search + u.hash;
      }
      var scheme = u.protocol.slice(0, -1);
      if (scheme !== 'http' && scheme !== 'https' && scheme !== 'ws' && scheme !== 'wss') return url;
      var hostOk =
        isLoopbackHost(u.hostname) ||
        (!!targetHostname && u.hostname.toLowerCase() === targetHostname.toLowerCase()) ||
        extraHosts.indexOf(u.hostname.toLowerCase()) !== -1;
      if (!hostOk) return url;
      var hostSegment = u.hostname.indexOf(':') !== -1 ? '[' + u.hostname + ']' : u.hostname;
      if (u.port) hostSegment += ':' + u.port;
      var fwdPath = '/__uce/fwd/' + scheme + '/' + hostSegment + u.pathname + u.search;
      if (scheme === 'ws' || scheme === 'wss') {
        var wsScheme = proxyOrigin.indexOf('https:') === 0 ? 'wss' : 'ws';
        return wsScheme + '://' + location.host + fwdPath + u.hash;
      }
      return proxyOrigin + fwdPath + u.hash;
    } catch (err) {
      return url;
    }
  }

  window.__nudgitRewriteUrl = rewriteUrl;

  // --- fetch -----------------------------------------------------------
  if (window.fetch) {
    var originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string') {
          return originalFetch(rewriteUrl(input), init);
        }
        if (typeof URL !== 'undefined' && input instanceof URL) {
          return originalFetch(rewriteUrl(input.href), init);
        }
        if (typeof Request !== 'undefined' && input instanceof Request) {
          var newUrl = rewriteUrl(input.url);
          if (newUrl === input.url) return originalFetch(input, init);
          var noBody = input.method === 'GET' || input.method === 'HEAD';
          var rebuilt = new Request(newUrl, {
            method: input.method,
            headers: input.headers,
            body: noBody ? undefined : input.body,
            credentials: input.credentials,
            mode: input.mode,
            signal: input.signal,
          });
          return originalFetch(rebuilt, init);
        }
      } catch (err) {
        // fall through to the original, unrewritten call below
      }
      return originalFetch(input, init);
    };
  }

  // --- XMLHttpRequest ----------------------------------------------------
  if (window.XMLHttpRequest) {
    var originalOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      var rest = Array.prototype.slice.call(arguments, 2);
      var newUrl = url;
      try {
        newUrl = rewriteUrl(url);
      } catch (err) {
        newUrl = url;
      }
      return originalOpen.apply(this, [method, newUrl].concat(rest));
    };
  }

  // --- EventSource ---------------------------------------------------------
  if (window.EventSource) {
    var OriginalEventSource = window.EventSource;
    /** @param {string} url @param {EventSourceInit} [config] */
    var PatchedEventSource = function (url, config) {
      var newUrl = url;
      try {
        newUrl = rewriteUrl(url);
      } catch (err) {
        newUrl = url;
      }
      return arguments.length > 1 ? new OriginalEventSource(newUrl, config) : new OriginalEventSource(newUrl);
    };
    PatchedEventSource.prototype = OriginalEventSource.prototype;
    PatchedEventSource.CONNECTING = OriginalEventSource.CONNECTING;
    PatchedEventSource.OPEN = OriginalEventSource.OPEN;
    PatchedEventSource.CLOSED = OriginalEventSource.CLOSED;
    window.EventSource = /** @type {any} */ (PatchedEventSource);
  }

  // --- WebSocket -----------------------------------------------------------
  if (window.WebSocket) {
    var OriginalWebSocket = window.WebSocket;
    /** @param {string} url @param {string|string[]} [protocols] */
    var PatchedWebSocket = function (url, protocols) {
      var newUrl = url;
      try {
        newUrl = rewriteUrl(url);
      } catch (err) {
        newUrl = url;
      }
      return arguments.length > 1 ? new OriginalWebSocket(newUrl, protocols) : new OriginalWebSocket(newUrl);
    };
    PatchedWebSocket.prototype = OriginalWebSocket.prototype;
    PatchedWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    PatchedWebSocket.OPEN = OriginalWebSocket.OPEN;
    PatchedWebSocket.CLOSING = OriginalWebSocket.CLOSING;
    PatchedWebSocket.CLOSED = OriginalWebSocket.CLOSED;
    window.WebSocket = /** @type {any} */ (PatchedWebSocket);
  }

  // --- navigator.sendBeacon --------------------------------------------
  if (window.navigator && window.navigator.sendBeacon) {
    var originalSendBeacon = window.navigator.sendBeacon.bind(window.navigator);
    window.navigator.sendBeacon = function (url, data) {
      var newUrl = url;
      try {
        newUrl = rewriteUrl(url);
      } catch (err) {
        newUrl = url;
      }
      return originalSendBeacon(newUrl, data);
    };
  }
})();

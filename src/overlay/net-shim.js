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
  /** @type {string|null} last two DNS labels of the target host: hosts under it are forwarded automatically */
  var targetSite = null;
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
      targetSite = siteOf(targetHostname);
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
   * Last two DNS labels of a hostname (`a.b.example.com` -> `example.com`); null
   * for loopback hosts, IP addresses and single-label names. Mirrors `siteOf`
   * in src/proxy/server.js (known limitation: two-part public suffixes such as
   * `co.uk` yield the suffix itself).
   * @param {string} hostname
   * @returns {string|null}
   */
  function siteOf(hostname) {
    var h = String(hostname).toLowerCase().replace(/\.$/, '');
    if (!h || isLoopbackHost(h) || h.indexOf(':') !== -1 || h.charAt(0) === '[' || /^[0-9.]+$/.test(h)) return null;
    var labels = h.split('.');
    return labels.length < 2 ? null : labels.slice(-2).join('.');
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
      var host = u.hostname.toLowerCase();
      var hostOk =
        isLoopbackHost(host) ||
        (!!targetHostname && host === targetHostname.toLowerCase()) ||
        (!!targetSite && (host === targetSite || host.slice(-targetSite.length - 1) === '.' + targetSite)) ||
        extraHosts.indexOf(host) !== -1;
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

  // --- failure detection for cross-origin requests that are NOT rewritten ---
  // Such a request reaches its host directly, so the browser may block it (CORS).
  // When one fails, a deduplicated `nudgit:forward-blocked` event ({ host }) is
  // dispatched on `window` (the overlay offers to forward that host); hosts are
  // also collected in `window.__nudgitBlockedHosts` for listeners that attach later.
  // The app's own promises/events are never altered.
  /** @type {string[]} */
  var blockedHosts = [];
  window.__nudgitBlockedHosts = blockedHosts;

  /**
   * Hostname of a URL the shim leaves alone but that points to another origin.
   * @param {string} url
   * @returns {string|null}
   */
  function foreignHost(url) {
    try {
      var u = new URL(String(url), location.href);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== proxyOrigin) return u.hostname.toLowerCase();
    } catch (err) {
      // unparsable: nothing to report
    }
    return null;
  }

  /** @param {string|null} host */
  function reportBlocked(host) {
    if (!host || blockedHosts.indexOf(host) !== -1) return;
    blockedHosts.push(host);
    try {
      window.dispatchEvent(new window.CustomEvent('nudgit:forward-blocked', { detail: { host: host } }));
    } catch (err) {
      // CustomEvent unavailable: the host is still listed in __nudgitBlockedHosts
    }
  }

  /**
   * Reports `host` when `promise` (a fetch) rejects with a TypeError, and returns
   * a promise that settles exactly like `promise`.
   * @param {Promise<any>} promise
   * @param {string|null} host
   * @returns {Promise<any>}
   */
  function watchFetch(promise, host) {
    if (!host || !promise || typeof promise.then !== 'function') return promise;
    return new Promise(function (resolve, reject) {
      promise.then(resolve, function (err) {
        if (err && err.name === 'TypeError') reportBlocked(host);
        reject(err);
      });
    });
  }

  // --- fetch -----------------------------------------------------------
  if (window.fetch) {
    var originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      /** @type {string|null} */
      var watchHost = null;
      var callInput = input;
      try {
        var isRequest = typeof Request !== 'undefined' && input instanceof Request;
        var href = typeof input === 'string' ? input : typeof URL !== 'undefined' && input instanceof URL ? input.href : isRequest ? input.url : null;
        if (href !== null) {
          var newUrl = rewriteUrl(href);
          if (newUrl === href) {
            var noCors = (init && init.mode === 'no-cors') || (isRequest && input.mode === 'no-cors');
            watchHost = noCors ? null : foreignHost(href);
          } else if (!isRequest) {
            callInput = newUrl;
          } else {
            var noBody = input.method === 'GET' || input.method === 'HEAD';
            callInput = new Request(newUrl, {
              method: input.method,
              headers: input.headers,
              body: noBody ? undefined : input.body,
              credentials: input.credentials,
              mode: input.mode,
              signal: input.signal,
            });
          }
        }
      } catch (err) {
        // fall through to the original, unrewritten call below
        callInput = input;
        watchHost = null;
      }
      return watchFetch(originalFetch(callInput, init), watchHost);
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
        // remember the host of an unrewritten cross-origin request; one 'error' listener per XHR
        this.__nudgitHost = newUrl === url ? foreignHost(url) : null;
        if (!this.__nudgitListening) {
          this.__nudgitListening = true;
          this.addEventListener('error', function () {
            reportBlocked(this.__nudgitHost);
          });
        }
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
      var watchHost = null;
      try {
        newUrl = rewriteUrl(url);
        if (newUrl === url) watchHost = foreignHost(url);
      } catch (err) {
        newUrl = url;
      }
      var source = arguments.length > 1 ? new OriginalEventSource(newUrl, config) : new OriginalEventSource(newUrl);
      if (watchHost) {
        var opened = false;
        source.addEventListener('open', function () {
          opened = true;
        });
        source.addEventListener('error', function () {
          if (!opened) reportBlocked(watchHost);
        });
      }
      return source;
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

#!/usr/bin/env node
// @ts-check
// CLI entry point: parses arguments, starts the proxy, optionally opens the browser.
// Without a target URL, starts in launcher mode (GET /__uce/ lets the user pick one).

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProxy } from '../src/proxy/server.js';
import { checkForUpdate } from '../src/proxy/update-check.js';

const MIN_NODE_MAJOR = 22;
if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
  console.error(`PixelAgent needs Node.js ${MIN_NODE_MAJOR} or newer (found ${process.versions.node}).`);
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const CURRENT_VERSION = PACKAGE_JSON.version;

const USAGE =
  'Usage: uce [target-url] [--port 4400] [--out ui-changes.md] [--open] [--no-open] [--no-update-check]';

/**
 * @param {string[]} argv
 * @returns {{ port: number, out: string, open: boolean, noOpen: boolean, noUpdateCheck: boolean, targetUrl?: string }}
 */
function parseArgs(argv) {
  const result = {
    port: 4400,
    out: 'ui-changes.md',
    open: false,
    noOpen: false,
    noUpdateCheck: false,
    targetUrl: /** @type {string | undefined} */ (undefined),
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') {
      result.port = Number(argv[++i]);
    } else if (arg === '--out') {
      result.out = argv[++i];
    } else if (arg === '--open') {
      result.open = true;
    } else if (arg === '--no-open') {
      result.noOpen = true;
    } else if (arg === '--no-update-check') {
      result.noUpdateCheck = true;
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }
  result.targetUrl = positional[0];
  return result;
}

/** @param {string} url */
function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Browser could not be launched automatically; not fatal.
  }
}

/**
 * Checks whether `GET /__uce/state` on `port` answers like a PixelAgent instance
 * (used when our own `.listen()` fails with EADDRINUSE).
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isUceInstance(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: 'localhost', port, path: '/__uce/state', timeout: 1500 }, (res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          resolve(Boolean(data) && typeof data === 'object' && 'target' in data && 'out' in data);
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

/**
 * @param {number} port
 * @param {boolean} allowOpen
 */
async function handlePortInUse(port, allowOpen) {
  const isUce = await isUceInstance(port);
  if (isUce) {
    console.log(`PixelAgent is already running on port ${port}.`);
    if (allowOpen) openBrowser(`http://localhost:${port}/__uce/`);
    process.exit(0);
    return;
  }
  console.error(`Port ${port} is already in use by another program.`);
  process.exit(1);
}

function main() {
  const { port, out, open, noOpen, noUpdateCheck, targetUrl } = parseArgs(process.argv.slice(2));

  if (!Number.isInteger(port) || port <= 0) {
    console.error(`Invalid port: ${String(port)}`);
    console.error(USAGE);
    process.exit(1);
    return;
  }

  const launcherMode = !targetUrl;
  let parsedTarget;
  if (!launcherMode) {
    try {
      parsedTarget = new URL(/** @type {string} */ (targetUrl));
      if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
        throw new Error('unsupported protocol');
      }
    } catch {
      console.error(`Invalid target URL: ${targetUrl}`);
      console.error(USAGE);
      process.exit(1);
      return;
    }
  }

  const resolvedOut = path.resolve(process.cwd(), out);
  const allowOpen = !noOpen && (open || launcherMode);
  const updateCheckDisabled = noUpdateCheck || process.env.PIXELAGENT_NO_UPDATE_CHECK === '1';

  const server = createProxy({
    target: launcherMode ? undefined : targetUrl,
    out: resolvedOut,
    updateCheck: updateCheckDisabled ? false : () => checkForUpdate({ currentVersion: CURRENT_VERSION }),
    onQuit: () => {
      server.close(() => process.exit(0));
    },
  });

  server.on('error', (err) => {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EADDRINUSE') {
      handlePortInUse(port, allowOpen);
      return;
    }
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });

  server.listen(port, () => {
    if (launcherMode) {
      const launcherUrl = `http://localhost:${port}/__uce/`;
      console.log(`PixelAgent is running at ${launcherUrl}`);
      console.log(`Output directory: ${path.dirname(resolvedOut)}`);
      if (allowOpen) openBrowser(launcherUrl);
    } else {
      const proxyUrl = `http://localhost:${port}${parsedTarget.pathname}${parsedTarget.search}${parsedTarget.hash}`;
      console.log(`PixelAgent proxy running at ${proxyUrl} (target: ${targetUrl})`);
      console.log(`Changes will be exported to: ${resolvedOut}`);
      if (allowOpen) openBrowser(proxyUrl);
    }
    /** @type {any} */ (server).uce.getUpdateInfo().then((/** @type {any} */ info) => {
      if (!info) return;
      console.log(`A new PixelAgent version is available: ${info.latest} (you have ${info.current}) – ${info.url}`);
    });
  });

  // Allows a process manager (e.g. the macOS app wrapper) to stop PixelAgent
  // cleanly by sending SIGTERM instead of killing it outright.
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();

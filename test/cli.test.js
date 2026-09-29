import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'nudgit.js');

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = /** @type {net.AddressInfo} */ (srv.address());
      srv.close(() => resolve(port));
    });
  });
}

/** @param {string} host @param {number} port @param {string} method @returns {Promise<number>} */
function status(host, port, method = 'GET', pathName = '/__uce/state') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path: pathName, method, headers: { origin: `http://${host.includes(':') ? `[${host}]` : host}:${port}` } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

/** @returns {string | null} first non-internal IPv4 address of this machine */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

test('CLI listens on loopback only by default and quits on POST /__uce/quit', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [BIN, '--no-open', '--no-update-check', '--port', String(port)], {
    cwd: os.tmpdir(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  try {
    await new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', (d) => {
        out += d;
        if (out.includes('nudgit is running')) resolve(undefined);
      });
      child.on('exit', () => reject(new Error(`CLI exited early: ${out}`)));
    });
    assert.equal(await status('127.0.0.1', port), 200);
    const v6 = await status('::1', port).catch((err) => err.code);
    assert.ok(v6 === 200 || v6 === 'EADDRNOTAVAIL' || v6 === 'EAFNOSUPPORT', `::1 → ${v6}`);
    const lan = lanAddress();
    if (lan) {
      await assert.rejects(status(lan, port), (err) => /** @type {any} */ (err).code === 'ECONNREFUSED');
    }
    assert.equal(await status('127.0.0.1', port, 'POST', '/__uce/quit'), 200);
    assert.equal(await exited, 0);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

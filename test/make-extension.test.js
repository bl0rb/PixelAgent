// @ts-check
// scripts/make-extension.js: assembled directory, manifest and zip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildExtension, manifestVersion, validateExtension } from '../scripts/make-extension.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf-8'));

/** @param {string} dir @returns {string[]} */
function listFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
}

/**
 * Reads a zip through its central directory (independent of the writer).
 * @param {string} zipPath
 * @returns {Map<string, Buffer>}
 */
function readZip(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const packedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf-8', p + 46, p + 46 + nameLen);
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const packed = buf.subarray(dataStart, dataStart + packedSize);
    const data = method === 8 ? zlib.inflateRawSync(packed) : packed;
    assert.equal(data.length, size, `${name} size`);
    assert.equal(zlib.crc32 ? zlib.crc32(data) : crc, crc, `${name} crc`);
    files.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** @param {string} file @returns {{ w: number, h: number }} */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('latin1', 1, 4), 'PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test('manifestVersion keeps plain versions and moves pre-release suffixes to version_name', () => {
  assert.deepEqual(manifestVersion('1.2.3'), { version: '1.2.3' });
  assert.deepEqual(manifestVersion('1.3.0-rc.1'), { version: '1.3.0', versionName: '1.3.0-rc.1' });
  assert.throws(() => manifestVersion('latest'));
});

test('buildExtension assembles extension/ + overlay/ with the package version and zips it', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nudgit-ext-'));
  try {
    const outDir = path.join(tmp, 'nudgit-extension');
    const zipPath = path.join(tmp, 'nudgit-chrome-extension.zip');
    const res = buildExtension({ outDir, zipPath });
    assert.equal(res.version, pkg.version);

    // manifest
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf-8'));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, 'nudgit');
    assert.equal(manifest.description, pkg.description);
    assert.equal(manifest.version, pkg.version);
    assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage', 'downloads']);
    assert.equal(manifest.host_permissions, undefined, 'no host permissions');
    assert.equal(manifest.background.service_worker, 'service-worker.js');
    assert.equal(manifest.background.type, 'module');
    assert.equal(manifest.commands['toggle-nudgit'].suggested_key.default, 'Alt+Shift+N');
    assert.deepEqual(manifest.web_accessible_resources[0].resources, ['overlay/**']);
    assert.ok(manifest.action.default_title);

    // icons: every declared file exists with its declared size
    for (const size of [16, 32, 48, 128]) {
      for (const rel of [manifest.icons[size], manifest.action.default_icon[size]]) {
        assert.deepEqual(pngSize(path.join(outDir, rel)), { w: size, h: size }, rel);
      }
    }

    // files
    const files = listFiles(outDir);
    for (const rel of ['manifest.json', 'service-worker.js', 'content/loader.js', 'overlay/index.js', 'overlay/extension.js', 'overlay/actions/text.js']) {
      assert.ok(files.includes(rel), `${rel} in the build`);
    }
    const srcOverlay = listFiles(path.join(REPO, 'src/overlay')).map((f) => `overlay/${f}`);
    assert.deepEqual(files.filter((f) => f.startsWith('overlay/')), srcOverlay, 'overlay/ mirrors src/overlay');
    assert.equal(fs.readFileSync(path.join(outDir, 'overlay/index.js'), 'utf-8'), fs.readFileSync(path.join(REPO, 'src/overlay/index.js'), 'utf-8'));

    // zip: same entries and bytes as the directory, manifest at the archive root
    const zipped = readZip(zipPath);
    assert.deepEqual([...zipped.keys()].sort(), files);
    for (const rel of files) assert.ok(zipped.get(rel)?.equals(fs.readFileSync(path.join(outDir, rel))), `${rel} identical in zip`);
    assert.ok(zipped.has('manifest.json'));

    // rebuilding is deterministic and replaces the old output
    fs.writeFileSync(path.join(outDir, 'stale.txt'), 'x');
    const first = fs.readFileSync(zipPath);
    buildExtension({ outDir, zipPath });
    assert.ok(!fs.existsSync(path.join(outDir, 'stale.txt')));
    assert.ok(first.equals(fs.readFileSync(zipPath)), 'byte-identical zip');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('validateExtension rejects a build with a missing or unfilled piece', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nudgit-ext-'));
  try {
    const outDir = path.join(tmp, 'out');
    buildExtension({ outDir, zipPath: path.join(tmp, 'x.zip') });
    validateExtension(outDir);

    const manifestPath = path.join(outDir, 'manifest.json');
    const good = fs.readFileSync(manifestPath, 'utf-8');

    fs.rmSync(path.join(outDir, 'icons/icon-48.png'));
    assert.throws(() => validateExtension(outDir), /icon-48/);
    fs.cpSync(path.join(REPO, 'extension/icons/icon-48.png'), path.join(outDir, 'icons/icon-48.png'));

    fs.rmSync(path.join(outDir, 'content/loader.js'));
    assert.throws(() => validateExtension(outDir), /loader/);
    fs.cpSync(path.join(REPO, 'extension/content/loader.js'), path.join(outDir, 'content/loader.js'));

    fs.writeFileSync(manifestPath, good.replace(`"version": "${pkg.version}"`, '"version": "0.0.0"'));
    assert.throws(() => validateExtension(outDir), /version/);

    fs.writeFileSync(manifestPath, good.replace('"permissions"', '"host_permissions": ["<all_urls>"], "permissions"'));
    assert.throws(() => validateExtension(outDir), /host_permissions/);

    fs.writeFileSync(manifestPath, '{ not json');
    assert.throws(() => validateExtension(outDir));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a pre-release package version becomes version + version_name', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nudgit-ext-'));
  try {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.cpSync(path.join(REPO, 'extension'), path.join(repo, 'extension'), { recursive: true });
    fs.cpSync(path.join(REPO, 'src/overlay'), path.join(repo, 'src/overlay'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'nudgit', version: '2.0.0-rc.1' }));
    const { outDir } = buildExtension({ repoRoot: repo, outDir: path.join(tmp, 'out'), zipPath: path.join(tmp, 'x.zip') });
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf-8'));
    assert.equal(manifest.version, '2.0.0');
    assert.equal(manifest.version_name, '2.0.0-rc.1');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

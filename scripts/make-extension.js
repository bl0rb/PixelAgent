#!/usr/bin/env node
// @ts-check
// Assembles the Chrome/Edge extension into dist/nudgit-extension/ (extension/
// + src/overlay/ as overlay/, manifest version taken from package.json) and
// zips it to dist/nudgit-chrome-extension.zip. Pure Node (zlib), so it runs
// the same on macOS, Linux CI and Windows.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Chrome wants 1-4 dot-separated integers; a semver pre-release suffix goes
 * into `version_name` instead.
 * @param {string} pkgVersion
 * @returns {{ version: string, versionName?: string }}
 */
export function manifestVersion(pkgVersion) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(pkgVersion);
  if (!m) throw new Error(`package.json version "${pkgVersion}" is not semver`);
  const version = `${m[1]}.${m[2]}.${m[3]}`;
  return version === pkgVersion ? { version } : { version, versionName: pkgVersion };
}

/**
 * Throws if the built extension is unusable: bad manifest JSON, or a file the
 * manifest (or the loader/service worker) points at is missing.
 * @param {string} dir - the assembled extension directory
 */
export function validateExtension(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
  if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
  if (manifest.host_permissions) throw new Error('manifest must not request host_permissions');
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version) || manifest.version === '0.0.0') {
    throw new Error(`manifest version "${manifest.version}" was not filled in`);
  }

  /** @type {string[]} */
  const files = [
    manifest.background && manifest.background.service_worker,
    ...Object.values(manifest.icons || {}),
    ...Object.values((manifest.action && manifest.action.default_icon) || {}),
    // not in the manifest, but loaded at runtime by the service worker / loader
    'content/loader.js',
    'overlay/index.js',
  ];
  for (const file of files) {
    if (!file || !fs.existsSync(path.join(dir, String(file)))) throw new Error(`missing file: ${file}`);
  }
  for (const entry of manifest.web_accessible_resources || []) {
    for (const pattern of entry.resources || []) {
      const base = pattern.replace(/\/?\*.*$/, ''); // "overlay/**" -> "overlay"
      if (!base || !fs.existsSync(path.join(dir, base))) throw new Error(`web_accessible_resources matches nothing: ${pattern}`);
    }
  }
}

/** @param {string} dir @returns {string[]} file paths relative to `dir`, sorted, POSIX separators */
function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) out.push(next);
    }
  };
  walk('');
  return out.sort();
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Minimal deterministic zip writer (deflate, no zip64): every file of `dir`
 * at the archive root, sorted, fixed timestamp.
 * @param {string} dir
 * @param {string} zipPath
 */
export function writeZip(dir, zipPath) {
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  /** @type {Buffer[]} */
  const chunks = [];
  /** @type {Buffer[]} */
  const central = [];
  let offset = 0;

  for (const rel of listFiles(dir)) {
    const data = fs.readFileSync(path.join(dir, rel));
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const name = Buffer.from(rel, 'utf-8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made by: unix, 2.0
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, 0644
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += local.length + name.length + packed.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  const count = central.length / 2;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, Buffer.concat([...chunks, centralBuf, end]));
}

/**
 * @param {{ repoRoot?: string, outDir?: string, zipPath?: string }} [opts]
 * @returns {{ outDir: string, zipPath: string, version: string }}
 */
export function buildExtension(opts = {}) {
  const repoRoot = opts.repoRoot || REPO_ROOT;
  const outDir = opts.outDir || path.join(repoRoot, 'dist', 'nudgit-extension');
  const zipPath = opts.zipPath || path.join(repoRoot, 'dist', 'nudgit-chrome-extension.zip');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
  const skip = (/** @type {string} */ src) => path.basename(src) !== '.DS_Store';

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(path.join(repoRoot, 'extension'), outDir, { recursive: true, filter: skip });
  fs.cpSync(path.join(repoRoot, 'src', 'overlay'), path.join(outDir, 'overlay'), { recursive: true, filter: skip });

  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const { version, versionName } = manifestVersion(pkg.version);
  manifest.version = version;
  if (versionName) manifest.version_name = versionName;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  validateExtension(outDir);
  fs.rmSync(zipPath, { force: true });
  writeZip(outDir, zipPath);
  return { outDir, zipPath, version: pkg.version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { outDir, zipPath, version } = buildExtension();
  console.log(`nudgit extension ${version}\n  ${path.relative(process.cwd(), outDir)}/\n  ${path.relative(process.cwd(), zipPath)}`);
}

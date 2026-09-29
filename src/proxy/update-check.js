// @ts-check
// Checks the GitHub Releases API for a PixelAgent version newer than the one
// currently running. Never throws and never logs: any error, non-200
// response, timeout, or malformed payload simply resolves to `null` so the
// caller can treat "no update info" and "up to date" the same way. Sends
// nothing but a generic User-Agent (with our own version) — no identifiers,
// no query params.

const RELEASES_URL = 'https://api.github.com/repos/bl0rb/PixelAgent/releases/latest';
const MACOS_ASSET_NAME = 'PixelAgent-macos.zip';

/**
 * Parse a "major.minor.patch[-pre][+build]" string, tolerant of a leading "v".
 * Non-numeric/missing parts are treated as 0.
 * @param {string} version
 * @returns {{ parts: [number, number, number], hasPrerelease: boolean }}
 */
function parseVersion(version) {
  const trimmed = String(version).trim().replace(/^v/i, '');
  const [core, ...rest] = trimmed.split(/[-+]/);
  const segments = core.split('.').map((n) => parseInt(n, 10) || 0);
  return {
    parts: [segments[0] || 0, segments[1] || 0, segments[2] || 0],
    hasPrerelease: rest.length > 0,
  };
}

/**
 * Compares two semver-like versions (major.minor.patch). Tolerant of a
 * leading "v" and ignores pre-release/build suffixes for the numeric
 * comparison, except that a pre-release of an otherwise-equal version sorts
 * as older (e.g. "1.2.0-rc.1" < "1.2.0").
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a<b, 0 if a==b, positive if a>b
 */
export function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (va.parts[i] !== vb.parts[i]) return va.parts[i] - vb.parts[i];
  }
  if (va.hasPrerelease === vb.hasPrerelease) return 0;
  return va.hasPrerelease ? -1 : 1;
}

/**
 * @param {{ currentVersion: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<{ current: string, latest: string, url: string, downloadUrl?: string } | null>}
 */
export async function checkForUpdate({ currentVersion, fetchImpl = fetch, timeoutMs = 3000 }) {
  try {
    const res = await fetchImpl(RELEASES_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `PixelAgent/${currentVersion}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res || !res.ok) return null;

    const data = await res.json();
    const tagName = data && typeof data.tag_name === 'string' ? data.tag_name : '';
    const htmlUrl = data && typeof data.html_url === 'string' ? data.html_url : '';
    if (!tagName || !htmlUrl) return null;

    const latest = tagName.replace(/^v/i, '');
    if (compareVersions(latest, currentVersion) <= 0) return null;

    const assets = Array.isArray(data.assets) ? data.assets : [];
    const macAsset = assets.find(
      (asset) => asset && typeof asset === 'object' && asset.name === MACOS_ASSET_NAME,
    );
    const downloadUrl =
      macAsset && typeof macAsset.browser_download_url === 'string' ? macAsset.browser_download_url : undefined;

    /** @type {{ current: string, latest: string, url: string, downloadUrl?: string }} */
    const info = { current: currentVersion, latest, url: htmlUrl };
    if (downloadUrl) info.downloadUrl = downloadUrl;
    return info;
  } catch {
    return null;
  }
}

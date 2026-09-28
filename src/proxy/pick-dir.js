// @ts-check
// OS-native "choose a folder" dialog used by POST /__uce/pick-dir. Spawns a
// platform helper (osascript / powershell / zenity / kdialog) via
// child_process.execFile — never a shell — so there is no argument or script
// injection surface: user-supplied values (title, startDir) are passed as
// argv items or environment variables, never interpolated into script text.

import { execFile, execFileSync } from 'node:child_process';

// `argv` (item 1 / item 2) carries the caller-supplied title/startDir; the
// script text itself is a fixed constant. Exported so tests can validate its
// syntax (e.g. via `osacompile`) without ever executing it.
export const APPLESCRIPT = `
on run argv
  set promptText to item 1 of argv
  set startPath to item 2 of argv
  -- bring the dialog to the front (no System Events → no automation permission prompt)
  tell me to activate
  try
    if startPath is "" then
      set chosenFolder to choose folder with prompt promptText
    else
      set chosenFolder to choose folder with prompt promptText default location (POSIX file startPath)
    end if
  on error errMsg number errNum
    if errNum is -128 then
      return "CANCELLED"
    end if
    error errMsg number errNum
  end try
  return POSIX path of chosenFolder
end run
`;

// Caller-supplied values arrive via $env:UCE_PICK_TITLE / $env:UCE_PICK_START;
// the script text itself is a fixed constant.
const POWERSHELL_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = $env:UCE_PICK_TITLE
$dlg.ShowNewFolderButton = $true
if ($env:UCE_PICK_START -and (Test-Path -LiteralPath $env:UCE_PICK_START)) {
  $dlg.SelectedPath = $env:UCE_PICK_START
}
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'CenterScreen'
[void]$owner.Show()
$owner.Activate()
$result = $dlg.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dlg.SelectedPath
} else {
  Write-Output "CANCELLED"
}
`;

/** @param {string} cmd @returns {boolean} */
function commandExists(cmd) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether this platform has a folder-picker backend available.
 * @returns {boolean}
 */
export function isSupported() {
  if (process.platform === 'darwin') return true;
  if (process.platform === 'win32') return true;
  return commandExists('zenity') || commandExists('kdialog');
}

/**
 * Open the OS-native folder chooser.
 * @param {{ title?: string, startDir?: string }} [options]
 * @returns {Promise<{ path: string } | { cancelled: true }>}
 */
export function pickDirectory({ title = 'Choose a folder', startDir = '' } = {}) {
  if (process.platform === 'darwin') return pickDirectoryMac(title, startDir);
  if (process.platform === 'win32') return pickDirectoryWindows(title, startDir);
  return pickDirectoryLinux(title, startDir);
}

/** @param {string} title @param {string} startDir */
function pickDirectoryMac(title, startDir) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', APPLESCRIPT, title, startDir], (err, stdout, stderr) => {
      if (err) {
        if (/-128/.test(String(stderr || err.message))) return resolve({ cancelled: true });
        return reject(new Error(stderr && stderr.trim() ? stderr.trim() : err.message));
      }
      const out = stdout.trim();
      if (out === 'CANCELLED') return resolve({ cancelled: true });
      resolve({ path: out });
    });
  });
}

/** @param {string} title @param {string} startDir */
function pickDirectoryWindows(title, startDir) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', POWERSHELL_SCRIPT],
      { env: { ...process.env, UCE_PICK_TITLE: title, UCE_PICK_START: startDir } },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr && stderr.trim() ? stderr.trim() : err.message));
        const out = stdout.trim();
        if (out === 'CANCELLED' || out === '') return resolve({ cancelled: true });
        resolve({ path: out });
      },
    );
  });
}

/** @param {string} title @param {string} startDir */
function pickDirectoryLinux(title, startDir) {
  const useZenity = commandExists('zenity');
  const useKdialog = !useZenity && commandExists('kdialog');
  if (!useZenity && !useKdialog) {
    return Promise.reject(new Error('No folder picker available (install zenity or kdialog).'));
  }
  const bin = useZenity ? 'zenity' : 'kdialog';
  const args = useZenity
    ? [
        '--file-selection',
        '--directory',
        '--title',
        title,
        ...(startDir ? ['--filename', startDir.endsWith('/') ? startDir : `${startDir}/`] : []),
      ]
    : ['--getexistingdirectory', startDir || '.', '--title', title];
  return new Promise((resolve, reject) => {
    execFile(bin, args, (err, stdout, stderr) => {
      if (err) {
        // zenity/kdialog exit non-zero (typically 1) when the user cancels.
        if (err.code === 1) return resolve({ cancelled: true });
        return reject(new Error(stderr && stderr.trim() ? stderr.trim() : err.message));
      }
      const out = stdout.trim();
      if (!out) return resolve({ cancelled: true });
      resolve({ path: out });
    });
  });
}

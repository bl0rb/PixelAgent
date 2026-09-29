<img src="assets/icon.svg" alt="nudgit icon" width="96" align="right">

# nudgit

[![PR CI](https://github.com/bl0rb/nudgit/actions/workflows/pr-ci.yml/badge.svg)](https://github.com/bl0rb/nudgit/actions/workflows/pr-ci.yml)

**Your UI. Your feedback. Agent-ready.**

Edit, move and annotate elements directly in your browser. Turn visual
feedback into actionable instructions for your coding agent.

Visual editing · Agent-ready · Open source

nudgit was formerly called PixelAgent.

nudgit is a proxy that sits between the browser and a running web app. UI change
requests can be marked, moved, edited, duplicated, and commented on directly
on the page. The result is a machine-readable change list (`ui-changes.md`)
that a coding agent can implement.

## Screenshots

**Select any element** — hover shows what you would pick, the selection gets
quick icons for rename, move (drag) and comment; numbered markers show every
change already made.

![Selecting an element with nudgit](docs/images/select.png)

**Every change in one list** — text and description edits, moves, removals,
duplicates and comments, previewed live on the page.

![The change list next to the previewed page](docs/images/panel.png)

**Agent-ready result** — `ui-changes.md` states what to do first, then where,
with several locators per element and a JSON attachment.

![The exported ui-changes.md](docs/images/ui-changes-md.png)

## Requirements

- Node ≥ 22 to run nudgit (Node 20 is end-of-life); Node ≥ 22.22 to run the test suite, see [Tests](#tests)
- No runtime dependencies

## Installation & usage

```bash
git clone https://github.com/bl0rb/nudgit.git
cd nudgit
npm link   # optional: makes the `nudgit` command available globally
```

```bash
nudgit [target-url] [--port 4400] [--out ui-changes.md] [--open] [--no-open] [--no-update-check]
```

- `[target-url]`: full URL of the target app, e.g. `http://localhost:8787/admin`. If omitted, nudgit starts in launcher mode (see below)
- `--port 4400`: proxy port (default: 4400)
- `--host 127.0.0.1`: address to listen on. By default nudgit only listens on the loopback addresses (127.0.0.1 and ::1), so only this machine can reach it; use e.g. `--host 0.0.0.0` (or `NUDGIT_HOST`) only when others should reach it
- `--out ui-changes.md`: path for the change list, relative to the current working directory (default: `./ui-changes.md`)
- `--open`: open the browser (already the default in launcher mode)
- `--no-open`: don't open the browser automatically
- `--no-update-check`: don't check for a newer release on startup (see [Update check](#update-check))

Example:
```bash
cd ~/Documents/Code/my-project
nudgit http://localhost:8787/admin --open   # or: node /path/to/nudgit/bin/nudgit.js …
```
The change list ends up directly in the target repo.

### Run as an app

Without a target URL, nudgit starts in launcher mode:

```bash
nudgit
```

The browser opens automatically at `http://localhost:4400/__uce/`: a start
page with a field for the target URL (also works without `http://`, e.g.
`localhost:3000`), a field for the `ui-changes.md` save location with a "Choose…" button that
opens the native folder dialog (macOS, Windows, Linux with zenity/kdialog),
recently used URLs (each remembers its save location), and the "Open" / "Quit" buttons. "Open" sets the target and
redirects straight into the running app including the overlay — no CLI call
needed. In the overlay toolbar, the "Change URL" button always jumps back to
the start page. "Quit" stops the server.

![The nudgit start page](docs/images/launcher.png)

For a double-clickable macOS app, either download `nudgit-macos.zip` from
the [Releases page](https://github.com/bl0rb/nudgit/releases) and unzip
it, or build it yourself:

```bash
npm run app
```

Both produce `nudgit.app` (macOS only; no dependencies, uses a locally
installed Node ≥ 22). Drag it to `/Applications`.

The app is a small AppleScript wrapper around the same launcher-mode server
described above:
- Launching it starts nudgit in the background and opens the browser at
  `http://localhost:4400/__uce/`, same as `nudgit` on the command line.
- Clicking the Dock icon again reopens that page.
- `Cmd+Q`, the Dock's "Quit" item, and the "Quit" button on the launcher page
  all stop nudgit and close the app.
- Server output goes to `~/Library/Logs/nudgit.log`.

Gatekeeper note: the app is ad-hoc signed, not notarized, so macOS blocks the
first launch ("nudgit can't be opened because Apple cannot check it for
malicious software"). Allow it once via **System Settings → Privacy &
Security → Open Anyway**, or remove the quarantine flag yourself:
```bash
xattr -dr com.apple.quarantine /Applications/nudgit.app
```

### Run the demo

```bash
npm run demo
```
Starts a proxy on http://localhost:4400 for `examples/demo.html` and a static
server on http://localhost:4401 for the standalone variant.

### Standalone (without a proxy)

Add to the target app's HTML file:
```html
<script type="module" src="path/to/src/overlay/index.js"></script>
```
Export then happens as a download instead of a file write.

## Usage

### Modes

- **Interact** (`E`): the app behaves normally
- **Edit** (`E`): hover highlights elements, click selects, all events are blocked

### Keyboard shortcuts

| Action | Key / gesture |
|--------|---|
| **Switch mode** | `E` |
| Change text | Double-click / `Enter` |
| Move | Drag & drop or `Alt+↑/↓` |
| Duplicate | `Cmd/Ctrl+D` |
| Add new | `A` (opens the palette) |
| Remove | `Delete` / `Backspace` |
| Comment | `C` |
| Extend selection | `Shift+↑/↓` |
| Undo/Redo | `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` |
| Deselect | `Esc` |

**Quick icons:** three icons appear on the selected element — pencil =
rename, move cross = drag to move, speech bubble = comment.

![Commenting on an element](docs/images/comment.png)

![The palette of similar elements](docs/images/palette.png)

### Change list

All changes are numbered in the side panel ("Changes"). Click scrolls to the
element, `×` deletes the change. Status "Element not found" after a re-render
comes with a "Re-apply" button.

### Persistence

Changes are stored in `localStorage` and survive a reload. The "Discard all"
button clears the list.

### Export

- With proxy: `POST /__uce/export` → file in the target repo
- Without proxy: download dialog
- Also available: "Export / Copy" to copy to the clipboard

## Format: `ui-changes.md`

Markdown plus a JSON appendix, machine-readable for agents:
- **Change text**: `before`, `after`
- **Change attribute**: `attr`, `before`, `after`
- **Move**: `target`, `anchor`, `position` (before/after/inside-start/inside-end)
- **Add new**: `template`, `anchor`, `position`
- **Remove**: `target`
- **Comment**: `target`, `note`

Every change includes a selector, an HTML snippet, and a breadcrumb for
reliable identification.

Changes are grouped by view (the page path + hash they belong to); the group
heading is skipped when the whole export is a single view. Numbers in the
Markdown headings always match the JSON `id`s — both are renumbered `1…n` in
export order (grouped by view, stable order within a group) when the file is
written, regardless of gaps left by deleted or merged changes in the editor's
internal state. Each change states *what* to change before *where* to find
it (selector, HTML snippet, breadcrumb).

## How the proxy works

1. **Injection**: `<script src="/__uce/overlay.js">` is inserted before `</body>`
2. **Security**: removes `Content-Security-Policy`, `X-Frame-Options`
3. **Redirects**: `Location` headers are rewritten from the target origin to the proxy origin
4. **Cookies**: the `Domain` attribute is removed; `Secure` is dropped when the proxy is http
5. **WebSocket**: upgrades (e.g. Vite HMR) are passed through
6. **Local backends**: a network shim (`/__uce/net-shim.js`, injected right
   after `<head>`) rewrites `fetch`/`XHR`/`EventSource`/`WebSocket`/
   `sendBeacon` calls the app makes to its own local backend (e.g. a portal on
   `:3000` calling an API on `:8000`) so they go through
   `/__uce/fwd/<scheme>/<host:port>/<path>` instead of hitting the backend
   directly — the browser would otherwise send `Origin: <proxy origin>` and
   get rejected by the backend's CORS policy. The fwd route sets `Host` to
   the upstream host and rewrites `Origin`/`Referer` to the target's origin
   (what the backend's CORS/CSRF checks expect), streams the response
   (SSE/chat streaming works), and rewrites `Location`/`Set-Cookie` back to
   the fwd path. Only loopback hosts (`localhost`, `*.localhost`,
   `127.0.0.0/8`, `::1`) or a host matching the target's own hostname are
   forwarded; anything else gets a 403.

### Security note

nudgit only listens on 127.0.0.1 and ::1 unless you pass `--host`. Anyone who
can reach it can browse the target app through it (without its CSP /
X-Frame-Options), switch the target and write `ui-changes.md`, so only expose
it on a trusted network.

Cross-origin requests to `/__uce/*` (export, target, quit) are rejected: the
proxy checks the `Origin`/`Sec-Fetch-Site` headers and only accepts requests
from its own origin.

## Languages

The overlay and the launcher page are available in English and German. The
language is auto-detected from the browser (`navigator.language`) and can be
switched with a toggle in the overlay toolbar and on the launcher page; the
choice is stored in `localStorage` and shared between both. Markdown export
(`ui-changes.md`) is always English, regardless of the UI language, since it
is meant to be read by coding agents. Server-side texts (error messages, the
502 page) follow the browser's `Accept-Language` header. CLI output is
English only.

## Update check

On startup, nudgit does one GET request to the public GitHub API
(`https://api.github.com/repos/bl0rb/nudgit/releases/latest`) to see
whether a newer release exists, with a generic `User-Agent: nudgit/<version>`
header — no telemetry, no identifiers, no query params, and nothing about your
installation, target app, or usage is sent. The request has a ~3s timeout and
fails silently (no console error) if it can't complete.

- If a newer version is found, the CLI prints one line on startup (e.g. `A new
  nudgit version is available: 1.0.2 (you have 1.0.1) – <release URL>`),
  and the launcher page (`/__uce/`) shows a dismissible banner with a link to
  the release and, on macOS, a link to download the app if the release has a
  `nudgit-macos.zip` asset. Dismissing the banner is remembered per
  version in `localStorage`.
- Disable it with `--no-update-check` or the environment variable
  `NUDGIT_NO_UPDATE_CHECK=1`.

## Snippet for target repos

Add to `AGENTS.md` / `CLAUDE.md`:

```markdown
## UI changes
If `ui-changes.md` exists in the repo root, it is the binding spec for UI
changes. Implement each change exactly as described, locate elements in the
source via text/selector/HTML, and build new elements as copies of the named
template. After implementing, do not delete the file; report the
implementation status in the chat.
```

## Icons

The icon sources are `assets/icon.svg` (web/product icon) and
`assets/icon-macos.svg` (macOS app icon). `scripts/make-icons.sh` regenerates
`assets/nudgit.icns` and `assets/icon-512.png` (macOS: `sips` + `iconutil`).

## Screenshots (development)

`npm run screenshots` regenerates the images in `docs/images/` (macOS with
Google Chrome): it drives the real overlay on the demo app via
`examples/showcase.js` (`demo.html?showcase=<scene>`), frames the shots and
renders the exported `ui-changes.md`. `docs/images/social-preview.png`
(1280×640) is meant for the repository's social preview in the GitHub
settings.

## Tests

```bash
npm test
```
Runs all tests with `node --test`. Requires Node ≥ 22.22 (jsdom, used by the
overlay tests, needs it); nudgit itself requires Node ≥ 22. CI runs the
tests on Node 22, 24 and 26.

## License

[MIT](LICENSE)

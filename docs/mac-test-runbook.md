# Mac test runbook (both hosts)

For the owner, or a local Claude Code session on the Mac. Nothing in the host READMEs has been run on macOS yet.
Record results as Trello comments on the "Test on Mac" card (the list below mirrors its items plus extras).
Measurement script: `scripts/measure-host.sh`. Comparison context: `docs/host-comparison.md`.

## 1. Prerequisites

```bash
xcode-select --install                         # Xcode Command Line Tools (cgo, clang)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"   # Homebrew, if missing
brew install go go-task node                   # Go >= 1.25, Task, Node (current LTS)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust (rustup)
go version; task --version; node -v; cargo -V
(cd frontend && npm install)                   # shared frontend deps, once
```

Note macOS version, chip, and tool versions in your results.

## 2. Run commands

Tauri (from repo root):

```bash
cd hosts/tauri && npm install
npx tauri icon src-tauri/icons/icon.png   # once, generates icns
npm run dev            # vibrancy (default)
npm run dev:opaque     # opaque variant (comparison / fallback)
```

Wails (two terminals, from repo root):

```bash
cd hosts/wails && task dev:vite     # terminal 1 (Vite on :5173)
cd hosts/wails && task dev          # terminal 2: vibrancy (private_mac_apis tag)
cd hosts/wails && task dev:glass    # optional: Liquid Glass (macOS 15+)
cd hosts/wails && task dev:opaque   # opaque variant, public APIs only
```

Wails appearance can be pinned at creation: `ZUSTELLER_APPEARANCE=dark|light task dev`.

Release builds (needed for notifications, Dock badge, sizes): `cd hosts/tauri && npm run build` (bundle in
`src-tauri/target/release/bundle/macos/zusteller.app`), `cd hosts/wails && task build` (bare binary `bin/zusteller`; a
Wails `.app` is not packaged yet, so notification checks are Tauri-only until it is).

Accent panel: the page must be opened with `?debug=accent`. In the browser use `http://localhost:5173/?debug=accent` (reference
in Safari). In a host, temporarily edit the window URL (Tauri: `url` in `tauri.conf.json`, `index.html?vibrancy=1&debug=accent`;
Wails: add `&debug=accent` to the `/?vibrancy=1` URL in `main.go`) and revert afterwards.

## 3. Checklist

Run every item for: Tauri vibrancy, Tauri opaque, Wails vibrancy, Wails opaque (skip rows that do not apply). Mark
PASS / FAIL / N/A and note the macOS version.

1. App launches; the mock inbox lists and a thread opens in the reader. No blank or white window (Tauri issue 13415 risk).
2. Traffic lights: visible, inset position looks right, do not overlap the title/search or sidebar header content; still
   correct after resize and in fullscreen.
3. Window drag: dragging the title/search strip moves the window (Tauri needs a `data-tauri-drag-region`; expected FAIL there
   until added). Double-click on that strip maximizes/zooms and restores. Clicking inputs/buttons does not drag.
4. Vibrancy (vibrancy variants): the wallpaper visibly shows through the sidebar and the gutters between panes; list and
   reader panes stay opaque. Opaque variants: no see-through anywhere. Toggle System Settings > Accessibility > Display >
   Reduce transparency and confirm it degrades sanely.
5. Accent colour live update: open with `?debug=accent`. Change System Settings > Appearance > Accent colour (e.g. Red, then
   Graphite). Selected row, active tab and focus ring must update without restart (the panel re-renders on window `focus`,
   so click the window after changing). How to read the panel:
   - `AccentColor` and `-apple-system-control-accent`: the system accent colour setting. Expected to follow it.
   - `-apple-system-selected-content-background`: the selection colour for emphasized (active) selection; it follows the
     accent unless Appearance > "Highlight colour" differs.
   - `-apple-system-unemphasized-selected-content-background`: the gray used when selection is inactive.
   - `--accent`: what the app actually uses. Note which keyword it comes from and whether the swatch matches System
     Settings. If a keyword reads `unsupported`, record it (WKWebView differs per macOS version).
6. Inactive selection: select a row, then click another app (window inactive), and separately click the sidebar so the list
   loses focus. Selection must go gray when the window is inactive and differ from the active accent selection. Check light
   and dark.
7. Theme mismatch: System Dark with app theme Light, and the reverse. Tauri pins the window theme (`set_window_theme`) so
   material and text agree; app theme "System" follows the OS again. Wails cannot change at runtime (creation-time only):
   expect material/text disagreement; verify `ZUSTELLER_APPEARANCE` fixes it. Also flip the OS theme while running with app
   theme "System".
8. Sidebar-only transparency is not offered by either host (window-wide); confirm and screenshot the gutters.
9. Menus: App/Edit/Mail(Mailbox)/View/Window render. With a thread selected use Archive, Move to Trash, Mark Read/Unread,
   Star, Find (Cmd+F focuses search). Actions not enabled for the selection are ignored. Plain-key shortcuts still work in the
   list and are ignored while typing in search. Cmd+C/V/A work in the search field.
10. Dock badge: trigger `set_badge` (see "Triggering platform calls"); badge shows the count, 0 clears it.
11. Notifications: needs a bundled `.app` with a bundle identifier (Tauri release build; the Wails host has no `.app` yet).
    Expect the permission prompt on first use; System Settings > Notifications lists "zusteller". In `tauri dev` macOS
    attributes them to the terminal.
12. `mailto:` and `https:` open: a mailto link opens the default mail app, https the default browser; `file:`,
    `javascript:`, `ftp:` are refused.
13. Reader iframe renders sanitized HTML, remote images are not loaded, CSP breaks neither Vite HMR (dev) nor the release app.
14. Fullscreen, minimum size 900x600, move between displays: no layout or vibrancy glitches.
15. Release build only: no white/solid background where `dev` was transparent.
16. Run `scripts/measure-host.sh` and paste its table into the host-comparison rows.

### Triggering platform calls

The app has no UI for badge/notification yet. In the host webview devtools (right-click > Inspect Element, dev builds):
Tauri `await window.__TAURI__.core.invoke('set_badge', { count: 3 })` and
`await window.__TAURI__.core.invoke('notify', { title: 'Hi', body: 'Test' })` (`withGlobalTauri` is true).
Wails: `const r = await import('/wails/runtime.js'); r.Call.ByName('zusteller/hosts/wails/internal/platform.Service.SetBadge', 3)`
(also `.ShowNotification`, `.OpenExternal`). These snippets are unverified: if one fails, record the error text.

## 4. Screenshots to take

Same window size per host and variant (vibrancy/opaque). Save outside the repo (never commit screenshots):
1. Light, active: whole window with a thread open (sidebar material + gutters).
2. Dark, active, same view.
3. Light and dark with the window inactive (gray selection).
4. Close-up of the traffic lights over the sidebar/title area.
5. Accent debug panel under two different system accent colours, each with the selected row.
6. Theme mismatch cases (system dark/app light and reverse).
7. Reduce Transparency on.
8. Mail menu open, a notification banner, Dock icon with badge.
9. Activity Monitor row for the app after 30 s idle.

## 5. Prompt for a local Claude Code session with computer use

```text
You are testing the zusteller desktop hosts on this Mac. Read AGENTS.md, docs/host-comparison.md, hosts/tauri/README.md,
hosts/wails/README.md and docs/mac-test-runbook.md first. Do not change source code, push, or commit screenshots.
1. Verify prerequisites from the runbook (brew, go >= 1.25, task, rust, Xcode CLT, node); install missing ones with brew/rustup
   and tell me what you installed.
2. Run each of the four variants in turn (Tauri dev, Tauri dev:opaque, Wails task dev:vite + task dev, Wails dev:opaque).
   For each, use computer use to screenshot the window and walk through checklist items 1-15 in the runbook, including opening
   System Settings to change the accent colour and toggling the system appearance, and clicking another app to make the
   window inactive. Use ?debug=accent as described and transcribe the panel values.
3. Then run scripts/measure-host.sh and include its table.
4. Report a table of item x variant with PASS/FAIL/N/A, one short observation each, screenshot paths (outside the repo, e.g.
   ~/Desktop/zusteller-tests/), and any error output verbatim. Revert temporary URL edits (git diff must be clean).
Be concise. Stop and ask if a step needs my password, a destructive action or an Apple ID.
```

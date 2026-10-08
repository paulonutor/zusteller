# zusteller — Tauri host (Tauri 2.12, thin)

Layout follows the `create-tauri-app` React+TS template: the Vite app (`index.html`, `src/`, `vite.config.ts`, `package.json`) is at the
repo root and `src-tauri/` is its sibling. `tauri.conf.json`: `frontendDist = ../dist`, `beforeDevCommand = npm run dev`,
`devUrl = http://localhost:47831` (fixed port, `strictPort`, set in `vite.config.ts`; the template uses 1420). The Tauri CLI is a devDependency.

## First run (macOS)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # if `cargo -V` fails
npm install                                                      # frontend deps + Tauri CLI
npm run tauri dev                                                # vibrancy is the default; `npm run tauri:dev:opaque` for a plain window
```

## Use (macOS)

```
npx tauri icon src-tauri/icons/icon.png   # placeholder icon -> generates icns etc.
npm run tauri dev           # native vibrancy (default): transparent window + sidebar material
npm run tauri:dev:opaque    # plain opaque window (overlay config) for comparison / fallback
```

Vibrancy is configured in `src-tauri/tauri.conf.json` (`macOSPrivateApi`, `transparent`, `windowEffects: sidebar`, window `url`
`index.html?vibrancy=1`) and uses a private AppKit API for transparency. In Tauri 2.12.1 the `macos-private-api` Cargo feature/config is a no-op (the APIs are always compiled in; the private WKWebView key is set whenever `transparent` is requested). The feature is still declared in `Cargo.toml` so it matches the config on older versions.
`tauri:dev:opaque`/`tauri:build:opaque` merge `src-tauri/tauri.opaque.conf.json`; config merge replaces arrays, so it repeats the whole window
definition — keep it in sync with the base config.

## What exists

- Window 1280x800, min 900x600, `titleBarStyle: Overlay`, hidden title, traffic lights at (20,28). `withGlobalTauri: true`.
- Plugins: opener (capability scoped to `https://*`, `http://*`, `mailto:*` only), notification (used from Rust).
- Commands `notify`, `set_badge` (`window.set_badge_count`); native menu App/Edit/Mail/View/Window; Mail items
  (Archive, Move to Trash, Mark Read/Unread, Add/Remove Star, Find=Cmd+F) emit event `zusteller://menu` with the item id.
  No accelerators on plain-key items so they cannot fire while typing.
- Capability `default`: only `opener:allow-open-url` with the scope above. No fs/shell/http/core-window permissions.
- Frontend: `src/platform/tauri.ts` (+ test). Wired via `platform/index.ts` (Tauri -> browser); menu ids (`mail.*`) map to actions in `platform/menuActions.ts` and run through `MailApp`'s shortcut handler.

## Verified (Linux, this repo)

- `cargo check` in `src-tauri` passes (tauri 2.12.1, tauri-build 2.7.1, opener 2.7.0, notification 2.5.1; CLI 2.12.1 on npm),
  including config schema validation by tauri-build (window keys, `frontendDist` exists). Linux/webkit2gtk target only, so
  `cfg(macos)` code paths were not compiled.
- Frontend: vitest (platform), eslint, tsc pass.

## NOT verified (needs a Mac)

- `tauri dev/build`, the dev loop, bundling/signing/notarisation, dmg. Placeholder icon only.
- Overlay titlebar look, traffic-light position, drag region (the frontend must provide a `data-tauri-drag-region` or equivalent
  strip; not added since existing frontend files are off limits).
- Vibrancy: that `sidebar` material renders, that it is window-wide (NOT sidebar-only; per-pane material needs native code),
  Liquid Glass (not attempted), reduced-transparency behaviour, and that React backgrounds are transparent enough.
- Notifications (permission prompt; in `tauri dev` macOS attributes them to the terminal), Dock badge, menu rendering/events,
  `plugin:opener|open_url` invoke name and scope matching (the `mailto:*` pattern in particular).
- CSP in `tauri.conf.json` is a first guess: check the dev server (Vite HMR websocket / inline styles) and the reader iframe.

## Vibrancy mode (default)

Needs three layers: (1) transparent window + macOS `sidebar` material (`tauri.conf.json`, requires `macOSPrivateApi`),
(2) the page opened with `?vibrancy=1` (set via the window `url` in `tauri.conf.json`) which makes `src/platform/hostChrome.ts`
set `data-vibrancy` on `<html>`, and (3) `src/styles/host.css` (`:root[data-vibrancy]`) which makes the window backdrop,
gutters and sidebar transparent. List and reader panes stay opaque. Material is window-wide, not sidebar-only.
`npm run tauri:dev:opaque` gives the plain window. If the effect is missing, check that the opaque overlay config is not in use.

The window theme is pinned to the in-app theme (`set_window_theme`, called from `ThemeProvider`), so the vibrancy material
always matches the page colours; choosing "System" in the app lets the window follow the OS again.

Mac test steps and checklist: [`mac-test-runbook.md`](mac-test-runbook.md); measurements: `scripts/measure-host.sh`.

## System accent colour

WKWebView resolves the CSS system accent to default blue whatever System Settings says, so the `accent_color` command reads
`NSColor.controlAccentColor` (objc2-app-kit, sRGB `#rrggbb`) and a background thread emits `zusteller://accent` when it changes (1 s check,
deliberately not an observer). The page applies it as `--host-accent`. Event listening needs `core:event:allow-listen` in the capability.

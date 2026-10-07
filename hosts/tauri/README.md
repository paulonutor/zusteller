# zusteller — Tauri host (Tauri 2.12, thin)

Loads the shared `frontend/` Vite project; no UI code lives here. Paths in `tauri.conf.json` are relative to `src-tauri/`
(`frontendDist = ../../../frontend/dist`); the before-commands run from `hosts/tauri/` via `npm --prefix ../../frontend`.

## Use (macOS)
```
cd frontend && npm install && cd ../hosts/tauri && npm install
npx tauri icon src-tauri/icons/icon.png   # placeholder icon -> generates icns etc.
npm run dev            # opaque window
npm run dev:vibrancy   # transparent window + sidebar vibrancy (overlay config)
```
`dev:vibrancy`/`build:vibrancy` merge `src-tauri/tauri.vibrancy.conf.json` (sets `macOSPrivateApi`, `transparent`,
`windowEffects: sidebar`). Transparency on macOS requires Tauri's `macos-private-api` (a private AppKit API); the Tauri CLI
will add/remove that feature in `Cargo.toml` to match the config. Because config merge replaces arrays, the overlay repeats
the whole window definition — keep it in sync with the base config.

## What exists
- Window 1280x800, min 900x600, `titleBarStyle: Overlay`, hidden title, traffic lights at (16,18). `withGlobalTauri: true`.
- Plugins: opener (capability scoped to `https://*`, `http://*`, `mailto:*` only), notification (used from Rust).
- Commands `notify`, `set_badge` (`window.set_badge_count`); native menu App/Edit/Mail/View/Window; Mail items
  (Archive, Move to Trash, Mark Read/Unread, Add/Remove Star, Find=Cmd+F) emit event `zusteller://menu` with the item id.
  No accelerators on plain-key items so they cannot fire while typing.
- Capability `default`: only `opener:allow-open-url` with the scope above. No fs/shell/http/core-window permissions.
- Frontend: `frontend/src/platform/tauri.ts` (+ test). Wired via `platform/index.ts` (Wails -> Tauri -> browser); menu ids (`mail.*`) map to actions in `platform/menuActions.ts` and run through `MailApp`'s shortcut handler.

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

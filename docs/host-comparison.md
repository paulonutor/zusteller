# Host comparison: Wails v3 (beta.28) vs Tauri 2.12

Status: **provisional, written on Linux**. Nothing here was run on macOS. Every cell that needs a Mac says
`TO MEASURE (needs macOS)`. Facts come from the host READMEs, the scaffolds in `hosts/`, and the sources linked at the end.
Both hosts load the same `frontend/` and `MockMailService`; neither adapter is wired into `platform/index.ts` yet.

## Comparison table (plan section 7, 13 rows)

| Metric | Wails v3 beta.28 | Tauri 2.12 |
|---|---|---|
| Setup and dev loop | Go >= 1.25, Task, Xcode CLT (cgo). No `wails3` CLI used: `task dev:vite` + `task dev` in two terminals. Dev loop itself: TO MEASURE (needs macOS) | Rust toolchain + `npm install` in `hosts/tauri`. `npm run dev` starts Vite via `beforeDevCommand`. Dev loop: TO MEASURE (needs macOS) |
| Build time / bundle size | TO MEASURE (needs macOS) | TO MEASURE (needs macOS) |
| Cold startup / idle RAM | TO MEASURE (needs macOS) | TO MEASURE (needs macOS) |
| Native menus and shortcuts | App/Edit/Mailbox/View/Window menus in `menu.go`; mail items emit `zusteller:mail-action`. Compiles on Linux; rendering and event delivery TO MEASURE (needs macOS) | App/Edit/Mail/View/Window menus in `lib.rs`; mail items emit `zusteller://menu`. `cargo check` passes on Linux; rendering and events TO MEASURE (needs macOS) |
| Notifications / Dock badge | Built-in dock + notifications services. Notifications need a signed bundle with a bundle identifier and user authorization (README; the Wails v2 docs say the same, v3 docs do not state it). Behaviour TO MEASURE (needs macOS) | `notification` plugin (called from Rust) and `window.set_badge_count`. In `tauri dev` macOS attributes notifications to the terminal (README). Behaviour TO MEASURE (needs macOS) |
| Titlebar / traffic lights | `MacTitleBarHiddenInset` (hidden title, inset traffic lights). Look TO MEASURE (needs macOS) | `titleBarStyle: Overlay`, hidden title, lights at (16,18). Needs a `data-tauri-drag-region` strip in the frontend (not added). Look TO MEASURE (needs macOS) |
| Vibrancy / Liquid Glass | `MacBackdropTranslucent` set. WebView stays opaque above the backdrop unless built with `-tags private_mac_apis` (private API). `MacBackdropLiquidGlass` exists (macOS 15+ per source), not enabled. Rendering TO MEASURE (needs macOS) | `windowEffects: sidebar` via overlay config `tauri.vibrancy.conf.json`. Needs `macOSPrivateApi` (private API) for transparency. Liquid Glass not attempted. Rendering TO MEASURE (needs macOS) |
| Sidebar-only transparency | Not offered; backdrop is window-wide (README, from source) | Not offered; effect is window-wide, per-pane material needs custom native code (README) |
| Theme / inactive appearance | TO MEASURE (needs macOS) | TO MEASURE (needs macOS) |
| Packaging / signing | Not set up. `.app` needs the `wails3` CLI (`wails3 package`, Info.plist in `build/darwin/`) or a manual plist. Signing and notarization are macOS-only and need an Apple Developer account. DMG via `create-dmg`/`hdiutil`, not built in. End-to-end TO MEASURE (needs macOS) | `bundle.targets` = `app`, `dmg`; identifier `de.onutor.zusteller`; placeholder icon only (`tauri icon` generates icns). Signing/notarization not set up. End-to-end TO MEASURE (needs macOS) |
| Host-specific code size | 507 lines incl. adapter and tests (see below) | 362 lines incl. adapter and tests (see below) |
| Debugging and agent reliability | Beta API; bindings called by string name, so renames break at runtime. Agent could verify everything via module source on Linux. Real-world reliability TO MEASURE (needs macOS) | Stable API, config validated by `tauri-build` on Linux. Config overlay replaces arrays, so it must be kept in sync by hand. Real-world reliability TO MEASURE (needs macOS) |
| Known compatibility risks | See risks section | See risks section |

## Host-specific code size (counted 2026-10-07, `wc -l`)

| | Host files | Platform adapter + test | Total |
|---|---|---|---|
| Wails | `main.go` 95, `menu.go` 55, `internal/platform/platform.go` 81 + `_test.go` 51, `Taskfile.yml` 45 = 327 | `wails.ts` 104 + `wails.test.ts` 76 = 180 | 507 |
| Tauri | `lib.rs` 116, `main.rs` 6, `tauri.conf.json` 38, `tauri.vibrancy.conf.json` 23, `capabilities/default.json` 12, `package.json` 17 = 212 | `tauri.ts` 83 + `tauri.test.ts` 67 = 150 | 362 |

Shared and identical for both: `PlatformService.ts` 10, `browser.ts` 25, `index.ts` 9. Line counts are a rough proxy; the two
scaffolds differ in config verbosity and test coverage (Wails has Go unit tests, Tauri has none on the Rust side).

## Known compatibility risks

Wails:
- v3 is beta; APIs may change. Pin is `beta.28`.
- Window-wide translucency needs `-tags private_mac_apis`, which conflicts with the plan's "documented APIs only".
- No generated JS bindings: calls use fully-qualified Go names (`zusteller/hosts/wails/internal/platform.Service.<Method>`).
- Not verified: darwin cgo build, `task build` (vite into `appdist/` + embed), `Events.On` payload shape, dynamic `import('/wails/runtime.js')` under the dev proxy.
- Linux compile checks need `-tags gtk3` because beta.28 defaults to GTK4.

Tauri:
- Transparency needs `macOSPrivateApi` (private AppKit API). Community sources state this blocks Mac App Store acceptance (guideline 2.5.1); no official Tauri statement was reachable (see sources).
- A Tauri issue reports transparent windows rendering solid white in a bundled DMG while `tauri dev` works. Unconfirmed for this app.
- CSP in `tauri.conf.json` is a first guess; check Vite HMR and the reader iframe.
- `plugin:opener|open_url` invoke name and the `mailto:*` scope pattern are unverified.
- Overlay titlebar needs a drag-region strip in the shared frontend.

Both: Liquid Glass support must be verified on the installed framework version and macOS version; reduced-transparency and
inactive-window behaviour are unverified.

## Measurement checklist (run on a Mac, same machine, same macOS, release builds, mock data)

Record macOS version, chip, and Go/Rust/Node versions. Quit other apps; take the median of 5 runs.

1. Build time and bundle size
   - Wails: `cd hosts/wails && time task build` then `du -sh bin/zusteller` (bare binary; re-measure the `.app` once packaged).
   - Tauri: `cd hosts/tauri && npx tauri icon src-tauri/icons/icon.png && time npm run build`, then
     `du -sh src-tauri/target/release/bundle/macos/zusteller.app` and `ls -lh src-tauri/target/release/bundle/dmg/*.dmg`.
   - Also run each twice (clean and incremental). Add `build:vibrancy` for Tauri.
2. Cold start (purge cache between runs with `sudo purge`)
   - `time open -W -a <app>` is not meaningful; instead note the time from launch to first rendered list, e.g. screen-record
     at 60 fps and count frames, or log `performance.now()` at first list paint in devtools.
3. Idle RAM (let the app sit 60 s with the inbox open)
   - `ps -o rss= -p $(pgrep -f zusteller)` for the host, plus WebKit processes:
     `ps -axo rss,command | grep -i -E 'zusteller|WebKit.(WebContent|Networking)'`; sum host + WebContent for the app.
   - Cross-check with Activity Monitor "Memory" column.
4. Appearance (same-size screenshots, light + dark, active + inactive, Reduce Transparency on/off)
   - Traffic light position, dragging, fullscreen, resize.
   - Wails: with and without `-tags private_mac_apis`. Tauri: `dev:vibrancy` vs `dev`.
   - Does a sidebar-only material exist? (Expected: no for both.)
5. Native behaviour: menu items fire events, Dock badge, notification permission prompt (from a signed `.app`, not the terminal), `openExternal` allow-list.
6. Packaging: sign with a Developer ID cert, notarize, open on a second Mac, check Gatekeeper.

## Provisional recommendation (PROVISIONAL: based on no Mac measurements)

Lean **Tauri 2** as the default candidate, with low confidence:
- Stable 2.x API versus Wails v3 beta; fewer moving parts in agent-driven changes.
- Packaging (`app` + `dmg` targets) is already configured; Wails `.app` bundling is not.
- Smaller host footprint in the scaffold (362 vs 507 lines).

Counterpoints that could flip this: Wails has a Liquid Glass backdrop option in source (Tauri: not attempted), Go may suit
a future local mail cache/sync backend, and either host may win on startup/RAM. Both need a private API for the
translucent look, so that does not separate them. Decide only after items 1 to 6 above are measured.

## Sources

- [Wails v3 macOS packaging](https://v3.wails.io/guides/build/macos), [signing](https://v3.wails.io/guides/build/signing), [notifications](https://v3.wails.io/features/notifications/overview/)
- [Wails v2 notifications guide](https://wails.io/docs/guides/notifications) (bundle identifier note)
- [Tauri issue 13415](https://github.com/tauri-apps/tauri/issues/13415) (transparent window white in bundled build)
- [window-vibrancy](https://docsearch.algolia.com/mcp/docs/repo/tauri-apps/window-vibrancy) (macOSPrivateApi needed for transparency)
- Official Tauri docs (v2.tauri.app) were not reachable from the authoring environment; the App Store claim is community-sourced.

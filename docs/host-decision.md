# Host decision: Tauri 2 (Wails v3 evaluated and removed)

Both hosts wrapped the same frontend and were run on a Mac (Oct 2026). Tauri was kept.

|                                | Tauri 2                                                                           | Wails v3 beta.28                                                |
| ------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Stability                      | Stable 2.x                                                                        | Beta                                                            |
| Packaging                      | `tauri build` makes `.app`/`.dmg`; signing, notarisation, updater are first-party | None: needed a hand-made `.app` wrapper                         |
| Transparent webview (vibrancy) | `macos-private-api` feature                                                       | `-tags private_mac_apis` build tag                              |
| Runtime window theme           | `window.set_theme`                                                                | Needed a cgo shim (`NSApp.appearance`)                          |
| Dev loop                       | `tauri dev` (one command)                                                         | Vite + `go run` in two terminals                                |
| JS to host calls               | Typed commands + ACL permissions                                                  | String-named bindings, no ACL                                   |
| Cons                           | Slow cold Rust build (share `CARGO_TARGET_DIR`); native code is Rust (`objc2`)    | Go is nice for mail protocols (not needed for Gmail's HTTP API) |

Found on both: WKWebView ignores the macOS accent colour for CSS system colours, so the host reads
`NSColor.controlAccentColor` and sends it to the page (see `docs/tauri-host.md`).

Wails is in git history (`git log -- hosts/wails`) if it is ever worth reviving; `src/` stays host-neutral.

## Mac App Store note

Verified from source on Linux (not by submitting anything): in Tauri 2.12 the `macos-private-api` feature / `macOSPrivateApi`
config is documented as a no-op ("APIs are always enabled"), and wry 0.57 sets the private KVC key `drawsBackground` on the
WKWebView when `transparent` is requested. Apple's App Review guideline 2.5.1 requires public APIs only, so Mac App Store
submission of a transparent-WebView build is AT RISK of rejection (not proven, nothing was submitted). Developer ID +
notarisation outside the store is unaffected as far as known. The opaque variant (`tauri:dev:opaque` / `tauri:build:opaque`) uses public
APIs only and is the fallback if the store matters.

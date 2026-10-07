# zusteller - Wails v3 host

Thin Go host that loads the **shared** `../../frontend` Vite project. No frontend source is copied:
dev proxies to the Vite dev server (`FRONTEND_DEVSERVER_URL`); production embeds the Vite build output
(`appdist/`, a gitignored build artifact written by `task build:frontend`).

Wails: `github.com/wailsapp/wails/v3 v3.0.0-beta.28` (latest on the Go proxy on 2026-10-07; API read from the module source).

## First run (macOS)

```bash
brew install go go-task                       # Go >= 1.25 and Task
(cd ../../frontend && npm install)            # shared frontend deps
task dev:vite                                 # terminal 1
task dev                                      # terminal 2
# without Task: FRONTEND_DEVSERVER_URL=http://localhost:5173 go run .
```

## Commands (needs Go >= 1.25 and [Task](https://taskfile.dev); no `wails3` CLI)

| Task | |
|---|---|
| `task dev:vite` then `task dev` (2 terminals) | Vite on :5173 + Wails window proxying to it |
| `task build` | `vite build` into `appdist/`, then `go build -tags production` -> `bin/zusteller` |
| `task test` / `task vet` | Go tests (OS-independent) / `go vet` |

macOS: needs Xcode CLT (cgo). Linux (only for compile checks): `libgtk-3-dev libwebkit2gtk-4.1-dev`; Taskfile adds `-tags gtk3`
because beta.28 defaults to GTK4. `.app` bundling/signing is not set up (needs the `wails3` CLI or manual `Info.plist`).

## What is here

- `main.go` - window 1280x800, min 900x600, `MacTitleBarHiddenInset` (hidden title, full-size content, inset traffic lights),
  `MacBackdropTranslucent`, transparent background colour. Services: dock, notifications, `platform.Service`.
- `internal/platform` - the only Go type meant for JS: `OpenExternal(url)` (http/https/mailto allow-list), `SetBadge(count)`
  (Dock badge, <=0 removes), `ShowNotification(title, body)`. Pure Go with unit tests.
- `menu.go` - App (macOS) / Edit / Mailbox / View / Window menus. Mailbox items emit event `zusteller:mail-action`.
- Frontend: `frontend/src/platform/wails.ts` (`createWailsPlatformService`, `isWailsHost`, `onWailsMailAction`), no npm dependency.
  It lazily `import('/wails/runtime.js')` (served by the host) and sets `window.wails`; calls go through `Call.ByName`
  with the fully-qualified name `zusteller/hosts/wails/internal/platform.Service.<Method>`.
  `src/platform/index.ts` is wired: `createPlatformService()` picks Wails (`isWailsHost`) -> Tauri -> browser.

## Native menu -> `src/features/mail` mapping (wired)

Event `zusteller:mail-action`, string payload:

| Menu item | Payload | MailActionId / handling |
|---|---|---|
| Archive | `archive` | `archive` |
| Move to Trash | `trash` | `trash` |
| Mark as Read / Unread | `markRead` / `markUnread` | same ids |
| Star | `star` | toggle: run `star` or `unstar`, whichever `resolveActions()` reports enabled (as the `S` shortcut does) |
| Find (Cmd+F) | `find` | no MailActionId; focus the search field |

Wiring: `platform/index.ts` adapts `onWailsMailAction` into `PlatformService.subscribeMenuActions` (table in
`platform/menuActions.ts`); `MailApp` feeds it to the same `onShortcut` handler as the keyboard (star = toggle, find = focus
search), so actions that are not enabled for the current selection are ignored. Mail items intentionally have no plain-key accelerators
(a native key equivalent would swallow keystrokes in text inputs); `shortcuts.ts` keeps handling them.

## Verified vs. not

Verified (Linux, go1.24.7 + auto-downloaded go1.25, webkit2gtk-4.1/GTK3 headers):
- `go vet -tags gtk3 ./...`, `go build -tags gtk3` and `-tags production,gtk3` succeed (links against the real beta.28 module).
- `go test ./internal/...` passes (URL allow-list, badge, notification ids).
- Every Wails API used was checked against the module source (window/MacWindow options, menu API, `app.Event.Emit`,
  `app.Browser.OpenURL`, dock and notifications services, `/wails/runtime.js`, `Call.ByName`, `Events.On`).
- Frontend: vitest/eslint/tsc for `src/platform` (adapter tested against a stubbed `window.wails`).

NOT verified (needs a Mac):
- Anything darwin: cgo build, window appearance, traffic-light position, translucent backdrop, menus, event delivery to JS.
- That the real runtime module's `Events.On` payload shape equals what `onWailsMailAction` expects (handled: bare value or 1-element array).
- `task build` end to end (vite build into `appdist/` + embed) and `task dev` were not run.
- Dock badge and notifications on macOS; notifications need a signed app bundle with a bundle identifier and user authorization
  (service startup errors otherwise).
- Dynamic `import('/wails/runtime.js')` under the dev-server proxy (the host serves it itself, per source).

## Known limits / risks

- Wails v3 is beta; APIs may change. Pin is `beta.28`.
- Without `-tags private_mac_apis` the WebView stays opaque above the backdrop (documented in Wails source), so the
  translucent sidebar will not show through until the tag is used (private API: conflicts with the plan's "documented APIs only").
  `MacBackdropLiquidGlass` exists (macOS 15+ per source) but was not enabled.
- Sidebar-only material is not offered by Wails; the backdrop is window-wide.
- JS bindings are called by string name (no generated bindings, to avoid a dependency); renaming the Go type/package breaks them.

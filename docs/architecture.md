# zusteller architecture (Phase 1 reader + Phase 2 hosts)

```
React UI (features/mail) ──► MailService (domain contract) ◄── MockMailService   (Phase 1)
        │                                                  ◄── GmailMailService  (Phase 3, future)
        └────────────────► PlatformService ◄── browser impl ◄── Tauri adapter (Phase 2, wired)
```

`src/app/createServices.ts` is the only place a concrete mail provider is chosen; `src/platform/index.ts` is the only place the host is detected.

## Domain contract

`MailService` follows the plan with **one addition**: `getMailboxCounts(accountId)` returns unread-thread counts per system
mailbox and per user label. Correct counts can't be derived from paginated `getThreads`, and the plan requires "proper counts".
Compose/draft/send methods are intentionally absent until Phase 4.

System mailboxes (`SystemMailbox`) and user labels stay distinct in the UI. Internally system state is carried as label ids
(`INBOX`, `SENT`, `TRASH`) on messages, as Gmail does, but `Label.type` and `isSystemLabelId` always tell them apart, and
`addLabel`/`removeLabel` reject system labels.

### Thread semantics (mock; not a claim about Gmail)

- Thread unread ⇔ any message unread; starred ⇔ any message starred; labels = union. Mutations apply to every message.
- Inbox = `INBOX` ∧ ¬`TRASH`; Sent = `SENT` ∧ ¬`TRASH`; Starred = starred ∧ ¬`TRASH`; All = ¬`TRASH`; Trash = `TRASH`.
- archive removes `INBOX`; trash adds `TRASH` and removes `INBOX`; restore removes `TRASH` and adds `INBOX`
  (original placement is not remembered).
- Batch mutations are atomic: an unknown id fails the whole call and changes nothing.
- Ordering is `lastMessageAt` desc, id desc. Cursors are keyset-based, so mutations between pages can't duplicate or skip rows.
- Search is AND over whitespace-separated terms across subject, sender, recipients, body (HTML stripped) and attachment names,
  scoped to the current mailbox/label.

### Simulation

`MockMailService` takes `latency` (ms or `{min,max}` with a seeded PRNG), `setOffline()`, and `failNext(method?, n)` for
deterministic failure tests. Dev URL flags: `?latency=0`, `?offline=1`.
Other mock features: deterministic seed (`createSeedData`, fixed `SEED_NOW`) with accounts, labels, multi-message threads, HTML and
plain-text bodies and attachments (metadata); stateful mutations; keyset-paged `getThreads`; search; `getMailboxCounts` that
reflects mutations.

## UI architecture

- **State**: TanStack Query (lists via `useInfiniteQuery`, `keepPreviousData` so rows stay visible while refetching).
  Selection/focus/pane widths are React state; layout and theme persist best-effort in `localStorage`.
- **Mutations**: all go through `useMailActions().run`. Read/star update caches optimistically with rollback and an error
  toast; archive/trash/restore/label wait for the service (their effect on mailbox membership is provider semantics we
  don't duplicate in the UI). Every mutation then invalidates lists, counts and open threads.
- **Actions**: `resolveActions(threads, view)` is the single source of what is available (pure, unit-tested).
  Toolbar, context menu and shortcuts all render/execute from it.
- **Selection** (`selection.ts`, pure): click opens one; ⌘-click toggles; ⇧-click ranges; arrows move the cursor, ⇧+arrows
  extend; Space toggles; Enter opens; ⌘A selects all loaded; Esc clears. One selected row = open in the reader.
  Opening a conversation marks it read once.
- **Filter tabs** (All / Unread / Starred): client-side over the *loaded* rows only (not a server query). Selected rows stay
  visible even if they no longer match, so opening an unread thread doesn't make it vanish. Tab counts are over loaded rows.
- **Shortcuts** (`shortcuts.ts`): `E` archive · `⌫`/`Del`/`#` trash · `⇧Z` move to Inbox · `⇧I`/`⇧U` read/unread · `S` star toggle ·
  `/` or `⌘F` search. Plain keys only so they never collide with macOS ⌘ shortcuts; ignored while typing or while a menu is open.
- **Layout**: sidebar (180–320, default 220) · list (300–640, default 410) · reader (flex, min 320). Drag or arrow-key resize.
  A 52 px drag-region header on each pane leaves room for native traffic lights (see Platform layer).

### Rows and selection look (skin B2)

- Each row shows a sender **avatar** (initials, hue from the address). It becomes the round checkbox only while the pointer is over the
  avatar itself (enlarged hit area around it) or on keyboard focus; once anything is multi-selected, every row shows checkboxes
  (selection mode). Star appears only when starred or on hover.
- Selected rows use the macOS accent colour while the list **and** window are active, and gray otherwise (`data-window-inactive`),
  like native lists.
- **Accent handling** (`styles/skins.css`): default tokens are a fixed blue. `@supports (color: AccentColor)` switches `--sel-accent` /
  `--accent` to `AccentColor`; `@supports (color: -apple-system-control-accent)` overrides that with WebKit's own dynamic system colour
  (what `NSColor.controlAccentColor` returns). Text on the accent is always white (`--sel-accent-text`, `--accent-fg`), because
  `AccentColorText` resolves to black on bright accents. `trackWindowFocus` bumps `--accent-tick` on focus so the colour re-resolves
  after a System Settings change. `?debug=accent` (`platform/accentDebug.ts`) shows what the webview resolves for each keyword.

## Platform layer (`src/platform`)

| File | Role |
|---|---|
| `PlatformService.ts` | Interface: `showNotification`, `setBadge`, `openExternal`, `subscribeMenuActions(handler)` returning an unsubscribe, optional `setWindowTheme('system'/'light'/'dark')` |
| `browser.ts` | Browser implementation (`subscribeMenuActions` is a no-op, no `setWindowTheme`) |
| `tauri.ts` | Host adapter (`isTauriHost`): notifications, badge, `openExternal`, `setWindowTheme`, system accent colour |
| `index.ts` | `createPlatformService()`: Tauri, else browser; adapts host menu events to `subscribeMenuActions` |
| `menuActions.ts` | Host-neutral `MenuAction` (`archive trash markRead markUnread star find`); maps Tauri item ids (`mail.archive`). `MailApp` feeds them to the same handler as keyboard shortcuts (`star` = toggle, `find` = focus search); actions not enabled for the selection are ignored |
| `hostChrome.ts` | `applyHostChrome()` sets `data-host="tauri"` and, if the host opened `?vibrancy=1`, `data-vibrancy` on `<html>`; `trackWindowFocus()` mirrors focus into `data-window-inactive`; `dragRegionProps` (`data-tauri-drag-region`) marks draggable headers |
| `accentDebug.ts` | `?debug=accent` diagnostic panel |

`ThemeProvider` calls `platform.setWindowTheme?.()` so the native material follows the in-app theme ("System" follows the OS).
`main.tsx` runs `applyHostChrome`, `trackWindowFocus` and `showAccentDebug` at startup.

## Safe rendering

`features/mail/reader/safe-html`: DOMPurify allow-list; `<style>` dropped, inline CSS filtered; remote images/tracking
pixels blocked by default with an explicit "Load remote images" per message; link `href`s limited to http(s)/mailto and opened
only via `PlatformService.openExternal`; rendered in `<iframe sandbox="allow-same-origin" srcdoc>` with a CSP and no scripts;
the parent sizes the frame and intercepts link clicks. Attachments are metadata-only in V1 (no download).

## Hosts & skins

- **Host**: `hosts/tauri` (Rust, Tauri 2.12) is a thin shell around the shared `frontend/`;
  no UI code is copied. Native menu items reach the same action layer as toolbar and shortcuts (see Platform layer). Setup, commands
  and verification status are in the host's `README.md`; why Tauri (Wails was evaluated and removed) in `docs/host-decision.md`.
  Nothing native has been verified on a Mac yet.
- **Vibrancy is the default**: transparent window with a macOS sidebar material; the host opens the page with
  `?vibrancy=1`, which sets `data-vibrancy` so `skins.css` makes backdrop, gutters and sidebar transparent (list/reader stay opaque).
  Tauri needs `macOSPrivateApi` (a private API). Opaque variant:
  `npm run dev:opaque` / `build:opaque`.
- **Skins** (`src/styles/skins.css`, `src/app/skin.ts`): **B2 ("Gmail-in-glass")** is the default in light and dark. A and C are opt-in and
  dark-only: `?skin=a|b|c|default` (`default` = plain tokens). `?theme=dark` forces dark for one page load.

## Build and CI

- Reader HTML is code-split: `SafeHtmlFrame` (with DOMPurify) is `lazy()`-loaded from `MessageView` behind `Suspense`. Vite
  `manualChunks` splits `react`, `tanstack` and `radix` vendor chunks. `base: './'` so hosts can load the build from disk.
- `.github/workflows/frontend.yml` (every push/PR): `npm ci`, typecheck, lint, test, build in `frontend/`.
- `.github/workflows/hosts.yml` (when `hosts/**` or `frontend/src/platform/**` change): Tauri `cargo check --locked` after a frontend build. Linux only, so darwin code is not compiled in CI.

## Deliberately not built (later phases)

Gmail/OAuth/cache (3), compose/reply/send (4), on-device AI (5), app packaging/signing/notarisation, Liquid Glass in Tauri.

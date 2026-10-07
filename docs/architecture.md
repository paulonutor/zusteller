# zusteller architecture (Phase 1)

```
React UI (features/mail) ──► MailService (domain contract) ◄── MockMailService   (Phase 1)
        │                                                  ◄── GmailMailService  (Phase 3, future)
        └────────────────► PlatformService ◄── browser impl ◄── Wails / Tauri impls (Phase 2, future)
```

`src/app/createServices.ts` is the only place a concrete provider or host is chosen.

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
- **Shortcuts**: `E` archive · `⌫`/`#` trash · `⇧Z` move to Inbox · `⇧I`/`⇧U` read/unread · `S` star · `/` or `⌘F` search.
  Plain keys only so they never collide with macOS ⌘ shortcuts; ignored while typing or while a menu is open.
- **Layout**: sidebar (180–320, default 220) · list (300–640, default 410) · reader (flex, min 320). Drag or arrow-key resize.
  A 52 px drag-region header on each pane leaves room for native traffic lights in Phase 2.

## Safe rendering

`features/mail/reader/safe-html`: DOMPurify allow-list; `<style>` dropped, inline CSS filtered; remote images/tracking
pixels blocked by default with an explicit "Load remote images" per message; link `href`s limited to http(s)/mailto and opened
only via `PlatformService.openExternal`; rendered in `<iframe sandbox="allow-same-origin" srcdoc>` with a CSP and no scripts;
the parent sizes the frame and intercepts link clicks. Attachments are metadata-only in V1 (no download).

## Hosts & skins

- **Adapters**: `frontend/src/platform/` holds `PlatformService` (notification, badge, openExternal), the browser implementation,
  and the host adapters `wails.ts` / `tauri.ts`. They are written and unit-tested but not yet wired into `platform/index.ts`.
- **Hosts**: `hosts/wails` (Go, Wails v3 beta.28) and `hosts/tauri` (Rust, Tauri 2) are thin shells around the shared `frontend/`.
  No UI code is copied. Native menu items are routed to the same action layer as toolbar and shortcuts.
- **Skins**: dark mode defaults to skin B2 ("Gmail-in-glass"); `?skin=a|b|c|default` switches (`src/styles/skins.css`).
- Wails vs Tauri findings and the Mac measurement checklist: `docs/host-comparison.md`.

## Deliberately not built (later phases)

Wails/Tauri hosts and native vibrancy (Phase 2), Gmail/OAuth/cache (3), compose/reply/send (4), on-device AI (5).

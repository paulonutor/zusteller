# zusteller — Product & Engineering Plan

> Coding-agent specification · October 2026

## 1. Product vision

**zusteller** is a lightweight, desktop-first macOS email client combining Gmail's workflow and information density with the restrained, native-feeling visual language of Apple Mail. Initially Gmail-only, with a clean provider boundary. Build the product with coding agents and favor fast iteration, maintainable code, and verifiable behavior.

### Guiding constraints

- **One shared frontend** for both desktop host candidates: **Wails v3 + Go** and **Tauri + Rust shell**.
- React + TypeScript + Vite + Tailwind CSS + shadcn/ui + Lucide + TanStack Query.
- No Electron.
- **V1 is mock-only and read-focused**: no OAuth, Gmail network requests, compose, reply, forward, drafts editing, or sending.
- All UI behavior must work against a **mutable mock service**, not static screenshots.
- The eventual Gmail implementation must replace the mock through a stable application boundary.
- Apple Foundation Models is a **future, optional, on-device reading assistant**, not part of V1.

## 2. Delivery phases

| Phase | Outcome | Not included |
|---|---|---|
| 1 — Shared mock mail reader | Functional Gmail-inspired three-pane UI, realistic mock data and operations, browser dev mode | Gmail, OAuth, sending |
| 2 — Desktop host spike | Same frontend in Wails and Tauri; native window/material/menu experiments and measured comparison | Provider integration |
| 3 — Real Gmail | Google OAuth, read/sync/search/organize through Gmail API, local cache, secure tokens | Compose/send |
| 4 — Compose and send | New message, reply/reply-all/forward, drafts, attachments, send | AI automation |
| 5 — Local AI reading assistance | Optional Apple Foundation Models summaries, suggested labels, action/deadline extraction | Autonomous inbox management |

Phases 1 and 2 may be implemented together, but finish and validate the shared UI before duplicating host work. Do not build both hosts as separate apps.

## 3. Architecture

```text
                        Shared React/TypeScript frontend
              ┌──────────────────────────────────────────┐
              │ App shell · Mail UI · Queries · Actions  │
              │ shadcn/ui · Tailwind · Domain types       │
              └─────────────────────┬────────────────────┘
                                    │
                         Typed application services
                         MailService · PlatformService
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
       MockMailService      WailsMailAdapter      TauriMailAdapter
         (Phase 1)            (future)              (future)
              │                     │                     │
      In-memory fixtures       Go backend          Native commands
                                    │                     │
                               Gmail API           Gmail integration

          Future: AIService → MockAIService / Apple Foundation Models bridge
```

React feature components **must not import** `@tauri-apps/*`, Wails bindings, Gmail SDKs, Go/Rust-specific code, or native OS APIs. Host-specific logic lives behind typed adapters. Do not introduce placeholder adapter methods that appear functional: implement only needed capabilities and document future seams.

### Suggested monorepo

```text
zusteller/
  frontend/
    src/
      app/                  # app composition, providers, routing/state
      components/ui/        # shadcn/ui components
      features/mail/        # sidebar, list, reader, selection, actions
      domain/mail/          # types, MailService, query contracts
      infrastructure/mail/mock/  # mutable service, fixtures
      infrastructure/mail/wails/ # later adapter
      infrastructure/mail/tauri/ # later adapter
      platform/             # PlatformService and host implementations
      styles/
    tests/
  hosts/
    wails/                  # Wails v3 app, Go host
    tauri/                  # Tauri app, minimal Rust host
  docs/
    architecture.md
    host-comparison.md
  README.md
```

Configure both desktop hosts to load/build the **same** `frontend/` Vite project; do not copy compiled or source frontend code into separate projects except build artifacts.

## 4. Domain model and contracts

Use provider-neutral TypeScript models; do not leak Gmail API response types into the UI. IDs should be account-scoped or globally unique; pass account context to mutations to avoid cross-account ambiguity.

```ts
type ID = string;
type SystemMailbox = 'inbox' | 'starred' | 'sent' | 'trash' | 'all';

type Address = { name?: string; email: string };
type Account = { id: ID; email: string; displayName: string; avatarUrl?: string };
type Label = { id: ID; accountId: ID; name: string; type: 'system' | 'user'; color?: string };
type Attachment = { id: ID; filename: string; mimeType: string; size: number };

type Message = {
  id: ID; threadId: ID; accountId: ID;
  from: Address; to: Address[]; cc?: Address[];
  subject: string; sentAt: string;
  plainText?: string; html?: string;
  isRead: boolean; isStarred: boolean;
  labelIds: ID[]; attachments: Attachment[];
};

type ThreadSummary = {
  id: ID; accountId: ID; subject: string;
  participants: Address[]; snippet: string;
  messageCount: number; lastMessageAt: string;
  isRead: boolean; isStarred: boolean;
  labelIds: ID[]; hasAttachments: boolean;
};

type Thread = ThreadSummary & { messages: Message[] };
type Page<T> = { items: T[]; nextCursor?: string };
type ThreadQuery = {
  accountId: ID; mailbox?: SystemMailbox; labelId?: ID;
  search?: string; cursor?: string; limit?: number;
};

interface MailService {
  getAccounts(): Promise<Account[]>;
  getLabels(accountId: ID): Promise<Label[]>;
  getThreads(query: ThreadQuery): Promise<Page<ThreadSummary>>;
  getThread(accountId: ID, threadId: ID): Promise<Thread>;
  markRead(accountId: ID, threadIds: ID[], read: boolean): Promise<void>;
  setStarred(accountId: ID, threadIds: ID[], starred: boolean): Promise<void>;
  archive(accountId: ID, threadIds: ID[]): Promise<void>;
  trash(accountId: ID, threadIds: ID[]): Promise<void>;
  restore(accountId: ID, threadIds: ID[]): Promise<void>;
  addLabel(accountId: ID, threadIds: ID[], labelId: ID): Promise<void>;
  removeLabel(accountId: ID, threadIds: ID[], labelId: ID): Promise<void>;
}
```

**Thread semantics:** Gmail labels/read/star state can vary per message. The provider adapter must define and consistently implement thread-level actions; do not assume Gmail exposes exactly these aggregate fields. Derive summary flags using documented rules. System mailbox state and user labels should remain distinct even if Gmail represents both using label IDs. For V1, establish and test explicit semantics (e.g. archive removes Inbox, trash excludes from Inbox, restore removes Trash and returns to Inbox in the mock). Do not pretend these choices are universal Gmail behavior.

### Service injection and state

```ts
const services = {
  mail: new MockMailService(seedData),
  platform: createPlatformService(),
};
```

Provide services through React context. Use TanStack Query for async state and mutations, React state for transient selection, focus and pane widths. Invalidate/update all affected queries on mutations; optimistic updates are fine if rollback is correct. No Redux unless proven necessary.

## 5. Phase 1 — Realistic mock mail reader

### Seed data

- One mocked Gmail account initially; architecture permits more accounts later.
- 6–10 user labels; 40+ threads.
- Read/unread, starred, archived, sent, trash, attachments, multi-message threads.
- Realistic personal, transactional, newsletter and notification content.
- Plain text and sanitized HTML, short and long content, multiple recipients and oversized email layouts.
- Deterministic fixtures; optional seeded random generation.

### Mock behavior

- Stateful in-memory `MockMailService`: actions change subsequent queries.
- Inbox, Starred, Sent, Trash, All and user-label filtering.
- Text search across sender, recipients, subject and body; debounce in UI.
- Stable sorting and cursor-based pagination; prevent duplicate/missing rows.
- 100–300 ms configurable simulated latency; deterministic failure/offline simulation for tests.
- Multi-selection bulk actions and proper counts.
- A refresh command re-queries mock state (do not imply it contacts a server).

### Explicit exclusions

No Compose button that falsely promises functionality. No reply, reply-all, forward, drafts editor, send, Gmail OAuth, provider network calls, AI or background sync in V1.

## 6. UI and interaction specification

**Design brief:** *Gmail's information architecture and productivity workflow, presented as a polished Apple Mail-like macOS application.* Visually close enough to Gmail to feel familiar, but not a pixel-perfect clone or a generic SaaS dashboard.

### Three-pane layout

```text
┌──────────────────┬─────────────────────────┬──────────────────────────────┐
│ Sidebar          │ Thread list             │ Conversation                 │
│ Account          │ Search / list toolbar   │ Subject, participants        │
│ Inbox         12 │ □ ★ Sender       13:42  │ Archive / Trash / Labels     │
│ Starred          │     Subject             │ Message headers             │
│ Sent             │     Snippet [Label]     │ Sanitized message body      │
│ Trash            │                         │ Attachments                 │
│ Labels           │                         │                              │
└──────────────────┴─────────────────────────┴──────────────────────────────┘
```

- Initial sidebar width ~220 px; list ~380–450 px; reader fills remaining space.
- Resizable panes with reasonable minima, usable on 13–16-inch MacBooks.
- Native-feeling titlebar with traffic lights and integrated search/toolbar where host supports it.
- Compact desktop typography: system font stack, body 13–14 px, secondary 12–13 px, subject 18–22 px.
- Dense list rows around 60–75 px; sender, subject, snippet, time, star, checkbox, labels and attachment indicator.
- Unread emphasized by weight; subtle separators, hover and selection states.
- Sidebar like a macOS source list: icons, aligned unread counts, restrained highlight, colored label dots.
- Reader: expanded current message, older thread messages collapsible, no giant cards; safe HTML and compact attachment rows.
- Context menus and toolbars call the **same** application actions; no duplicated mutation logic.
- Search integrated into toolbar; light/dark/system theme (system default).
- Loading skeletons or subtle indicators; preserve visible data during refetch; restrained empty/error states.
- Avoid oversized buttons, gratuitous cards, heavy shadows, web-dashboard headers and excessive gradients.

### Keyboard and selection

- Arrow keys navigate list, Enter opens thread, Cmd+A selects all when list has focus.
- Shift-range and Cmd-toggle selection where feasible; checkboxes for explicit bulk selection.
- Keyboard shortcuts for Archive, Trash, Mark Read/Unread and search; validate macOS conflicts rather than assuming arbitrary shortcuts are safe.
- Correct focus and accessibility labels; keyboard-only navigation should be possible.

### Safe message rendering

- Sanitize untrusted HTML with a maintained sanitizer.
- Isolate message CSS/content so email HTML cannot restyle app chrome; consider sandboxed iframe and restrictive policy.
- Block active scripts and dangerous URLs, prevent oversized layouts from overflowing reader.
- Treat remote images/tracking pixels cautiously; prefer blocking by default once real Gmail is connected.
- Open external links through an explicit safe handler, not unrestricted webview navigation.

## 7. Phase 2 — Wails vs Tauri host comparison

### Host implementations

- **Wails:** use v3 if suitable/stable for the required features; Go host remains minimal in mock mode.
- **Tauri:** current stable Tauri; minimal Rust shell and commands/plugins only when needed.
- Both load the same React app and same `MockMailService` in V1.
- Shared `PlatformService` isolates native actions, for example:

```ts
interface PlatformService {
  showNotification(notification: { title: string; body?: string }): Promise<void>;
  setBadge(count?: number): Promise<void>;
  openExternal(url: string): Promise<void>;
}
```

Native menu actions should be routed through the same application action layer as toolbar/context-menu actions. For V1, notifications/badges may be host integration demonstrations rather than real new-mail notifications.

### macOS native appearance experiment

- Preserve genuine traffic lights, native resizing/fullscreen, correct window dragging and active/inactive appearance.
- Try a unified/transparent titlebar and a **translucent sidebar** backed by actual macOS material where possible.
- Evaluate native **Vibrancy / `NSVisualEffectView`** and **Liquid Glass** on supported macOS versions; use opaque surfaces for message list and reader.
- Use host-supported effects and documented APIs; avoid private APIs and visual hacks.
- Verify actual **sidebar-only** material placement: whole-window transparency is not equivalent. Some host/window APIs may not support per-pane native materials without additional native code.
- Transparent WebView backgrounds must not obscure the native effect; React sidebar backgrounds should not be unnecessarily opaque.
- Use CSS `backdrop-filter` only as a fallback or for UI-local effects, not as proof of native material integration.
- Respect reduced transparency/accessibility settings, light/dark themes, older macOS, and non-macOS fallback.
- Treat Liquid Glass support as a capability to **verify in the installed framework version**, not an assumed guarantee.

### Comparison report

Capture same-size screenshots and record:

| Metric | Wails | Tauri |
|---|---|---|
| Setup and dev loop | | |
| Build time / bundle size | | |
| Cold startup / idle RAM | | |
| Native menus and shortcuts | | |
| Notifications / Dock badge | | |
| Titlebar / traffic lights | | |
| Vibrancy / Liquid Glass | | |
| Sidebar-only transparency | | |
| Theme / inactive appearance | | |
| Packaging / signing | | |
| Host-specific code size | | |
| Debugging and agent reliability | | |
| Known compatibility risks | | |

Do not pick a winner from screenshots alone. Prefer stable, maintainable native integration and predictable build tooling. Document limitations honestly.

## 8. Phase 3 — Real Gmail provider

Replace the mock with a Gmail-backed service adapter **without changing feature components**. Add:

- Google OAuth installed-app flow with PKCE where applicable; no embedded password collection.
- Keychain-secured token storage; minimal Gmail scopes, explicit consent and revocation/logout.
- Gmail thread/message mapping, labels and mailbox semantics, search, pagination, mutation/error handling.
- Lightweight local metadata cache (SQLite if warranted), message bodies fetched on demand; no full offline mirror initially.
- Incremental sync, rate-limit/backoff, network/offline states, partial failure recovery and refresh.
- Clear account-scoped IDs and eventual multi-account support.
- Handle Gmail API restrictions and OAuth verification requirements before public distribution.

The choice of host determines where provider credentials, Gmail API access and local persistence live; avoid storing sensitive tokens in browser storage. Do not blindly move a production Gmail implementation into webview JavaScript.

## 9. Phase 4 — Compose and send

Only after the reader and Gmail integration are stable:

- New message, reply, reply all, forward.
- To/Cc/Bcc, subject, rich/plain body, attachment picker.
- Draft persistence/autosave and discard.
- Send with error handling, idempotency considerations and clear confirmation.
- Extend `MailService` with draft/send methods at this phase, not prematurely in V1.
- Keyboard shortcuts and native menus for composing.

## 10. Phase 5 — Optional Apple Foundation Models reading assistant

### Purpose

AI should **assist the user while reading**. It must not automatically organize the inbox, change labels, move messages, send replies, or execute actions. Keep AI separate from mail storage and provider logic.

### Candidate capabilities

1. **Summarize thread:** concise summary with key decisions and unanswered questions.
2. **Extract actions/deadlines:** suggest action items and dates with supporting message references; treat extraction as fallible.
3. **Suggest existing labels:** display recommendations, never apply automatically.
4. Optional later: explain lengthy/technical emails or produce a short “what matters” view.

### Contract sketch

```ts
type AISupport = { available: boolean; reason?: string };
type SuggestedAction = {
  description: string;
  deadline?: string; // ISO date only if explicitly supported by message
  sourceMessageId: ID;
};
type MailAnalysis = {
  summary: string;
  actions: SuggestedAction[];
  suggestedLabelIds: ID[];
};

interface AIService {
  availability(): Promise<AISupport>;
  summarizeThread(thread: Thread): Promise<string>;
  analyzeThread(thread: Thread, labels: Label[]): Promise<MailAnalysis>;
}
```

### Integration strategy

```text
React reading assistant
       ↓
AIService
  ├── MockAIService (deterministic fixtures/tests)
  └── AppleFoundationModelsAIService
            ↓
      host-specific native bridge
            ↓
      Apple's Foundation Models framework (on device)
```

- Apple Foundation Models is a native Apple framework; assess a small **Swift bridge/helper** shared conceptually by either host. Go/Rust bindings are optional alternatives only if mature and well maintained.
- Keep model prompts, schema validation, availability checks, timeouts, cancellation and errors behind the AI adapter.
- Prefer guided/structured generation for actions and labels; validate against actual label IDs and source content.
- Show the source message and let users verify deadlines. Never present inferred deadlines as authoritative facts.
- Invoke **on demand**, not automatically for every email; avoid unnecessary processing and preserve battery/performance.
- Default to local processing only; no silent cloud fallback. Explain unavailable model/device/OS/Apple Intelligence state without breaking mail reading.
- Do not log sensitive message bodies or model prompts; avoid persistent AI caches initially.
- Gate on supported macOS, hardware, model availability and Apple Intelligence configuration. Availability can change independently of app install.
- Evaluate summary quality on realistic emails, multilingual content, prompt injection inside emails and malformed HTML. Email text is untrusted input; never treat instructions inside a message as commands to the assistant.

**Out of scope:** autonomous classification, auto-labeling, auto-archive, sending replies, agentic inbox actions, cloud-model fallback and always-on background analysis.

## 11. Testing strategy

- Unit tests for mock service, filtering, pagination, mutation semantics, derived thread state.
- React component/integration tests for list, reader, labels, search, selection and keyboard behavior.
- Both hosts run the **same frontend test suite**.
- Desktop smoke tests for window startup, titlebar, menu dispatch, resize, theme and transparency fallback.
- Deterministic tests for simulated latency/errors; no random failures in CI.
- Security tests for hostile HTML, unsafe links and content overflow.
- Later Gmail adapter contract tests against recorded/controlled API responses; do not require live credentials in CI.
- Later AI mock contract tests plus manual supported-device evaluation, unavailable-model fallback and untrusted-email prompt-injection cases.

## 12. V1 / spike definition of done

- Both Wails and Tauri launch the **identical shared frontend** with the same mock data.
- Browse Inbox, Starred, Sent, Trash, All and user labels.
- Open and read multi-message threads with safe HTML/plain text and attachment metadata.
- Mark read/unread, star/unstar, archive, trash, restore, add/remove labels.
- Search, paginate, multi-select and use keyboard/context-menu/toolbar actions.
- Light, dark and system appearance; usable 13-inch layout.
- macOS native titlebar/sidebar appearance experiments documented with screenshots and honest fallbacks.
- Typecheck, lint and automated tests pass; each host can be built locally.
- `docs/host-comparison.md` contains measurements, limitations and a justified recommendation.
- No Gmail auth, compose/send or Apple AI required to complete V1.

## 13. Coding-agent execution instructions

1. Scaffold a single shared frontend and define strict TypeScript domain/service contracts.
2. Implement a mutable, deterministic `MockMailService` and realistic fixtures; write contract tests first.
3. Build the polished three-pane macOS/Gmail-inspired UI and interactions; run in Vite browser mode.
4. Integrate **Wails v3** as one thin host, verify actual supported native APIs and build.
5. Integrate **Tauri** as the second thin host, pointing at the same frontend.
6. Implement and compare titlebar, native material, menus, shortcuts and platform capabilities; record unsupported features instead of faking them.
7. Run formatter, TypeScript checker, linter and relevant tests after each significant change; fix failures.
8. Capture screenshots and measurements, fill comparison report, and recommend one host.
9. **Stop after the spike**. Do not implement Gmail, compose or Apple Foundation Models without an explicit next-phase request.

### Non-negotiable invariants

> The shared UI and application behavior must not change when switching between Wails and Tauri.

> Replacing MockMailService with GmailMailService must not require rewriting React mail components.

> Apple Foundation Models is an optional, on-device, user-invoked reading assistant introduced only in a later phase.

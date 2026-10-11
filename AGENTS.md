# Zusteller agent instructions

Instructions for coding agents (and humans) working in this repo.

**zusteller** is a lightweight macOS-first mail client: Gmail's workflow and density, Apple Mail's restraint.
The product/engineering plan lives in `zusteller-plan.md` (original spec) and `docs/architecture.md` (what is built).
**The plan describes intent; Trello tracks execution.** Never use Markdown/TODO files as the source of truth for progress.

## Local repository memory

- Read `~/.agents/memory/zusteller/MEMORY.md` at task start and follow relevant
  topic links. Use this same external directory in Codex, Claude, and all worktrees.
- Follow the global working agreements for recording and promoting lessons.
  Keep entries concise, dated, and supported by evidence. Recheck stale facts;
  current requests, project instructions, and verified source take precedence.
- Keep learned memory outside Git. It holds reusable agent lessons, while tasks,
  progress, and product decisions stay in the existing project tracker or docs.
- Promote stable, verified lessons through small, reviewed `AGENTS.md` changes.
  Factual path or command corrections may be made independently; changes to
  permissions or behavioral rules require user approval. If memory is missing,
  continue the task and create the local index when a useful lesson is learned.

## Communication style

- Be concise: short, scannable answers with minimal prose, easy to read and react to.
- When a decision is needed, ask **one** question with a few options and a clear recommendation (marked first).

## Current state

- **Phase 1** (shared mock mail reader) is implemented in `src/`.
- **Phase 2** host exists: `src-tauri/` (Rust, Tauri 2.12), the **only** desktop host (Wails was evaluated and removed, see
  `docs/host-decision.md`), wired through `src/platform` (menus, notifications, badge, external links, window theme, system accent
  colour). Vibrancy is the default; an opaque variant exists. Signing/notarisation/updater are open.
- **Phase 3** has a macOS read-only Gmail preview in `src-tauri/src/gmail/` and `src/infrastructure/mail/gmail/`. See `docs/gmail-preview.md`. Real Gmail writes, **Phase 4** (compose/send) and **Phase 5** (Apple on-device AI) require an explicit request.
- The browser/mock reader excludes OAuth and network calls. The desktop preview requests only `gmail.readonly`; organization actions remain local. Compose/reply/forward/drafts/send and AI remain excluded.

## Commands (run from the repo root)

| Task                         | Command                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| Install                      | `npm install`                                                    |
| Browser development          | `npm run dev`                                                    |
| Required frontend checks     | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` |
| Accessibility                | `npm run a11y`                                                   |
| Visual regression            | `npm run test:visual`                                            |
| Visual regression on macOS   | `npm run test:visual:docker`                                     |
| Desktop development          | `npm run tauri dev`                                              |
| App bundle for UI automation | `npm run tauri build -- --debug --bundles app`                   |

Read `docs/agent-guide.md` before accessibility, screenshot, visual-baseline, or
desktop UI-automation work. It documents prerequisites, platform differences,
baseline updates, and the app-bundle requirement.

CI (`.github/workflows/`): `frontend.yml` runs typecheck, lint, test and build (job `check`) plus visual regression (job `visual`) on every push/PR; `update-visual-baselines.yml` (manual) regenerates baselines on the runner and opens a PR for review (never pushes to main); `tauri.yml` runs Tauri `cargo check` (Linux and macOS) when `src-tauri/**` or `src/platform/**` change.

Before every push, typecheck, lint, tests and build must pass. Inspect screenshots
for visual changes. For documentation-only changes, verify Markdown formatting,
links, and `git diff --check` instead. Do not update visual baselines without
looking at the resulting images.

## Architecture rules (non-negotiable)

1. **One frontend** (`src/`) for the browser and the Tauri host (`src-tauri/`), laid out like the `create-tauri-app` template. Never fork or copy UI code into the host.
2. React feature code **must not import** `@tauri-apps/*`, provider SDKs or native APIs. ESLint enforces this
   (`no-restricted-imports`); features also may not import `@/infrastructure/*` — they use `MailService` from context.
3. Host/native behaviour goes behind typed adapters (`src/platform`, `src/infrastructure/mail/*`). Don't add placeholder
   methods that look functional. Host-only capabilities are optional on `PlatformService` (e.g. `setWindowTheme`);
   native menu items map to actions in `platform/menuActions.ts` and run through the same handler as shortcuts.
4. `MockMailService` → `GmailMailService` must be a one-line swap in `src/app/createServices.ts`; no feature component may change.
5. Toolbar, context menu and keyboard shortcuts share **one** action layer (`features/mail/actions.ts` +
   `useMailActions.ts` + `useThreadActions.ts`). Don't duplicate mutation logic in components.
6. Untrusted email HTML only renders through `features/mail/reader/safe-html` (DOMPurify + sandboxed iframe with
   `sandbox="allow-same-origin"` only + CSP). **Never add `allow-scripts`** to that iframe.
7. Thread semantics (archive/trash/restore, derived flags) are documented in `src/domain/mail/semantics.ts` and covered by
   `MockMailService.test.ts`. Change both together.
8. State: TanStack Query for async data; React state for selection/focus/pane widths. No Redux.

## Visual look

One look, in light and dark: "Gmail-in-glass" (Tahoe-style floating panes, title + search together).
`?theme=dark` forces dark. Styles live in `src/styles/mail.css` (layout + look) and `host.css` (native host chrome); tokens in `tokens.css`; component styles in `styles/mail/`.

- Rows show a sender avatar (initials); it turns into the round selection checkbox only when hovering the avatar itself (enlarged hit
  area) or on keyboard focus, and every row shows checkboxes once the user multi-selects. Star shows only when starred or on hover.
- Selection uses the macOS accent (`-apple-system-control-accent`, else `AccentColor`, else fixed blue; `@supports`-guarded) while list
  and window are active, gray otherwise (`data-window-inactive`). Text on the accent is always white. Debug with `?debug=accent`.
- The list filter menu is client-side over loaded rows. Unread keeps selected rows visible after mark-on-open; Starred removes unstarred rows even when selected.
- Native hosts: `?vibrancy=1` → `data-vibrancy` makes backdrop/gutters/sidebar transparent; `data-host` insets headers for traffic lights.

## Layout

```
src/
  app/            composition root (createServices), providers (services, theme, toast)
  components/ui/  small shadcn-style primitives (Button, Menu, Checkbox, Resizer)
  domain/mail/    provider-neutral types, MailService contract (incl. getMailboxCounts), semantics, query keys
  features/mail/  sidebar/ list/ reader/ (+ safe-html/, lazy-loaded), actions, selection, shortcuts
  infrastructure/mail/mock/  stateful MockMailService + deterministic seed
  platform/       PlatformService, browser/tauri adapters, menuActions, hostChrome, accentDebug
  styles/         tokens.css, index.css (Tailwind mappings), mail/ (component styles), host.css
tests/            integration tests (full app against the mock)  tests-visual/ Playwright baselines
scripts/          screenshots, a11y audit, capture-states, measure-host.sh
src-tauri/        Tauri host (Rust), sibling of the Vite app like `create-tauri-app`
.github/workflows/ frontend.yml, tauri.yml, update-visual-baselines.yml
docs/             architecture.md, host-decision.md, mac-test-runbook.md, previews/
```

## Conventions

- TypeScript strict; prettier (single quotes, width 100). Design tokens live in `src/styles/tokens.css`; Tailwind v4 mappings live in `src/styles/index.css`; use semantic
  colour classes (`bg-sidebar`, `text-muted`), never hard-coded hex in components.
- Accessibility: a listbox option must not contain nested controls. The row avatar-checkbox and star are pointer-only
  (`aria-hidden`, not focusable); keyboard/AT use Space, `S`, the toolbar and the context menu. Filter tabs and the
  appearance radiogroup use roving tabindex. Re-run `npm run a11y` after UI/style changes.
- Keyboard shortcuts are plain keys only (no ⌘-combos that macOS owns), ignored while typing. See `shortcuts.ts`.
- Tests must be deterministic: latency `0`, failures injected through `failNext()`/`setOffline()`, never random.
- Test with real behaviour (Testing Library queries by role/name), not implementation details.

## Trello workflow

Board: **Zusteller** — https://trello.com/b/LJT3FtfE/zusteller (lists: Ideas · Backlog · Next up · In progress · Playtest / Review · Done).

- Check the board before starting work; don't create duplicate cards.
- Cards: `P<phase>-<nn> Title`, description with **Acceptance** criteria. Keep them small.
- Move cards as work proceeds (Next up → In progress → Playtest / Review → Done). Comment on the card with what shipped
  (commit hash) or why it is blocked.
- Record ideas (Ideas), technical decisions and discovered bugs as cards or card comments — not in local notes.

## Git policy

- Work on the assigned feature branch. Commit completed, validated work in focused
  commits. Integration into and pushing to `main` are allowed after finishing work,
  using `git merge --ff-only`. Rebase unpublished task commits onto current main
  when needed; never create merge commits, including through `git pull`.
- Preserve unrelated changes and stage only intended files. Do not rewrite
  published history or force-push without explicit authorization.
- Commit identity: author/committer **Paul Onutor <paul@onutor.de>** (`git config user.name/user.email` in the repo).
  Keep the `Co-Authored-By: Claude ... <noreply@anthropic.com>` trailer when Claude
  contributed. Other agents follow their own attribution conventions; never
  attribute work to an agent that did not contribute. Do not add a `Claude-Session:` line.
  Check `git log --format='%an <%ae>'` before pushing; no other author identity.
- Rewriting published history requires Paul's explicit request. Take a backup tag before an authorized force-push.
- Small, descriptive commits. Never commit `node_modules`, `dist`, ad-hoc screenshots or secrets (exception: the visual-regression baselines in `tests-visual/__screenshots__`, and curated `docs/previews`).

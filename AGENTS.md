# AGENTS.md — zusteller

Instructions for coding agents (and humans) working in this repo.

**zusteller** is a lightweight macOS-first mail client: Gmail's workflow and density, Apple Mail's restraint.
The product/engineering plan lives in `zusteller-plan.md` (original spec) and `docs/architecture.md` (what is built).
**The plan describes intent; Trello tracks execution.** Never use Markdown/TODO files as the source of truth for progress.

## Communication style

- Be concise: short, scannable answers with minimal prose, easy to read and react to.
- When a decision is needed, ask **one** question with a few options and a clear recommendation (marked first).

## Current state

Phase 1 (shared mock mail reader) is implemented in `frontend/`. Phase 2 (Wails/Tauri hosts), 3 (Gmail), 4 (compose/send)
and 5 (Apple on-device AI) are **not started** — do not implement them without an explicit request.
V1 explicitly excludes: OAuth, network calls, compose/reply/forward/drafts/send, AI, background sync.

## Commands (run from `frontend/`)

| Task | Command |
|---|---|
| Install | `npm install` |
| Dev server (browser mode) | `npm run dev` → http://localhost:5173 (`?latency=0`, `?offline=1` flags) |
| Typecheck / lint / test | `npm run typecheck` · `npm run lint` · `npm test` |
| Production build | `npm run build` |
| Screenshots (needs dev server) | `CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/screenshots.mjs http://localhost:5173 screenshots` |

Before every push: typecheck, lint, tests and build must all pass. Look at screenshots for any visual change.

## Architecture rules (non-negotiable)

1. **One shared frontend** (`frontend/`) for both future hosts. Never fork or copy UI code into a host.
2. React feature code **must not import** `@tauri-apps/*`, Wails bindings, provider SDKs or native APIs. ESLint enforces this
   (`no-restricted-imports`); features also may not import `@/infrastructure/*` — they use `MailService` from context.
3. Host/native behaviour goes behind typed adapters (`src/platform`, `src/infrastructure/mail/*`). Don't add placeholder
   methods that look functional.
4. `MockMailService` → `GmailMailService` must be a one-line swap in `src/app/createServices.ts`; no feature component may change.
5. Toolbar, context menu and keyboard shortcuts share **one** action layer (`features/mail/actions.ts` +
   `useMailActions.ts` + `useThreadActions.ts`). Don't duplicate mutation logic in components.
6. Untrusted email HTML only renders through `features/mail/reader/safe-html` (DOMPurify + sandboxed iframe with
   `sandbox="allow-same-origin"` only + CSP). **Never add `allow-scripts`** to that iframe.
7. Thread semantics (archive/trash/restore, derived flags) are documented in `src/domain/mail/semantics.ts` and covered by
   `MockMailService.test.ts`. Change both together.
8. State: TanStack Query for async data; React state for selection/focus/pane widths. No Redux.

## Visual skin

Skin **B2** is the default in light and dark ("Gmail-in-glass": Tahoe-style floating panes, title + search together, All/Unread/Starred tabs).
`?skin=a|b|c|default` switches skins (A and C are dark-only); `?theme=dark` forces dark. Styles live in `frontend/src/styles/skins.css`.

## Layout

```
frontend/src/
  app/            composition root, providers (services, theme, toast)
  components/ui/  small shadcn-style primitives (Button, Menu, Checkbox, Resizer)
  domain/mail/    provider-neutral types, MailService contract, query keys
  features/mail/  sidebar/ list/ reader/ (+ safe-html/), actions, selection, shortcuts
  infrastructure/mail/mock/  stateful MockMailService + deterministic seed
  platform/       PlatformService + browser implementation
frontend/tests/   integration tests (full app against the mock)
docs/             architecture.md (host-comparison.md arrives with Phase 2)
```

## Conventions

- TypeScript strict; prettier (single quotes, width 100). Tailwind v4 tokens live in `src/styles/index.css`; use semantic
  colour classes (`bg-sidebar`, `text-muted`), never hard-coded hex in components.
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

- Work on the assigned feature branch; pushing to `main` is allowed after finishing work, **fast-forward only** —
  no merge commits (`git merge --ff-only`, or rebase onto `origin/main` first).
- Small, descriptive commits. Never commit `node_modules`, `dist`, screenshots or secrets.

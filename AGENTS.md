# AGENTS.md — zusteller

Instructions for coding agents (and humans) working in this repo.

**zusteller** is a lightweight macOS-first mail client: Gmail's workflow and density, Apple Mail's restraint.
The product/engineering plan lives in `zusteller-plan.md` (original spec) and `docs/architecture.md` (what is built).
**The plan describes intent; Trello tracks execution.** Never use Markdown/TODO files as the source of truth for progress.

## Communication style

- Be concise: short, scannable answers with minimal prose, easy to read and react to.
- When a decision is needed, ask **one** question with a few options and a clear recommendation (marked first).

## Current state

- **Phase 1** (shared mock mail reader) is implemented in `frontend/`.
- **Phase 2** hosts exist: `hosts/wails` (Go, Wails v3 beta.28) and `hosts/tauri` (Rust, Tauri 2.12), wired through `src/platform`
  (menus, notifications, badge, external links, window theme). Vibrancy is the default in both; opaque variants exist. Written and
  checked on Linux only (CI compiles them); **nothing native is verified on a Mac**. Decision rule: if Wails vibrancy doesn't work, commit to Tauri.
- **Phase 3** (Gmail), **4** (compose/send) and **5** (Apple on-device AI) are **not started** — do not implement them without an explicit request.
- V1 explicitly excludes: OAuth, network calls, compose/reply/forward/drafts/send, AI, background sync.

## Commands

Frontend (run from `frontend/`):

| Task | Command |
|---|---|
| Install | `npm install` |
| Dev server (browser mode) | `npm run dev` → http://localhost:5173 (`?latency=0`, `?offline=1`, `?skin=`, `?theme=dark`, `?debug=accent`) |
| Typecheck / lint / test | `npm run typecheck` · `npm run lint` · `npm test` (also `npm run test:watch`, `npm run format`) |
| Production build | `npm run build` (typecheck + vite) |
| Accessibility audit (needs dev server) | `npm run a11y` (axe via Playwright over many states, light/dark, host+vibrancy, `?seed=big`; `CHROMIUM_PATH=...`, `A11Y_VERBOSE=1`; non-zero exit on violations; known design-token findings are listed, not failing). Structure/ARIA also asserted in `tests/a11y.test.tsx` |
| Visual regression | `npm run test:visual` (Playwright `toHaveScreenshot`, baselines in `frontend/tests-visual/__screenshots__/`, starts its own dev server on :5304, clock frozen to the seed's now). After an intentional visual change run `npm run test:visual:update`, LOOK at the changed PNGs, commit them. Baselines are `-linux`; regenerate on the CI runner via the manual `update-visual-baselines` workflow if fonts differ |
| Screenshots (needs dev server) | `CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/screenshots.mjs http://localhost:5173 screenshots` |

Hosts (macOS; details in each `hosts/*/README.md`):

| Task | Command |
|---|---|
| Wails (from `hosts/wails/`; Go ≥ 1.25 + Task) | `task dev:vite` then `task dev` · `task dev:glass` · `task dev:opaque` · `task build` · `task test` · `task vet` |
| Tauri (from `hosts/tauri/`) | `npm install`, then `npm run dev` · `dev:opaque` · `build` · `build:opaque` · `check` (cargo check) |

CI (`.github/workflows/`): `frontend.yml` runs typecheck, lint, test and build (job `check`) plus visual regression (job `visual`) on every push/PR; `update-visual-baselines.yml` (manual) regenerates baselines and uploads them as an artifact (never auto-commits); `hosts.yml` runs Wails vet/build/test and
Tauri `cargo check` when `hosts/**` or `frontend/src/platform/**` change.

Before every push: typecheck, lint, tests and build must all pass. Look at screenshots for any visual change.

## Architecture rules (non-negotiable)

1. **One shared frontend** (`frontend/`) for both future hosts. Never fork or copy UI code into a host.
2. React feature code **must not import** `@tauri-apps/*`, Wails bindings, provider SDKs or native APIs. ESLint enforces this
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

## Visual skin

Skin **B2** is the default in light and dark ("Gmail-in-glass": Tahoe-style floating panes, title + search together, All/Unread/Starred tabs).
`?skin=a|b|c|default` switches skins (A and C are opt-in, dark-only); `?theme=dark` forces dark. Styles live in `frontend/src/styles/skins.css`.

- Rows show a sender avatar (initials); it turns into the round selection checkbox only when hovering the avatar itself (enlarged hit
  area) or on keyboard focus, and every row shows checkboxes once the user multi-selects. Star shows only when starred or on hover.
- Selection uses the macOS accent (`-apple-system-control-accent`, else `AccentColor`, else fixed blue; `@supports`-guarded) while list
  and window are active, gray otherwise (`data-window-inactive`). Text on the accent is always white. Debug with `?debug=accent`.
- Filter tabs are client-side over loaded rows; selected rows stay visible.
- Native hosts: `?vibrancy=1` → `data-vibrancy` makes backdrop/gutters/sidebar transparent; `data-host` insets headers for traffic lights.

## Layout

```
frontend/src/
  app/            composition root (createServices), providers (services, theme, toast), skin.ts
  components/ui/  small shadcn-style primitives (Button, Menu, Checkbox, Resizer)
  domain/mail/    provider-neutral types, MailService contract (incl. getMailboxCounts), semantics, query keys
  features/mail/  sidebar/ list/ reader/ (+ safe-html/, lazy-loaded), actions, selection, shortcuts
  infrastructure/mail/mock/  stateful MockMailService + deterministic seed
  platform/       PlatformService, browser/wails/tauri adapters, menuActions, hostChrome, accentDebug
  styles/         index.css (tokens), skins.css (skins, accent, vibrancy)
frontend/tests/   integration tests (full app against the mock)
frontend/scripts/ screenshots.mjs
hosts/wails/      Go host (Taskfile.yml, internal/platform)     hosts/tauri/  Rust host (src-tauri)
.github/workflows/ frontend.yml, hosts.yml
docs/             architecture.md, host-comparison.md, previews/
```

## Conventions

- TypeScript strict; prettier (single quotes, width 100). Tailwind v4 tokens live in `src/styles/index.css`; use semantic
  colour classes (`bg-sidebar`, `text-muted`), never hard-coded hex in components.
- Accessibility: a listbox option must not contain nested controls. The row avatar-checkbox and star are pointer-only
  (`aria-hidden`, not focusable); keyboard/AT use Space, `S`, the toolbar and the context menu. Filter tabs and the
  appearance radiogroup use roving tabindex. Re-run `npm run a11y` after UI/skin changes.
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
- Commit identity: author/committer **Paul Onutor <paul@onutor.de>** (`git config user.name/user.email` in the repo).
  Keep the `Co-Authored-By: Claude ... <noreply@anthropic.com>` trailer; do **not** add a `Claude-Session:` line.
  Check `git log --format='%an <%ae>'` before pushing; no other author identity.
- History is only rewritten when Paul explicitly asks (it needs a force-push; take a backup tag first).
- Small, descriptive commits. Never commit `node_modules`, `dist`, screenshots or secrets.

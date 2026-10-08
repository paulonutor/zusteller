# zusteller

A lightweight, desktop-first macOS mail client: Gmail's workflow and information density with Apple Mail's native feel.

**Status: Phase 1 (shared mock mail reader) done; Phase 2 (Tauri host) running on a Mac.**
A three-pane reader (browse, search, filter, select, archive, trash, restore, star, read/unread, labels) running against a mutable
in-memory mock, in the browser or in a native macOS window with vibrancy. No Gmail, OAuth, compose or sending yet.

```bash
npm install
npm run dev        # http://localhost:47831  (?latency=0, ?offline=1, ?skin=a|b|c|default, ?theme=dark)
npm run typecheck && npm run lint && npm test
npm run build
```

Desktop app (macOS): `npm run tauri dev` (needs Rust; see `docs/tauri-host.md`). `src-tauri/` wraps this same frontend and follows the
`create-tauri-app` layout; vibrancy is on by default, `npm run tauri:dev:opaque` gives a plain window.

See `AGENTS.md` for contributor/agent rules, `docs/architecture.md` for the design, `docs/host-decision.md` for why Tauri,
and `zusteller-plan.md` for the roadmap.

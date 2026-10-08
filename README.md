# zusteller

A lightweight, desktop-first macOS mail client: Gmail's workflow and information density with Apple Mail's native feel.

**Status: Phase 1 (shared mock mail reader) done; Phase 2 (Wails and Tauri hosts) scaffolded, unverified on a Mac.**
A three-pane reader (browse, search, filter, select, archive, trash, restore, star, read/unread, labels) running against a mutable
in-memory mock, in the browser or in a native macOS window with vibrancy. No Gmail, OAuth, compose or sending yet.

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173  (?latency=0, ?offline=1, ?skin=a|b|c|default, ?theme=dark)
npm run typecheck && npm run lint && npm test
npm run build
```

Desktop hosts (macOS): `hosts/wails/README.md` (`task dev:vite` + `task dev`) and `hosts/tauri/README.md` (`npm run dev`).
Both load the same `frontend/`; vibrancy is on by default, `dev:opaque` gives a plain window.

See `AGENTS.md` for contributor/agent rules, `docs/architecture.md` for the design, `docs/host-comparison.md` for Wails vs Tauri,
and `zusteller-plan.md` for the roadmap.

# zusteller

A lightweight, desktop-first macOS mail client: Gmail's workflow and information density with Apple Mail's native feel.

**Status: Phase 1 — shared mock mail reader.** A fully working three-pane reader (browse, search, select, archive, trash,
restore, star, read/unread, labels) running against a mutable in-memory mock. No Gmail, OAuth, compose or sending yet.

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration tests
npm run build
```

See `AGENTS.md` for contributor/agent rules, `docs/architecture.md` for the design, and `zusteller-plan.md` for the roadmap
(Phase 2 adds Wails and Tauri hosts around this same frontend).

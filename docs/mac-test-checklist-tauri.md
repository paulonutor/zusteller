# Mac test checklist: Tauri only (remaining items)

For a local Claude desktop session with computer use. Setup and run commands: `docs/mac-test-runbook.md` §1–2 (Tauri parts only).
Wails is dropped. Record results as Trello comments on the "Test on Mac" card. Do not change source, push or commit screenshots.

**Already verified by Paul, skip:** dark mode / theme mismatch, accent colour (live update + inactive gray), traffic lights, vibrancy.

Run each item on `npm run dev` (vibrancy) unless noted. Mark PASS / FAIL / N/A + one-line observation.

## A. Window and launch
1. Launches to the mock inbox with no blank/white window; a thread opens in the reader.
2. Window drag: dragging the title/search strip moves the window (needs `data-tauri-drag-region`; likely FAIL until added).
   Double-click on the strip zooms/restores. Clicking inputs/buttons does not drag.
3. Fullscreen enter/exit, minimum size 900x600, minimize/restore, move between displays (if available): no layout glitches.
4. Opaque variant (`npm run dev:opaque`): no see-through anywhere. Reduce Transparency on (System Settings > Accessibility >
   Display) degrades sanely in the vibrancy variant.
5. Release build (`npm run build`, open the `.app`): no white/solid background where dev was transparent.

## B. Native menus
6. App/Edit/Mail/View/Window menus render with the expected items.
7. With a thread selected: Archive, Move to Trash, Mark Read, Mark Unread, Star, Find each do the same as their shortcut.
   Find (Cmd+F) focuses search. With nothing selected, mail items are ignored without error.
8. Cmd+C/V/A/Z work in the search field. Plain-key shortcuts work in the list, are ignored while typing in search and
   while a menu is open.

## C. System integration (release `.app` needed for 10–11)
9. `mailto:` link opens the default mail app; `https:` opens the default browser; `file:`, `javascript:`, `ftp:` are refused.
10. Dock badge: `await window.__TAURI__.core.invoke('set_badge', { count: 3 })` shows 3; count 0 / null clears it.
11. Notification: `invoke('notify', { title: 'Hi', body: 'Test' })` prompts for permission on first use, shows a banner,
    "zusteller" appears in System Settings > Notifications. (In `tauri dev` it is attributed to the terminal.)

## D. Reader / WKWebView
12. Reader iframe renders sanitized HTML; remote images are not loaded; CSP breaks neither Vite HMR (dev) nor the release app.
13. Safe-HTML payload spot check (open any mock message with scripts/forms, or temporarily inject): no script runs, links
    never navigate the app frame.

## E. Real input (new; Playwright cannot do these)
14. Trackpad: two-finger scroll with momentum in list and reader; no jumps; selected row stays visible when scrolling far.
15. Pane resizer: drag past min/max clamps; width persists after relaunch; double-click resets (if implemented).
16. Keyboard: `/`, `e`, `#`, `s`, Shift+I/U/Z, arrows, Enter, Esc, Space. Repeat with a non-US layout (e.g. German: `#` is
    a different key) and with Caps Lock on. Held key does not repeat destructive actions.
17. IME: with Japanese/Chinese input, composing in search does not trigger a search or shortcut mid-composition.
18. Focus: after archive/trash/menu close, keyboard focus is never lost to the page body; Tab order sidebar > search > tabs >
    list > reader; shortcuts ignored while focus is in the reader iframe.
19. Context menu (right-click): opens at the pointer, stays on screen at window edges, closes on Esc/outside click/scroll/resize.
    On an unselected row it acts on that row; inside a multi-selection it acts on all.
20. Rapid input: double-click archive/star; hold arrow-down; mash `e`. No double actions, no errors.
21. Label drag (only if implemented by then): drag a thread onto a sidebar label with the real pointer; cancel with Esc.

## F. Performance
22. `?seed=big` (5000 threads): scrolling stays smooth, no visible jank; Activity Monitor shows sane CPU/RAM after 30 s idle.
23. Run `scripts/measure-host.sh` (Tauri rows) and paste the table into `docs/host-comparison.md`.

## Screenshots (save outside the repo, e.g. ~/Desktop/zusteller-tests/)
Menus open (Mail), notification banner, Dock badge, window-drag result, `?seed=big` scroll, release `.app` first launch.

## Prompt for the local session

```text
Test the zusteller Tauri host on this Mac. Read AGENTS.md and docs/mac-test-runbook.md (§1–2 only for setup), then
docs/mac-test-checklist-tauri.md. Skip anything marked already verified. Do not change source, commit or push.
Run items in order (dev first, release build for 5, 10, 11), use computer use for screenshots and real input. Report a table
item x PASS/FAIL/N/A with one short observation, screenshot paths, and verbatim errors. Post the result as a comment on the
Trello "Test on Mac" card. Stop and ask if a step needs a password or Apple ID.
```

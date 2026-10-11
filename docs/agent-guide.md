# Zusteller development checks

Detailed command prerequisites and visual-verification workflow.

## Install

`npm install`

## Dev server (browser mode)

`npm run dev` → http://localhost:47831 (static port, shared with `tauri dev`; `?latency=0`, `?offline=1`, `?theme=dark`, `?debug=accent`)

## Typecheck / lint / test

`npm run typecheck` · `npm run lint` · `npm test` (also `npm run test:watch`, `npm run format`)

## Production build

`npm run build` (typecheck + vite)

## Accessibility audit (needs dev server)

`npm run a11y` (axe via Playwright over many states, light/dark, host+vibrancy, `?seed=big`; `CHROMIUM_PATH=...`, `A11Y_VERBOSE=1`; non-zero exit on violations; known design-token findings are listed, not failing). Audits app controls and iframe titles, not scripts-disabled email bodies. Structure/ARIA also asserted in `tests/a11y.test.tsx`

## Visual regression

`npm run test:visual` (Playwright `toHaveScreenshot`, baselines in `tests-visual/__screenshots__/`, starts its own dev server on :5304, clock frozen to the seed's now). After an intentional visual change run `npm run test:visual:update`, LOOK at the changed PNGs, commit them. Baselines are `-linux`; the tests pin the UI font (`tests-visual/fixtures.ts`, Inter from `@fontsource-variable/inter`, test-only) so local Linux runs match CI. From a Mac use `npm run test:visual:docker` / `npm run test:visual:docker:update` (Playwright image, linux/amd64, needs Docker); everything but the email-iframe text matches CI exactly, which is why the HTML-mail shots allow 1.2% difference. If baselines still differ, run the manual `update-visual-baselines` workflow: it opens a PR with the regenerated PNGs

## Screenshots (needs dev server)

`CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/screenshots.mjs http://localhost:47831 screenshots`

## Desktop app (Tauri)

`npm run tauri dev` (vibrancy; `npm run tauri:dev:opaque` for a plain window). Needs Rust; see `docs/tauri-host.md`

## Tauri `.app` for UI automation

`npm run tauri build -- --debug --bundles app`, then `open` the `.app` path the build prints (`<cargo target dir>/debug/bundle/macos/zusteller.app`; the target dir is `src-tauri/target` unless `build.target-dir` is set in `~/.cargo/config.toml`, as on Paul's machine). A `tauri dev` binary is attributed to the launching app and cannot be driven by computer use

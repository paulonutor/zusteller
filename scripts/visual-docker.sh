#!/usr/bin/env bash
# Runs the Playwright visual tests inside the official Playwright image (Linux, x86_64 like the CI
# runner) so the `-linux` baselines can be checked or regenerated from a Mac.
#   npm run test:visual:docker                  compare against the committed baselines
#   npm run test:visual:docker -- --update-snapshots   regenerate them (LOOK at the PNGs, then commit)
# Extra arguments go to `playwright test`. Needs Docker (OrbStack/Docker Desktop).
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('@playwright/test/package.json').version")
image="mcr.microsoft.com/playwright:v${version}-noble"

# Linux node_modules and the npm cache live in named volumes, so the macOS ones stay untouched and
# repeat runs skip most of `npm ci`. Snapshots are written straight into the mounted repo.
exec docker run --rm --platform linux/amd64 --ipc=host \
  -v "$PWD":/work \
  -v zusteller-visual-node-modules:/work/node_modules \
  -v zusteller-visual-npm-cache:/root/.npm \
  -w /work \
  "$image" \
  bash -c 'npm ci --no-audit --no-fund --loglevel=error && npx playwright test "$@"' _ "$@"

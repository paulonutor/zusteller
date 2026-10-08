#!/usr/bin/env bash
# Measure build time, size, cold start and idle RAM of both zusteller hosts (macOS only).
# Usage: scripts/measure-host.sh [tauri|wails|all]   (default: all)
# Output: a markdown table on stdout; progress and errors on stderr.
# Env: IDLE_SECS (default 30), START_TIMEOUT (default 30), SKIP_BUILD=1 reuses existing builds.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "measure-host.sh: macOS only (detected $(uname -s)); run it on your Mac." >&2
  exit 1
fi

which_host="${1:-all}"
case "$which_host" in tauri | wails | all) ;; *)
  echo "usage: $0 [tauri|wails|all]" >&2
  exit 2
  ;;
esac

IDLE_SECS="${IDLE_SECS:-30}"
START_TIMEOUT="${START_TIMEOUT:-30}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

need() {
  command -v "$1" > /dev/null 2>&1 || {
    echo "missing tool '$1': $2" >&2
    exit 1
  }
}

log() { echo "[measure] $*" >&2; }
now() { python3 -c 'import time; print(time.time())'; }
secs_since() { python3 -c "import time; print(f'{time.time() - $1:.1f}')"; }
human() { du -sh "$1" 2> /dev/null | cut -f1; }

need python3 "install Xcode Command Line Tools (xcode-select --install)"
need ps "unexpected"

# Sum RSS (MB) of a process tree: root pid and all descendants, plus any WebKit WebContent/Networking
# processes (macOS WKWebView runs them outside the app's tree).
rss_mb() {
  local root_pid="$1" pids
  pids="$(descendants "$root_pid")"
  local total=0 kb p
  for p in $pids; do
    kb="$(ps -o rss= -p "$p" 2> /dev/null | tr -d ' ' || true)"
    total=$((total + ${kb:-0}))
  done
  # WebKit helpers: only counted when launched for this app (single test app running assumed).
  while read -r kb; do
    total=$((total + kb))
  done < <(ps -axo rss=,command= | awk '/com\.apple\.WebKit\.(WebContent|Networking)/ && !/awk/ {print $1}')
  echo $((total / 1024))
}

descendants() {
  local pid="$1" child
  echo "$pid"
  for child in $(pgrep -P "$pid" 2> /dev/null || true); do
    descendants "$child"
  done
}

# Wait until process $1 (command-name pattern) owns a window; echo seconds, or "n/a".
wait_for_window() {
  local pattern="$1" t0="$2" win
  while (($(python3 -c "import time; print(int(time.time() - $t0 > $START_TIMEOUT))") == 0)); do
    win="$(osascript -e "tell application \"System Events\" to count windows of (first process whose name is \"$pattern\")" 2> /dev/null || true)"
    if [[ "${win:-0}" =~ ^[0-9]+$ ]] && ((win > 0)); then
      secs_since "$t0"
      return 0
    fi
    sleep 0.1
  done
  echo "n/a"
}

BUILD_T_TAURI="skipped" BUILD_T_WAILS="skipped"
SIZE_TAURI="n/a" SIZE_WAILS="n/a"
START_TAURI="n/a" START_WAILS="n/a"
RAM_TAURI="n/a" RAM_WAILS="n/a"

measure_tauri() {
  need cargo "install Rust: https://rustup.rs"
  need npm "brew install node"
  local dir="$ROOT/hosts/tauri" app bin
  app="$dir/src-tauri/target/release/bundle/macos/zusteller.app"
  if [[ "${SKIP_BUILD:-0}" != 1 ]]; then
    log "Tauri: npm install + build (release)"
    (cd "$ROOT/frontend" && npm install > /dev/null)
    (cd "$dir" && npm install > /dev/null)
    local t0
    t0="$(now)"
    (cd "$dir" && npm run build >&2)
    BUILD_T_TAURI="$(secs_since "$t0")s"
  fi
  [[ -d "$app" ]] || {
    echo "Tauri: $app not found (build failed, or run without SKIP_BUILD)" >&2
    return 1
  }
  SIZE_TAURI="$(human "$app") (.app)"
  bin="$app/Contents/MacOS/zusteller"
  log "Tauri: cold start + idle RAM"
  pkill -x zusteller 2> /dev/null || true
  sudo -n purge 2> /dev/null || log "(no passwordless sudo: skipping 'purge', start is warm-disk)"
  local t0 pid
  t0="$(now)"
  open -n "$app"
  START_TAURI="$(wait_for_window zusteller "$t0")s"
  pid="$(pgrep -nx "$(basename "$bin")" || true)"
  if [[ -n "$pid" ]]; then
    sleep "$IDLE_SECS"
    RAM_TAURI="$(rss_mb "$pid") MB"
    kill "$pid" 2> /dev/null || true
  fi
}

measure_wails() {
  need go "brew install go"
  need task "brew install go-task"
  need npm "brew install node"
  local dir="$ROOT/hosts/wails" bin
  bin="$dir/bin/zusteller"
  if [[ "${SKIP_BUILD:-0}" != 1 ]]; then
    log "Wails: npm install + task build"
    (cd "$ROOT/frontend" && npm install > /dev/null)
    local t0
    t0="$(now)"
    (cd "$dir" && task build >&2)
    BUILD_T_WAILS="$(secs_since "$t0")s"
  fi
  [[ -x "$bin" ]] || {
    echo "Wails: $bin not found (build failed, or run without SKIP_BUILD)" >&2
    return 1
  }
  SIZE_WAILS="$(human "$bin") (bare binary, no .app yet)"
  log "Wails: cold start + idle RAM"
  pkill -x zusteller 2> /dev/null || true
  sudo -n purge 2> /dev/null || log "(no passwordless sudo: skipping 'purge')"
  local t0 pid
  t0="$(now)"
  "$bin" > /dev/null 2>&1 &
  pid=$!
  START_WAILS="$(wait_for_window zusteller "$t0")s"
  if kill -0 "$pid" 2> /dev/null; then
    sleep "$IDLE_SECS"
    RAM_WAILS="$(rss_mb "$pid") MB"
    kill "$pid" 2> /dev/null || true
  fi
}

# Failures in one host must not hide the other host's numbers.
if [[ "$which_host" != wails ]]; then measure_tauri || log "Tauri measurement failed"; fi
if [[ "$which_host" != tauri ]]; then measure_wails || log "Wails measurement failed"; fi

cat << EOF

Measured $(date +%Y-%m-%d) on macOS $(sw_vers -productVersion), $(uname -m); idle RAM after ${IDLE_SECS}s, release builds, mock data.
Cold start = launch to first window (osascript polling, ~0.1 s resolution), not first paint of the list.
Idle RAM = RSS of the app process tree plus all system WebKit WebContent/Networking processes (upper bound if other
WebKit apps, e.g. Safari, are running: quit them first).

| Metric | Wails v3 beta.28 | Tauri 2.12 |
|---|---|---|
| Build time (clean-ish, incl. frontend) | ${BUILD_T_WAILS} | ${BUILD_T_TAURI} |
| Bundle size | ${SIZE_WAILS} | ${SIZE_TAURI} |
| Cold startup (first window) | ${START_WAILS} | ${START_TAURI} |
| Idle RAM (${IDLE_SECS}s) | ${RAM_WAILS} | ${RAM_TAURI} |
EOF

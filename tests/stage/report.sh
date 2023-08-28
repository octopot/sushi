#!/bin/bash
# The window of Report a problem in the real app, without disturbing work on this Mac: the stage
# build (me.octopot.sushi.stage) with SUSHI_STAGE_WINDOW=report puts the window under the desktop
# wallpaper, takes no focus or mouse, and uses only its own profile, which this script removes.
#
#   tests/stage/report.sh [<output-dir>]
#
# 1. An end-to-end run: tests/stage/report.js drives the real page through the real commands, to
#    the report's text; the panel's page, hidden, answers for the snapshot. No access needed.
# 2. With <output-dir>: frames of the real window, dark and light, which need Screen Recording
#    access for the terminal. Without it the script says so and skips them.
# Exits non-zero when a check fails. It rebuilds src-tauri/target/release/sushi as the stage
# bundle: run `npm run bundle` afterwards for the regular one.
set -uo pipefail
cd "$(dirname "$0")/../.."
out="${1:-}"
work="$(mktemp -d)"
profile="$HOME/Library/Application Support/me.octopot.sushi.stage"
pid=
wipe() {
  rm -rf "$profile" "$HOME/Library/WebKit/me.octopot.sushi.stage" "$HOME/Library/Caches/me.octopot.sushi.stage" \
    "$HOME/Library/Logs/me.octopot.sushi.stage"
}
stop() {
  [[ -n "$pid" ]] || return 0
  kill -TERM "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  pid=
}
cleanup() { stop; rm -rf "$work"; wipe; }
trap cleanup EXIT

echo "Building the stage bundle…"
npx tauri build --bundles app \
  --config '{"identifier":"me.octopot.sushi.stage","productName":"Sushi Stage"}' </dev/null >"$work/build.log" 2>&1 ||
  { tail -20 "$work/build.log" >&2; exit 1; }
app="src-tauri/target/release/bundle/macos/Sushi Stage.app/Contents/MacOS/sushi"
mkdir -p "$work/library"

# run <frame> <log> <env...>: starts the stage app with the script; waits for DONE or READY.
run() {
  local frame="$1" log="$2"
  shift 2
  { echo "const FRAME = '$frame';"; cat tests/stage/report.js; } >"$work/script.js"
  : >"$log"
  env SUSHI_STAGE=1 SUSHI_STAGE_WINDOW=report SUSHI_STAGE_SCRIPT="$work/script.js" SUSHI_LIBRARY_DIR="$work/library" "$@" \
    "$app" >"$log" 2>"$log.err" &
  pid=$!
  for _ in $(seq 1 300); do
    grep -qE '^(DONE|READY )' "$log" && return 0
    kill -0 "$pid" 2>/dev/null || break
    perl -e 'select(undef, undef, undef, 0.1)'
  done
  echo "The run did not finish. $(tail -3 "$log.err")" >&2
  return 1
}

echo "End to end, in the stage profile:"
wipe
failures=0
run '' "$work/e2e.out" || failures=1
stop
grep '^CHECK ' "$work/e2e.out" | sed 's/^CHECK //'
checks="$(grep -c '^CHECK ' "$work/e2e.out")"
failed="$(grep -c '^CHECK FAIL' "$work/e2e.out")"
failures=$((failures + failed))
[[ "$checks" -gt 0 ]] || { echo "FAIL no check ran"; failures=$((failures + 1)); }

if [[ -n "$out" ]]; then
  mkdir -p "$out"
  out="$(cd "$out" && pwd -P)"
  swiftc -O tests/stage/stagecap.swift -o "$work/stagecap" || exit 1
  printf 'import CoreGraphics\nexit(CGPreflightScreenCaptureAccess() ? 0 : 2)\n' >"$work/access.swift"
  swiftc "$work/access.swift" -o "$work/access" || exit 1
  if "$work/access"; then
    for frame in recording report; do
      for appearance in dark light; do
        wipe
        if run "$frame" "$work/frame.out" SUSHI_STAGE_APPEARANCE="$appearance"; then
          window="$(sed -n 's/^SUSHI_STAGE_WINDOW=//p' "$work/frame.out")"
          backdrop="$(sed -n 's/^SUSHI_STAGE_BACKDROP_WINDOW=//p' "$work/frame.out")"
          if "$work/stagecap" "$out/report-$frame-$appearance.png" 40 "$window" "$backdrop" >/dev/null; then
            echo "frame report-$frame-$appearance.png"
          else
            echo "FAIL frame $frame-$appearance: stagecap failed"; failures=$((failures + 1))
          fi
        else
          echo "FAIL frame $frame-$appearance: the page did not get there"; failures=$((failures + 1))
        fi
        stop
      done
    done
  else
    echo "Frames skipped: the terminal has no Screen Recording access."
  fi
fi

echo "$checks checks, $failures failed."
[[ "$failures" -eq 0 ]]

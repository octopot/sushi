#!/bin/bash
# Captures the real Susi window on Liquid Glass without disturbing work on this Mac.
# A separate build, me.octopot.susi.stage, puts the window under the desktop wallpaper: it is not visible,
# takes no focus or mouse, and creates neither the hotkey nor the menu bar icon.
# The terminal needs Screen Recording access. Without it the capture ends and no access prompt is shown.
set -euo pipefail
cd "$(dirname "$0")/../.."
out="${1:?usage: tests/stage/capture.sh <output-dir> [frame ...]}"
shift
frames=("$@")
[[ ${#frames[@]} -gt 0 ]] || frames=(01-empty 02-editor 03-action 04-diff 05-library 07-dictionary 13-library-all)
mkdir -p "$out"
out="$(cd "$out" && pwd -P)"
work="$(mktemp -d)"
profile="$HOME/Library/Application Support/me.octopot.susi.stage"
cleanup() {
  rm -rf "$work" "$profile" "$HOME/Library/WebKit/me.octopot.susi.stage" "$HOME/Library/Caches/me.octopot.susi.stage"
}
trap cleanup EXIT

npx tauri build --bundles app \
  --config '{"identifier":"me.octopot.susi.stage","productName":"Susi Stage"}' </dev/null >"$work/build.log" 2>&1 ||
  { tail -20 "$work/build.log" >&2; exit 1; }
app="src-tauri/target/release/bundle/macos/Susi Stage.app/Contents/MacOS/susi"
swiftc -O tests/stage/stagecap.swift -o "$work/stagecap"

mkdir -p "$work/library" "$profile"
for entry in "Refactor settings store:-2H" "Release notes 2.4:-1d" "Flaky login test:-3d" "Review onboarding copy:-7d" "Dark mode toggle:-30d"; do
  name="${entry%%:*}"
  printf '# %s\n\nSynthetic prompt for screenshots.\n' "$name" >"$work/library/$name.md"
  touch -t "$(date -v"${entry##*:}" +%Y%m%d%H%M)" "$work/library/$name.md"
done
cat >"$profile/dictionary.json" <<'JSON'
{"terms": [
  {"from": "Mac Whisper", "to": "MacWhisper"},
  {"from": "type script", "to": "TypeScript"},
  {"from": "git hub", "to": "GitHub"},
  {"from": "release please", "to": "release-please"}
]}
JSON

for frame in "${frames[@]}"; do
  { echo "const FRAME = '$frame';"; cat tests/stage/frames.js; } >"$work/frame.js"
  : >"$work/stage.out"
  SUSI_STAGE=1 SUSI_LIBRARY_DIR="$work/library" SUSI_STAGE_SCRIPT="$work/frame.js" "$app" >"$work/stage.out" 2>"$work/stage.err" &
  pid=$!
  for _ in $(seq 1 60); do
    grep -q BACKDROP "$work/stage.out" && break
    kill -0 "$pid" 2>/dev/null || break
    perl -e 'select(undef, undef, undef, 0.1)'
  done
  if ! grep -q BACKDROP "$work/stage.out"; then
    echo "$frame: the window was not shown. $(cat "$work/stage.err")" >&2
    kill -TERM "$pid" 2>/dev/null || true
    exit 1
  fi
  window="$(sed -n 's/^SUSI_STAGE_WINDOW=//p' "$work/stage.out")"
  backdrop="$(sed -n 's/^SUSI_STAGE_BACKDROP_WINDOW=//p' "$work/stage.out")"
  # WebKit stops painting a hidden window a few seconds after launch. The frame is taken within that time.
  perl -e 'select(undef, undef, undef, 1.9)'
  "$work/stagecap" "$out/$frame.png" 60 "$window" "$backdrop"
  kill -TERM "$pid"
  wait "$pid" 2>/dev/null || true
done

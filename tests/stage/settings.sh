#!/bin/bash
# The settings window in the real app, without disturbing work on this Mac: the stage build
# (me.octopot.sushi.stage, as capture.sh makes it) with SUSHI_STAGE_WINDOW=settings puts the window
# under the desktop wallpaper, takes no focus or mouse, registers no key, and reads and writes only
# its own profile, ~/Library/Application Support/me.octopot.sushi.stage, which this script removes.
#
#   tests/stage/settings.sh <output-dir> [frame ...]
#
# 1. An end-to-end run: tests/stage/settings.js drives the real page, whose commands write the real
#    files; this script checks the files (and `cue vet`s each JSON file against docs/specs/files.cue).
#    It needs no Screen Recording access.
# 2. Frames of the real window on Liquid Glass, dark and light, into <output-dir>: these need Screen
#    Recording access for the terminal. Without it the script says so and skips them.
# Exits non-zero when a check fails or a frame cannot be taken.
set -uo pipefail
cd "$(dirname "$0")/../.."
root="$PWD"
out="${1:?usage: tests/stage/settings.sh <output-dir> [frame ...]}"
shift
frames=("$@")
[[ ${#frames[@]} -gt 0 ]] || frames=(keyboard keyboard-shortcut model model-expanded actions actions-editor
  library library-dictionary about about-build-details)
mkdir -p "$out"
out="$(cd "$out" && pwd -P)"
work="$(mktemp -d)"
profile="$HOME/Library/Application Support/me.octopot.sushi.stage"
pid=
wipe() {
  rm -rf "$profile" "$HOME/Library/WebKit/me.octopot.sushi.stage" "$HOME/Library/Caches/me.octopot.sushi.stage"
}
cleanup() {
  [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null
  rm -rf "$work"
  wipe
}
trap cleanup EXIT

echo "Building the stage bundle…"
npx tauri build --bundles app \
  --config '{"identifier":"me.octopot.sushi.stage","productName":"Sushi Stage"}' </dev/null >"$work/build.log" 2>&1 ||
  { tail -20 "$work/build.log" >&2; exit 1; }
app="src-tauri/target/release/bundle/macos/Sushi Stage.app/Contents/MacOS/sushi"
swiftc -O tests/stage/stagecap.swift -o "$work/stagecap" || exit 1
printf 'import CoreGraphics\nexit(CGPreflightScreenCaptureAccess() ? 0 : 2)\n' >"$work/access.swift"
swiftc "$work/access.swift" -o "$work/access" || exit 1

failures=0
pass() { echo "PASS $1${2:+ — $2}"; }
fail() { echo "FAIL $1${2:+ — $2}"; failures=$((failures + 1)); }
expect() { # expect <name> <command...>: PASS when the command succeeds
  local name="$1"
  shift
  local detail
  if detail="$("$@" 2>&1)"; then pass "$name" "$detail"; else fail "$name" "$detail"; fi
}
vet() { # vet <file> <definition>
  cue vet docs/specs/files.cue "$1" -d "$2" && echo "cue vet $(basename "$1") $2"
}
json() { # json <file> <expression over `f`, the parsed file>: prints the file, fails when the expression is false
  node -e '
    const fs = require("fs"); const text = fs.readFileSync(process.argv[1], "utf8"); const f = JSON.parse(text)
    process.stdout.write(text.trim().replace(/\s*\n\s*/g, " "))
    if (!eval(process.argv[2])) process.exit(1)' "$1" "$2"
}
listing() { (cd "$profile" && ls -A | sort | tr '\n' ' ' | sed 's/ $//'); }

# start <stdout> <env...>: runs the stage app, waits for its windows; 1 when they did not show.
start() {
  local log="$1"
  shift
  : >"$log"
  env SUSHI_STAGE=1 SUSHI_STAGE_WINDOW=settings "$@" "$app" >"$log" 2>"$log.err" &
  pid=$!
  for _ in $(seq 1 100); do
    grep -q BACKDROP "$log" && return 0
    kill -0 "$pid" 2>/dev/null || break
    perl -e 'select(undef, undef, undef, 0.1)'
  done
  local code=0
  if kill -0 "$pid" 2>/dev/null; then kill -TERM "$pid"; fi
  wait "$pid" 2>/dev/null || code=$?
  pid=
  if [[ $code -eq 3 ]]; then
    echo "The app exited with code 3: no desktop picture covers the window's area, so nothing was shown." >&2
  else
    echo "The window was not shown (exit $code). $(cat "$log.err")" >&2
  fi
  return 1
}
stop() {
  [[ -n "$pid" ]] || return 0
  kill -TERM "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  pid=
}

# ——— 1. End to end ———

echo "End to end, in the stage profile:"
wipe
acks="$work/acks"
mkdir -p "$acks"
{ echo "const MODE = 'e2e'; const FRAME = '';"; cat tests/stage/settings.js; } >"$work/e2e.js"
log="$work/e2e.out"
broken='{"rules": [{"id": "shorten", "name": "", "instruction": "Make it shorter.", "aliases": []}]}'

on_step() {
  case "$1" in
  launched)
    expect "fresh profile: launch and the first read seed rules.json, dictionary.json, hotkey.json and nothing else" \
      test "$(listing)" = "dictionary.json hotkey.json rules.json"
    echo "     profile: $(listing)"
    expect "fresh profile: rules.json is the shipped example" cmp "$profile/rules.json" docs/specs/examples/rules.json
    expect "fresh profile: dictionary.json is the shipped example" cmp "$profile/dictionary.json" docs/specs/examples/dictionary.json
    expect "fresh profile: hotkey.json is the shipped example (seeded at launch)" cmp "$profile/hotkey.json" docs/specs/examples/hotkey.json
    for f in rules:'#Rules' dictionary:'#Dictionary' hotkey:'#Hotkey'; do
      expect "cue vet ${f%%:*}.json" vet "$profile/${f%%:*}.json" "${f#*:}"
    done
    # The next read starts from an empty folder and a hotkey.json written by hand.
    rm -f "$profile"/*
    printf '{\n  "capsLock": true,\n  "shortcut": "Option+Command+KeyP"\n}\n' >"$profile/hotkey.json"
    ;;
  loaded)
    expect "prefs_load alone seeds rules.json and dictionary.json and creates nothing else" \
      test "$(listing)" = "dictionary.json hotkey.json rules.json"
    expect "prefs_load leaves the hand-written hotkey.json alone" \
      json "$profile/hotkey.json" 'f.capsLock === true && f.shortcut === "Option+Command+KeyP"'
    ;;
  caps-off)
    expect "keyboard: hotkey.json has capsLock false and keeps the shortcut" \
      json "$profile/hotkey.json" 'f.capsLock === false && f.shortcut === "Option+Command+KeyP" && Object.keys(f).length === 2'
    expect "cue vet hotkey.json" vet "$profile/hotkey.json" '#Hotkey'
    ;;
  added)
    expect "actions: Polite is appended with a generated id" json "$profile/rules.json" \
      'const r = f.rules.at(-1); r.id === "polite" && r.name === "Polite" && r.instruction === "Make the tone polite." && JSON.stringify(r.aliases) === "[\"be polite\"]"'
    expect "cue vet rules.json" vet "$profile/rules.json" '#Rules'
    ;;
  moved)
    expect "actions: Polite moved to the top" json "$profile/rules.json" 'f.rules[0].id === "polite" && f.rules.filter(r => r.id === "polite").length === 1'
    expect "cue vet rules.json" vet "$profile/rules.json" '#Rules'
    ;;
  deleted)
    expect "actions: Polite is deleted" json "$profile/rules.json" '!f.rules.some(r => r.id === "polite")'
    expect "cue vet rules.json" vet "$profile/rules.json" '#Rules'
    ;;
  undone)
    expect "actions: Undo puts Polite back at the top" json "$profile/rules.json" \
      'const r = f.rules[0]; r.id === "polite" && r.instruction === "Make the tone polite." && r.aliases[0] === "be polite"'
    expect "cue vet rules.json" vet "$profile/rules.json" '#Rules'
    ;;
  term-added)
    expect "dictionary: the term is written" json "$profile/dictionary.json" 'f.terms.some(t => t.from === "pull request" && t.to === "PR")'
    expect "cue vet dictionary.json" vet "$profile/dictionary.json" '#Dictionary'
    cp "$profile/dictionary.json" "$work/dictionary.before"
    ;;
  duplicate)
    expect "dictionary: a duplicate Heard as leaves dictionary.json unchanged" cmp "$profile/dictionary.json" "$work/dictionary.before"
    ;;
  log-on)
    expect "about: diagnostics.json is {\"record\": true}" json "$profile/diagnostics.json" 'JSON.stringify(f) === "{\"record\":true}"'
    expect "cue vet diagnostics.json" vet "$profile/diagnostics.json" '#Diagnostics'
    ;;
  log-off)
    expect "about: diagnostics.json is {\"record\": false}" json "$profile/diagnostics.json" 'JSON.stringify(f) === "{\"record\":false}"'
    expect "cue vet diagnostics.json" vet "$profile/diagnostics.json" '#Diagnostics'
    ;;
  hand-edit)
    node -e '
      const fs = require("fs"), file = process.argv[1], f = JSON.parse(fs.readFileSync(file, "utf8"))
      f.rules[1].name = "Edited by hand"
      fs.writeFileSync(file, JSON.stringify(f, null, 2) + "\n")' "$profile/rules.json"
    ;;
  break)
    printf '%s\n' "$broken" >"$profile/rules.json"
    ;;
  restored)
    expect "actions: Restore default actions writes the shipped example" cmp "$profile/rules.json" docs/specs/examples/rules.json
    local kept
    kept="$(ls "$profile"/rules.invalid-*.json 2>/dev/null | head -1)"
    expect "actions: the broken file is kept as $(basename "${kept:-rules.invalid-*.json}")" \
      test -n "$kept" -a "$(cat "${kept:-/dev/null}" 2>/dev/null)" = "$broken"
    echo "     profile: $(listing)"
    ;;
  esac
  touch "$acks/ack-$1.md"
}

if start "$log" SUSHI_STAGE_PANE=keyboard SUSHI_LIBRARY_DIR="$acks" SUSHI_STAGE_SCRIPT="$work/e2e.js"; then
  seen=0
  deadline=$((SECONDS + 240))
  done=
  while [[ -z "$done" ]]; do
    if ((SECONDS > deadline)); then fail "end to end" "timed out; the page's last line: $(tail -1 "$log")"; break; fi
    if ! kill -0 "$pid" 2>/dev/null; then fail "end to end" "the app quit: $(tail -3 "$log.err")"; break; fi
    total=$(wc -l <"$log")
    while ((seen < total)); do
      seen=$((seen + 1))
      line="$(sed -n "${seen}p" "$log")"
      case "$line" in
      "STEP "*) on_step "${line#STEP }" ;;
      "CHECK PASS "*) pass "${line#CHECK PASS }" ;;
      "CHECK FAIL "*) fail "${line#CHECK FAIL }" ;;
      DONE) done=1 ;;
      esac
    done
    perl -e 'select(undef, undef, undef, 0.05)'
  done
  stop
else
  fail "end to end" "the settings window did not start"
fi

# ——— 2. Frames ———

if ! "$work/access"; then
  echo "SKIP frames: this terminal has no Screen Recording access, so the real window cannot be captured."
  echo "     Grant it in System Settings ▸ Privacy & Security ▸ Screen & System Audio Recording and run again."
else
  mkdir -p "$work/library/.templates"
  for entry in "Refactor settings store:-2H" "Release notes 2.4:-1d" "Flaky login test:-3d"; do
    name="${entry%%:*}"
    printf '# %s\n\nSynthetic prompt for screenshots.\n' "$name" >"$work/library/$name.md"
    touch -t "$(date -v"${entry##*:}" +%Y%m%d%H%M)" "$work/library/$name.md"
  done
  for appearance in dark light; do
    for frame in "${frames[@]}"; do
      wipe
      mkdir -p "$profile"
      cat >"$profile/dictionary.json" <<'JSON'
{"terms": [
  {"from": "Mac Whisper", "to": "MacWhisper"},
  {"from": "type script", "to": "TypeScript"},
  {"from": "git hub", "to": "GitHub"},
  {"from": "release please", "to": "release-please"}
]}
JSON
      printf '%s\n' "$work/library" >"$profile/library-path.txt"
      printf '{"record": true}\n' >"$profile/diagnostics.json"
      { echo "const MODE = 'frame'; const FRAME = '$frame';"; cat tests/stage/settings.js; } >"$work/frame.js"
      start "$work/frame.out" SUSHI_STAGE_PANE="${frame%%-*}" SUSHI_STAGE_APPEARANCE="$appearance" SUSHI_STAGE_SCRIPT="$work/frame.js" ||
        { fail "frame $frame-$appearance" "the window was not shown"; continue; }
      for _ in $(seq 1 100); do
        grep -q "^READY " "$work/frame.out" && break
        perl -e 'select(undef, undef, undef, 0.05)'
      done
      grep -q "^READY " "$work/frame.out" || echo "frame $frame-$appearance: the page did not say READY; capturing anyway" >&2
      grep "^FRAME " "$work/frame.out" >&2
      window="$(sed -n 's/^SUSHI_STAGE_WINDOW=//p' "$work/frame.out")"
      backdrop="$(sed -n 's/^SUSHI_STAGE_BACKDROP_WINDOW=//p' "$work/frame.out")"
      if "$work/stagecap" "$out/settings-$frame-$appearance.png" 40 "$window" "$backdrop" >/dev/null; then
        echo "frame $out/settings-$frame-$appearance.png"
      else
        fail "frame $frame-$appearance" "stagecap failed"
      fi
      stop
    done
  done
fi

if ((failures)); then
  echo "$failures check(s) failed."
  exit 1
fi
echo "All checks passed."

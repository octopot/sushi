# Working on Susi

Susi is a local prompt composer for macOS with an icon in the menu bar. ⌘⇧Space shows a glass panel with a single text field. With ⌘K the user edits the selection or the whole text through Ollama and sees the diff right in the editor. ⌘← and ⌘→ step through the version chain, ⌘L opens the library, ⌘↵ copies the prompt and returns focus to the previous app. On a diff the right-hand version is copied, on text the version shown. [Chain specification](docs/specs/version-history.md) · [Keys and files](README.md)

**On the working Mac, check changes in the background.** Use synthetic text, a temporary profile and input addressed to the Playwright page. Open the app in the user's session only when the user explicitly asks for it. Capture the look of the real window with [background capture](#background-capture-of-the-real-window). Check system key presses, dictation, the real clipboard and focus switching inside a guest macOS or on a separate Mac. Run one-off browser scripts with the IPC stub too: without it ⌘↵ writes to the real clipboard.

## Where to look in the code

| What changes | Where to start |
| --- | --- |
| Version chain, text/diff positions, the copy rule | [src/history.ts](src/history.ts) — the `Chain` class, no DOM. |
| Selection, input, diff markup, locking during an edit | [src/editor.ts](src/editor.ts) — the CodeMirror 6 document and transactions. |
| A field with a filtered list: arrows, Enter, paste | [src/palette.ts](src/palette.ts) — the shared component. Ranking and matching of dictated phrases are in [src/fuzzy.ts](src/fuzzy.ts). |
| Library sections, Tab, the T/P/D sequences and 1–9 | [src/library.ts](src/library.ts). |
| ⌘K actions, starting and cancelling an edit, the hint above the bottom line, keys, the draft in `localStorage` | [src/main.ts](src/main.ts) ties together the editor, the palettes and the Tauri commands. |
| Window look, keycaps, colors on glass | [src/style.css](src/style.css), markup in [index.html](index.html), icons in [src/icons.ts](src/icons.ts). |
| Edit quality and speed, warm-up and cancelling the model request | [src-tauri/src/rewrite.rs](src-tauri/src/rewrite.rs) — finding and starting Ollama, the local model check, the system instruction, the Ollama call. |
| Reading Markdown, template titles, choosing the Tuna folder | [src-tauri/src/library.rs](src-tauri/src/library.rs). For a separate library set `SUSI_LIBRARY_DIR`. |
| Action and dictionary files | [src-tauri/src/settings.rs](src-tauri/src/settings.rs), [examples and CUE schemas](docs/specs/local-files.md). |
| Glass, the icon menu, the global hotkey, showing the window, the active Space, returning focus, copying, capture mode | [src-tauri/src/main.rs](src-tauri/src/main.rs) registers the commands and manages the window. [src-tauri/src/macos.m](src-tauri/src/macos.m) calls AppKit. Window parameters and Liquid Glass are in [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json). |
| The site, the release notes and the specifications | [docs/](docs/README.md): the Nextra site published at sushi.octolab.org, `docs/content/changelog/` and `docs/specs/`. |
| Release pipeline, the cask, the hooks | [.github/workflows/README.md](.github/workflows/README.md), [.github/scripts/release.mjs](.github/scripts/release.mjs), the cask template [.github/homebrew/susi.rb](.github/homebrew/susi.rb), and [Releasing](#releasing) below. |

The window is frameless and transparent: macOS draws Liquid Glass with radius 26 under the page, and the page adds the translucent `--tint`. Outside the app there is no glass, so the `stage` class on `<html>` paints the panel with an opaque substitute. `main.ts` sets it in an ordinary browser, and the test sets it in headless Chrome.

## The short change loop

1. Start with observable behavior. For example, "after going back to the original text, ⌘↵ copies the original". Take a short reproducible text and name the action after which the error shows.
2. Reproduce the failure at the nearest level of the table below. For a regression the current check misses, add a concrete example and make sure it fails before the fix.
3. Make the change and repeat the same check. For a change across layers, check both sides. For example, correct text from Rust still has to be inserted into the original range in the editor.
4. Before handing over the result, say which scenario passed, which command checked it and where the stub was used. Attach a frame to a visual change and say whether it was taken in Chrome or from the real window.

Run commands from the repository root. In a fresh checkout install the dependencies with `npm ci`, or `make setup`, which also wires the Git hooks. The frontend needs Node.js and npm, the browser test an installed Google Chrome, the native part Rust and the Xcode Command Line Tools.

| When | What to run | What the result shows |
| --- | --- | --- |
| Tuning styles and markup | `npm run dev` | Vite refreshes the page at `http://127.0.0.1:1420`. For an agent's inspection use a headless browser. Tauri commands are available only in the app. |
| A change to the behavior of the editor, palettes or chain | `npm test` | TypeScript, the Vite build, the chain model and ranking in [tests/history.test.mjs](tests/history.test.mjs), scenarios in headless Chrome with a temporary profile in [tests/composer.test.mjs](tests/composer.test.mjs). The model response and system actions are stubbed. |
| The same scenarios in the app's engine | `SUSI_ENGINE=webkit node --test tests/composer.test.mjs` after `npm run build` | The scenarios pass in Playwright WebKit. Install the engine once: `npx playwright-core install webkit`. |
| Interface frames in Chrome | `SUSI_REVIEW_SCREENS=<folder> npm test` | PNGs of all screens at 750 × 470 in the dark theme and two light ones. The glass is replaced with an opaque background. |
| The look of the real window on glass | `tests/stage/capture.sh <folder>` | PNGs of the real window on Liquid Glass over the wallpaper. Details below. |
| A change to the file library or settings | `cargo test --manifest-path src-tauri/Cargo.toml --release` | Rust checks reading Markdown and frontmatter, allowed paths, first creation and validation of the settings files in a temporary folder. |
| A change to the instruction, the model or its call | `npm run test:local` | The browser scenario and the Rust tests, including a real Russian edit through an already running Ollama. If the server is off, the test says so. |
| Everything the pre-push hook and ci check | `make verify` | `tsc`, `cargo fmt --check`, `cargo clippy -D warnings`, `npm test`, the Rust tests, the release helper tests, `cue vet` of `.github/settings.json` and `actionlint`. |
| A change to packaging or preparing a build | `make dist`, then `codesign --verify --deep --strict src-tauri/target/release/bundle/macos/Susi.app` | The bundle, `artifacts/susi_<version>_darwin-arm64.zip`, `checksums.txt` and the cask for those bytes, as `cd` builds them, without launching the app or publishing anything. |
| The hotkey, Space, dictation or returning focus | `npm run app` inside a separate macOS graphical session | Open a test document in the source app, invoke Susi, type a known phrase, copy and paste it back. Check the text and the app that received focus. |

### Background capture of the real window

The window server draws the glass from what lies under the window on the display, so it can be captured only from the real window. `tests/stage/capture.sh` builds a separate bundle `me.octopot.susi.stage` and runs it with `SUSI_STAGE=1`. In this mode the app places its window and a backdrop with a picture of the desktop **under the wallpaper** and ignores the mouse. The hotkey, the menu bar icon, activation, the clipboard and starting Ollama are off. A build with the real identifier exits with code 2 in this mode. If the wallpaper does not cover the window area entirely, the app shows nothing and exits with code 3.

[tests/stage/frames.js](tests/stage/frames.js) sets the screen states: it puts a draft into the `localStorage` of a temporary profile and sends synthetic key presses to the page. [tests/stage/stagecap.swift](tests/stage/stagecap.swift) stitches the frame from two windows through ScreenCaptureKit. The terminal needs Screen Recording access; without it the capture exits and no access prompt appears. `SUSI_STAGE_APPEARANCE=light` or `dark` before the command captures the given theme without switching the system one. The window is not active in this mode: frames have no caret and no focus highlight. The script rebuilds `src-tauri/target/release/susi`, so run `npm run bundle` again after a capture if you need the regular bundle.

## Localizing a failure

- **The edit landed in the wrong fragment.** In `src/main.ts`, follow the path from `openActions()` and the saved `target` range to `rewrite()`. The editor is locked during the request, so the range stays valid. When the shown and the copied text differ, compare `chain.text`, the `index`/`diff` position and the `editor.show()` call.
- **A keyboard scenario failed only in the test.** Run `DEBUG=pw:api npm test`. Find the first wait or action that ended in an error. Compare the accessible name of the element, the open palette and the response of the IPC stub. To repeat after changing only the test file, `node --test tests/composer.test.mjs` with an already built `dist/` is enough.
- **Ollama is unavailable or the answer changed.** For a running server, `curl --noproxy '*' -fsS --max-time 2 http://127.0.0.1:11434/api/version` shows the version. At the same address `/api/tags` shows the downloaded models and `/api/ps` the ones loaded into memory. The working request uses `qwen3.5:4b-mlx` and `think: false`. For a narrow check run `cargo test --manifest-path src-tauri/Cargo.toml --release rewrite::tests::local_russian_edit -- --ignored --nocapture`. Compare the facts and the deadline in the printed test phrase.
- **It got slower.** Repeat one command on one test fragment. Record the model state before the first request, the time of the first answer and the median of several repetitions. Say where the timer stops: when the Ollama answer arrives or when the diff appears. The latter needs a native run in a separate session.
- **A key does not fire only in the real window.** First check whether the app is active: a visible window of an inactive app receives no keys. The WebKit scenarios rule out an error in the page code. Start an updated build without showing the window: quit the installed Susi, then `open -g src-tauri/target/release/bundle/macos/Susi.app --args --hidden`. Two copies with the same identifier confuse Launch Services and the single-instance plugin.
- **An element is invisible only in a native frame.** Check whether its appearance animation starts at zero opacity: in a hidden window WebKit does not advance animations. `frames.js` turns them off.

## Closing the loop with reviews

The project materials live outside the repository, in the maintainer's notes folder for Susi on this Mac; ask for its location if your context does not have it. `Research/` holds research, `Reviews/` the galleries and the history of remarks. The current gallery is `Reviews/susi-ux-02/`. The user's remarks on the first interface are in `Reviews/susi-ux-01/feedback/`.

1. To work through a remark, open `feedback/<round>/comments.md` and the snapshot from `screens/` **of the same round**. `result.json` holds the original Plannotator answer. A folder with snapshots only means the session result has not been written yet.
2. Turn the remark into a checkable scenario, fix it and run the matching test. For example, for the remark "after a step back the edit is copied", check the clipboard content after going back and stepping forward again.
3. For the next version of the interface, create a sibling gallery, for example `Reviews/susi-ux-03/`, move `review.sh` into it, update `README.md` and put current PNGs into `screens/` under the former numbers of comparable screens. Earlier rounds stay as history. The user runs `./review.sh` from the new gallery's folder. The script saves a separate snapshot of the materials for every run and writes the answer after the session ends.
4. Write the answer into `feedback/<round>/response.md` next to the original `comments.md` and `result.json`. Keep the numbers of the remarks and mark where a solution is proposed and where the fix is already verified. Copy the references the user attached from the Plannotator temporary folder into `attachments/` of that round and link them relatively.
5. Add the user's clarifications and your follow-up answers to the same `response.md` with a date and the item numbers. After the check, link the screen of the next gallery. When told "the round is ready" in the chat or the Inbox, read the folder. Send a short answer with a link to the write-up to the Susi for macOS thread in the Plannotator Inbox.

## Releasing

A release is a curated note plus a signed tag. `cd` builds `Susi.app` on a
`macos-26` runner, packs it into `susi_X.Y.Z_darwin-arm64.zip` with
`checksums.txt`, publishes the GitHub release with the note's title and body,
then commits `Casks/susi.rb` to
[octolab/homebrew-tap](https://github.com/octolab/homebrew-tap), signed as the
OctoLab Releaser App. A prerelease (`vX.Y.Z-rcN`) is a release too: it has its
own note and tag, never becomes *Latest* and leaves the tap as it is. Pipeline
mechanics, secrets and hooks are in
[.github/workflows/README.md](.github/workflows/README.md); site conventions
are in [docs/README.md](docs/README.md).

The build is ad-hoc signed and not notarized, Apple Silicon and macOS 26 or
newer only. The cask removes the quarantine attribute before installing the
app; Developer ID signing and notarization switch on in `cd` once the
`APPLE_*` secrets exist, and the cask then drops that step by itself.

### Ground rules

- The agent brings the shells, the maintainer fires: the agent prepares each
  step in full and hands over one command; the maintainer reviews it, commits,
  tags and pushes. Nothing else waits for him.
- What can be verified mechanically the agent does without asking: the checks
  before the release, the release commit, the note, the tag annotation, the
  checks after the push, the upgrade of this Mac through the cask,
  `.github/self-control.md` and the cleanup. It asks only for decisions:
  scope, wording the owner cares about, a criterion to change.
- Product changes first, release commit last: `chore(release): prepare vX.Y.Z`.
  It sets the version in `package.json`, `src-tauri/Cargo.toml` and
  `src-tauri/tauri.conf.json` (`cargo` follows in `src-tauri/Cargo.lock`) and
  in the site, and adds the note. `make release-check` refuses a tag whose
  commit disagrees with any of them.
- The app is the source of truth for what the docs and the notes claim.
- A published release is frozen: its tag, annotation, archive and cask entry
  stay as tagged. Its note may still get pictures or wording that keep it true
  to the tag. A missed fix ships in the next patch, or in the next candidate
  before the final tag.
- A release that changes the files in `~/Library/Application Support/me.octopot.susi`
  ships with the way to move to it, and the agent moves this Mac with it: it
  backs the folder up, migrates it, checks the library and the actions in the
  installed app, and removes the backup once the owner confirms.

### Before you start

`git fetch` and reconcile `main` with `origin/main`, then:

```sh
for w in ci cd.docs doctor; do gh run list -w "$w.yml" -b main -L 1; done
make doctor
gh api repos/octolab/homebrew-tap/contents/Casks/susi.rb -q .sha
```

- The latest `ci` and `cd.docs` runs on `main` are green.
- `doctor` is green: it mints the tap token from the OctoLab Releaser App,
  which proves the App can write to the tap. If the App, its installation, the
  secrets or `doctor.yml` changed since its last run, run it again:
  `make workflow-doctor REASON="before vX.Y.Z"` dispatches it on `main` and
  waits for the result.
- `make doctor` has no `fail`; it names the signing mode the next release will
  use (ad-hoc, or Developer ID with notarization).
- Record the cask `sha` (empty before the first release): after a prerelease
  it must be unchanged.

On the candidate commit:

```sh
make verify
make dist
```

`make dist` builds the app and leaves in `artifacts/` the archive,
`checksums.txt` and the cask rendered for those bytes; unpack the archive into
a temporary folder and run `codesign --verify --deep --strict` on the
unpacked `Susi.app`.

### 1. Changelog

The note covers everything that changed since the last stable release. Read the
whole range before writing:

```sh
base="$(git describe --tags --abbrev=0 --exclude='*-rc*' 2>/dev/null || git rev-list --max-parents=0 HEAD)"
git log --oneline "$base"..HEAD
git diff --stat "$base"..HEAD -- . ':!docs' ':!.github' ':!AGENTS.md'
```

Go through every product change: the panel, the keys, the version chain, the
library, the model and its instruction, the macOS integration, packaging and
the dependencies the app ships with (`src-tauri/Cargo.lock`,
`package-lock.json`), whose own notes say whether users see a difference. Only
what users get goes into the note; tooling, CI, docs and tests stay out.

Write `docs/content/changelog/vX.Y.Z.md`; it becomes the GitHub release:

```md
---
title: vX.Y.Z — Slogan.
description: "One sentence on what changed for the user."
---

# vX.Y.Z — Slogan.

Lead paragraph: what the release does, in keys and results.

## A section per user-facing change

- Short, concrete bullets.

**Upgrade:** run `brew upgrade --cask octolab/tap/susi`. Homebrew quits Susi, replaces it and opens it again.
```

- English; a short slogan ending with a period.
- Only what users get. Explain jargon in user terms; no comparisons to release
  candidates.
- Links are site-relative with a trailing slash. Markdown and HTML, no MDX:
  `release.mjs render` makes the links absolute for the GitHub release.

A prerelease note, `vX.Y.Z-rcN.md`, is short and self-contained: what to try,
what to report, and links only to pages already on the site. Hide it from the
sidebar as [docs/README.md](docs/README.md) describes.

Then, in the same release commit, update the version and the archive name
wherever the site and the README state them: `docs/release.mjs`, `README.md`
and the pages [docs/README.md](docs/README.md) lists. Whether the social
preview image needs regenerating is described in [docs/README.md](docs/README.md).

```sh
grep -rn 'X\.Y\.W' README.md docs --exclude-dir=node_modules --exclude-dir=dist  # only old notes and "since" facts may remain
node .github/scripts/release.mjs version                                         # X.Y.Z, or the files disagree
node .github/scripts/release.mjs render vX.Y.Z --site-url https://sushi.octolab.org/ --out "$(mktemp -d)/notes.md"
(cd docs && npm ci && TARGET=static SITE_URL=https://sushi.octolab.org/ npm run build)
```

### 2. Tag annotation

Follow the previous tag, `git tag -l --format='%(contents)' vX.Y.W`:

```text
vX.Y.Z — Slogan.

One or two sentences on what the release does, wrapped
at 72 columns.

- lowercase imperative bullets without trailing periods

Release notes: docs/content/changelog/vX.Y.Z.md
```

Same scope as the note. Write it to `.agents/release/vX.Y.Z/annotation.txt`:
`.agents/` is not tracked, so it never reaches a commit.

### 3. Tag, check, push

The maintainer runs one line, which the agent hands over with the release
commit:

```sh
git tag -s vX.Y.Z -F .agents/release/vX.Y.Z/annotation.txt && git tag -v vX.Y.Z && make release-check TAG=vX.Y.Z && git push --atomic origin main vX.Y.Z
```

Run it on `main` with the release commit checked out: `make release-check`
checks the tag against the branch you are about to push, as the `pre-push`
hook does: the tag pattern, the committed note and the version in every
version file.

`git tag -v` must report a good signature from a key GitHub knows for your
email: `cd` checks that GitHub verifies the tag before anything is published.

If the push lock is set (`remote.origin.pushurl` is `no_push`), lift it for
this push only and set it again afterwards.

Never push the tag separately. A tag pushed by mistake can be deleted only
before the GitHub release exists; after that, ship the next patch.

### 4. After the push

The agent runs this section by itself once the push is done: the push is the
owner's request to upgrade this Mac. It reports what it saw and hands the
owner the checks that need his hands.

```sh
gh run watch --exit-status "$(gh run list -w cd.yml -c "$(git rev-parse 'vX.Y.Z^{commit}')" -L 1 --json databaseId -q '.[0].databaseId')"
gh release view vX.Y.Z --json name,isPrerelease,isDraft,assets -q '.name, .isPrerelease, .isDraft, .assets[].name'
gh api repos/octolab/homebrew-tap/commits/main -q '.commit.verification.verified, .commit.message'
gh api repos/octolab/homebrew-tap/contents/Casks/susi.rb -H 'Accept: application/vnd.github.raw' | grep -E '^\s+(version|sha256) '
```

- `cd` is green; for a prerelease, its tap job is skipped. If `gh run watch`
  says the run is not found, `cd` hasn't started yet: run the line again.
- The release has the note's title and body, `susi_X.Y.Z_darwin-arm64.zip`
  and `checksums.txt`, and is not a draft.
- A stable release: the tap commit `Brew cask update for susi version vX.Y.Z`
  is verified, signed as the App, and the cask's `sha256` is the one in
  `checksums.txt`.
- A prerelease: `isPrerelease` is `true`,
  `gh release view --json tagName -q .tagName` still names the previous stable
  release, and the cask has the recorded `sha`.
- The site shows the new changelog page once `cd.docs` finishes for the
  release commit.

Then upgrade this Mac through the cask. The first time, the hand-built copy in
`~/Applications` gives way to the cask's copy in `/Applications`: quit it and
move it to `.agents/release/vX.Y.Z/` as a backup, so only one app carries the
identifier.

```sh
brew update
brew upgrade --cask octolab/tap/susi || brew install --cask octolab/tap/susi
defaults read /Applications/Susi.app/Contents/Info.plist CFBundleShortVersionString   # X.Y.Z
xattr -p com.apple.quarantine /Applications/Susi.app 2>&1 | grep -q 'No such xattr' && echo 'not quarantined'
codesign --verify --deep --strict /Applications/Susi.app && echo 'signature intact'
pgrep -lf /Applications/Susi.app/Contents/MacOS/susi                               # running again after the upgrade
```

`brew upgrade` quits the running app (`uninstall quit:`) and opens it again;
after a first `brew install`, start it with `open -g -a Susi --args --hidden`,
which keeps the panel closed. The owner then checks in the running app: the
menu bar icon is there, ⌘⇧Space shows the panel, ⌘K edits a short phrase with
Ollama running, ⌘↵ pastes the result into the previous app, and the library
(⌘L) still lists his prompts. What he has not checked yet goes to
[.github/self-control.md](.github/self-control.md).

### When `cd` fails

- **Before the GitHub release is published** (the tag checks, the tests, the
  build or the packaging; `gh release view vX.Y.Z` finds no release or a
  draft): nothing is public. Delete the tag with
  `git push --delete origin vX.Y.Z && git tag -d vX.Y.Z`, fix the cause on
  `main` or in your signing setup, and go back to step 3. A draft left behind
  is replaced by the next run.
- **Only the tap job failed**: the release is out and stays. Fix the cause, for
  example the App's installation on the tap, and run the failed job again:
  `gh run rerun <run-id> --failed`. It takes the checksum from the published
  release; a cask already in the tap with the same text is left alone, an
  older version is updated and a newer one is never overwritten.
- **A prerelease reached a stable channel** (*Latest* or the tap changed):
  restore the previous stable release as *Latest* and the cask, then file an
  issue before the next candidate.
- **Anything else after the release is published**: it is frozen; ship the fix
  in the next patch.

### 5. Announcement

Add a row for "Latest contributions" in the
[kamilsk/kamilsk](https://github.com/kamilsk/kamilsk) profile README, in its
local checkout, stage it with the message
`chore: add new contribution log entry` and hand over the commit command.
For example, with the date, emoji and phrase to be chosen at release time:

```md
| 2026-11-20   | 🍣 [susi][]                 | [v0.1.0][os010]                   | A prompt composer one keystroke away      |

[os010]:  https://github.com/octopot/susi/releases/tag/v0.1.0
```

Newest first, one row per release day; a prerelease gets no row. The
reference label is `o` + project initials + version digits. Notes is a short
phrase, no longer than the existing ones, saying what the user gets. Follow
the emoji and the column widths of the existing rows.

### 6. Self-control and cleanup

[.github/self-control.md](.github/self-control.md) holds the checks that
outlive a session: each item says when to look, what proves it and what to do
if it fails. The agent adds the checks a release leaves open, removes an item
once it is proven or filed as an issue, and keeps the follow-ups that still
need one. The file is public: no private paths, notes, secrets or names of
agent sessions.

The drafts of a release live in `.agents/release/vX.Y.Z/` (plan, note,
annotation, the backup of the hand-built app). After the checks of step 4 the
agent removes them, `artifacts/`, its scratch builds and test folders, and any
backup the owner has confirmed.

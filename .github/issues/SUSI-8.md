---
code: SUSI-8
id: I_kwDOVy11Hs8AAAABhsDPBw
databaseId: 6555750151
number: 12
url: https://github.com/octopot/sushi/issues/12
title: "app: embed build info and show which version and build is running"
issueType: Feature
labels:
  - "scope: code"
  - "impact: medium"
assignees:
  - kamilsk
milestone: "[[SUSI-M2]]"
parent: null
issueFields: {}
state: OPEN
stateReason: null
duplicateOf: null
createdAt: 2026-11-23T08:57:03Z
updatedAt: 2026-11-24T13:45:06Z
lastEditedAt: 2026-11-24T13:45:06Z
closedAt: null
---

# app: embed build info and show which version and build is running

## Motivation

A bug report about Sushi rarely says which build it came from, and nothing in the app tells. [[SUSI-7]] started with "which Sushi and macOS versions?" and had no answer. The version in `Info.plist` is not enough: a hand-built copy, a snapshot from a manual `cd` run and the release carry the same number. The author's command-line tools answer this with a `version` command; that is the experience to carry over, not its form. In a menu-bar app the answer belongs one click from the menu of the menu bar icon, where a user copies it without a terminal: **About Sushi** opens it in the settings window ([[SUSI-12]]). The `version` command stays for the release check and for support, and both must always tell the same thing.

## PoC

```text
Menu bar menu → About Sushi → Settings ▸ About:
  Sushi 0.3.0    [Copy build info]     ← copies the block below
  Build details                        ← shows the block and the short hash

$ /Applications/Sushi.app/Contents/MacOS/sushi version
sushi:
  version     : 0.3.0
  build       : release | debug
  build date  : <UTC time>
  git hash    : <40 hex>[-dirty]
  rust        : <rustc version>
  tauri       : <tauri version>
  webkit      : <WebKit version>
  platform    : darwin/arm64
  macos       : <version (build)>
  signing     : ad-hoc | Developer ID (<team>)
  features    : -
```

## Acceptance criteria

- [x] `build.rs` reads the commit and the dirty mark from git and passes them with `cargo:rustc-env`. It reruns when `.git/HEAD`, the current ref, `.git/index`, `SOURCE_DATE_EPOCH` or `SUSHI_BUILD_*` change, so a new commit or an edit never ships the old hash. `SUSHI_BUILD_COMMIT` and `SUSHI_BUILD_DATE` override them, as ldflags do for Go. Dirty means tracked files differ from HEAD, and untracked files don't count. Without git the build still succeeds and says `unknown`, and a plain `cargo build` or `npm run app` gives a block too.
- [ ] The build date is `SUSHI_BUILD_DATE` when set, else `SOURCE_DATE_EPOCH`, otherwise the time of the build, in UTC. `cd` sets `SOURCE_DATE_EPOCH` to the time the release tag was made, not to the time of its commit: a commit carries whatever date its author gave it.
- [x] The fields come from what Tauri and Cargo already embed, plus `build.rs`, plus the running Mac:
  - the Rust version from `build.rs`;
  - the Tauri version from `tauri::VERSION`, the platform the binary is built for, and the compiled-in Cargo features, `-` while Sushi declares none;
  - the WebKit version from `tauri::webview_version()` at run time;
  - the running macOS version with its build number;
  - the signing mode, read at run time from the app's own signature.

  A dev build says `build: debug`. The block holds nothing about the user: no paths, names or settings.
- [x] The menu bar menu has no version item: **About Sushi** opens Settings ▸ About, which shows `Sushi <version>`. **Copy build info** puts the block on the clipboard, and **Build details** shows the block and the short hash, `<short hash>-dirty` for a dirty build and `unknown` without git. It is not `PredefinedMenuItem::about`: the standard About panel can't be brought forward from an app without a Dock icon, and its version line can't be copied. The stage build never touches the clipboard.
- [x] `sushi version` as the first argument is handled at the top of `main()`, before the single-instance check and any AppKit call. It prints the block and exits 0 whether or not Sushi is running, and a running Sushi does not show its panel.
- [x] **One block, by contract.** A specification, `docs/specs/build-info.md`, fixes the block: its fields, their order, their sources, the one-line form `Sushi <version> (<short hash>)`, and the rule that **Copy build info**, **Build details** and `sushi version` give the same text byte for byte. All three call one function, and nothing else in the code formats build info. The run-time fields are read the same way in both places, without a window. A Rust test renders a fixed set of values and compares the block with the example in the spec, byte for byte, and checks that the one-line form is the block's version plus the first seven characters of its hash. The diagnostic log of [[SUSI-7]] starts with the same block.
- [x] `release.mjs package` runs `sushi version` on the built bundle and fails when a field is missing or says `unknown`, or when the version differs from the version files. In `cd` it also fails when the commit is not the tag's commit, the build is marked dirty, the build is not a release build, or the date is not the time the tag was made.
- [x] The docs are updated:
  - *Report a problem* in `docs/content/guide/troubleshooting.mdx` asks for the block from **Copy build info** in Settings ▸ About instead of the macOS version alone;
  - the menu list in `docs/content/quick-start.mdx` and `docs/specs/panel.md` name **About Sushi**;
  - step 4 of the release procedure in `AGENTS.md` runs `sushi version` on the installed app;
  - `docs/specs/README.md` gains a row for `build-info.md`.

## Out of scope

- The standard About panel. The About pane itself is part of the settings window ([[SUSI-12]]).
- `--version` and other aliases of the command.
- Update checks.
- Sending anything off the Mac; that belongs to [[SUSI-9]].
- Changing `CFBundleVersion` or adding the commit to `Info.plist`.
- A `binary` stanza in the cask that would put `sushi` on PATH.

<!-- 2026-11-24T12:02Z https://github.com/octopot/sushi/issues/12#issuecomment-7130913669
v0.3.0 shipped this, with one defect: `sushi version` and **Copy build info** say `build date: 2023-06-17`. `cd` dated the build by the commit time of the tag's commit, and the commits of this repository carry dates of their own. Fixed on main for the next release: the date is the time the release tag was made (`release.mjs date`, BI-3), and `release.mjs package` expects that date in the bundle. The commit hash in the same block named the build correctly all along.

The body is reworded to what was built: the menu has no version row; **About Sushi** opens Settings ▸ About (#17) with **Copy build info** and **Build details**. Ticked criteria are proven by the tests the Verification table of `docs/specs/build-info.md` names. Left: the date criterion, proven by the next release; and by hand, **Copy build info** against `sushi version` in the installed app, and `sushi version` while Sushi runs without the panel showing.
-->

<!-- 2026-11-24T13:45Z https://github.com/octopot/sushi/issues/12#issuecomment-7133267709
Checked by hand in the owner's run by hand on 2026-11-24, on the v0.3.0 code with the fixes then on main (build `05a23ce-dirty`), macOS 27.2: **Copy build info** and `sushi version` give the same text, and `sushi version` with Sushi running does not show the panel. Left: the build date, which v0.3.1 proves when its tag dates the build.
-->

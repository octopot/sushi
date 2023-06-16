---
code: SUSI-8
id: I_kwDOVy11Hs8AAAABhsDPBw
databaseId: 6555750151
number: 12
url: https://github.com/octopot/sushi/issues/12
title: "app: embed build info and show which version and build is running"
issueType: Feature
labels:
  - "impact: medium"
  - "scope: code"
assignees:
  - kamilsk
milestone: null
parent: null
issueFields: {}
state: OPEN
stateReason: null
duplicateOf: null
createdAt: 2026-11-23T08:57:03Z
updatedAt: 2026-11-23T09:17:30Z
lastEditedAt: 2026-11-23T09:17:30Z
closedAt: null
---

# app: embed build info and show which version and build is running

## Motivation

A bug report about Sushi rarely says which build it came from, and nothing in the app tells. [[SUSI-7]] started with "which Sushi and macOS versions?" and had no answer. The version in `Info.plist` is not enough: a hand-built copy, a snapshot from a manual `cd` run and the release carry the same number. The author's command-line tools answer this with a `version` command; that is the experience to carry over, not its form. In a menu-bar app the answer belongs in the menu of the menu bar icon, where a user copies it in one click without a terminal. The `version` command stays for the release check and for support, and both must always tell the same thing.

## PoC

```text
Menu bar menu:
  Sushi 0.2.1 (<short hash>)      ← one item; choosing it copies the block below

$ /Applications/Sushi.app/Contents/MacOS/sushi version
sushi:
  version     : 0.2.1
  build date  : <UTC time>
  git hash    : <40 hex>[-dirty]
  rust        : <rustc version>
  tauri       : <tauri version>
  webkit      : <WebKit version>
  platform    : darwin/arm64
  macos       : <version (build)>
  signing     : ad-hoc | Developer ID (<team>)
  features    : diagnostics=true | -
```

## Acceptance criteria

- [ ] `build.rs` reads the commit and the dirty mark from git and passes them with `cargo:rustc-env`. It reruns when `.git/HEAD`, the current ref, `.git/index`, `SOURCE_DATE_EPOCH` or `SUSHI_BUILD_*` change, so a new commit or an edit never ships the old hash. `SUSHI_BUILD_COMMIT` and `SUSHI_BUILD_DATE` override them, as ldflags do for Go. Dirty means tracked files differ from HEAD, and untracked files don't count. Without git the build still succeeds and says `unknown`, and a plain `cargo build` or `npm run app` gives a block too.
- [ ] The build date is `SOURCE_DATE_EPOCH` when set, otherwise the time of the build, in UTC. `cd` sets it to the commit time of the tag.
- [ ] The fields come from what Tauri and Cargo already embed, plus `build.rs`, plus the running Mac:
  - the Rust version from `build.rs`;
  - the Tauri version, the target and the compiled-in Cargo features from `tauri::VERSION`, `TAURI_ENV_TARGET_TRIPLE` and `cfg!`;
  - the WebKit version from `tauri::webview_version()` at run time;
  - the running macOS version with its build number;
  - the signing mode, read at run time from the app's own signature.

  A dev build says so. The block holds nothing about the user: no paths, names or settings.
- [ ] The menu bar menu has one item, `Sushi <version> (<short hash>)`, above **Open Settings Folder**, and choosing it puts the block on the clipboard. It is an ordinary menu item, not `PredefinedMenuItem::about`: the standard About panel can't be brought forward from an app without a Dock icon, and its version line can't be copied. A dirty build shows `(<short hash>-dirty)`, and a build without git shows `(unknown)`. The stage build has no menu bar icon, so it never touches the clipboard.
- [ ] `sushi version` as the first argument is handled at the top of `main()`, before the single-instance check, the migration and any AppKit call. It prints the block and exits 0 whether or not Sushi is running, and a running Sushi does not show its panel.
- [ ] **One block, by contract.** A specification, `docs/specs/build-info.md`, fixes the block: its fields, their order, their sources, the format of the menu item, and the rule that the menu and `sushi version` give the same text byte for byte. Both the menu item and `sushi version` call one function, and nothing else in the code formats build info. The run-time fields are read the same way in both places, without a window. A Rust test renders a fixed set of values and compares the block with the example in the spec, byte for byte, and checks that the menu title is the block's version plus the first seven characters of its hash. The diagnostic log of [[SUSI-7]] starts with the same block.
- [ ] `release.mjs package` runs `sushi version` on the built bundle and fails when a field is missing or says `unknown`, or when the version differs from the version files. In `cd` it also fails when the commit is not the tag's commit, the build is marked dirty, or the date is not the tag's commit time.
- [ ] The docs are updated:
  - *Report a problem* in `docs/content/guide/troubleshooting.mdx` asks for the block from the version item of the menu instead of the macOS version alone;
  - the menu list in `docs/content/quick-start.mdx` and `docs/specs/panel.md` name the new item;
  - step 4 of the release procedure in `AGENTS.md` runs `sushi version` on the installed app;
  - `docs/specs/README.md` gains a row for `build-info.md`.

## Out of scope

- An About window or the standard About panel.
- `--version` and other aliases of the command.
- Update checks.
- Sending anything off the Mac; that belongs to [[SUSI-9]].
- Changing `CFBundleVersion` or adding the commit to `Info.plist`.
- A `binary` stanza in the cask that would put `sushi` on PATH.

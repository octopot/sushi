# Build info

**Status:** describes Sushi v0.3.0 as implemented. Rules marked with an ID hold today and are checked by the tests listed under [Verification](#verification).

A report about Sushi has to say which build it came from. The version in `Info.plist` is not enough: a hand-built copy, a snapshot from a manual `cd` run and the release carry the same number. This document fixes one block of text that names the build, where it comes from, and the two places that give it: Settings ▸ About and the `sushi version` command. The diagnostic log ([LF-22](local-files.md#the-diagnostic-log)) and a problem report ([RP-6](report.md#the-snapshot)) start with the same block.

## Rules

- **BI-1. One block.** The block is these lines, in this order, with the names padded to 12 characters:

  <!-- block -->
  ```text
  sushi:
    version     : 0.3.0
    build       : release
    build date  : 2026-11-29T09:30:00Z
    git hash    : 0123456789abcdef0123456789abcdef01234567
    rust        : 1.100.0 (0ef1bc386 2026-11-09)
    tauri       : 2.12.7
    webkit      : 21623.1.14.11.4
    platform    : darwin/arm64
    macos       : 27.2 (25C56)
    signing     : ad-hoc
    features    : -
  ```

  | Field | Source |
  | --- | --- |
  | `version` | The package version Cargo compiles in, the one `make release-check` compares with the tag. |
  | `build` | `release`, or `debug` for a development build (`npm run app`, a plain `cargo build`). |
  | `build date` | BI-3. |
  | `git hash` | BI-2: 40 hexadecimal digits, `-dirty` appended when tracked files differed from that commit, or `unknown`. |
  | `rust` | `rustc --version` of the compiler, read by `build.rs`. |
  | `tauri` | `tauri::VERSION`. |
  | `webkit` | `tauri::webview_version()`, at run time. |
  | `platform` | The operating system and the processor the binary is built for. |
  | `macos` | The running macOS version with its build number, at run time. |
  | `signing` | The binary's own signature, at run time: `ad-hoc`, `ad-hoc (linker)` for a build that only the linker signed, `Developer ID (<team>)`, `other certificate (<team>)` or `unsigned`. |
  | `features` | The optional Cargo features compiled in, or `-`. Sushi declares none today. |

  The block holds nothing about the user: no paths, names or settings.
- **BI-2. The commit.** `build.rs` reads `git rev-parse HEAD` and marks the hash `-dirty` when `git status` lists a tracked file that differs from it; untracked files do not count. The script runs again when `HEAD`, the branch it names, the folder `refs/heads`, `packed-refs`, the index or any tracked file changes, a deleted one included (Cargo reruns the script while it is missing and once more when it comes back), and when `SOURCE_DATE_EPOCH`, `SUSHI_BUILD_COMMIT` or `SUSHI_BUILD_DATE` changes, so a new commit or an edit never ships the old hash. `SUSHI_BUILD_COMMIT` overrides the hash. Without git, or outside a repository, the build succeeds and says `unknown`.
- **BI-3. The date.** `SUSHI_BUILD_DATE` when set; else `SOURCE_DATE_EPOCH` when set; else the time `build.rs` ran. Always UTC, as `YYYY-MM-DDTHH:MM:SSZ`. `cd` sets `SOURCE_DATE_EPOCH` to the time the release tag was made, its tagger date. The time of the tagged commit is not used: a commit carries whatever date its author gave it, and v0.3.0, dated that way, says `2023-06-17`.
- **BI-4. About.** Settings ▸ About ([ST-29](settings.md#about)) shows `Sushi <version>`. **Copy build info** puts the block on the clipboard. **Build details** expands to the block and the short hash, as `Commit 0123456`: the first 7 characters of the hash, `0123456-dirty` for a dirty build, `unknown` without git. The menu bar menu has no version item: **About Sushi** there opens this pane. The standard About panel is not used: an app without a Dock icon cannot bring it forward, and its version line cannot be copied. The stage build never touches the clipboard.

  On one line, as a person quotes it, a build is `Sushi <version> (<short hash>)`; for the block above:

  <!-- title -->
  ```text
  Sushi 0.3.0 (0123456)
  ```
- **BI-5. `sushi version`.** `sushi version` as the first argument prints the block and exits with 0. It is handled at the top of `main()`, before the single-instance check and any AppKit call, so it answers whether or not Sushi is running, and a running Sushi does not show its panel.
- **BI-6. The same text everywhere.** **Copy build info**, **Build details** and `sushi version` call one function, and nothing else formats build info: they give the same text byte for byte. The run-time fields are read the same way in each, without a window.
- **BI-7. The release checks it.** `release.mjs package` runs `sushi version` on the built bundle and fails when a field is missing or says `unknown`, or when `version` differs from the version files. In `cd` it also fails when the hash is not the tag's commit, the build is marked dirty, or the date is not the time the tag was made.

## Not supported

- The standard About panel, `--version` and other aliases of the command.
- Update checks.
- The commit in `Info.plist` or a changed `CFBundleVersion`.
- `sushi` on the `PATH`: run it as `/Applications/Sushi.app/Contents/MacOS/sushi version`.

## Verification

| ID | Test | Code |
| --- | --- | --- |
| BI-1 | `build_info::tests::renders_the_block_of_the_specification` compares the block above, byte for byte; `the_running_build_fills_every_field` | `block`, `collect` in `src-tauri/src/build_info.rs`; `sushi_signing` in `src-tauri/src/macos.m` |
| BI-2, BI-3 | `build_git::tests::a_new_commit_of_a_packed_nested_branch_reruns_the_build`, `without_a_repository_there_is_no_commit` on a temporary repository; `release.mjs package` (BI-7) on every release; by hand: `SUSHI_BUILD_COMMIT=x cargo build` | `watched_in`, `commit_in` in `src-tauri/build_git.rs`, which `src-tauri/build.rs` includes |
| BI-4 | `build_info::tests::the_title_is_the_version_and_seven_characters_of_the_hash`; `settings.test.mjs` — about: copy only says Copied when it worked; Build details; Report a problem; the log (the stub); the clipboard: by hand | `short_hash`, `title` in `src-tauri/src/build_info.rs`; `about`, `prefs_action` in `src-tauri/src/preferences.rs` |
| BI-5, BI-6 | `release.test.mjs` — the block is parsed and checked; by hand: `sushi version` while Sushi runs | the top of `main()` in `src-tauri/src/main.rs` |
| BI-7 | `release.test.mjs` — build info checks | `buildInfoErrors`, `pack` in `.github/scripts/release.mjs` |

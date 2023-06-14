# Self-control

Open checks that outlive a working session: things to look at later, decisions
that are waiting, and follow-ups that still need an issue. Each item says when
to look, what proves it and what to do if it fails. An item is removed once it
is proven or moved into an issue; a release adds the checks it leaves open
([AGENTS.md](../AGENTS.md#6-self-control-and-cleanup)).

## Watch

### After v0.2.0

v0.2.0 renames Susi to Sushi and moves the panel to Caps Lock. Before the tag
the upgrade was rehearsed on Homebrew 7.0.15 with throwaway tokens and bundle
identifiers: a trusted tap migrates on `brew update`; a tap trusted cask by
cask needs `brew upgrade --cask octolab/tap/sushi` by its full name; install
steps cannot launch the app from Homebrew's sandbox; the first launch moved the
settings, the library and the draft; the Caps Lock mapping was set and removed
on this Mac.

On 2026-11-19 `cd` published v0.2.0; the tap commit through
`createCommitOnBranch` added `Casks/sushi.rb`, deleted `Casks/susi.rb` and
added `cask_renames.json`, verified as the Releaser App. This Mac upgraded by
the release note: `brew update` migrated the cask, the upgrade replaced
`Susi.app`, Homebrew's reopen of `me.octopot.susi` failed as expected, and
`open -a Sushi` brought over the draft byte for byte and the settings
unchanged. The `susi` record left in the Caskroom (a symlink here, an empty
receipt when only the cask was trusted) is removed with `rm -rf` without
touching Sushi; the note says so.

- [ ] **A week after v0.2.0**: both other users run Sushi. Proven when each
  confirms the panel opens on Caps Lock with their old prompt; if one is stuck,
  walk them through the release note's five steps and fix what the note missed
  in the next patch.
- [ ] **An external keyboard** connected while Sushi runs gets the Caps Lock
  mapping. Not tried: this Mac had only the built-in keyboard. If Caps Lock
  does not show the panel on a keyboard connected later, the IOKit
  notification in `macos.m` is the place to look.
- [ ] **v0.3.0 removes the move from Susi**: `src-tauri/src/migrate.rs`,
  `sushi_quit_app` in `macos.m`, the `susi.draft.v3` fallback in `src/main.ts`,
  LF-17 and the Susi part of VH-18, their tests, `x-release.tap.renamed_from`
  in `.github/settings.json`. The tap keeps `cask_renames.json` and the cask's
  `zap` keeps Susi's folders.

### After v0.1.1

v0.1.0 and v0.1.1 were released on 2026-11-18: `cd` published both releases,
the tap commits are verified, the cask installs without the quarantine
attribute, and `brew upgrade` from 0.1.0 to 0.1.1 quit Susi, replaced it and
opened it again with the signature intact.

- [ ] **On a Mac without Ollama**: v0.1.1 was verified by tests with replaced
  search locations only. On a clean Mac an edit must answer at once with
  "Ollama is not installed on this Mac. Download Ollama", the link must open
  the download page, and ⌘K must show the same note. With only the
  command-line tool, the first edit must start `ollama serve`, and the server
  must outlive Susi. If any of these fails, fix it in the next patch.
- [ ] **On the next `brew upgrade` of Sushi** (the first after v0.2.0):
  Homebrew reopens the app without `--hidden` (seen after 0.1.0 → 0.1.1), so
  the panel is expected to show after an upgrade. Confirm it on screen and
  decide whether Sushi should start hidden when Homebrew relaunches it.
- [ ] **On every upgrade until Developer ID**: Homebrew warns that "sushi's
  signer changed so macOS may prompt at next launch": every ad-hoc build has a
  new signature. After 0.1.0 → 0.1.1 on this Mac Susi was running again
  right away; whether macOS showed a prompt was not observed.

### Homebrew and Gatekeeper

- [ ] **On every Homebrew minor release**: the cask still installs with the
  quarantine attribute removed. Homebrew 7 removed `--no-quarantine`,
  deprecates Ruby flight blocks in favour of `*_flight_steps` ("available
  temporarily for third-party tap compatibility") and disables official casks
  that fail Gatekeeper. A tap cask is not audited for that today; if Homebrew
  starts refusing quarantine removal in tap casks, Developer ID signing and
  notarization become the only way to keep `brew install` working.

## Decisions waiting

- [ ] **Developer ID.** Join the Apple Developer Program, create a Developer ID
  Application certificate and an App Store Connect API key, and set the
  `APPLE_*` secrets ([workflows README](workflows/README.md#common-ground)).
  `cd` then signs, notarizes and staples, and the cask drops the quarantine
  step by itself. Proven when a tag's run passes `stapler validate` and
  `spctl --assess`, and the tap's cask has no `preflight_steps`.
- [ ] **The minimum macOS.** `minimumSystemVersion` and the cask say macOS 26,
  the only version Sushi has run on. The code has fallbacks for older systems
  (the untinted Visual Effect window without `NSGlassEffectView`, focus
  hand-off without macOS 14 APIs), and the web bundle targets Safari 16.4,
  so macOS 13.3 is the floor the code itself sets. Lower it only after
  running the app on macOS 13, 14 and 15.

## Follow-ups to file

- [ ] The Tauri updater plugin as an in-app update path next to
  `brew upgrade`: it needs its own signing key pair (`TAURI_SIGNING_PRIVATE_KEY`)
  and an update manifest published with each release. File it when the owner
  wants updates outside Homebrew.

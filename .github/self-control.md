# Self-control

Open checks that outlive a working session: things to look at later, decisions
that are waiting, and follow-ups that still need an issue. Each item says when
to look, what proves it and what to do if it fails. An item is removed once it
is proven or moved into an issue; a release adds the checks it leaves open
([AGENTS.md](../AGENTS.md#6-self-control-and-cleanup)).

## Watch

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
- [ ] **On the next `brew upgrade`**: Homebrew reopens Susi without
  `--hidden` (seen in the process arguments after 0.1.0 → 0.1.1), so the
  panel is expected to show after an upgrade. Confirm it on screen and decide
  whether Susi should start hidden when Homebrew relaunches it.
- [ ] **On every upgrade until Developer ID**: Homebrew warns that "susi's
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
  the only version Susi has run on. The code has fallbacks for older systems
  (the untinted Visual Effect window without `NSGlassEffectView`, focus
  hand-off without macOS 14 APIs), and the web bundle targets Safari 16.4,
  so macOS 13.3 is the floor the code itself sets. Lower it only after
  running the app on macOS 13, 14 and 15.

## Follow-ups to file

- [ ] The Tauri updater plugin as an in-app update path next to
  `brew upgrade`: it needs its own signing key pair (`TAURI_SIGNING_PRIVATE_KEY`)
  and an update manifest published with each release. File it when the owner
  wants updates outside Homebrew.

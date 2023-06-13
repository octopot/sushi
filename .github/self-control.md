# Self-control

Open checks that outlive a working session: things to look at later, decisions
that are waiting, and follow-ups that still need an issue. Each item says when
to look, what proves it and what to do if it fails. An item is removed once it
is proven or moved into an issue; a release adds the checks it leaves open
([AGENTS.md](../AGENTS.md#6-self-control-and-cleanup)).

## Watch

### The first release, v0.1.0

The delivery path was dry-run locally only: build, archive, signature after
unpacking, checksums, cask rendering, `ruby -c` and `brew style`. Nothing below
has run on GitHub yet.

- [ ] **Before tagging**: the workflows are pushed and active, `ci` and
  `cd.docs` are green on `main`, and a manual `cd` run on `main` (a snapshot)
  is green and its artifact holds `susi_0.1.0_darwin-arm64.zip`,
  `checksums.txt` and `susi.rb`. If `macos-26` fails to build, compare its
  Xcode with the one in the runner image README before anything else.
- [ ] **Before tagging**: `make workflow-doctor` is green, which proves the
  OctoLab Releaser App can write to `octolab/homebrew-tap`, and Pages has
  Enforce HTTPS on (`make doctor` reports it off until then).
- [ ] **On the v0.1.0 tag**: the release is published, not a draft; the tap
  commit `Brew cask update for susi version v0.1.0` exists and
  `gh api repos/octolab/homebrew-tap/commits/main -q .commit.verification.verified`
  is `true`. If it is not verified, compare with the Formula commits that
  GoReleaser makes with the same App: the contents API call must send no
  author or committer.
- [ ] **On the v0.1.0 tag, on this Mac**: `brew install --cask octolab/tap/susi`
  leaves `/Applications/Susi.app` without `com.apple.quarantine`, and the app
  opens without a Gatekeeper dialog. If Homebrew refuses the `run` step of
  `preflight_steps` or its sandbox blocks `xattr`, the cask is broken for
  everyone: fix the template and ship v0.1.1, or tell users to clear the
  attribute by hand until then.
- [ ] **On the v0.1.0 tag, owner**: in the cask-installed app, the menu bar
  icon, ⌘⇧Space, a ⌘K edit with Ollama running, ⌘↵ into the previous app and
  ⌘L with his own prompts work as in the hand-built copy, and only one Susi
  is installed.
- [ ] **On the first `brew upgrade` (v0.1.1 or later)**: Homebrew quits Susi,
  replaces it and opens it again, and the new app is not quarantined either.
  Every ad-hoc build has a new signature, so Homebrew warns that the signer
  changed; that warning is expected until Developer ID.

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

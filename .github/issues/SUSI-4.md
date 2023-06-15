---
code: SUSI-4
id: I_kwDOVy11Hs8AAAABgvvPMg
databaseId: 6492507954
number: 5
url: https://github.com/octopot/sushi/issues/5
title: "rewrite: starting Ollama opens its window and takes the focus"
issueType: Bug
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
createdAt: 2026-11-19T15:03:27Z
updatedAt: 2026-11-19T15:03:27Z
lastEditedAt: null
closedAt: null
---

# rewrite: starting Ollama opens its window and takes the focus

## Problem

When the Ollama app is installed but not running, the first ⌘K action starts it with `open -g -a Ollama.app`. Ollama 0.40 opens its main window (the Apps screen) on an ordinary launch and becomes the active app, so the user gets a window they did not ask for over their work. With the panel hiding when it loses the keyboard ([[SUSI-2]], PN-5), the panel would also hide in the middle of the edit.

Ollama's own command line starts the app for the same purpose with `open -j -a <Ollama.app> --args --fast-startup` (`cmd/start_darwin.go`): `-j` launches it hidden, which the app reads as "start without the window", and `--fast-startup` skips the optional startup steps, such as a pending update and the offer to move the app to Applications.

## PoC

```text
1. Quit Ollama from its menu bar icon; the Ollama app stays installed with the model pulled.
2. Show Sushi, type a sentence, press ⌘K and run Shorten.
3. Ollama's window opens over the desktop and the menu bar shows Ollama's menus.
```

## Expected behavior

Ollama starts in the background, with its menu bar icon only. The edit arrives in the panel, which stays open with the keyboard, and no Ollama window shows.

## Acceptance criteria

- [ ] Sushi starts the Ollama app hidden and with fast startup, as Ollama's own command line does; a Rust test fixes the arguments.
- [ ] A regression scenario in `docs/specs/panel.md` covers an edit with Ollama quit, and a run of it passes on the release build.
- [ ] Starting the command-line `ollama serve` (no app installed) stays as it is.

## Out of scope

Stopping Ollama after the edit, or starting it before the first ⌘K.

---
code: SUSI-13
id: I_kwDOVy11Hs8AAAABiGLLMA
databaseId: 6583143216
number: 18
url: https://github.com/octopot/sushi/issues/18
title: "app: drive Sushi from outside, so an agent can do everything a person can"
issueType: Feature
labels:
  - "scope: code"
  - "impact: high"
assignees:
  - kamilsk
milestone: null
parent: null
issueFields: {}
state: OPEN
stateReason: null
duplicateOf: null
createdAt: 2026-11-24T13:42:48Z
updatedAt: 2026-11-24T13:42:49Z
lastEditedAt: null
closedAt: null
---

# app: drive Sushi from outside, so an agent can do everything a person can

## Motivation

Sushi can be used only by a person at the keyboard. Checking v0.3.0 by hand took the owner one long sitting: about fifty steps across the panel, the menu bar menu, the settings window, three providers and the report flow, each pressed, looked at and ticked. Most of it an agent could have done, if the app could be driven and observed from outside. Today an agent reaches only what the tests stub: the page in a headless browser, and the settings window under the wallpaper in stage mode. The real panel, the key that shows it, the menu, the sheets, focus and the clipboard stay out of reach, so every release waits for a person, and the regression scenarios in `docs/specs/*.feature` are tagged `@hands`.

The same gap limits what Sushi is for. A person composes a prompt in Sushi and hands it to an agent; an agent cannot hand a draft to Sushi, ask for an edit with the user's actions and dictionary, read the version chain or change a setting on the user's behalf.

Sushi should be AI-native: everything a person can do in it, an agent can do from outside, in every part of the app a person reaches, and can see what happened.

## PoC

The shape below shows what is asked for from outside, not how it is built. The candidates to compare before choosing are in the criteria.

```bash
$ sushi ctl state
panel: hidden · view: editor · versions: 1 · model: Ollama · qwen3.5:4b-mlx · key: Caps Lock

$ sushi ctl panel show
$ sushi ctl editor set "tighten this paragraph …"
$ sushi ctl action run shorten          # the edit a person starts with ⌘K
edit: answered in 1.8 s · 3 places changed · version 2 of 2
$ sushi ctl chain back                  # ⌘←
$ sushi ctl copy                        # ⌘↵: what a person would have copied
$ sushi ctl settings keyboard set --shortcut "⌥Space"
saved: hotkey.json · ⌥Space shows Sushi
$ sushi ctl watch                       # events as they happen
show reason=control · hide reason=focus-lost · sheet attached · …
```

An agent then runs a scenario that needs a person today, start to end, and reports each step:

```bash
$ node .github/scripts/scenarios.mjs run --id PR-16
PR-16 Starting stays quiet … 4 of 4 steps passed
```

## Acceptance criteria

- [ ] The ways to drive a macOS app from outside are compared for Sushi: a command of the `sushi` binary over a local socket, an MCP server, App Intents and Shortcuts, AppleScript, a URL scheme, the accessibility tree. The comparison says what each reaches, what it costs to keep and what an agent already speaks, and one is chosen for the first release.
- [ ] Every action a person has is available from outside, in the panel (show and hide, type, select, ⌘K with an action or an instruction, cancel, the version chain, the library, copy), the menu bar menu, the settings window (every pane and every save, with the same refusals a person gets) and the report flow.
- [ ] The state a person sees can be read: whether the panel shows and which view, the text and the chain's position, the hint and the messages, the rows of the menu, what each pane of Settings shows, which window has the keyboard. Events are available as they happen: a show, a hide with its reason, a sheet, an edit's start and end.
- [ ] What macOS shows on Sushi's behalf is reachable too: the connect and disconnect sheets, the folder picker, an alert. An agent can answer them or learn that a person has to.
- [ ] The interface is the same code path a person's action takes, so a scenario passed by an agent says the same as one passed by hand; where it cannot be (a real key press, dictation, a click in another app), the difference is listed.
- [ ] It is safe by default: off until the user turns it on, local to this Mac and this user, and it says in the app that it is on. It never gives out a key from the keychain, and a text leaves the Mac only where a person's action would send it.
- [ ] A second copy of Sushi with its own profile and identifier can be driven without touching the user's panel, key, clipboard or settings, so an agent checks a build on the working Mac while the owner works.
- [ ] The scenarios in `docs/specs/*.feature` that the interface covers are tagged `@agent` and run by one command; the release checklist asks a person only for the rest, and that rest is listed with the reason.
- [ ] The interface is specified in `docs/specs/` with rule IDs and described on the site for a user who wants an agent to use Sushi.

## Out of scope

- An agent inside Sushi that acts by itself: this task makes Sushi drivable, it adds no autonomy.
- Driving other apps through Sushi, or a general automation tool for macOS.
- Access from another Mac or over a network.
- Replacing the tests that stub the model and the system: they stay the fast check.

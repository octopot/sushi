---
code: SUSI-M1
id: MI_kwDOVy11Hs4BLjR9
databaseId: 19805309
number: 1
url: https://github.com/octopot/sushi/milestone/1
title: "M1: Prompt always at hand"
state: CLOSED
openIssueCount: 0
closedIssueCount: 4
dueOn: null
createdAt: 2026-11-23T10:49:15Z
updatedAt: 2026-11-23T11:09:14Z
closedAt: 2026-11-23T10:49:15Z
---

# M1: Prompt always at hand

One key opens a panel over any app, a full-screen one included. You write a prompt for Claude Code or Codex, or dictate it with a tool such as MacWhisper, change any part of it with ⌘K and see each edit as a diff in your text, step through versions, and ⌘↵ copies the prompt and returns you to the app you came from, where ⌘V pastes it. Edits run on a model on your Mac by default.

**What you get after upgrading**

- Caps Lock shows and hides the panel, on the Space you are in; a click elsewhere hides it and keeps your draft.
- ⌘K edits the selection or the whole prompt with an action or your own words; ⌘← and ⌘→ walk the versions; ⌘L opens templates and saved prompts.
- A right click opens the usual macOS menu, and starting Ollama no longer takes the focus.
- Without Ollama or its model, Sushi says at once what is missing and how to get it.

**Done:** the loop *open → write or dictate → edit → copy and paste* works on the desktop and over a full-screen app on macOS 26 and later. Delivered in v0.1.0 – v0.2.1.

**Checked:** the reporters confirmed the fixes on their Macs, and all four issues are closed. A second display and Stage Manager are still to be tried.

**Known exception:** on one Mac the panel hides after ⌘A ([[SUSI-7]]); the fix is tracked in M2.

## Issues

- [x] [[SUSI-1]] — hotkey: move off ⌘⇧Space, which macOS 27 and 1Password claim
- [x] [[SUSI-2]] — panel: show over a full-screen app without switching Spaces, and stay out of Mission Control
- [x] [[SUSI-3]] — editor: a right click opens the macOS menu, not the actions
- [x] [[SUSI-4]] — rewrite: starting Ollama opens its window and takes the focus

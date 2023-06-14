---
code: null
id: I_kwDOVy11Hs8AAAABgroL2w
databaseId: 6488198107
number: 2
url: https://github.com/octopot/sushi/issues/2
title: "hotkey: move off ⌘⇧Space, which macOS 27 and 1Password claim"
issueType: Bug
labels:
  - "impact: high"
  - "scope: code"
assignees:
  - kamilsk
milestone: null
parent: null
issueFields: {}
state: OPEN
stateReason: null
duplicateOf: null
createdAt: 2026-11-19T11:07:40Z
updatedAt: 2026-11-19T11:33:00Z
lastEditedAt: 2026-11-19T11:33:00Z
closedAt: null
---

# hotkey: move off ⌘⇧Space, which macOS 27 and 1Password claim

## Problem

Sushi opens its panel on ⌘⇧Space, and two others want the same keys: macOS 27 uses ⇧⌘Space for Visual Intelligence, and 1Password used it for Quick Access by default (1Password itself now asks its users to move to ⌥⌘\ for this reason). Whoever holds the keys wins, and registering a global hotkey does not fail when the system or another app owns the combination, so Sushi cannot tell the user that its panel will not open. The app needs macOS 26 or newer, so every user who upgrades to macOS 27 loses the panel.

## PoC

```text
1. macOS 27, Sushi running in the menu bar.
2. Press ⌘⇧Space in any app: Visual Intelligence opens, the Sushi panel does not.
3. With 1Password Quick Access on ⌘⇧Space (its old default), the same keys open 1Password instead.
```

## Expected behavior

One press of Caps Lock opens and hides the panel, with no permission to grant and no other app needed. While Sushi runs it maps Caps Lock to an unused key (F18) the way Raycast does for its Hyper key, so Caps Lock no longer switches case; quitting Sushi gives the key back. A user who wants Caps Lock as it was turns this off and gets a regular combination that is free on macOS 26 and 27.

## Acceptance criteria

- [ ] One press of Caps Lock shows the panel over the frontmost app and a second press hides it, as ⌘⇧Space does today; holding the key does not repeat.
- [ ] The mapping applies to every keyboard, including one connected while Sushi runs, and keeps other key mappings in place; quitting Sushi restores Caps Lock; after a crash the next launch takes the mapping over again.
- [ ] No permission prompt: no Input Monitoring, no Accessibility.
- [ ] Sushi does not take Caps Lock silently when macOS uses it to switch input sources or another tool (Raycast Hyper, Karabiner) already maps it: it says so and uses the fallback combination.
- [ ] The menu bar menu shows the hotkey in use and turns Caps Lock mode on and off; the choice and the fallback combination live in a file in the settings folder, validated like the other settings files.
- [ ] The fallback combination is checked against the shortcuts macOS 26 and 27 enable by default (Spotlight, Finder search, input sources, Character Viewer, Visual Intelligence) and the defaults of 1Password, Raycast and ChatGPT; the list is written down with the decision.
- [ ] A hotkey that cannot be registered shows the combination and the reason.
- [ ] Ships in v0.2.0 with the rename: a user who upgrades from Susi learns the new key from the release note and the site, including how to turn Caps Lock mode off.
- [ ] README, AGENTS.md, the site (landing, quick start, keyboard guide), the specs and the social image name the new key.

## Out of scope

Caps Lock held together with another key (Caps + Space) and double-tapped modifiers: both need an event tap and the Input Monitoring permission.

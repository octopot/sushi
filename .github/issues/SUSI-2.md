---
code: SUSI-2
id: I_kwDOVy11Hs8AAAABgtxFcw
databaseId: 6490441075
number: 3
url: https://github.com/octopot/sushi/issues/3
title: "panel: show over a full-screen app without switching Spaces, and stay out of Mission Control"
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
createdAt: 2026-11-19T13:16:28Z
updatedAt: 2026-11-19T13:16:28Z
lastEditedAt: null
closedAt: null
---

# panel: show over a full-screen app without switching Spaces, and stay out of Mission Control

## Problem

The panel behaves like an ordinary app window, not like an overlay. Over an app in full screen, Caps Lock does not show Sushi on top of it: macOS slides away from that app's full-screen Space to a desktop Space and shows the panel there, so the user loses the screen they were working in. When the panel hides, focus stays on that other Space. Mission Control lists the panel among the windows of the Space as well. Spotlight and Raycast do neither: they appear over whatever is on screen, full screen included, and Mission Control does not show them. It affects everyone who works with apps in full screen, the common case for a terminal or an editor, the apps Sushi writes prompts for.

## PoC

```text
1. Sushi running in the menu bar; Terminal (or any app) in full screen (⌃⌘F).
2. Press Caps Lock: the screen slides to a desktop Space, the panel shows there,
   and Terminal's full-screen Space is no longer on screen.
3. Press Esc: the panel hides, and the screen stays on the desktop Space
   instead of returning to Terminal.
4. On a desktop Space, show the panel and open Mission Control (swipe up with
   three or four fingers, or F3): the panel is listed among the windows.
5. For comparison, ⌘Space (Spotlight) or Raycast's key in steps 2 and 4: they show
   over the full-screen app, the Space does not change, and Mission Control does
   not list them.
```

## Expected behavior

The panel is an overlay on the Space the user is in, like Spotlight. Caps Lock shows it on top of the current Space of the active display, a full-screen Space included, without any switch of Space; the app underneath stays in full screen and stays the app the user returns to. Hiding the panel, by Caps Lock, Esc, ⌘↵ or ⇧⌘↵, leaves the user exactly where they were, with keyboard focus in that app, so a pasted prompt lands there. Mission Control and App Exposé do not list the panel, and ⌘Tab does not list Sushi, as today.

## Acceptance criteria

- [ ] Over an app in full screen, Caps Lock shows the panel on top of it with no Space animation; the app stays in full screen behind the panel.
- [ ] Esc, Caps Lock, ⌘↵ and ⇧⌘↵ hide the panel and keyboard focus is back in the full-screen app on the same Space; after ⌘↵, ⌘V pastes the prompt there.
- [ ] The same on a desktop Space, on a second display (the panel shows on the display the user works on), and with Stage Manager on.
- [ ] Mission Control and App Exposé do not show the panel, whether it is open or hidden.
- [ ] Everything inside the panel works as before: typing and IME, dictation into the editor and the action field, ⌘K, ⌘L, ⌘← ⌘→, ⌘C ⌘V ⌘X ⌘Z ⇧⌘Z ⌘A, the right-click menu, the glass and its shadow.
- [ ] Showing the panel from the menu bar menu (**Show Sushi**) behaves the same way.
- [ ] Checked in a separate macOS session or on a separate Mac, as AGENTS.md asks for keys, Spaces and focus; the steps of the PoC are the check, written down with the result.

## Out of scope

What happens on a click outside the panel or on a switch to another Space while it is open: today the panel stays until hidden, and changing that is a separate decision. The key that shows the panel (SUSI-1), the panel's size and position.

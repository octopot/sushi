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
- [ ] A click in another app, another window or on the desktop hides the panel, as Spotlight and Raycast do; focus stays where the user clicked, and the draft is kept.
- [ ] The same on a desktop Space, on a second display (the panel shows on the display the user works on), and with Stage Manager on.
- [ ] Mission Control and App Exposé do not show the panel, whether it is open or hidden.
- [ ] Everything inside the panel works as before: typing and IME, dictation into the editor and the action field, ⌘K, ⌘L, ⌘← ⌘→, ⌘C ⌘V ⌘X ⌘Z ⇧⌘Z ⌘A, the right-click menu, the glass and its shadow.
- [ ] Dictation tools see the panel's text field: MacWhisper shows its recording bubble while the panel is open, as it does over Raycast, and the text lands in the editor.
- [ ] Showing the panel from the menu bar menu (**Show Sushi**) behaves the same way.
- [ ] Checked by hand, as AGENTS.md asks for keys, Spaces and focus. The checks become regression scenarios in `docs/specs/panel.md`, each run written down with its date, build and result.

## Out of scope

The key that shows the panel (SUSI-1), the panel's size and position. Placing MacWhisper's bubble at the caret: over Raycast it also shows at the top left of the screen.

<!-- 2026-11-19T14:00Z
Checked by hand on macOS 27 with the build of 30f8f36, a full-screen terminal underneath:

| Check | Result |
| --- | --- |
| Caps Lock over a full-screen app | Works: the panel shows on top, no Space switch. |
| Dictation with MacWhisper | Text lands in the editor. In the first run MacWhisper showed no recording bubble, so dictation looked broken while it worked; in a recorded rerun the bubble showed 3 times of 3, at the top left, where it shows over Raycast too. |
| Esc and ⌘↵ return focus | Works. A click in another app does not hide the panel, while Raycast and Spotlight hide: now a criterion. |
| Mission Control | Works: the panel is not listed. |
| Second display, Stage Manager | Not checked: no second display at hand. |

The recording, taken every 0.3 s: with Raycast and with Sushi open, the frontmost app stays the terminal and the accessibility focus moves to the panel's app. Raycast's window sits at level 8, Sushi's at 0.
-->

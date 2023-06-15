# The panel on screen

**Status:** describes Sushi v0.2.1 as implemented. Rules marked with an ID hold today; the system parts of them are checked by hand, with the [regression scenarios](#regression-scenarios) below.

Sushi's window is an overlay, like Spotlight's: it comes up over whatever the user is doing and goes away without moving them anywhere. This document fixes where the panel shows, who has the keyboard while it is open and where focus goes when it hides. The key that shows it is fixed in [LF-18 and LF-19](local-files.md#hotkeyjson--the-key-that-shows-sushi); what is copied on the way out, in [VH-5 to VH-7](version-history.md#copying).

## Terms

- **The app underneath** — the app the user was in when the panel showed. It stays the frontmost app while the panel is open.
- **Non-activating panel** — a macOS window that takes the keyboard without making its app active. Spotlight and Raycast show theirs this way.

## Rules

### Showing

- **PN-1. On the current Space.** Caps Lock (or the combination of LF-18), **Show Sushi** in the menu bar menu and opening Sushi again while it runs show the panel on the Space the user is in, on the active display. A full-screen app's Space counts: the panel comes up over that app, which stays in full screen, and macOS does not switch Spaces.
- **PN-2. Sushi does not become active.** The panel is a non-activating panel: it takes the keyboard while the app underneath stays frontmost, so the menu bar keeps that app's menus. Accessibility tools, dictation included, see the panel's text field as the focused element. A window that cannot become a panel falls back to activating Sushi, which brings back the Space switch of v0.2.0.
- **PN-3. Out of the window lists.** Mission Control, App Exposé and window cycling do not list the panel, and ⌘Tab does not list Sushi.

### Hiding

- **PN-4. Back where the user was.** Caps Lock, Esc, ⌘↵ and ⇧⌘↵ hide the panel. Keyboard focus is back in the app underneath, on the same Space, so ⌘V right after ⌘↵ pastes the prompt there.
- **PN-5. A click elsewhere hides.** When the panel loses the keyboard, by a click in another app, another window or on the desktop, it hides, and focus stays where the user clicked. The same happens when an action of the panel opens another app: **Open in Editor** for the dictionary, **Open Settings Folder**, the link to download Ollama. Hiding keeps the draft and what the panel showed: an open Library is still open on the next show.

## Not supported or switched off

- **The display to show on** is the active one; the panel does not remember a display or a position.
- **MacWhisper's recording bubble** goes to the bottom left corner of the focused text field's whole frame, not to the caret, in every app. The panel's field is the editor's full text, which scrolls inside the panel: with a short prompt the bubble shows under the text, with a prompt taller than the panel it goes below the screen, out of sight. The dictated text lands in the editor either way. Over Raycast the field is one line high, so the bubble sits right under it.
- **Stage Manager and a second display** follow from PN-1 but have not been checked.

## Regression scenarios

Window showing, Spaces, focus and dictation go through the window server and other apps, so no automated test reaches them. Run these by hand before a release that touches `show_launcher`, `hide` or the window code in `src-tauri/src/macos.m`, in a separate macOS session or on a separate Mac, or on the working Mac when its owner runs them. Start the build under test with `open -g <path>/Sushi.app --args --hidden` after quitting the installed one.

| ID | Steps | Expected | Rules |
| --- | --- | --- | --- |
| PR-1 | Put a terminal in full screen (⌃⌘F). Press Caps Lock. | The panel shows over the terminal; no Space animation; the terminal stays in full screen. | PN-1, PN-2 |
| PR-2 | In PR-1, type a phrase, press ⌘A, ⌘C, ⌘V, ⌘Z, right-click a selection, run ⌘K with Shorten, open ⌘L. | Each works as on a desktop Space; the right click opens the macOS context menu (VH-10). | PN-2 |
| PR-3 | In PR-1, dictate into the editor with MacWhisper, once with a short prompt and once with a prompt taller than the panel. | The text lands in the editor both times. The recording bubble shows under a short prompt; under a tall one it is out of sight (see Not supported). | PN-2 |
| PR-4 | In PR-1, press Esc. Show the panel again, press ⌘↵, then ⌘V. | After Esc the terminal has the keyboard on its full-screen Space; ⌘V pastes the prompt into it. | PN-4 |
| PR-5 | Show the panel, click in another app's window, then on the desktop. | The panel hides on the first click; focus is in the clicked app. Caps Lock shows the panel with the draft. | PN-5 |
| PR-6 | Show the panel on a desktop Space and open Mission Control; then App Exposé; then hold ⌘Tab. | The panel is in none of them, and ⌘Tab has no Sushi. | PN-3 |
| PR-7 | With a second display, show the panel on each one; with Stage Manager on, show it over a stage. | It shows on the display the user works on, over the stage, and hides back to it. | PN-1, PN-4 |

### Runs

| Date | Build | Passed | Failed or not run |
| --- | --- | --- | --- |
| 2026-11-19 | 30f8f36 (before PN-5) | PR-1, PR-4, PR-6; PR-3: text lands, the bubble did not show in the first try and showed 3 of 3 in a recorded rerun | PR-5: a click elsewhere left the panel open, fixed by PN-5; PR-2 not run as a whole; PR-7 not run, no second display |
| 2026-11-19 | 4c3b076 | PR-1, PR-4, PR-5, PR-6; PR-2: typing and the edit keys | PR-2: a right click on a selection opened the actions instead of the macOS menu, changed in VH-10; PR-3: the text lands, but MacWhisper showed no bubble again, while it does over Raycast; PR-7 not run, no second display |
| 2026-11-19 | 4c3b076 and the VH-10 change | PR-2: a right click opens the macOS menu; PR-3 explained: with a 1,843 px tall prompt the bubble window opened 5 times of 5 at y = 2169 on a 1117 px screen, the bottom of the field's frame | — |

Add a row for every run: the commit of the build, the scenarios that passed, and what failed or was not run, with the reason.

## Verification

| ID | Check | Code |
| --- | --- | --- |
| PN-1 | PR-1, PR-7 by hand | `show_launcher` in `src-tauri/src/main.rs`; the collection behaviour in `sushi_prepare_window` in `src-tauri/src/macos.m` |
| PN-2 | PR-1, PR-2, PR-3 by hand | `as_panel`, `sushi_present` in `src-tauri/src/macos.m` |
| PN-3 | PR-6 by hand | the transient and ignores-cycle behaviour in `sushi_prepare_window` |
| PN-4 | PR-4 by hand; `composer.test.mjs` checks that Esc, ⌘↵ and ⇧⌘↵ ask to hide | `hide` in `src-tauri/src/main.rs`; `sushi_restore_frontmost` for the fallback of PN-2 |
| PN-5 | PR-5 by hand | the `WindowEvent::Focused(false)` handler in `src-tauri/src/main.rs` |

The stage capture (`tests/stage/capture.sh`) renders the panel on glass after it has become an NSPanel, so a change here that breaks the glass, the corners or the shadow shows in its frames.

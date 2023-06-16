---
code: SUSI-7
id: I_kwDOVy11Hs8AAAABhr0sEg
databaseId: 6555511826
number: 11
url: https://github.com/octopot/sushi/issues/11
title: "panel: hides right after ⌘A selects all text, then flickers on Caps Lock"
issueType: Bug
labels:
  - "scope: code"
  - "impact: high"
assignees:
  - kamilsk
milestone: "[[SUSI-M2]]"
parent: null
issueFields: {}
state: OPEN
stateReason: null
duplicateOf: null
createdAt: 2026-11-23T08:40:41Z
updatedAt: 2026-11-23T10:50:39Z
lastEditedAt: 2026-11-23T09:17:27Z
closedAt: null
---

# panel: hides right after ⌘A selects all text, then flickers on Caps Lock

## Problem

On one user's Mac so far, ⌘A in the panel closes it, every time. After that, and this is the worse part, Caps Lock no longer opens the panel: it flickers, showing and hiding again right away. It does not reproduce on the developer's Mac, and Sushi records nothing about why the panel hid, so the cause can't be found from the outside. How many users it affects is not known. Also not known yet: the Sushi and macOS versions of the affected Mac, whether the text gets selected before the panel hides, whether every later press of Caps Lock flickers the same way, and whether the flicker stays after a restart.

## PoC

```text
1. Sushi is running, and the panel keeps a draft from the last session.
2. Press Caps Lock: the panel shows the draft.
3. Press ⌘A: the panel hides.
4. Press Caps Lock: the panel flickers: it shows and hides again right away.
```

## Expected behavior

⌘A selects the whole text and the panel stays open, as with any other key. Caps Lock shows the panel and keeps it open. When the panel hides, its reason can be found out: a diagnostic mode records why it hid and what took the keyboard.

## Acceptance criteria

- [ ] On a Mac where the bug reproduces, the PoC no longer hides the panel: ⌘A selects all and the panel stays open; Caps Lock shows it and it stays open.
- [ ] PN-5 keeps holding and PR-5 passes: a click in another app, another window or on the desktop hides the panel, and so does an action that opens another app.
- [ ] A diagnostic mode records every show and every hide with its reason: hotkey toggle, Esc or copy from the page, close request, loss of focus. It also records every press and release of the hotkey, with the time.
- [ ] On a loss of focus the record holds what Sushi can see without any permission: its own key window (class and level), whether Sushi is active, the frontmost app with its bundle ID, the on-screen windows above the normal level (owner, level and size), and the last combination with ⌘ or ⌃ the panel received. It never records the prompt, typed characters or other apps' window titles.
- [ ] The record is a plain-text file under `~/Library/Logs` with a size limit. The user can open it and send it without the developer tools.
- [ ] The log starts with the build info block of [[SUSI-8]], so a log always says which build wrote it.
- [ ] The diagnostic code is compiled under a Cargo feature, and the release build enables that feature until this issue closes or [[SUSI-9]] takes the recording over. Removing the feature removes the code.
- [ ] An optional file in the settings folder turns the mode on, and the mode is off without the file. Sushi never creates the file. Sushi reads it on every show (LF-2) and rejects unknown fields. An invalid file is reported as `<file>: …` (LF-4, LF-20).
- [ ] While the mode is on, the panel says so on every show without displacing errors or edit hints, for example `Diagnostics on · <file> turns it off`. The menu bar menu says so too.
- [ ] The file and the log are specified in `docs/specs/local-files.md`, with a schema in `docs/specs/files.cue`, a `cue vet` line and an unseeded example. The list of files Sushi writes gains the log. Rust tests cover reading the file, and a browser scenario covers the notice.
- [ ] The cause is named in this issue, and the fix is a rule in `docs/specs/panel.md` with a regression scenario that states its precondition.

## Out of scope

Changing PN-5, the rule that losing the keyboard hides the panel. A general log of Sushi's work beyond showing, hiding and focus.

<!-- 2026-11-23T09:00Z https://github.com/octopot/sushi/issues/11#issuecomment-7095725338
Hypotheses, most likely first. None of them is verified yet.

1. **Writing Tools (Apple Intelligence).** When text is selected in a web view, macOS may offer Writing Tools, and its window or panel may take the keyboard. Whether it takes key status is not verified. The panel hides on any loss of the keyboard (`WindowEvent::Focused(false)` in `src-tauri/src/main.rs`), and Sushi does not opt out of Writing Tools anywhere. That would explain the flicker: the window is hidden, not destroyed, so the selection survives and focus returns to the editor on the next show, and Writing Tools takes the keyboard again.
   One question can rule this out: after ⌘↵, the next show selects the whole prompt by itself (VH-9). If that show stays open on the affected Mac, a selection alone is not the trigger. PR-2 also presses ⌘A, and it passes on a Mac where Apple Intelligence may be off, so the difference may simply be whether Apple Intelligence is on.
2. **⌘A is intercepted before the page.** A global shortcut of another app or a keyboard utility takes ⌘A and the keyboard with it. This fits a hide without a confirmed selection, and it would explain why the bug does not reproduce elsewhere.
3. **Another app that reacts to selected text.** Popup menus on selection, translators, grammar checkers and AI helpers would act like hypothesis 1, but from another process. System text-assistance panels belong here too: the editor turns on spell checking and autocorrect (`src/editor.ts`).
4. **The hotkey arrives twice.** Sushi already refuses Caps Lock when another `UserKeyMapping` entry maps it (LF-19), and it swallows repeats within one hold. That leaves a mapping added after Sushi started, or a virtual keyboard driver that `UserKeyMapping` does not show, delivering two full presses for one. This could explain the flicker, but not ⌘A.
5. **A version difference.** Sushi supports macOS 26.0 and newer, and the affected Mac's macOS and Sushi versions are not known yet.

Why nothing shows up in a log: Sushi has no log, and the handler hides the panel without recording who took the keyboard.
-->

<!-- 2026-11-23T09:01Z https://github.com/octopot/sushi/issues/11#issuecomment-7095726064
Plan to verify.

1. **On the affected Mac, without a new build.** Record the Sushi and macOS versions (once #12 ships: the build info block from the menu bar menu) and whether Apple Intelligence is on. It reproduces every time on that Mac. Then:
   a. Select with ⇧→, ⇧⌘↓ or a triple click instead of ⌘A. This separates the selection from the key combination.
   b. Press ⌘↵, then Caps Lock. The selection of VH-9 is there, without ⌘A.
   c. After the panel hides, show it with **Show Sushi** from the menu bar menu, then with `"capsLock": false` in `hotkey.json` and ⌃⇧Space. If the flicker stays, hypothesis 4 is out.
   d. Quit Sushi and open it again, then check whether the first Caps Lock works.
   e. Turn off Apple Intelligence or Writing Tools in System Settings and repeat the PoC.
   f. Quit the apps that react to selected text or remap keys, and repeat the PoC. Read `hidutil property --get UserKeyMapping`: it prints decimals per keyboard, and Sushi's own entry is `30064771129 → 30064771181` (0x700000039 → 0x70000006D). Remappers that use a virtual driver do not show there, so look for them in the running apps.
2. **Reproduce in a guest macOS** with Apple Intelligence and Writing Tools on.
3. **The diagnostic mode**, as the acceptance criteria describe: the Cargo feature, the settings file, the notice and the log. Add `WKWebView.isWritingToolsActive` to the record of a loss of focus. Give the build to the affected Mac and read the log after the PoC.
4. **Fix according to the cause.**
   - For Writing Tools: opt out in the panel's web view with `WKWebViewConfiguration.writingToolsBehavior`. It has to be set before the web view exists, and wry creates the configuration unless one is passed in. So the window has to be built in code with `WebviewWindowBuilder::with_webview_configuration` instead of `tauri.conf.json`. The property has no binding in `objc2-web-kit`, so set it in `macos.m` or through `msg_send`.
   - For anything that takes the keyboard briefly: decide one run-loop turn after the loss, by what took the keyboard and not by where the pointer is. tao reports the loss from `windowDidResignKey:`, before the new key window is known. PN-5 has to keep holding for a click elsewhere and for apps the panel opens.
5. **Regression.** Add a scenario to `docs/specs/panel.md` with its precondition, for example: "With Apple Intelligence and Writing Tools on: show the panel, ⌘A, wait 2 s; ⌘↵, Caps Lock". Tie it to PN-2 and PN-5, and record a run on the Mac where it reproduced.
-->

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
updatedAt: 2026-11-24T15:05:28Z
lastEditedAt: 2026-11-24T15:05:25Z
closedAt: null
---

# panel: hides right after ⌘A selects all text, then flickers on Caps Lock

## Problem

On one user's Mac so far, ⌘A in the panel closes it, every time. After that, and this is the worse part, Caps Lock no longer opens the panel: it flickers, showing and hiding again right away. It does not reproduce on the developer's Mac, and when the issue was filed Sushi recorded nothing about why the panel hid. The diagnostic record this issue added named one cause on the affected Mac: the Summary of Writing Tools opens as a sheet of the panel and takes the keyboard from it. How many users it affects is not known. Also not known yet: the Sushi and macOS versions of the affected Mac, whether the text gets selected before the panel hides, whether every later press of Caps Lock flickers the same way, and whether the flicker stays after a restart.

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
- [x] PN-5 keeps holding and PR-5 passes: a click in another app, another window or on the desktop hides the panel, and so does an action that opens another app.
- [x] A diagnostic mode records every show and every hide with its reason: hotkey toggle, Esc or copy from the page, close request, loss of focus. It also records every press and release of the hotkey, with the time.
- [ ] On a loss of focus the record holds what Sushi can see without any permission: its own key window (class and level), whether Sushi is active, the frontmost app with its bundle ID, the on-screen windows above the normal level (owner, level and size), and the last combination with ⌘ or ⌃ the panel received. It never records the prompt, typed characters or other apps' window titles.
- [x] The record is a plain-text file under `~/Library/Logs` with a size limit. The user can open it and send it without the developer tools.
- [x] The log starts with the build info block of [[SUSI-8]], so a log always says which build wrote it.
- [x] The diagnostic code is a permanent part of Sushi, without a Cargo feature: [[SUSI-9]] took the recording over.
- [x] `diagnostics.json` in the settings folder turns the mode on, and the mode is off without it. Sushi writes the file only from **Log panel activity** in Settings ▸ About ([[SUSI-12]]); a hand edit keeps working. Sushi reads it on every show (LF-2) and when the settings window loads, and rejects unknown fields. An invalid file is reported as `diagnostics.json: …` (LF-21).
- [x] While the mode is on, the panel says so on every show without displacing errors or edit hints, for example `Diagnostics on · <file> turns it off`. The menu bar menu says so too.
- [x] The file and the log are specified in `docs/specs/local-files.md`, with a schema in `docs/specs/files.cue`, a `cue vet` line and an unseeded example. The list of files Sushi writes gains the log. Rust tests cover reading the file, and a browser scenario covers the notice.
- [x] The cause is named in this issue, and the fix is a rule in `docs/specs/panel.md` with a regression scenario that states its precondition.

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

<!-- 2026-11-23T16:00Z https://github.com/octopot/sushi/issues/11#issuecomment-7129457134
Cause, confirmed on the affected Mac for one path: **⌘A → Writing Tools → Summary**. macOS attaches the Summary result to the panel as a sheet; the sheet takes the keyboard, `WindowEvent::Focused(false)` hides the panel and the sheet with it, and each later show makes the panel key, AppKit hands the keyboard back to the sheet, and the panel hides again: the flicker. The affected user's diagnostic build on v0.2.1 logged it: `begin sheet` on the panel, `_NSAlertPanel` became key, `focus_lost`, hide; on **Show Sushi** the panel became key and the same sheet took it again 10 ms later.

Not confirmed yet:

- A hide after ⌘A alone. In the same report the panel stayed open after ⌘A; the hide needed the Summary sheet. Whether the original PoC opened such a window by itself is open.
- The Caps Lock flicker. Caps Lock was off in the diagnostic copy, so the runs used **Show Sushi**; hypothesis 4 is not ruled out.
- The fix on a live sheet: in the user's last run of their patched build the sheet did not appear, so the patched branch never ran.

Dropped: turning Writing Tools off in the web view (step 4 of the plan). The Writing Tools button kept appearing with `NSWritingToolsBehaviorNone` set.

Fix, in M2 (PN-8 in `docs/specs/panel.md`):

- Losing the keyboard is decided one run-loop turn later, by the window that took it: the panel's own sheet keeps it open; anything else hides it, as PN-5 says. A sheet that loses the keyboard goes through the same decision, so a click in another app with the sheet in front still hides the panel.
- The hotkey hides the panel while its sheet has the keyboard, and a show with a sheet attached gives the keyboard back to the sheet instead of the editor.
- The focus record of the diagnostic log names an attached sheet, and a kept loss is logged.
- `SUSHI_TEST_SHEET=1` attaches a test sheet on every show, for the regression scenario PR-10 on any Mac. PR-9 adds the Summary path for the affected Mac.

To close: PR-10 on a separate Mac or session, and PR-9 on the affected Mac with Caps Lock on.
-->

<!-- 2026-11-24T12:02Z https://github.com/octopot/sushi/issues/11#issuecomment-7130912491
Reworded after v0.3.0: the diagnostic code is permanent (#13 took the recording over), and `diagnostics.json` is written by **Log panel activity** in Settings ▸ About (#17). Ticked criteria are proven by the tests the Verification table of `docs/specs/local-files.md` names.

Open until checked by hand: PR-9 on the affected Mac with Caps Lock on, which also shows the focus record on a real loss of the keyboard, and PR-5 and PR-10 on any Mac. v0.3.0 carries the fix, but its code has not met a live sheet of Writing Tools yet.
-->

<!-- 2026-11-24T13:30Z https://github.com/octopot/sushi/issues/11#issuecomment-7129458016
The affected user confirmed by hand, on the Mac where it reproduces, that a sheet-aware check fixes the Summary path: their patch against v0.2.1 keeps the panel when it loses the keyboard while `attachedSheet` is set or the key window's `sheetParent` is the panel, and **Show Sushi** over an open sheet raises the panel and makes the sheet key.

Taken from it:

- The panel's own loss of the keyboard is decided at once, by their condition (`sushi_panel_keeps`). `attachedSheet` is set when the sheet begins, before it takes the keyboard, and tao reports the loss only when the run-loop turn ends, after the key window changed; their log shows both (`begin sheet`, then `_NSAlertPanel` key, then `focused=false`). The one-turn wait we had on this path added nothing.
- **Show Sushi** over an open sheet: the same raise, already in ours.

Beyond it, because their patch leaves these open:

- A click in another app, another window or on the desktop with the sheet in front hides the panel (PN-5). Only the sheet loses the keyboard then, and tao does not report it, so with their patch the panel and the sheet stay over the other app. One observer of `NSWindowDidResignKeyNotification` for the panel's sheets decides one turn later, when the new key window is known.
- The hotkey hides the panel while its sheet has the keyboard (PN-4); with their patch Caps Lock only shows it again.
- When the sheet closes and no window has the keyboard, the panel takes it, so typing lands in the editor. Normally AppKit gives the keyboard back to the parent and this does nothing.

Simplified on our side: the deferred decision for the panel's own loss and its `from_panel` branch, the `kept` callback, and the observer's second callback are gone. Without a sheet the panel hides exactly as in v0.2.1. `SUSHI_TEST_SHEET=1` stays for PR-10, but attaches its sheet on the first show only, so PR-4 and PR-5 can follow in the same run. Kept: the walk up `sheetParent` and `deepest_sheet`, which the settings window shares.

Not confirmed yet: none of our code has run against a live sheet. To close: PR-9 on the affected Mac, now with Caps Lock on, and PR-10 in a separate session, each recorded in the runs of `docs/specs/panel.md`.
-->

<!-- 2026-11-24T13:45Z https://github.com/octopot/sushi/issues/11#issuecomment-7133266725
PR-10 in the owner's run by hand on 2026-11-24, on the v0.3.0 code with the fixes then on main (build `05a23ce-dirty`), macOS 27.2, the first time our code met a live sheet. Passed: the test sheet shows over the panel and the panel stays; **Show Sushi** keeps the sheet in front; a click in another app hides both and focus stays there; after **OK** typing lands in the editor and a click elsewhere hides the panel (PR-5).

Failed: after Caps Lock hid the panel with its sheet, the next Caps Lock made the panel flicker, show and hide at once; only **Show Sushi** from the menu brought it back. The likely cause, not yet seen in a log: the sheet got the keyboard from the panel when it began, but a panel under a sheet does not take the keyboard again, and a sheet is an ordinary window that has the keyboard only in the active app. The show asked for it, the sheet lost it in the same turn, and the watcher of the panel's sheets read that as a click elsewhere.

Changed for v0.3.1 (PN-8): a show with a sheet attached brings the panel forward, makes Sushi the active app and gives the keyboard to the sheet; what the windows report until Sushi is active is not a loss. Hiding gives the app underneath its place back. Not confirmed: this needs PR-10 again in the installed build, with *Log panel activity* on. PR-9 on the affected Mac is still to come.
-->

<!-- 2026-11-24T15:05Z https://github.com/octopot/sushi/issues/11#issuecomment-7135442099
PR-10 again, by the owner on the build with the change of PN-8 (`8b6d940` and the working tree): Caps Lock shows the panel with its sheet, hides both, shows both again without a flicker, and again. Together with the first run, PR-10 passes as a whole. The cause named in the previous comment held: a show with a sheet attached has to make Sushi the active app.

Left: PR-9 on the Mac where the panel hid, with Writing Tools.
-->

# The panel on screen

**Status:** describes Sushi v0.3.0 as implemented. Rules marked with an ID hold today; the system parts of them are checked by hand, with the [regression scenarios](#regression-scenarios) below.

Sushi's window is an overlay, like Spotlight's: it comes up over whatever the user is doing and goes away without moving them anywhere. This document fixes where the panel shows, who has the keyboard while it is open, where focus goes when it hides, how it shares the keyboard with the [settings window](settings.md), and what the menu bar menu holds. The key that shows it is fixed in [LF-18 and LF-19](local-files.md#hotkeyjson--the-key-that-shows-sushi); what is copied on the way out, in [VH-5 to VH-7](version-history.md#copying).

## Terms

- **The app underneath** — the app the user was in when the panel showed. It stays the frontmost app while the panel is open.
- **Non-activating panel** — a macOS window that takes the keyboard without making its app active. Spotlight and Raycast show theirs this way.

## Rules

### Showing

- **PN-1. On the current Space.** Caps Lock (or the combination of LF-18), **Show Sushi** in the menu bar menu and opening Sushi again while it runs show the panel on the Space the user is in, on the active display. A full-screen app's Space counts: the panel comes up over that app, which stays in full screen, and macOS does not switch Spaces.
- **PN-2. Sushi does not become active.** The panel is a non-activating panel: it takes the keyboard while the app underneath stays frontmost, so the menu bar keeps that app's menus. Accessibility tools, dictation included, see the panel's text field as the focused element. A window that cannot become a panel falls back to activating Sushi, which brings back the Space switch of v0.2.0.
- **PN-3. Out of the window lists.** Mission Control, App Exposé and window cycling do not list the panel, and ⌘Tab does not list Sushi.
- **PN-11. Starting stays quiet.** Starting Sushi puts its icon in the menu bar and takes the key that shows it; the panel stays closed. It shows by itself only on the first start on a Mac, when there is no settings folder yet. So a login item, and Homebrew opening Sushi again after an upgrade, put nothing in front of the user. Opening Sushi while it already runs shows the panel (PN-1). `--hidden` keeps the panel closed on the first start too.

### Hiding

- **PN-4. Back where the user was.** Caps Lock, Esc, ⌘↵ and ⇧⌘↵ hide the panel. Keyboard focus is back in the app underneath, on the same Space, so ⌘V right after ⌘↵ pastes the prompt there. Over the settings window, PN-10 decides instead.
- **PN-5. A click elsewhere hides.** When the panel loses the keyboard to anything but its own sheet (PN-8), by a click in another app, another window or on the desktop, it hides, and focus stays where the user clicked. The same happens when an action of the panel opens another app: **Open in editor** for the dictionary, the link to download Ollama. Hiding keeps the draft and what the panel showed: an open Library is still open on the next show.

- **PN-8. Its own sheets stay.** A sheet macOS attaches to the panel, such as the result of **Writing Tools → Summary** on a selection, takes the keyboard and the panel stays open under it: while a sheet is attached, the panel losing the keyboard does not hide it. When the sheet loses the keyboard to another app or window, by a click as in PN-5, the panel hides with it; Sushi decides that one run-loop turn after the sheet's loss, once it knows which window took the keyboard. When the sheet closes, the keyboard is back in the editor. The hotkey hides the panel with its sheet open, and the next show brings both back, the sheet in front with the keyboard; **Show Sushi** over an open sheet gives the keyboard back to the sheet. A sheet is an ordinary window, so that show makes Sushi the active app, which a show of the panel alone never does; hiding gives the app underneath its place back. Without a sheet, the panel hides as PN-5 says ([SUSI-7](../../.github/issues/SUSI-7.md)).
- **PN-9. Settings takes the keyboard.** When the settings window opens ([ST-1](settings.md#opening-and-closing)), by ⌘, in the panel or from the menu, a shown panel hides without giving the keyboard back to the app underneath: the window takes it ([ST-2](settings.md#opening-and-closing)). The draft and the panel's view stay, as in PN-5.
- **PN-10. Shown over Settings.** The key that shows Sushi and **Report a problem…** in Settings ▸ About show the panel over the settings window, which stays open. When the window or one of its sheets (a folder picker, a connect screen) had the keyboard, hiding the panel with Esc, ⌘↵, ⇧⌘↵ or the key gives the keyboard back to the window, or to its sheet, instead of the app underneath. A report started from Settings ▸ About hides the panel when the user leaves it, with Esc or Cancel at any step or by copying it, so the window has the keyboard again; a report started from the menu leaves the panel open at the editor, as before ([RP-1](report.md#starting)). A click in the window hides the panel and leaves the keyboard where the click put it; a click in another app hides it as in PN-5.

### Apps Sushi starts

- **PN-6. Ollama starts behind the panel.** When an edit starts the Ollama app (it is installed and not running), the app starts hidden, as Ollama's own command line starts it: its menu bar icon appears, its window does not, and it does not take the keyboard, so the panel stays open under PN-5 and the edit arrives in it. `ollama serve`, started when only the command-line tool is installed, has no window.

### The menu bar menu

- **PN-7. What it holds.** The menu of the menu bar icon is built again whenever what it shows changes, and on every show of the panel. Each row is there for one reason; the rows that report a state appear only while that state holds. In order:

  | Row | When | Why it is there |
  | --- | --- | --- |
  | **Show Sushi** | Always | Shows the panel without the key (PN-1). Its shortcut hint is the key in effect: a combination as the row's own shortcut (⌃⇧Space), Caps Lock as ⇪. When the menu cannot draw the hint, it goes into the title: `Show Sushi · ⇪`, `Show Sushi · ⌥Space`. No hint when no key is active. `F18`, the key Caps Lock arrives as, is never shown. |
  | **Caps Lock unavailable…**, **No shortcut is active…** or **Shortcut settings need attention…** | Only when the key in effect is not the one chosen: Caps Lock is taken or could not be registered; no key is registered; `hotkey.json` is invalid | Says that the key does not work as chosen, and opens Settings ▸ Keyboard, which says why and what to do ([ST-17](settings.md#keyboard)). |
  | **Model · <model name>** ▸ | Always; `Model · Needs attention` with an invalid `model.json` | Where edits run, switched in one click ([MD-15](model.md#connecting-a-provider)). |
  | **Settings…** ⌘, | Always | Opens the settings window ([ST-1](settings.md#opening-and-closing)). |
  | **Report a problem…** | Always | Starts the report in the panel. One row and one way in, so a report does not depend on the settings window ([RP-1, RP-2](report.md#starting)). |
  | **Finish recording** | While a problem report records | Ends the recording and shows the panel at the report ([RP-2](report.md#starting)). |
  | **Diagnostics on · Show log** | While `diagnostics.json` turns the recording on | Says that Sushi records, and shows the log in Finder ([LF-23](local-files.md#diagnosticsjson--recording-why-the-panel-hid)). |
  | **About Sushi** | Always | Opens Settings ▸ About, with the version and **Copy build info** ([ST-29](settings.md#about), [BI-4](build-info.md#rules)). |
  | **Quit Sushi** ⌘Q | Always | Quits Sushi and gives Caps Lock back ([LF-19](local-files.md#hotkeyjson--the-key-that-shows-sushi)). |

  A separator follows **Model** and another precedes **About Sushi**. No row copies anything, and none opens anything it does not name.

## Not supported or switched off

- **The display to show on** is the active one; the panel does not remember a display or a position.
- **MacWhisper's recording bubble** goes to the bottom left corner of the focused text field's whole frame, not to the caret, in every app. The panel's field is the editor's full text, which scrolls inside the panel: with a short prompt the bubble shows under the text, with a prompt taller than the panel it goes below the screen, out of sight. The dictated text lands in the editor either way. Over Raycast the field is one line high, so the bubble sits right under it.
- **Stage Manager and a second display** follow from PN-1 but have not been checked.

## Regression scenarios

Window showing, Spaces, focus and dictation go through the window server and other apps, so no automated test reaches them. Run these by hand before a release that touches `show_launcher`, `hide`, the window code in `src-tauri/src/macos.m`, the settings window (`src-tauri/src/settings_window.rs`), the menu (`src-tauri/src/tray.rs`), the key that shows Sushi (`src-tauri/src/hotkey.rs`) or the way `src-tauri/src/rewrite.rs` starts Ollama, in a separate macOS session or on a separate Mac, or on the working Mac when its owner runs them. Start the build under test with `open -g <path>/Sushi.app --args --hidden` after quitting the installed one.

| ID | Steps | Expected | Rules |
| --- | --- | --- | --- |
| PR-1 | Put a terminal in full screen (⌃⌘F). Press Caps Lock. | The panel shows over the terminal; no Space animation; the terminal stays in full screen. | PN-1, PN-2 |
| PR-2 | In PR-1, type a phrase, press ⌘A, ⌘C, ⌘V, ⌘Z, right-click a selection, run ⌘K with Shorten, open ⌘L. | Each works as on a desktop Space; the right click opens the macOS context menu (VH-10). | PN-2 |
| PR-3 | In PR-1, dictate into the editor with MacWhisper, once with a short prompt and once with a prompt taller than the panel. | The text lands in the editor both times. The recording bubble shows under a short prompt; under a tall one it is out of sight (see Not supported). | PN-2 |
| PR-4 | In PR-1, press Esc. Show the panel again, press ⌘↵, then ⌘V. | After Esc the terminal has the keyboard on its full-screen Space; ⌘V pastes the prompt into it. | PN-4 |
| PR-5 | Show the panel, click in another app's window, then on the desktop. | The panel hides on the first click; focus is in the clicked app. Caps Lock shows the panel with the draft. | PN-5 |
| PR-6 | Show the panel on a desktop Space and open Mission Control; then App Exposé; then hold ⌘Tab. | The panel is in none of them, and ⌘Tab has no Sushi. | PN-3 |
| PR-7 | With a second display, show the panel on each one; with Stage Manager on, show it over a stage. | It shows on the display the user works on, over the stage, and hides back to it. | PN-1, PN-4 |
| PR-8 | Quit Ollama from its menu bar icon, with the Ollama app and the model installed. Show the panel over a terminal, type a phrase, run ⌘K with Shorten. | Ollama's menu bar icon appears and no Ollama window opens; the panel stays open with the keyboard and shows the diff; the menu bar keeps the terminal's menus. | PN-6, PN-2 |
| PR-9 | Precondition: the Mac where the panel hid after ⌘A ([SUSI-7](../../.github/issues/SUSI-7.md)), with Writing Tools on, Caps Lock as the hotkey and *Log panel activity* on in Settings ▸ About. Show the panel with a draft, press ⌘A, wait 2 s; press Caps Lock twice. Then select all again, choose **Writing Tools → Summary** and wait for its sheet; press Caps Lock twice; choose **Show Sushi** in the menu bar menu; click another app's window, then press Caps Lock; close the sheet and type; click another app's window. Then **Diagnostics on · Show log**. | ⌘A selects all and the panel stays open; Caps Lock hides and shows it without flicker. The Summary sheet opens over the panel, the panel stays, and the log has `focus kept`. Caps Lock hides both and shows them again with the sheet in front; **Show Sushi** keeps the sheet in front. The click hides both, focus stays in the clicked app, and Caps Lock brings them back with the sheet in front. After the sheet closes, typing lands in the editor, and the last click hides the panel. When the panel hides at any other step, the log's `focus lost` record names what took the keyboard. | PN-2, PN-5, PN-8, LF-22 |
| PR-10 | Start the build with `open -g --env SUSHI_TEST_SHEET=1 <path>/Sushi.app --args --hidden`, which attaches a test sheet to the panel on its first show. Press Caps Lock; press it twice more; choose **Show Sushi** in the menu bar menu; click another app's window; press Caps Lock, press **OK** and type; click another app's window; press Caps Lock, then Esc; then run PR-5. | The sheet shows over the panel and the panel stays. Caps Lock hides the panel with the sheet and shows both again, the sheet in front with the keyboard. **Show Sushi** keeps the sheet in front with the keyboard. The click hides both and focus stays in the clicked app; the next show brings the sheet back in front. After **OK** typing lands in the editor, and the click hides the panel. Esc gives the keyboard back to the app underneath. PR-5 passes. | PN-4, PN-5, PN-8 |
| PR-11 | Show the panel over a terminal and press ⌘,. Press Caps Lock, then Esc, and type into a field of Settings. Press Caps Lock, click inside Settings. Press Caps Lock, click the terminal. Open Settings again from **Settings…** in the menu, open About, click **Report a problem…**, press Esc. Choose **About Sushi** in the menu while Settings is behind another app. Press ⌘W. | ⌘, hides the panel and Settings opens on the same Space with the keyboard; the panel does not come back. Caps Lock shows the panel over Settings, and Esc gives the keyboard back to Settings: the typing lands there. A click in Settings hides the panel and the field clicked has the keyboard. A click in the terminal hides the panel with focus in the terminal. **Report a problem…** shows the panel at *What went wrong?* over Settings, and Esc returns to Settings. **About Sushi** brings the same window forward at About, never a second one. ⌘W hides Settings, the panel does not show, the terminal is active and takes typing. | PN-9, PN-10, ST-1, ST-2, ST-3 |
| PR-12 | With Caps Lock in effect, open the menu bar menu. In Settings ▸ Keyboard choose **Keyboard shortcut**, record ⌥Space and open the menu again. Choose **Caps Lock** again. Turn on “Use the Caps Lock key to switch to and from ABC” in System Settings ▸ Keyboard ▸ Input Sources, quit Sushi and start it; open the menu and choose the row under **Show Sushi**. Then turn the macOS option off and click in Settings. | First **Show Sushi** shows ⇪ as its shortcut and no row follows it. After the recording it shows ⌥Space. After the restart it shows ⌥Space, the backup, and **Caps Lock unavailable…** follows it; choosing that row opens Settings at Keyboard, which leads with *Caps Lock is used to switch input sources.*, says to use ⌥Space and offers **Open macOS keyboard settings…**. Once the option is off, coming back to Settings makes Caps Lock show Sushi again, and the row leaves the menu. `F18` shows nowhere. | PN-7, ST-17 |
| PR-13 | In Settings ▸ Keyboard choose **Keyboard shortcut**. Click **Change…** and press ⌃⇧Space, then record ⌥Space. Click **Change…** again, hold ⌥Space for two seconds and release it; press ⌥Space once more. Click **Change…** and click another app. Record a combination another app already holds. Then choose **Caps Lock**, click **Change…** and press Caps Lock, then record as the backup the combination another app holds, then ⌃⇧Space. | While recording, the key in effect neither shows nor hides the panel; a combination is recorded when released. The held ⌥Space is recorded and the panel does not show; the next ⌥Space shows it once. Clicking another app ends the recording, and the key in effect works again. A combination another app holds is not saved, and the field says that ⌥Space still shows Sushi. With Caps Lock chosen, pressing Caps Lock while recording toggles nothing; the held backup is not saved (*… Caps Lock still shows Sushi.*), and ⌃⇧Space is saved as the backup while Caps Lock keeps showing Sushi. | ST-16, ST-18 |
| PR-14 | In Settings ▸ Model click **Connect…** on OpenAI. With its sheet open, press Caps Lock; type in the panel; press Esc. Click **Cancel**. | The connect screen opens as a sheet of Settings. Caps Lock shows the panel over Settings and its sheet; Esc gives the keyboard back to the sheet's key field. **Cancel** changes nothing. | PN-10, ST-22, MD-17 |
| PR-15 | In Settings ▸ Model click **Connect…** on OpenRouter, then **Connect** on its sheet; when the browser opens, press ⌘W in Settings. Approve in the browser. Then disconnect OpenRouter, connect again, close Settings while the browser waits, and deny in the browser; open Settings. | After the approval no alert shows over the browser; the Model menu has OpenRouter checked, and the next Settings shows it *In use*. After the denial no alert shows either; the next open of Settings shows *OpenRouter is not connected* as a sheet, and the previous choice is in effect. | ST-22, MD-17 |
| PR-16 | Quit Sushi from its menu and open it from Applications. Press Caps Lock twice. Open Sushi from Applications again. | The icon comes back to the menu bar and no panel shows, with focus left where it was. Caps Lock shows the panel and hides it. Opening Sushi while it runs shows the panel. On an account where Sushi never ran, the first opening shows the panel. |

### Runs

| Date | Build | Passed | Failed or not run |
| --- | --- | --- | --- |
| 2026-11-19 | 30f8f36 (before PN-5) | PR-1, PR-4, PR-6; PR-3: text lands, the bubble did not show in the first try and showed 3 of 3 in a recorded rerun | PR-5: a click elsewhere left the panel open, fixed by PN-5; PR-2 not run as a whole; PR-7 not run, no second display |
| 2026-11-19 | 4c3b076 | PR-1, PR-4, PR-5, PR-6; PR-2: typing and the edit keys | PR-2: a right click on a selection opened the actions instead of the macOS menu, changed in VH-10; PR-3: the text lands, but MacWhisper showed no bubble again, while it does over Raycast; PR-7 not run, no second display |
| 2026-11-19 | 4c3b076 and the VH-10 change | PR-2: a right click opens the macOS menu; PR-3 explained: with a 1,843 px tall prompt the bubble window opened 5 times of 5 at y = 2169 on a 1117 px screen, the bottom of the field's frame | — |
| 2026-11-19 | fa2c689 and the PN-6 change | PR-8: with Ollama quit, ⌘K Shorten started Ollama with its menu bar icon only, no window; the panel stayed open and showed the diff | — |
| 2026-11-23 | v0.2.1 from the cask | PR-1; PR-2: ⌘K through OpenRouter, ⌘L; PR-4: Esc, Caps Lock, ⌘↵ and ⇧⌘↵ return focus, ⌘V pastes; PR-5; PR-8; **Show Sushi** from the menu over a full-screen app behaves as Caps Lock | PR-7 not run, no second display |
| 2026-11-23 | v0.2.1 from the cask | PR-7 with Stage Manager on macOS 27.2: the panel shows over the stage, Esc hides it with focus back in the stage's window, a click on another app's thumbnail hides it | PR-7 on a second display not run, no second display |
| 2026-11-24 | the working tree on 8891b78, `tests/stage/settings.sh` in stage mode on macOS 27.2 | The settings window end to end in the real app: 23 checks passed (ST-5, ST-6, ST-13, ST-15, ST-24, ST-28, ST-30), 20 frames captured | PR-11 to PR-15 not run: they need a separate macOS session |

Add a row for every run: the commit of the build, the scenarios that passed, and what failed or was not run, with the reason.

## Verification

| ID | Check | Code |
| --- | --- | --- |
| PN-1 | PR-1, PR-7 by hand | `show_launcher` in `src-tauri/src/main.rs`; the collection behaviour in `sushi_prepare_window` in `src-tauri/src/macos.m` |
| PN-2 | PR-1, PR-2, PR-3 by hand | `as_panel`, `sushi_present` in `src-tauri/src/macos.m` |
| PN-3 | PR-6 by hand | the transient and ignores-cycle behaviour in `sushi_prepare_window` |
| PN-4 | PR-4 by hand; `composer.test.mjs` checks that Esc, ⌘↵ and ⇧⌘↵ ask to hide | `hide` in `src-tauri/src/main.rs`; `sushi_restore_frontmost` for the fallback of PN-2 |
| PN-5 | PR-5 by hand | the `WindowEvent::Focused(false)` handler, `focus_lost` and `sheet_lost` in `src-tauri/src/main.rs`; `sushi_panel_keeps`, `sushi_watch_sheets` in `src-tauri/src/macos.m` |
| PN-6 | PR-8 by hand; `starts_the_app_hidden_and_behind` in `src-tauri/src/rewrite.rs` fixes the `open` arguments | `launch_app` in `src-tauri/src/rewrite.rs` |
| PN-7 | `tray::tests::the_usual_menu_has_no_row_for_the_key`, `the_key_in_effect_is_the_hint_of_show_sushi`, `a_problem_gets_a_row_that_leads_to_the_setting`, `a_recording_and_the_diagnostic_mode_add_their_rows`; `providers::tests::the_model_menu_lists_the_choices_and_the_way_to_settings`; the native menu and its ⇪: by hand, PR-12 | `rows`, `build`, `caps_hint` in `src-tauri/src/tray.rs`; `sushi_menu_caps_hint` in `src-tauri/src/macos.m`; `model_menu` in `src-tauri/src/providers.rs` |
| PN-8 | PR-10 by hand; PR-9 on the Mac of SUSI-7 | `sushi_panel_keeps`, `sushi_watch_sheets`, `sushi_present_sheet`, `sushi_panel_family_key`, `sushi_test_sheet` in `src-tauri/src/macos.m`; `show_launcher` and the `WindowEvent::Focused(false)` handler in `src-tauri/src/main.rs` |
| PN-9 | PR-11 by hand | `hide_for_settings` in `src-tauri/src/main.rs`; `open` in `src-tauri/src/settings_window.rs` |
| PN-10 | PR-11, PR-14 by hand; `composer.test.mjs` — Report from Settings ▸ About: leaving it hides the panel, so Settings has the keyboard again (RP-1) | `OVER_SETTINGS`, `hide`, `show_launcher` and `open_report` in `src-tauri/src/main.rs`; `has_keyboard`, `take_keyboard` in `src-tauri/src/settings_window.rs`; `sushi_window_family_key`, `sushi_window_family_focus` in `src-tauri/src/macos.m`; `openReport` in `src/main.ts` |
| PN-11 | `tests::the_panel_shows_by_itself_only_on_the_first_start` in `src-tauri/src/main.rs`; PR-16 by hand | `shows_at_start` and the start of `setup` in `src-tauri/src/main.rs` |

The stage capture (`tests/stage/capture.sh`) renders the panel on glass after it has become an NSPanel, so a change here that breaks the glass, the corners or the shadow shows in its frames.

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

Window showing, Spaces, focus and dictation go through the window server and other apps, so no automated test reaches them. What only a real session can check is written as acceptance scenarios in Gherkin, one file beside each specification: [`panel.feature`](panel.feature), [`settings.feature`](settings.feature), [`model.feature`](model.feature), [`report.feature`](report.feature) and [`build-info.feature`](build-info.feature). They do not repeat what `npm test`, the Rust tests or `tests/stage/settings.sh` prove.

- **One ID each.** A scenario has an ID, `PR-n`, in one series across the files; a Verification table that says *PR-n by hand* means that scenario. An ID keeps its meaning: a scenario that checks something else gets a new one.
- **Tags say what and who.** Every scenario is tagged with its ID, with the rules it checks (`@PN-8`, `@ST-22`), and with who can run it: `@hands`, a person in a real macOS session, which is all of them today, or `@agent`, once an agent can drive Sushi from outside. A few more tags cut a run: `@smoke` for the two-minute basics after every upgrade, and `@account`, `@writing-tools`, `@second-display`, `@affected-mac` and `@fresh-account` for what a scenario needs beyond the app.
- **Steps.** `Given` is the setup, with a command in a doc string where the build has to be started in a certain way. Each `When` is one action, and each `Then` after it one thing to see. Labels are quoted as the app shows them.

Run them before a release that touches `show_launcher`, `hide`, the window code in `src-tauri/src/macos.m`, the settings window (`src-tauri/src/settings_window.rs`), the menu (`src-tauri/src/tray.rs`), the key that shows Sushi (`src-tauri/src/hotkey.rs`), the connect flow (`src-tauri/src/providers.rs`) or the way `src-tauri/src/rewrite.rs` starts Ollama, in a separate macOS session or on a separate Mac, or on the working Mac when its owner runs them. Start the build under test with `open -g <path>/Sushi.app --args --hidden` after quitting the installed one.

`make checklist` renders the scenarios as a Markdown checklist, for a person or an agent: the setup, the actions numbered, and a box for each thing to see. `ARGS` selects: `make checklist ARGS='--tag smoke'`, `--rule PN-8` for the scenarios of a rule, `--id PR-10` for one, `--skip account` to leave some out, `--out <file>` to write it to a file. `make scenarios`, a part of `make verify`, checks that every scenario has one ID, one runner and rules that exist, that every `PR-n` the specifications mention is a scenario, and that the table below is current (`node .github/scripts/scenarios.mjs index --write` writes it).

Every run gets a row in [runs.md](runs.md): the build, who ran it, what passed, and what failed or was not run, with the reason.

<!-- scenarios:index -->
| ID | Scenario | File | Rules |
| --- | --- | --- | --- |
| PR-1 | The panel shows over a full-screen app | [panel.feature](panel.feature) | PN-1, PN-2 |
| PR-2 | Typing and the edit keys work over a full-screen app | [panel.feature](panel.feature) | PN-2, VH-10 |
| PR-3 | Dictation lands in the editor | [panel.feature](panel.feature) | PN-2 |
| PR-4 | Hiding gives the keyboard back to the app underneath | [panel.feature](panel.feature) | PN-4 |
| PR-5 | A click elsewhere hides the panel | [panel.feature](panel.feature) | PN-5 |
| PR-6 | The panel is out of the window lists | [panel.feature](panel.feature) | PN-3 |
| PR-7 | A second display and Stage Manager | [panel.feature](panel.feature) | PN-1, PN-4 |
| PR-8 | Ollama starts behind the panel | [panel.feature](panel.feature) | PN-6, PN-2 |
| PR-9 | The Writing Tools sheet on the Mac where the panel hid | [panel.feature](panel.feature) | PN-2, PN-5, PN-8, LF-22 |
| PR-10 | A sheet of the panel stays, hides and comes back with it | [panel.feature](panel.feature) | PN-4, PN-5, PN-8 |
| PR-11 | The panel and the settings window share the keyboard | [panel.feature](panel.feature) | PN-9, PN-10, ST-1, ST-2, ST-3 |
| PR-12 | The menu names the key in effect, and says when Caps Lock is taken | [panel.feature](panel.feature) | PN-7, ST-17 |
| PR-13 | Recording the key that shows Sushi | [settings.feature](settings.feature) | ST-16, ST-18 |
| PR-14 | The connect screen is a sheet of Settings and keeps the keyboard | [model.feature](model.feature) | PN-10, ST-22, MD-17, MD-13 |
| PR-15 | A sign-in that ends while Settings is closed shows no alert | [model.feature](model.feature) | ST-22, MD-17 |
| PR-16 | Starting Sushi stays quiet | [panel.feature](panel.feature) | PN-11 |
| PR-17 | The two-minute basics after an upgrade | [panel.feature](panel.feature) | PN-1, PN-4, VH-5, LF-12 |
| PR-18 | The first start on a Mac shows the panel | [panel.feature](panel.feature) | PN-11 |
| PR-19 | The menu bar menu holds its rows | [panel.feature](panel.feature) | PN-7, MD-15 |
| PR-20 | OpenRouter by sign-in, with a real account | [model.feature](model.feature) | MD-14, MD-16, MD-8, MD-11, ST-22 |
| PR-21 | A hosted provider that is not reachable offers Ollama | [model.feature](model.feature) | MD-6, MD-1 |
| PR-22 | OpenAI by a pasted key, with a real account | [model.feature](model.feature) | MD-13, MD-15, MD-16, MD-8, ST-21 |
| PR-23 | Claude by a pasted key, with a real account | [model.feature](model.feature) | MD-13, MD-16, MD-8, ST-23 |
| PR-24 | A report from the menu, by hand | [report.feature](report.feature) | RP-1, RP-2, RP-3, RP-4, RP-5, RP-8 |
| PR-25 | Copy build info and sushi version say the same | [build-info.feature](build-info.feature) | BI-3, BI-4, BI-5, BI-6 |
| PR-26 | The library folder and its picker | [settings.feature](settings.feature) | ST-27 |
| PR-27 | VoiceOver and a session without the mouse | [settings.feature](settings.feature) | ST-4 |
| PR-28 | A sign-in the browser never answers is cancelled | [model.feature](model.feature) | MD-14, ST-22 |
<!-- /scenarios:index -->

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

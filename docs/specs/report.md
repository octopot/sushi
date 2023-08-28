# Reporting a problem

**Status:** describes Sushi v0.3.0 as implemented. Rules marked with an ID hold today and are checked by the tests listed under [Verification](#verification).

When Sushi misbehaves, the user starts **Report a problem** from the menu bar menu or from Settings ▸ About, and a window of its own opens. There they say what happened in their own words, and gets one text that support can act on: their description, the answers to a few questions, which build runs and the state of Sushi, with everything personal left out. The user reads it, edits it and sends it themselves. Sushi never sends it, and *nothing leaves your Mac without your say* stays true.

## Terms

- **The flow** — the steps of Report a problem in its window: describe, questions, recording, report.
- **The report's window** — a normal window of Sushi, like the settings window: it stays open when the user turns to another app or to the panel, can be moved and resized, and shows in Mission Control.
- **Snapshot** — what Sushi collects about itself for the report (RP-6), built only from the fields listed there.
- **Recording** — the record of the diagnostic mode ([LF-22](local-files.md#the-diagnostic-log)) made while the user repeats the steps.

## Rules

### Starting

- **RP-1. A window of its own, never by itself.** **Report a problem…** in the menu bar menu and in Settings ▸ About open the report's window at the flow's first step, *What went wrong?*, and make Sushi the active app, as the settings window does ([ST-2](settings.md#opening-and-closing)); a shown panel hides first ([PN-9](panel.md#hiding)). Starting records nothing and sends nothing. A report is written while the user looks things up, in other apps and in Sushi itself, so the window stays open when the keyboard goes elsewhere, and the panel works as usual while it is open: the key shows the panel over the window, and hiding it gives the keyboard back to the window ([PN-10](panel.md#hiding)). There is one window: asking for it again brings it forward with the flow where the user left it. Its close button and ⌘W hide it and keep the flow; **Esc**, **Cancel** and **Done** leave the flow, which closes the window, and the next **Report a problem…** starts from an empty description. The panel links to the flow from no message today.
- **RP-2. One way in.** The flow lives in its window and nowhere else: both entries open the same window, and the menu keeps its row, so a report never depends on the settings window. While a recording runs, the menu has **Finish recording**, which ends it and brings the window forward at the report. The window does not need the panel: when the panel does not show or does not stay open, the report can still be written, and Settings ▸ About also gives **Copy build info** and *Log panel activity* with **Show log** ([ST-29, ST-30](settings.md#about)).

### Describing

- **RP-3. Up to three questions.** After the description the flow asks at most three follow-up questions, each optional, and **Skip** passes them all.
  - With Ollama active, the local model writes the questions, in the language of the description.
  - With a hosted provider active ([MD-2](model.md#choosing-the-provider)), the flow first says the description would go to that provider and asks: **Ask <Name>** sends it, **Use standard questions** keeps it on the Mac.
  - The standard questions, used also when the model fails or asks nothing: *What were you doing when it happened?*, *What did you expect to happen instead?*, *Does it happen again when you repeat the same steps?*

  The model receives the description only: never the answers, the snapshot or the recording, and no text of the prompt.
- **RP-4. The user's words.** The description and the answers go into the report as written, typed or dictated.

### Recording

- **RP-5. While the steps are repeated.** **Start recording** turns on the recording of the diagnostic mode in memory, empties `~/Library/Logs/me.octopot.sushi/report-recording.log` and starts it with the build info block; Sushi still never creates `diagnostics.json`. The window stays open at *Recording…* with **Finish recording** while the user repeats the steps in the panel, and the top of the panel says `Recording for a problem report · Finish recording` on every show. The recording stops when the user finishes it, in the window, at the top of the panel or in the menu, leaves the flow or quits Sushi; finished from the panel or the menu, the window comes forward at the report. Leaving the flow also forgets it, so no later report takes it, and is cut from its start past 512 KB, as the diagnostic log is.

### The report

- **RP-6. The snapshot.** It holds, and can hold, only:
  - the build info block of [BI-1](build-info.md#rules);
  - the panel, as it is when the report is built: which view it shows (`editor`, `actions` or `library`), the number of versions in the chain and whether an edit is running; `unknown` when the panel's page does not answer within half a second;
  - for `rules.json`, `dictionary.json`, `hotkey.json`, `model.json`, `diagnostics.json` and `library-path.txt`: absent, valid or invalid, with the kind of problem (*a duplicate entry*, *JSON that is not valid*) and never its text; the number of actions and terms;
  - the library: where its folder comes from (`default`, `custom` for `library-path.txt`, `environment` for `SUSHI_LIBRARY_DIR`) and the number of prompts and templates;
  - the hotkey: `capsLock`, the key in effect (`not registered` when none could be) and the conflicts Sushi detected by kind; the keyboard input source's identifier; dark or light appearance;
  - the model: the active provider and its model name, the connected providers, how the last hosted edit since Sushi started ended (*answered*, *not reachable*, *out of credits* and so on, never the provider's text), and Ollama: running with its version and whether `qwen3.5:4b-mlx` is present, installed and not running, or not installed. Sushi asks only the Ollama server at `127.0.0.1`; a hosted provider is not contacted;
  - the recording's size, if there is one.
- **RP-7. Nothing personal.** The snapshot and the recording are built from the fields of RP-6 and LF-22 only. They never hold prompt text, drafts, versions, names or contents of library files, dictionary terms, action names or instructions, API keys, file paths, the user or computer name, or other apps' window titles. They hold other apps' bundle IDs, and the report says so.
- **RP-8. Read, edit, copy or save.** The last step shows the whole report as one editable text. Every part can be changed or removed, the snapshot included; the recording is listed with its size and can be left out. **Copy** (⌘↵) puts the text on the clipboard and keeps the window, so the report can still be saved; ⌘↵ is the main button of every step wherever the keyboard focus is, also after a click on a button or the checkbox took it from the field. **Save…** writes `report.txt`, and the recording if kept, to a new folder in `~/Library/Logs/me.octopot.sushi/Reports/` and shows it in Finder. Sushi never sends the report: apart from the questions of RP-3 that the user agreed to, the flow makes no network request.
- **RP-9. Format 1.** The text is plain Markdown, readable by a person and by an agent, and fits a chat message or an email; the recording goes as a separate file:

  ```text
  Sushi problem report · format 1

  ## What went wrong

  <the description>

  ## Follow-up questions

  1. <question>
     <answer, or (skipped)>

  ## Build

  <the block of BI-1>

  ## State

  <the snapshot of RP-6>

  ## Recording

  report-recording.log (12.3 KB), sent as a separate file. It lists when the panel showed and hid, the keys with ⌘ or ⌃, and the bundle IDs of the apps and windows around it; never the text.
  ```

  A section without content is left out (*Follow-up questions*) or says so (`No recording.`). A recording cut at its start says so after its size. A change of these sections is a new format number.

## Worked example

The panel hides after ⌘A. The user chooses **Report a problem…**, and in the window that opens types *Панель закрывается после ⌘A.*, answers *Что вы делали?* from Ollama with *Нажимал ⌘A*, skips the second question and starts the recording. With the window still open beside it, they press Caps Lock and ⌘A twice in the panel, then **Finish recording** in the window. The report shows their words, the block, `panel: editor view, 1 version in the chain, an edit not running`, `hotkey: capsLock true, in effect Caps Lock, conflicts none` and `report-recording.log (3.1 KB)`. **Save…** opens Finder at the folder with `report.txt` and the recording, which they attach to an email.

## Not supported

- Sending the report from Sushi: a prefilled GitHub issue, an email draft or a service of ours. The candidates are compared in [SUSI-9](../../.github/issues/SUSI-9.md).
- A report in the panel: until v0.3.0 the flow covered the panel, which hides when the keyboard leaves it, so the report went out of sight whenever the user looked something up. An earlier build also saved a report with a placeholder for the description straight from the menu; one way in replaced it.
- Crash reports, automatic collection and usage analytics.
- Screenshots: a picture of the panel would carry the prompt.

## Verification

| ID | Test | Code |
| --- | --- | --- |
| RP-1 | `report.test.mjs` — describe, answer, record … (nothing recorded at the start, the handles that move the window, Esc leaves and closes it, the next flow starts empty); closing the window keeps the flow; `settings.test.mjs` — about: copy only says Copied when it worked; Build details; Report a problem; the log (the stub); `tests/stage/report.sh` — the real window loads its page and walks the flow; the window among other apps, the panel over it and the keyboard back: by hand, PR-24, PR-11 | `src/report-window.ts`, `Report` in `src/report.ts`; `open`, `close` in `src-tauri/src/report_window.rs`; the `sushi-report` item in `src-tauri/src/main.rs`; `prefs_action` in `src-tauri/src/preferences.rs` |
| RP-2 | `tray::tests::the_usual_menu_has_no_row_for_the_key` (one row, no submenu), `a_recording_and_the_diagnostic_mode_add_their_rows` (Finish recording); the menu items: by hand | `record` in `src-tauri/src/report.rs`; `rows` in `src-tauri/src/tray.rs` |
| RP-3, RP-4 | `report.test.mjs` — … (Ollama's questions get the description only); a hosted provider gets the description only with consent; `report::tests::reads_the_questions` | `report_questions`, `questions` |
| RP-5 | `report.test.mjs` — the window stays at *Recording…* and offers only to finish; the panel or the menu can finish a recording; `composer.test.mjs` — Report a problem lives in its own window … (the notice at the top of the panel finishes it) | `diagnostics::report`; `report_record`; `showStatus` in `src/main.ts` |
| RP-6, RP-7 | `report::tests::plants_a_marker_everywhere_and_finds_none_in_the_report` (with the last hosted edit's outcome); `hosted::tests::anthropic_request` (the outcome is remembered) plants a marker in the draft's folder path (the home folder's name), `rules.json`, `dictionary.json`, `hotkey.json`, the key in `model.json` and in the keychain, `library-path.txt`, the library's prompt and template names and contents, and the panel's view; `composer.test.mjs` — the panel answers with its view, versions and edit state, never its text; `tests/stage/report.sh` — the hidden panel answers in the real app; `diagnostics::tests::keeps_only_combinations` | `snapshot`, `kind`; `panel`, `report_panel` in `src-tauri/src/report.rs` |
| RP-8 | `report.test.mjs` — … (edited text copied and the window kept, saved without the recording, ⌘↵ with the focus nowhere, no network request) | `Report.finish`; `report_save` |
| RP-9 | `report::tests::renders_format_1` | `render` |

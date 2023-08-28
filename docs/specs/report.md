# Reporting a problem

**Status:** describes Sushi v0.3.0 as implemented. Rules marked with an ID hold today and are checked by the tests listed under [Verification](#verification).

When Sushi misbehaves, the user starts **Report a problem** from the menu bar menu or from Settings ▸ About, says what happened in their own words, and gets one text that support can act on: their description, the answers to a few questions, which build runs and the state of Sushi, with everything personal left out. The user reads it, edits it and sends it themselves. Sushi never sends it, and *nothing leaves your Mac without your say* stays true.

## Terms

- **The flow** — the steps of Report a problem in the panel: describe, questions, recording, report.
- **Snapshot** — what Sushi collects about itself for the report (RP-6), built only from the fields listed there.
- **Recording** — the record of the diagnostic mode ([LF-22](local-files.md#the-diagnostic-log)) made while the user repeats the steps.

## Rules

### Starting

- **RP-1. From the menu, never by itself.** The menu bar menu has **Report a problem…**, which shows the panel with the flow's first step, *What went wrong?*. Starting records nothing and sends nothing. **Esc** or **Cancel** leaves at any step, and the editor comes back as it was. **Report a problem…** in Settings ▸ About starts the same flow with the panel over the settings window; leaving a flow started there, with **Esc** or **Cancel** at any step or by copying the report, also hides the panel, so the window has the keyboard again ([PN-10](panel.md#hiding)). The menu keeps its row, so a report never depends on the settings window. The panel links to the flow from no message today.
- **RP-2. One way in.** The flow lives in the panel and nowhere else: the menu has no second way to a report. While a recording runs, the menu has **Finish recording**, which ends it and shows the panel at the report. When the panel does not show or does not stay open, Settings ▸ About gives what a developer needs without the flow: **Copy build info** and *Log panel activity* with **Show log** ([ST-29, ST-30](settings.md#about)).

### Describing

- **RP-3. Up to three questions.** After the description the flow asks at most three follow-up questions, each optional, and **Skip** passes them all.
  - With Ollama active, the local model writes the questions, in the language of the description.
  - With a hosted provider active ([MD-2](model.md#choosing-the-provider)), the flow first says the description would go to that provider and asks: **Ask <Name>** sends it, **Use standard questions** keeps it on the Mac.
  - The standard questions, used also when the model fails or asks nothing: *What were you doing when it happened?*, *What did you expect to happen instead?*, *Does it happen again when you repeat the same steps?*

  The model receives the description only: never the answers, the snapshot or the recording, and no text of the prompt.
- **RP-4. The user's words.** The description and the answers go into the report as written, typed or dictated.

### Recording

- **RP-5. While the steps are repeated.** **Start recording** turns on the recording of the diagnostic mode in memory, empties `~/Library/Logs/me.octopot.sushi/report-recording.log` and starts it with the build info block; Sushi still never creates `diagnostics.json`. The flow steps aside so the panel can be used, and the top of the panel says `Recording for a problem report · Finish recording` on every show. The recording stops when the user finishes it, in the panel or the menu, leaves the flow or quits Sushi. Leaving the flow also forgets it, so no later report takes it, and is cut from its start past 512 KB, as the diagnostic log is.

### The report

- **RP-6. The snapshot.** It holds, and can hold, only:
  - the build info block of [BI-1](build-info.md#rules);
  - the panel: which view was open when the flow started (`editor`, `actions` or `library`), the number of versions in the chain and whether an edit was running;
  - for `rules.json`, `dictionary.json`, `hotkey.json`, `model.json`, `diagnostics.json` and `library-path.txt`: absent, valid or invalid, with the kind of problem (*a duplicate entry*, *JSON that is not valid*) and never its text; the number of actions and terms;
  - the library: where its folder comes from (`default`, `custom` for `library-path.txt`, `environment` for `SUSHI_LIBRARY_DIR`) and the number of prompts and templates;
  - the hotkey: `capsLock`, the key in effect (`not registered` when none could be) and the conflicts Sushi detected by kind; the keyboard input source's identifier; dark or light appearance;
  - the model: the active provider and its model name, the connected providers, how the last hosted edit since Sushi started ended (*answered*, *not reachable*, *out of credits* and so on, never the provider's text), and Ollama: running with its version and whether `qwen3.5:4b-mlx` is present, installed and not running, or not installed. Sushi asks only the Ollama server at `127.0.0.1`; a hosted provider is not contacted;
  - the recording's size, if there is one.
- **RP-7. Nothing personal.** The snapshot and the recording are built from the fields of RP-6 and LF-22 only. They never hold prompt text, drafts, versions, names or contents of library files, dictionary terms, action names or instructions, API keys, file paths, the user or computer name, or other apps' window titles. They hold other apps' bundle IDs, and the report says so.
- **RP-8. Read, edit, copy or save.** The last step shows the whole report as one editable text. Every part can be changed or removed, the snapshot included; the recording is listed with its size and can be left out. **Copy** (⌘↵) puts the text on the clipboard; ⌘↵ is the main button of every step wherever the keyboard focus is, also after a click on a button or the checkbox took it from the field. **Save…** writes `report.txt`, and the recording if kept, to a new folder in `~/Library/Logs/me.octopot.sushi/Reports/` and shows it in Finder. Sushi never sends the report: apart from the questions of RP-3 that the user agreed to, the flow makes no network request.
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

The panel hides after ⌘A. The user chooses **Report a problem…**, types *Панель закрывается после ⌘A.*, answers *Что вы делали?* from Ollama with *Нажимал ⌘A*, skips the second question, starts the recording, presses Caps Lock and ⌘A twice, then **Finish recording** at the top of the panel. The report shows their words, the block, `panel: editor view, 1 version in the chain, an edit not running`, `hotkey: capsLock true, in effect Caps Lock, conflicts none` and `report-recording.log (3.1 KB)`. **Save…** opens Finder at the folder with `report.txt` and the recording, which they attach to an email.

## Not supported

- Sending the report from Sushi: a prefilled GitHub issue, an email draft or a service of ours. The candidates are compared in [SUSI-9](../../.github/issues/SUSI-9.md).
- A report without the panel: the flow needs it (RP-2). An earlier build saved a report with a placeholder for the description from the menu; one way in replaced it.
- Crash reports, automatic collection and usage analytics.
- Screenshots: a picture of the panel would carry the prompt.

## Verification

| ID | Test | Code |
| --- | --- | --- |
| RP-1 | `composer.test.mjs` — Report a problem: describe, answer, record … (nothing recorded at the start, Esc leaves); Report from Settings ▸ About: leaving it hides the panel, so Settings has the keyboard again (RP-1); `settings.test.mjs` — about: copy only says Copied when it worked; Build details; Report a problem; the log (the stub); the keyboard back in Settings: by hand, PR-11 | `Report` in `src/report.ts`; `openReport`, `reportOrigin` in `src/main.ts`; `open_report` and the `sushi-report` item in `src-tauri/src/main.rs`; `prefs_action` in `src-tauri/src/preferences.rs` |
| RP-2 | `tray::tests::the_usual_menu_has_no_row_for_the_key` (one row, no submenu), `a_recording_and_the_diagnostic_mode_add_their_rows` (Finish recording); the menu items: by hand | `record` in `src-tauri/src/report.rs`; `rows` in `src-tauri/src/tray.rs` |
| RP-3, RP-4 | `composer.test.mjs` — … (Ollama's questions get the description only); Report: a hosted provider gets the description only with consent …; `report::tests::reads_the_questions` | `report_questions`, `questions` |
| RP-5 | `composer.test.mjs` — both Report scenarios (start, finish in the panel and from the menu, Esc stops it) | `diagnostics::report`; `showStatus` in `src/main.ts` |
| RP-6, RP-7 | `report::tests::plants_a_marker_everywhere_and_finds_none_in_the_report` (with the last hosted edit's outcome); `hosted::tests::anthropic_request` (the outcome is remembered) plants a marker in the draft's folder path (the home folder's name), `rules.json`, `dictionary.json`, `hotkey.json`, the key in `model.json` and in the keychain, `library-path.txt`, the library's prompt and template names and contents, and the panel's view; `composer.test.mjs` — the draft never reaches `report_draft`; `diagnostics::tests::keeps_only_combinations` | `snapshot`, `kind` |
| RP-8 | `composer.test.mjs` — … (edited text copied, saved without the recording, ⌘↵ with the focus nowhere, no network request) | `Report.finish`; `report_save` |
| RP-9 | `report::tests::renders_format_1` | `render` |

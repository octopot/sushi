# Local files

**Status:** describes Sushi v0.3.0 as implemented. Rules marked with an ID hold today and are checked by the tests listed under [Verification](#verification).

Everything Sushi knows besides the current draft lives in plain files on the Mac: the key that shows it, the model, the actions, the dictation dictionary, saved prompts and templates. The [settings window](settings.md) edits the settings files and writes every change back to them; the user may also edit them in any text editor, and Sushi reads them again the next time it needs them. Prompts and templates are edited only as files. This document fixes where the files live, their formats, how they are validated and what Sushi does on first run. The formats are also given as [CUE definitions](files.cue), and the [examples](examples/) are the files Sushi ships and seeds.

## Rules

### Settings folder

- **LF-1. Location.** Settings live in `~/Library/Application Support/me.octopot.sushi/`. **Open settings folder** in Settings ▸ About creates the folder if needed and opens it in Finder ([ST-30](settings.md#about)); **Show in Finder** under each section of the window shows its file there ([ST-7](settings.md#reading)). All files are UTF-8.
- **LF-2. Fresh reads.** Sushi reads `rules.json` and `dictionary.json` at launch, every time the panel is shown or gains focus, and when the Library opens. An edit, by hand or in the settings window, takes effect the next time the panel appears; no restart is needed. The settings window reads every settings file when it opens and whenever it gets focus ([ST-5](settings.md#reading)).
- **LF-3. First run.** A missing `rules.json` or `dictionary.json` is created from the [rule set](examples/rules.json) or the [dictionary](examples/dictionary.json) that ship with Sushi. A file that exists always wins and is never rewritten, including one with an empty array.
- **LF-4. Invalid settings.** `rules.json` and `dictionary.json` are checked each on its own: an invalid dictionary leaves the actions working, and an invalid `rules.json` leaves the dictionary shown. The error names the file and the entry by its position (`rules.json: entry 2 contains an empty field.`), the duplicate value (`rules.json: duplicate rule ID 'shorten'.`), or the parser's line and column. It shows in the hint line; for the invalid file Sushi keeps using what it last read from it successfully — nothing, if there was nothing. With both files invalid, the hint names `rules.json` first, and the dictionary's error shows once `rules.json` is fixed. The next successful read clears the error. The settings window shows each file's error in its own pane ([ST-13](settings.md#saving)).
- **LF-24. What Sushi writes.** Sushi writes only these files, besides creating missing directories:
  - on first use: `rules.json`, `dictionary.json` (LF-3) and `hotkey.json` (LF-18) from their examples, and the templates of a library with its marker `.initialized-v1` (LF-16);
  - from the settings window, when the user makes a change ([ST-8](settings.md#saving)): `hotkey.json` (Keyboard), `model.json` (Model), `rules.json` (Actions), `library-path.txt` and `dictionary.json` (Library), `diagnostics.json` (About); restoring an invalid file writes its example or removes it, after keeping its bytes as `<stem>.invalid-<UTC time>.<ext>` ([ST-13](settings.md#saving));
  - `model.json` also from the Model menu, the connect and disconnect flows and the move of a key of v0.2.1 (LF-20);
  - in `~/Library/Logs/me.octopot.sushi/`, the logs of LF-22 and the problem reports the user saves ([RP-8](report.md#the-report)).

  Every write of a settings file replaces the whole file at once, with permissions 0600, and never overwrites a change Sushi has not read ([ST-10, ST-12](settings.md#saving)). A settings file that is a symbolic link is never written ([ST-14](settings.md#saving)).

### `rules.json` — actions

- **LF-5. Format.** An object with one array, `rules`. Each rule has a stable `id`, a display `name`, an array `aliases` of other phrases that find it, and exactly one of two kinds:
  - `instruction` — sent to the model in use ([MD-2](model.md#choosing-the-provider)) with the selection or the whole prompt;
  - `prefix` — a local edit that puts this string, verbatim and including a trailing space, at the very beginning of the whole prompt. The built-in **Turn into goal** uses `/goal `. The effect on the chain of versions is fixed in [VH-10 and VH-12](version-history.md#what-changes-the-chain).
- **LF-6. Validation.** Unknown fields are rejected. `id`, `name`, the `instruction` or `prefix`, and every alias must contain something besides whitespace. IDs are unique; names need not be. `aliases` is required and may be empty.
- **LF-7. Finding a rule.** With an empty query the Actions palette lists the rules in file order. A query is matched against the name and the aliases, ignoring case and diacritics: an exact match ranks above a prefix, a word prefix, a substring and, for three letters or more, a loose in-order match; an alias ranks a little below the same match on the name. Any non-blank query is also offered as a free-form instruction. That row comes first when no rule matches strongly and the query has three words or more, or matches nothing at all; otherwise it comes last.
- **LF-8. Dictation runs a rule.** Text pasted into the Actions field — which is how dictation tools type — runs a rule at once when it equals the rule's name or one of its aliases, ignoring case, diacritics and punctuation (`Сделай короче.` runs Shorten through its alias `сделай короче`). Typing never runs a rule without Enter.

### `dictionary.json` — dictation terms

- **LF-9. Format and validation.** An object with one array, `terms`. Each term has a phrase `from`, as a dictation tool may hear it, and the preferred spelling `to`. Both must contain something besides whitespace; unknown fields are rejected. The phrases `from` are unique after trimming and lowercasing.
- **LF-10. In the Library.** The Dictionary section lists each term as `to` with `from` beside it, searchable by both. Its rows have no numbers. Enter or **Open in editor** opens `dictionary.json` in the default text editor and leaves the Library open; the file must be a regular file, not a link. Terms are added, changed and removed in Settings ▸ Library ([ST-28](settings.md#library)).

### `hotkey.json` — the key that shows Sushi

- **LF-18. Caps Lock or a combination.** `hotkey.json` holds `capsLock` (true or false) and `shortcut`, a combination of at least one modifier (`Control`, `Option`, `Shift`, `Command`) and one key joined with `+`; unknown fields are errors. A missing file is created from the [example](examples/hotkey.json), Caps Lock with `Control+Shift+Space`, at launch, as in LF-3. Modifiers may be written in any case and with their usual aliases (`ctrl`, `alt`, `cmd`, `super`, `CmdOrCtrl`); the key is a key name such as `P`, `KeyP`, `1`, `Digit1`, `Space` or `F13`. The settings window writes the canonical spelling: the modifiers in the order Control, Option, Shift, Command, then the key's physical name, so `command+option+p` becomes `Option+Command+KeyP`.

  Sushi reads the file and registers its key:
  - at launch; an invalid file is reported (`hotkey.json: …`) and Sushi uses the example meanwhile;
  - when the settings window saves the key ([ST-18](settings.md#keyboard)), which registers the new key before it writes the file and keeps the previous key when the new one cannot be registered;
  - when the settings window reads the files ([ST-5](settings.md#reading)) and the file differs from the one Sushi applied: a hand edit takes effect then, or at the next launch. An invalid file read this way leaves the key in effect as it is, and the window and the menu say so. When the file is unchanged but Caps Lock is chosen and not in effect, or no key is active, the same read tries the chosen key again;
  - when the window restores an invalid file ([ST-13](settings.md#saving)).
- **LF-19. Caps Lock.** With `capsLock` true, Sushi maps Caps Lock to F18 in the `UserKeyMapping` of every keyboard, including one connected later, keeps the other entries, and registers F18 as its hotkey; quitting Sushi removes its entry. Sushi does not take Caps Lock when macOS switches input sources with it (`TISRomanSwitchState`) or another entry already maps it, and gives back its entry when the key Caps Lock arrives as cannot be registered: in each case it registers `shortcut` instead and says why, in the panel, the menu ([PN-7](panel.md#the-menu-bar-menu)) and Settings ▸ Keyboard ([ST-17](settings.md#keyboard)). With `capsLock` false it registers `shortcut` and removes an entry a crashed run left. When `shortcut` cannot be registered either, no key shows Sushi, and **Show Sushi** in the menu still does. Each time the settings window reads the files, Sushi tries Caps Lock again (LF-18), so once the cause is gone, coming back to Settings is enough. Holding the key toggles the panel once. While the settings window records a combination, the key does not toggle the panel ([ST-16](settings.md#keyboard)).

### `model.json` — the model

- **LF-20. Provider and settings.** `model.json` is optional; without it edits run on Ollama. It holds `provider`, one of `"ollama"`, `"openrouter"`, `"openai"` or `"anthropic"`, and an optional section per hosted provider. A missing section, or one without `model`, takes the provider's default model and the default of each option it leaves out; a section that names a `model` is taken as it is ([MD-10](model.md#connecting-a-provider)):
  - `openrouter`: `model` (an OpenRouter model ID such as `openai/gpt-6-luna`), `reasoning` (`none`, `minimal`, `low`, `medium`, `high` or `xhigh`), `tier` (`default`, `flex`, `fast` or `ultrafast`);
  - `openai`: `model` (an OpenAI model ID), `reasoning` (as above);
  - `anthropic`: `model` (a Claude model ID), `effort` (`low`, `medium`, `high`, `xhigh` or `max`).

  Every field is optional and must contain something besides whitespace; unknown fields and other values are errors that name the field (`model.json: openrouter.tier must be one of default, flex, fast, ultrafast.`). Keys are not part of the file: they live in the keychain ([MD-11](model.md#connecting-a-provider)). The one exception is `openrouter.key` in a file from v0.2.1, which Sushi moves to the keychain ([MD-12](model.md#connecting-a-provider)). The file is read for every edit and every ⌘K; the menu bar menu reads it again when Sushi starts, on every show of the panel and after each change made from the menu or the settings window, so a hand edit shows there at the next show. Sushi writes it when the user chooses a provider in the Model menu or in Settings ▸ Model, changes a provider's options there ([ST-21, ST-23](settings.md#model)), connects or disconnects a provider ([MD-14, MD-16](model.md#connecting-a-provider)), and once at launch to move a key of v0.2.1 out ([MD-12](model.md#connecting-a-provider)). It sets `provider`, adds the default section of a provider being connected or first given an option, and keeps the other sections. Restoring an invalid file in the window removes it. The [example](examples/model.json) is not seeded.

### `diagnostics.json` — recording why the panel hid

- **LF-21. The switch.** `diagnostics.json` is optional; without it nothing is recorded. It holds one field, `record`, true or false; unknown fields are errors. Sushi creates it only from *Log panel activity* in Settings ▸ About ([ST-30](settings.md#about)): turning the switch on writes `{"record": true}`, off writes `{"record": false}`, and the mode turns on or off at once. Sushi also reads the file at launch, on every show of the panel (LF-2) and when the settings window loads, so a hand edit takes effect at the next show or the next time Settings gets focus. An invalid file is reported in the hint line (`diagnostics.json: missing field …`) on every show until it is fixed, and the mode stays as it was; Settings ▸ About shows that state ([ST-30](settings.md#about)). The [example](examples/diagnostics.json) turns it on and is not seeded.
- **LF-23. It says so.** While the mode is on, the top of the panel says `Diagnostics on · diagnostics.json turns it off` on every show, apart from the hint line, so errors and edit hints stay where they are. While it is on, the menu bar menu has **Diagnostics on · Show log**, which shows the log in Finder; **Show log** in Settings ▸ About does the same whenever a log exists.

### The diagnostic log

- **LF-22. What it records.** `~/Library/Logs/me.octopot.sushi/diagnostics.log` is plain UTF-8 text, one record per line, each starting with the UTC time in milliseconds. Each session starts with the build info block ([BI-1](build-info.md#rules)) and `recording started`. It records:
  - every show with its reason: `hotkey`, `menu`, `reopen`, `second-launch`, `launch` or `settings` (**Report a problem…** in Settings), and a show over the open panel that gives the keyboard back to its sheet ([PN-8](panel.md#hiding));
  - every hide with its reason: `hotkey` (the toggle), `esc` or `copy` from the page, `page` for another request of the page, `close-request`, `focus-lost` or `settings` (the settings window opened, PN-9);
  - every press and release of the hotkey, a repeat while held marked as ignored;
  - every key combination with ⌘ or ⌃ the panel received, as modifiers and one key name (`⌘A`), never other keys or text;
  - a loss of focus while a sheet is attached to the panel or has the keyboard, which keeps the panel open (`focus kept`, [PN-8](panel.md#hiding));
  - on a loss of focus that hides the panel, one run-loop turn later: Sushi's own key window (class and level) or none, the class of a sheet attached to the panel or `no`, whether Sushi is active, the frontmost app's bundle ID, whether Writing Tools is active in the panel's web view, the on-screen windows above the normal level (the owner's bundle ID or process name, the level and the size), and the last combination with ⌘ or ⌃.

  It needs no permission and never records the prompt, typed characters or other apps' window titles. A log over 512 KB is cut from its start: it keeps the block of the build that writes and its last 256 KB, after a line that says so. The recording of a problem report ([RP-5](report.md#recording)) writes the same records to `report-recording.log` next to it.

### Library: prompts and templates

- **LF-11. Which directory.** The Library reads one directory, chosen in this order: the environment variable `SUSHI_LIBRARY_DIR`, if set and non-empty; else the path written in `library-path.txt` in the settings folder; else `Input/` in the settings folder. The path in `library-path.txt` must be absolute; only trailing line breaks are trimmed. Pointing it at a Tuna assistant's `Input/` directory shares that assistant's prompts. The choice is made again on every Library request, and a missing directory is created. A `library-path.txt` that is not valid, or cannot be read (`library-path.txt: <the system's message>`), keeps the Library from opening until it is fixed; Sushi does not fall back to the default folder. **Choose folder…** in Settings ▸ Library writes the chosen folder to `library-path.txt` as one line, and **Use default folder** removes the file ([ST-27](settings.md#library)); with `SUSHI_LIBRARY_DIR` set the window writes neither.
- **LF-12. Prompts.** Every regular `*.md` file directly in the library directory is a saved prompt, named after the file. Files whose names start with `.` or contain `/`, `\`, `:` or control characters, symbolic links, subdirectories and their contents are not listed. The Prompts section shows the newest modification first, with its age (`2h`, `1d`, `5w`); while it is the only section shown, its first nine rows carry the numbers 1–9. Opening a prompt puts the whole file into the editor as it is — frontmatter and leading blank lines included — with line endings turned into `\n`. A file that is not valid UTF-8 gives an error naming it.
- **LF-13. Templates.** Templates are `*.md` files in the `.templates/` subdirectory of the library directory, under the same naming rules. They are listed in file-name order under their title. With an empty query the first nine templates carry the numbers 1–9, both in the full list and in the Templates section.
- **LF-14. Template frontmatter.** A template may start with a YAML block: the first line is exactly `---`, a later line is exactly `---`, and the block, both lines included, is at most 16 KiB. The block holds `title`, a string with something besides whitespace, and nothing else. Opening the template puts the bytes after the closing line into the editor, without its leading blank lines. CRLF line endings are accepted.
- **LF-15. Legacy templates.** A template without that block is plain Markdown: its file name is its title and the whole file is the prompt. The same holds when the block does not mention `title` at all, so a note that merely starts with a horizontal rule stays intact. A block that mentions `title` but is broken — unclosed, too large, not valid YAML, an empty or non-string title, another key — is listed under its file name and gives an error when opened.
- **LF-16. Seeded templates.** The first time a library's templates are listed, Sushi creates the [task brief](examples/task-brief.md), [bug report](examples/bug-report.md) and [release review](examples/release-review.md) in its `.templates/` directory, without overwriting files, and marks the directory with `.initialized-v1`. This happens once per library directory, a Tuna directory included: a deleted example does not come back, and a library initialised earlier receives no new examples.

## Worked examples

**A rule set with a model action and a prefix action (LF-5, LF-6).**

```json
{
  "rules": [
    {"id": "review", "name": "Review checklist", "prefix": "Review this change against the checklist:\n", "aliases": ["checklist"]},
    {"id": "formal", "name": "Make formal", "instruction": "Rewrite in a formal tone. Keep every fact.", "aliases": ["formal", "официальнее"]}
  ]
}
```

Adding `"instruction"` to the first rule makes the file invalid: `rules.json: entry 1 needs exactly one of 'instruction' or 'prefix'.`

**A template and what the editor receives (LF-14).** The file `.templates/handover.md`:

```markdown
---
title: Handover note
---

## What is done

## What is left
```

The Library lists it as **Handover note**. Opening it puts `## What is done⏎⏎## What is left⏎` into the editor, with the caret on the blank line under the first heading ([VH-14](version-history.md#what-changes-the-chain)).

**A shared library (LF-11).** `library-path.txt` holds one line, `/Volumes/Notes/assistant/Input`. The Library then lists the `*.md` files of that directory as prompts and its `.templates/` as templates, creating and seeding `.templates/` the first time (LF-16). A relative path such as `assistant/Input` gives `Enter an absolute library directory in library-path.txt.`

**Validating files before Sushi reads them.** From the repository root:

```sh
cue vet docs/specs/files.cue docs/specs/examples/rules.json -d '#Rules'
cue vet docs/specs/files.cue docs/specs/examples/dictionary.json -d '#Dictionary'
cue vet docs/specs/files.cue docs/specs/examples/hotkey.json -d '#Hotkey'
cue vet docs/specs/files.cue docs/specs/examples/model.json -d '#Model'
cue vet docs/specs/files.cue docs/specs/examples/diagnostics.json -d '#Diagnostics'
for t in task-brief bug-report release-review; do
  awk 'NR == 1 {next} /^---$/ {exit} {print}' docs/specs/examples/$t.md |
    cue vet docs/specs/files.cue yaml: - -d '#Template'
done
```

Replace the example paths with the files in your settings folder or library. The schema checks the fields, the kinds of rule, non-blank text and uniqueness (LF-6, LF-9, LF-14); the placement of the `---` lines, the 16 KiB limit, whether a shortcut's key is one Sushi knows and the absolute path of `library-path.txt` are checked only by Sushi. `make config-vet` runs these checks on the examples and also checks that the files the settings window writes pass the schema and the files Sushi refuses fail it ([ST-32](settings.md#the-schema)).

## Not supported or switched off

These are deliberate limits of v0.3.0, not defects. Changing any of them is a change of this specification.

- **Dictionary replacement is switched off.** When on, Sushi would replace whole-word, case-insensitive matches of each `from` with its `to` in text pasted or dropped into the editor, longest phrase first; typed text and model replies would never change. It is off because dictation tools post-process their text themselves. The switch is the constant `APPLY_DICTIONARY` in `src/main.ts`, and the browser test *dictionary terms replace pasted dictation* is skipped until it is turned back on. Today the dictionary is only shown in the Library.
- **Prompts and templates are files only.** Sushi does not save the current prompt to the Library, and neither the panel nor the settings window creates or edits prompt or template files; LF-24 lists what Sushi writes.
- **Text only.** Prompts and templates are read as text. Images and other attachments are not supported; an image link stays a line of Markdown.
- **No template variables.** Template frontmatter carries only `title`; there are no placeholders, descriptions or per-template aliases.
- **One flat library.** One directory at a time, without subdirectories.
- **The local model is fixed.** The model `qwen3.5:4b-mlx`, the Ollama address `127.0.0.1:11434` and the 12 KB limit on text with its instruction are fixed in `src-tauri/src/rewrite.rs`; `model.json` (LF-20) chooses between Ollama and the hosted providers.

## Verification

| ID | Test | Code |
| --- | --- | --- |
| LF-1 | `settings.test.mjs` — about: copy only says Copied when it worked; Build details; Report a problem; the log (the stub); the folder opening in Finder: by hand | `prefs_action` in `src-tauri/src/preferences.rs` |
| LF-2 | `composer.test.mjs` — pasted dictation stays as dictated; a settings error clears itself (reload on focus); `settings.test.mjs` — actions and dictionary: a clean external edit replaces the rows, never becomes a draft | `loadSettings()` callers in `src/main.ts`; `prefs_load` |
| LF-3 | `settings::tests::first_run_seeds_examples`, `existing_files_win_and_reload_sees_edits` | `read_seeded`, `create_once` in `src-tauri/src/settings.rs`; `seed` in `src-tauri/src/files.rs` |
| LF-4 | `settings::tests::invalid_entries_name_file_and_entry`, `rules_and_the_dictionary_are_read_independently`; `composer.test.mjs` — … a settings error clears itself | `load`, `parse_rules`, `parse_terms` in `src-tauri/src/settings.rs`; `loadSettings()` |
| LF-24 | `files::tests::refuses_a_write_after_a_change_on_disk`, `a_linked_file_is_read_and_not_written`, `a_reset_keeps_the_broken_bytes_aside`; `preferences::tests::a_broken_file_affects_only_its_own_pane_and_can_start_over`; `settings::tests::first_run_seeds_examples` | `update`, `seed`, `reset` in `src-tauri/src/files.rs`, the one writer of the settings files |
| LF-5, LF-6 | `settings::tests::first_run_seeds_examples` (the trailing space of `/goal `), `invalid_entries_name_file_and_entry`; `cue vet` on the examples | `Rule`, `validate_rules`; `files.cue` |
| LF-7 | `history.test.mjs` — fuzzy ranking; `composer.test.mjs` — a free-form instruction leads when no action matches well | `rank`, `match`, `instructionFirst` in `src/fuzzy.ts` |
| LF-8 | `composer.test.mjs` — pasting a spoken rule name runs it; typing never does; Turn into goal … (`Преврати в цель.`) | `phrase` in `src/fuzzy.ts`; `onPaste` in `src/main.ts` |
| LF-9 | `settings::tests::invalid_entries_name_file_and_entry`; `cue vet` on the example | `Term`, `validate_terms`; `files.cue` |
| LF-10 | `composer.test.mjs` — Library: ⌘L T 1 … scopes and dictionary | `Library.open` in `src/library.ts`; `dictionary_open` in `src-tauri/src/settings.rs` (regular-file check: manual) |
| LF-11 | `preferences::tests::the_library_folder_is_chosen_and_given_back`, `the_library_pane_says_what_the_panel_reads`; `settings.test.mjs` — library: the folder first, Show library in Finder, choose and return to the default; library: set outside Settings, and the controls say so; the Library with both: by hand, in a temporary profile | `source`, `parse_path`, `environment`, `count_templates` in `src-tauri/src/library.rs`; `library_folder`, `save_library` in `src-tauri/src/preferences.rs` |
| LF-12 | `library::tests::reads_markdown_and_rejects_unsafe_paths`; `composer.test.mjs` — Library … (prompts keep their leading blank lines, order by age) | `list`, `valid_stem`, `open_file`, `read` |
| LF-13, LF-14, LF-15 | `library::tests::templates_read_titles_and_preserve_legacy_markdown`; `composer.test.mjs` — Library … (numbers, caret) | `header`, `mentions_title`, `section`; `files.cue` |
| LF-16 | `library::tests::templates_read_titles_and_preserve_legacy_markdown` (removal, earlier libraries) | `ensure_templates` |
| LF-18 | `hotkey::tests::first_run_seeds_caps_lock_with_a_fallback`, `invalid_files_name_the_file_and_the_field`, `an_invalid_file_runs_the_defaults_and_says_so`, `canonical_spelling_accepts_what_the_file_may_hold`, `a_saved_switch_keeps_the_combination_in_its_canonical_spelling`, `the_window_applies_a_file_edited_since_launch`, `a_load_retries_a_key_lost_to_something_outside_sushi`, `a_backup_combination_is_tried_and_given_back`, `combinations_read_as_menu_symbols`; `make config-vet` (the hand spellings and the written ones against `files.cue`) | `load`, `canonical`, `render`, `apply`, `reload`, `worth_retrying`, `save`, `probe` in `src-tauri/src/hotkey.rs`; `files.cue` |
| LF-20 | `model::tests::*` (reading, invalid files, writing the defaults, the key of v0.2.1); `preferences::tests::an_option_is_set_removed_or_refused`, `a_provider_without_a_key_is_not_chosen`; `cue vet` on the example; `make config-vet` | `Settings`, `load`, `modify`, `move_key` in `src-tauri/src/model.rs`; `select`, `option` in `preferences.rs`; `files.cue` |
| LF-21 | `diagnostics::tests::reads_the_switch`, `rejects_invalid_files`; `preferences::tests::the_diagnostics_switch_creates_and_updates_its_file`, `about_says_whether_sushi_logs_now`; `settings.test.mjs` — about: copy only says Copied when it worked; Build details; Report a problem; the log; closing round: logging, a linked model.json that does not validate, templates that cannot be read; `cue vet` on the example | `load`, `refresh`, `render` in `src-tauri/src/diagnostics.rs`; `prefs_diagnostics_save` |
| LF-22 | `diagnostics::tests::cuts_a_long_log_from_the_start`, `keeps_only_combinations`, `writes_utc_with_milliseconds`; `composer.test.mjs` — diagnostics: … (combinations without text, hide reasons); the focus record: by hand, on the Mac where the panel hides | `record`, `focus_lost`, `diagnostics_key`; `sushi_focus_snapshot` in `src-tauri/src/macos.m`; `show_launcher`, `hide` in `src-tauri/src/main.rs` |
| LF-23 | `composer.test.mjs` — diagnostics: a notice on every show …; `tray::tests::a_recording_and_the_diagnostic_mode_add_their_rows`; `settings.test.mjs` — about: copy only says Copied when it worked; Build details; Report a problem; the log; Show log disabled without a log: by hand | `showStatus()` in `src/main.ts`; `rows` in `src-tauri/src/tray.rs` |
| LF-19 | `hotkey::tests::a_held_key_toggles_once`, `a_taken_caps_lock_falls_back_to_the_combination_and_says_why`, `a_key_that_failed_to_register_is_not_shown_as_in_effect`, `a_load_retries_a_key_lost_to_something_outside_sushi`, `a_capture_waits_for_the_keys_of_the_key_in_effect`, `a_load_never_registers_while_keys_of_a_capture_are_down`; the mapping itself: manual, on a Mac whose keyboard may be remapped (see AGENTS.md), and PR-12, PR-13 | `sushi_caps_take`, `sushi_caps_release` in `src-tauri/src/macos.m`; `plan`, `engage`, `capture` |

Run the Rust tests with `cargo test --manifest-path src-tauri/Cargo.toml --release` and the browser tests with `npm test`. Both work in temporary directories and profiles and never touch the real settings folder.

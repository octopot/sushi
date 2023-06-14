# Local files

**Status:** describes Sushi v0.1.1 as implemented. Rules marked with an ID hold today and are checked by the tests listed under [Verification](#verification).

Everything Sushi knows besides the current draft lives in plain files on the Mac: the actions, the dictation dictionary, saved prompts and templates. Sushi has no screen for editing them; the user edits the files in any text editor, and Sushi reads them again the next time it needs them. This document fixes where the files live, their formats, how they are validated and what Sushi does on first run. The formats are also given as [CUE definitions](files.cue), and the [examples](examples/) are the files Sushi ships and seeds.

## Rules

### Settings folder

- **LF-1. Location.** Settings live in `~/Library/Application Support/me.octopot.sushi/`. **Open Settings Folder** in the menu of the menu-bar icon creates the folder if needed and opens it in Finder. All files are UTF-8.
- **LF-2. Fresh reads.** Sushi reads `rules.json` and `dictionary.json` at launch, every time the window is shown or gains focus, and when the Library opens. An edit takes effect the next time the window appears; no restart is needed.
- **LF-3. First run.** A missing `rules.json` or `dictionary.json` is created from the [rule set](examples/rules.json) or the [dictionary](examples/dictionary.json) that ship with Sushi. A file that exists always wins and is never rewritten, including one with an empty array.
- **LF-4. Invalid settings.** Both files must be valid; an error in either rejects both. The error names the file and the entry by its position (`rules.json: entry 2 contains an empty field.`), the duplicate value (`rules.json: duplicate rule ID 'shorten'.`), or the parser's line and column. It shows in the hint line, and Sushi keeps using the settings it last read successfully — none, if there were none. The next successful read clears the error.

### `rules.json` — actions

- **LF-5. Format.** An object with one array, `rules`. Each rule has a stable `id`, a display `name`, an array `aliases` of other phrases that find it, and exactly one of two kinds:
  - `instruction` — sent to the local model with the selection or the whole prompt;
  - `prefix` — a local edit that puts this string, verbatim and including a trailing space, at the very beginning of the whole prompt. The built-in **Turn into goal** uses `/goal `. The effect on the chain of versions is fixed in [VH-10 and VH-12](version-history.md#what-changes-the-chain).
- **LF-6. Validation.** Unknown fields are rejected. `id`, `name`, the `instruction` or `prefix`, and every alias must contain something besides whitespace. IDs are unique; names need not be. `aliases` is required and may be empty.
- **LF-7. Finding a rule.** With an empty query the Actions palette lists the rules in file order. A query is matched against the name and the aliases, ignoring case and diacritics: an exact match ranks above a prefix, a word prefix, a substring and, for three letters or more, a loose in-order match; an alias ranks a little below the same match on the name. Any non-blank query is also offered as a free-form instruction. That row comes first when no rule matches strongly and the query has three words or more, or matches nothing at all; otherwise it comes last.
- **LF-8. Dictation runs a rule.** Text pasted into the Actions field — which is how dictation tools type — runs a rule at once when it equals the rule's name or one of its aliases, ignoring case, diacritics and punctuation (`Сделай короче.` runs Shorten through its alias `сделай короче`). Typing never runs a rule without Enter.

### `dictionary.json` — dictation terms

- **LF-9. Format and validation.** An object with one array, `terms`. Each term has a phrase `from`, as a dictation tool may hear it, and the preferred spelling `to`. Both must contain something besides whitespace; unknown fields are rejected. The phrases `from` are unique after trimming and lowercasing.
- **LF-10. In the Library.** The Dictionary section lists each term as `to` with `from` beside it, searchable by both. Its rows have no numbers. Enter or **Open in Editor** opens `dictionary.json` in the default text editor and leaves the Library open; the file must be a regular file, not a link.

### Library: prompts and templates

- **LF-11. Which directory.** The Library reads one directory, chosen in this order: the environment variable `SUSHI_LIBRARY_DIR`, if set and non-empty; else the path written in `library-path.txt` in the settings folder; else `Input/` in the settings folder. The path in `library-path.txt` must be absolute; only trailing line breaks are trimmed. Pointing it at a Tuna assistant's `Input/` directory shares that assistant's prompts. The choice is made again on every Library request, and a missing directory is created.
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
for t in task-brief bug-report release-review; do
  awk 'NR == 1 {next} /^---$/ {exit} {print}' docs/specs/examples/$t.md |
    cue vet docs/specs/files.cue yaml: - -d '#Template'
done
```

Replace the example paths with the files in your settings folder or library. The schema checks the fields, the kinds of rule, non-blank text and uniqueness (LF-6, LF-9, LF-14); the placement of the `---` lines and the 16 KiB limit are checked only by Sushi.

## Not supported or switched off

These are deliberate limits of v0.1.1, not defects. Changing any of them is a change of this specification.

- **Dictionary replacement is switched off.** When on, Sushi would replace whole-word, case-insensitive matches of each `from` with its `to` in text pasted or dropped into the editor, longest phrase first; typed text and model replies would never change. It is off because dictation tools post-process their text themselves. The switch is the constant `APPLY_DICTIONARY` in `src/main.ts`, and the browser test *dictionary terms replace pasted dictation* is skipped until it is turned back on. Today the dictionary is only shown in the Library.
- **No editing inside Sushi.** Rules, terms, prompts and templates are edited as files. Sushi does not save the current prompt to the Library or create prompt files; the only files it writes are the first-run copies of LF-3 and LF-16 and the marker `.initialized-v1`, besides creating missing directories.
- **Text only.** Prompts and templates are read as text. Images and other attachments are not supported; an image link stays a line of Markdown.
- **No template variables.** Template frontmatter carries only `title`; there are no placeholders, descriptions or per-template aliases.
- **One flat library.** One directory at a time, without subdirectories.
- **Model settings are not files.** The model `qwen3.5:4b-mlx`, the Ollama address `127.0.0.1:11434` and the 12 KB limit on text with its instruction are fixed in `src-tauri/src/rewrite.rs`.

## Verification

| ID | Test | Code |
| --- | --- | --- |
| LF-1 | Manual: the menu item opens the folder | `open_settings_folder` in `src-tauri/src/main.rs` |
| LF-2 | `composer.test.mjs` — pasted dictation stays as dictated; a settings error clears itself (reload on focus) | `loadSettings()` callers in `src/main.ts` |
| LF-3 | `settings::tests::first_run_seeds_examples`, `existing_files_win_and_reload_sees_edits` | `read_json`, `create_once` in `src-tauri/src/settings.rs` |
| LF-4 | `settings::tests::invalid_entries_name_file_and_entry`; `composer.test.mjs` — … a settings error clears itself | `load`, `validate_rules`, `validate_terms`; `loadSettings()` |
| LF-5, LF-6 | `settings::tests::first_run_seeds_examples` (the trailing space of `/goal `), `invalid_entries_name_file_and_entry`; `cue vet` on the examples | `Rule`, `validate_rules`; `files.cue` |
| LF-7 | `history.test.mjs` — fuzzy ranking; `composer.test.mjs` — a free-form instruction leads when no action matches well | `rank`, `match`, `instructionFirst` in `src/fuzzy.ts` |
| LF-8 | `composer.test.mjs` — pasting a spoken rule name runs it; typing never does; Turn into goal … (`Преврати в цель.`) | `phrase` in `src/fuzzy.ts`; `onPaste` in `src/main.ts` |
| LF-9 | `settings::tests::invalid_entries_name_file_and_entry`; `cue vet` on the example | `Term`, `validate_terms`; `files.cue` |
| LF-10 | `composer.test.mjs` — Library: ⌘L T 1 … scopes and dictionary | `Library.open` in `src/library.ts`; `dictionary_open` in `src-tauri/src/settings.rs` (regular-file check: manual) |
| LF-11 | Manual, with `SUSHI_LIBRARY_DIR` and `library-path.txt` in a temporary profile | `directory` in `src-tauri/src/library.rs` |
| LF-12 | `library::tests::reads_markdown_and_rejects_unsafe_paths`; `composer.test.mjs` — Library … (prompts keep their leading blank lines, order by age) | `list`, `valid_stem`, `open_file`, `read` |
| LF-13, LF-14, LF-15 | `library::tests::templates_read_titles_and_preserve_legacy_markdown`; `composer.test.mjs` — Library … (numbers, caret) | `header`, `mentions_title`, `section`; `files.cue` |
| LF-16 | `library::tests::templates_read_titles_and_preserve_legacy_markdown` (removal, earlier libraries) | `ensure_templates` |

Run the Rust tests with `cargo test --manifest-path src-tauri/Cargo.toml --release` and the browser tests with `npm test`. Both work in temporary directories and profiles and never touch the real settings folder.

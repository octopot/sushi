# Sushi specifications

The specifications fix how Sushi behaves where a casual reading of the code or the user guide is not enough: what each key does to the chain of versions, and what the local files may contain. They are written for whoever changes that behaviour, and for anyone who wants to know exactly what Sushi promises.

| Specification | Covers | Status |
| --- | --- | --- |
| [Prompt versions and copying](version-history.md) | The chain of versions, diff and text positions, what ⌘↵ and ⇧⌘↵ copy, review mode, the draft across restarts | v0.3.0, as implemented |
| [Local files](local-files.md) | `rules.json`, `dictionary.json`, `hotkey.json`, `model.json`, `diagnostics.json` and its log, `library-path.txt` and the Library directory, prompts, templates, first-run seeding, what Sushi writes | v0.3.1, as implemented |
| [The model behind an edit](model.md) | Ollama or a hosted provider (OpenRouter, OpenAI, Claude), connecting one from Settings, the keychain, what an edit sends, failures and Edit with Ollama | v0.3.1, as implemented |
| [The panel on screen](panel.md) | Where the panel shows, who has the keyboard, where focus goes when it hides, the panel with the settings window, the menu bar menu, and how the acceptance scenarios are written and run | v0.3.1, as implemented |
| [The settings window](settings.md) | Opening and closing it, reading and saving the settings files, drafts, conflicts and broken files, each pane, recording the key, the schema check | v0.3.1, as implemented |
| [Build info](build-info.md) | The block that names the build, About in Settings and `sushi version` | v0.3.1, as implemented |
| [Reporting a problem](report.md) | Report a problem: the questions, the recording, the snapshot and what it leaves out, the report's format | v0.3.1, as implemented |
| [Acceptance scenarios](panel.md#regression-scenarios) | What only a real macOS session can check, as Gherkin beside each specification: [`panel.feature`](panel.feature), [`settings.feature`](settings.feature), [`model.feature`](model.feature), [`report.feature`](report.feature), [`build-info.feature`](build-info.feature) | checked by `make scenarios` |
| [Runs](runs.md) | Every run of the scenarios: the build, who ran it, what passed and what did not | a row per run |

[`files.cue`](files.cue) gives the file formats as CUE definitions, and [`examples/`](examples/) holds the files Sushi ships: the app embeds the examples of `rules.json`, `dictionary.json`, `hotkey.json` and the templates at build time to seed missing files in a new settings folder and library, and restores them over a broken file; the examples of `model.json` and `diagnostics.json` document optional files and are not seeded. The tests read them all. Editing an example therefore changes what new users get.

## How a specification is built

Each specification opens with a status line naming the version it describes, then states its rules as the implementation behaves today. Every rule has an ID (`VH-6`, `LF-14`) and is stated once; worked examples and other documents refer to it by that ID. A separate section, **Not supported or switched off**, lists what is deliberately absent or turned off, so that nothing there reads as a promise. The **Verification** table at the end maps each rule to the test that proves it and to the code that implements it; a rule that only a real session can check names its scenario.

## Specifications, tests and the user guide

- **Tests prove the rules.** `tests/history.test.mjs` checks the chain model, `tests/composer.test.mjs` drives the real page in headless Chrome or WebKit with the model and system calls replaced, `tests/settings.test.mjs` drives the settings window's page the same way, the Rust tests in `src-tauri/src/` check file reading, validation and writing, and `make config-vet` checks the files against [`files.cue`](files.cue). Run `npm test` and `cargo test --manifest-path src-tauri/Cargo.toml --release`.
- **Scenarios check what the tests cannot reach.** Showing a window, Spaces, focus, the keys macOS delivers, native sheets, dictation and a provider's real API need the real app in a real session. Each such check is a scenario with an ID (`PR-n`) in the `.feature` file beside its specification, tagged with the rules it checks; `make checklist` renders them for a person or an agent, and each run is written down in [runs.md](runs.md). A Verification row that says *PR-n by hand* names its scenario.
- **The user guide explains, the specification decides.** The [site](https://sushi.octolab.org/) shows how to use Sushi and links here for the exact rules. These files are plain Markdown read on GitHub; they are not published on the site.
- **A change of behaviour changes its specification in the same change.** Update the rule, its example and its row in Verification together with the code and the test. A rule that drifted from the code is a defect of one of the two: decide which, and fix that one.

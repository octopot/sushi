# Susi specifications

The specifications fix how Susi behaves where a casual reading of the code or the user guide is not enough: what each key does to the chain of versions, and what the local files may contain. They are written for whoever changes that behaviour, and for anyone who wants to know exactly what Susi promises.

| Specification | Covers | Status |
| --- | --- | --- |
| [Prompt versions and copying](version-history.md) | The chain of versions, diff and text positions, what ⌘↵ and ⇧⌘↵ copy, review mode, the draft across restarts | v0.1.1, as implemented |
| [Local files](local-files.md) | `rules.json`, `dictionary.json`, the Library directory, prompts, templates, first-run seeding | v0.1.1, as implemented |

[`files.cue`](files.cue) gives the file formats as CUE definitions, and [`examples/`](examples/) holds the files Susi ships: the app embeds them at build time to seed a new settings folder and library, and the tests read them. Editing an example therefore changes what new users get.

## How a specification is built

Each specification opens with a status line naming the version it describes, then states its rules as the implementation behaves today. Every rule has an ID (`VH-6`, `LF-14`) and is stated once; worked examples and other documents refer to it by that ID. A separate section, **Not supported or switched off**, lists what is deliberately absent or turned off, so that nothing there reads as a promise. The **Verification** table at the end maps each rule to the test that proves it and to the code that implements it; a rule that only a person can check says so.

## Specifications, tests and the user guide

- **Tests prove the rules.** `tests/history.test.mjs` checks the chain model, `tests/composer.test.mjs` drives the real page in headless Chrome or WebKit with the model and system calls replaced, and the Rust tests in `src-tauri/src/` check file reading and validation. Run `npm test` and `cargo test --manifest-path src-tauri/Cargo.toml --release`.
- **The user guide explains, the specification decides.** The [site](https://sushi.octolab.org/) shows how to use Susi and links here for the exact rules. These files are plain Markdown read on GitHub; they are not published on the site.
- **A change of behaviour changes its specification in the same change.** Update the rule, its example and its row in Verification together with the code and the test. A rule that drifted from the code is a defect of one of the two: decide which, and fix that one.

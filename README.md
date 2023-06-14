> # 🍣 Sushi
>
> Dead simple prompt composer.

**Write the prompt here. Paste it there.**

Sushi is a glass panel for writing prompts to coding agents, one keystroke away on your Mac. Press Caps Lock, type or dictate the task, select a passage and press ⌘K: a local model rewrites it, and you read the change as a diff right in the text. Step back and forth through every version, take a template from your library, then press ⌘↵ — the whole prompt is on the clipboard and you are back in the app you came from. Nothing leaves your Mac: edits run on Ollama.

## Install

On an Apple Silicon Mac with macOS 26 or later, with [Homebrew](https://brew.sh/):

```sh
brew install --cask octolab/tap/sushi
```

Or download `sushi_0.2.0_darwin-arm64.zip` from the [v0.2.0 release](https://github.com/octopot/sushi/releases/tag/v0.2.0) and move `Sushi.app` to Applications. This build is not notarized yet, so macOS stops its first launch and asks you to confirm opening it; the quick start shows how in [Download instead](docs/content/quick-start.mdx#download-instead). Homebrew needs no confirmation and stays the recommended way.

Edits need [Ollama](https://ollama.com/) and its model:

```sh
ollama pull qwen3.5:4b-mlx
```

See the [installation steps](docs/content/quick-start.mdx).

## Quick start

1. Launch Sushi. Its icon appears in the menu bar.
2. Press **Caps Lock** and write a prompt: `Add a dark mode toggle to the settings screen and keep the existing labels.`
3. Select a sentence, press **⌘K**, type `short` and press Enter. The edit appears as a diff: **⌘→** accepts it, **⌘←** goes back.
4. Press **⌘↵**. The prompt is on the clipboard and focus is back in your terminal or editor.

| Action | Keys |
| --- | --- |
| Show or hide the window | Caps Lock (or ⌃⇧Space, see the menu bar icon) |
| Copy the prompt and hide | ⌘↵ |
| Copy, clear the field and hide | ⇧⌘↵ |
| Hide without copying, or cancel a running edit | Esc |
| Actions on the selection or the whole prompt | ⌘K, or a right click on a selection |
| Step back or forward through versions | ⌘← ⌘→ right after an edit, or the arrows at the sides |
| Library of templates, prompts and dictionary | ⌘L; then T, P or D for a section, 1–9 for an item |

- [Quick start](docs/content/quick-start.mdx) — install, write and copy your first prompt.
- [Editing and versions](docs/content/guide/editing.mdx) — diffs, accepting an edit, stepping back, what ⌘↵ copies.
- [Actions](docs/content/guide/actions.mdx) — built-in rewrites, free-form instructions, Turn into goal, your own `rules.json`.
- [Voice](docs/content/guide/voice.mdx) — dictate the prompt and the action, for example «make it shorter».
- [Long prompts with /goal](docs/content/guide/goal.mdx) — turn a prompt into a `/goal` command and make sure Claude Code or Codex sees it.
- [Library](docs/content/guide/library.mdx) — templates, saved prompts, the dictionary and a shared Tuna folder.
- [Local model](docs/content/guide/model.mdx) — Ollama, warm-up, limits and troubleshooting.
- [Keyboard](docs/content/guide/keyboard.mdx) — every key in one place.
- [Troubleshooting](docs/content/guide/troubleshooting.mdx) — what Sushi's messages mean, from the shortcut and the first launch to Ollama and your settings files.
- [v0.2.0 release notes](docs/content/changelog/v0.2.0.md) — Susi is now Sushi, Caps Lock shows the panel; the upgrade path step by step.
- [v0.1.1 release notes](docs/content/changelog/v0.1.1.md) — a clear first step without Ollama or its model.
- [v0.1.0 release notes](docs/content/changelog/v0.1.0.md) — the first public release.

## How it works

**Edits and versions.** An action rewrites the selection, or the whole prompt when nothing is selected. The editor is locked while the model works, and Esc cancels the request. Every action adds a version to one linear chain, and each version made by an action is shown first as a diff against the one before. ⌘↵ always copies the whole prompt: on a diff, the edited version, which it also accepts. Typing changes the version you stand on; a new action from an earlier version replaces the versions after it. After ⌘↵ the next show selects the old prompt, so you either type over it or press → to continue. The exact rules are in the [versions specification](docs/specs/version-history.md).

**Voice.** Dictate into the editor with a tool such as MacWhisper. In the action field, a dictated phrase that names an action runs it at once; any other phrase becomes a free-form instruction for the model.

**Long prompts with `/goal`.** The built-in action **Turn into goal** puts `/goal ` in front of the prompt without a model call. Claude Code and Codex collapse a long paste into a placeholder and do not see a command at its start: in Claude Code paste a second time to expand it; in Codex press Ctrl+G to open the text, expanded, in an external editor.

**Library and files.** There is no settings screen: everything is a file in `~/Library/Application Support/me.octopot.sushi/`, opened from **Open Settings Folder** in the menu-bar menu.

| What | Where |
| --- | --- |
| Actions | `rules.json` |
| Dictation dictionary | `dictionary.json` |
| Saved prompts | `Input/*.md` |
| Templates | `Input/.templates/*.md`, with a `title` in the frontmatter |

To use the prompts of a Tuna assistant, write the absolute path of its `Input` folder as the single line of `library-path.txt` next to `rules.json`. Formats, validation and CUE schemas are in the [local files specification](docs/specs/local-files.md).

**Local model.** Edits run on Ollama at `127.0.0.1:11434` with `qwen3.5:4b-mlx`. If Ollama is not running, the first edit starts it: the app, or `ollama serve` when only the command-line tool is installed. Without Ollama or the model, the hint links to the download or offers `ollama pull` to copy; opening ⌘K says the same and asks a running Ollama to load the model in advance. The text with its instruction is limited to 12 KB, so select a passage of a long prompt.

v0.2.0 composes one prompt at a time, with a linear history of edits, a file-based library and a local model. Branching versions, images, editing the library inside Sushi and dictionary replacement of dictated text are not part of it; see what each specification lists as [not supported or switched off](docs/specs/README.md).

## Development

<details>
<summary>Build from source (optional)</summary>

You need Node.js with npm, Rust and the Xcode Command Line Tools:

```sh
git clone https://github.com/octopot/sushi.git
cd sushi
npm ci
npm run bundle
```

The app appears in `src-tauri/target/release/bundle/macos/Sushi.app`. `npm test` checks the editor, the palettes and the chain of versions in headless Chrome with the model and system calls replaced; `npm run test:local` adds the Rust tests and a real edit through a running Ollama. The working agreement for changes and screenshots of the real window is in [AGENTS.md](AGENTS.md).

</details>

---

<p align="center">
  <sub>Sushi 🍣</sub><br>
  <sub>MIT · Built by <a href="https://github.com/octolab">OctoLab.</a></sub>
</p>

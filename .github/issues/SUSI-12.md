---
code: SUSI-12
id: I_kwDOVy11Hs8AAAABiDYgMA
databaseId: 6580215856
number: 17
url: https://github.com/octopot/sushi/issues/17
title: "app: a settings window over the files, a simpler menu and the key that shows Sushi"
issueType: Feature
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
createdAt: 2026-11-24T10:56:32Z
updatedAt: 2026-11-24T13:44:58Z
lastEditedAt: 2026-11-24T13:44:58Z
closedAt: null
---

# app: a settings window over the files, a simpler menu and the key that shows Sushi

## Motivation

Everything Sushi knows lives in plain files, and that stays its strength: a setting can be read, copied, versioned and fixed by hand. But today the files are the only way in. To change the key that shows Sushi, the model of a provider or the wording of an action, a user opens a folder, edits JSON and learns from an error line whether it worked. Users of a prompt composer are not expected to edit JSON.

The menu bar menu grew with M2 and shows it. The key takes two rows that say the same thing in the usual case (`Shows Sushi: Caps Lock` above **Use Caps Lock**). **Model ▸** mixes what a user does daily, choosing where edits run, with what they do once, connecting a provider. **Report a problem ▸** is a submenu of two items, the version row copies something without saying so, and **Open settings folder** is the only door to settings.

Sushi needs a settings window that is a careful interface over the same files, not a replacement for them, and a menu where every row earns its place. The key that shows Sushi deserves the most care: it is the first thing a new user wants to change and the one setting that fails for reasons outside Sushi (Caps Lock switches input sources, another app remaps it).

## PoC

```text
Menu bar menu                               Settings… (⌘, in the menu and in the panel)

  Show Sushi                      ⇪         ┌ Keyboard ── the key that shows Sushi: Caps Lock, or a
  Model · gpt-6-luna              ▸         │             combination recorded by pressing it; what is
  ─────────────────────────────────         │             in effect right now and why; the panel's keys
  Settings…                      ⌘,         │ Model ───── where edits run; each provider: connect,
  Report a problem…                         │             model, options; what leaves the Mac, who pays
  ─────────────────────────────────         │ Actions ─── the ⌘K actions: add, edit, reorder, delete,
  About Sushi                               │             the phrases that find each one
  Quit Sushi                     ⌘Q         │ Library ─── the folder of prompts and templates; the
                                            │             dictation dictionary
  Model ▸  ✓ Ollama · qwen3.5:4b-mlx        └ About ───── version and build, copy; the diagnostic log;
             OpenRouter · gpt-6-luna                      the settings folder
             ─────────────────────
             Model settings…

Turn Caps Lock off in Keyboard, press ⌥Space in the recorder → hotkey.json holds
{"capsLock": false, "shortcut": "Option+Space"} → ⌥Space shows Sushi, the menu row says ⌥Space.

Edit rules.json by hand while the window is open → the Actions list shows the edit when the
window gets focus again. Break the file → the pane says what is wrong and where, as the panel does.
```

## Acceptance criteria

- [x] **The menu.** Every row of the menu bar menu is listed in `docs/specs/panel.md` with the reason it is there. The key in effect shows on the **Show Sushi** row as a shortcut; a separate row appears only when the key in effect is not the one the user chose, or none is active, and it leads to the setting. **Model** names the model in use and lists only the choices; connecting and disconnecting live in the settings window. No row copies or opens anything it does not name.
- [x] **What left the menu is still reachable.** The build info with its copy ([[SUSI-8]]), the diagnostic log and the settings folder are in the settings window. **Report a problem…** is one row that starts the report in the panel ([[SUSI-9]]); the route that saved a report without the panel is gone, and when the panel does not show or does not stay open, the build info and the log are in the settings window.
- [ ] **The window.** **Settings…** in the menu and ⌘, in the panel open one settings window; a second request brings the same window forward. It follows the system appearance, is usable with the keyboard alone, names every control for VoiceOver, and closes with ⌘W. Opening it from the panel hides the panel; the key that shows Sushi works over it, and hiding the panel then returns the keyboard to the window.
- [x] **Over the files.** Every setting the window shows is read from its file and written back to it: `hotkey.json`, `model.json`, `rules.json`, `dictionary.json`, `library-path.txt`, `diagnostics.json`. A change is saved when it is made, without a Save button, and takes effect as the file's rule says (LF-2, LF-18, LF-20, LF-21). What is typed and not valid yet stays in the window as a draft, marked as not saved, and is never lost by a reload. Each pane names its file and shows it in Finder.
- [x] **The schema decides.** A value the CUE definitions in `docs/specs/files.cue` reject is never written: the control does not offer it, or the field says what is wrong next to it and the file stays as it was. Files written through every save path pass `cue vet`, files the window refuses fail it, and a check fails when the choices the window offers differ from the schema's.
- [x] **Hand edits keep working.** A file edited outside the window shows there when the window gets focus. Sushi never overwrites a change it has not seen, whoever writes: the window, the menu or a connect flow. When the file changed under a draft, the window keeps both and lets the user choose. An invalid file is reported in its pane with the message the panel gives, and the pane offers to open the file, or to start over from the defaults with the broken file kept aside. A file that is a symbolic link is shown and not written.
- [x] **One broken file breaks one thing.** An invalid `dictionary.json` no longer stops the actions, and an invalid `rules.json` no longer hides the dictionary (LF-4 changes).
- [x] **The key.** The user chooses Caps Lock or a combination. A combination is recorded by pressing it, and while it is recorded the current key does not show the panel. The pane says which key is in effect and, when it is not the chosen one, why and what to do about it. A combination Sushi cannot register is not saved, and the previous key keeps working.
- [x] **The keys of the panel** are listed in the same pane, grouped as in the keyboard guide.
- [x] **Model.** The pane shows where edits run and lets the user switch, connect and disconnect each provider with the flows of [[SUSI-6]], [[SUSI-10]] and [[SUSI-11]], and choose the model and the options `model.json` holds for it, telling apart what the file sets from what an edit sends. Before connecting, the pane says what leaves the Mac and who pays. A key never reaches the page (MD-5).
- [x] **Actions.** Actions can be added, duplicated, edited, reordered and removed, with their phrases and their kind (a model edit or a prefix, whitespace kept exactly). A removal can be undone at once. A phrase that also finds another action is flagged. A user never types an `id`.
- [ ] **Library.** The pane shows which folder the library reads and where that choice comes from (LF-11), lets the user choose another folder or return to the default, and says when `SUSHI_LIBRARY_DIR` decides. The dictionary's terms can be added, edited and removed there, and the pane says they are a reference and are not applied to text.
- [x] **Docs and tests.** A specification of the window in `docs/specs/`, with the menu in `docs/specs/panel.md` and the files Sushi writes in `docs/specs/local-files.md`; the guide pages name the window instead of hand edits where it replaces them. Rust tests cover reading, validating and writing each file, including a change on disk in between; browser scenarios cover each pane in both appearances with frames for review; the regression scenarios of the panel gain the window's transitions.

## Out of scope

Changing the keys inside the panel. Opening Sushi at login. Themes and the size of the panel. Editing prompts and templates in the window. Syncing settings between Macs. Choosing the local model. A search field in the settings window.

<!-- 2026-11-24T12:02Z https://github.com/octopot/sushi/issues/17#issuecomment-7130910399
After v0.3.0: ticked criteria are proven by the tests the Verification table of `docs/specs/settings.md` names and by the run of the real window recorded in `docs/specs/panel.md`. Left to check by hand: PR-11 to PR-15 of `docs/specs/panel.md` (the panel with the settings window, the key hint in the menu, the key recorder, the connect sheets), the folder picker as a sheet, and one pass with VoiceOver.
-->

<!-- 2026-11-24T13:45Z https://github.com/octopot/sushi/issues/17#issuecomment-7133264821
Checked by hand in the owner's run by hand on 2026-11-24, on the v0.3.0 code with the fixes then on main (build `05a23ce-dirty`), macOS 27.2: the rows of the menu and its key hint (PR-12), the panel with the settings window (PR-11), the key recorder (PR-13), the connect sheets (PR-14, PR-15). They pass, with one correction to a scenario: a combination another app holds as a global shortcut (Raycast's, for example) never reaches the recorder, the other app answers and nothing is recorded or saved; PR-13 now says so. The refusal of a combination Sushi cannot register stays proven by the tests of ST-18.

Left by hand: **Choose folder…** as a sheet of the window, the library path wrapping after a slash (v0.3.1), and one pass with VoiceOver.
-->

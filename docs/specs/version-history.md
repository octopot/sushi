# Prompt versions and copying

**Status:** describes Susi v0.1.1 as implemented. Rules marked with an ID hold today and are checked by the tests listed under [Verification](#verification).

Susi keeps every edit of the prompt in one linear chain of versions. The user walks the chain one step at a time, sees each edit as an inline diff before accepting it, and copies the whole prompt from any point. This document fixes how the chain changes, what ⌘↵ copies at each position, and how the draft survives a restart. How to use these keys is explained on the [site](https://susi.octolab.org/); this document is the contract the code and the tests keep.

## Terms

- **Version** — the full text of the prompt at one point. A version created by an action (a rule from `rules.json` or a free-form instruction) carries the action's **label**: the rule's name, or the instruction itself.
- **Chain** — the ordered list of versions with a current version. It has no branches.
- **Position** — what the editor shows: the **text** of the current version, or the **diff** between the previous version and the current one. Only a labelled version that is not the first has a diff position.
- **Review mode** — the state right after an action or a step, in which ⌘← and ⌘→ walk the chain instead of moving the caret.

## Rules

### Positions and steps

- **VH-1. Linear chain.** The chain is a list of versions and an index. A new version is always added right after the current one, and everything that was to the right of the current version is discarded first.
- **VH-2. Positions.** For A →(Shorten) B →(Clarify) C there are five positions: text A, diff(A, B), text B, diff(B, C), text C. A version opened from the Library and the first version have no diff position.
- **VH-3. One step at a time.** ⌘← (Back) and ⌘→ (Forward) move exactly one position. Forward from a diff accepts it: the editor shows the text of the same version without marks. Back from a diff shows the text of the previous version. A step past either end does nothing.
- **VH-4. Inline diff.** On a diff position the editor holds the right-hand text: inserted words are highlighted, deleted words are drawn struck through between them and cannot be edited. The hint line above the bottom bar reads `<label> · ⌘← Back · ⌘→ Accept`.

### Copying

- **VH-5. What a copy takes.** ⌘↵ and the Copy button copy the whole prompt of the current version, never just a selection: on a text position the shown text, on a diff the right-hand text, which is the full result of the edit. Across the chain above the copies are A, B, B, C, C.
- **VH-6. A copy on a diff accepts it.** After a successful copy on a diff the chain stands on the text of the same version, as after ⌘→, and the editor shows that text without marks. No version is lost: ⌘← leads back to the diff and to the earlier text. A copy on a text position does not move.
- **VH-7. ⇧⌘↵ copies and clears.** ⇧⌘↵ copies exactly what ⌘↵ would. After a successful copy the chain becomes one empty version, the empty draft is saved and the window hides. The next show starts with an empty field and the caret in it.
- **VH-8. When a copy does nothing.** ⌘↵ and ⇧⌘↵ do nothing while an edit is running, while the Actions or Library palette is open, and when the prompt is empty or only whitespace. If the clipboard write fails, the error shows in the hint line, the chain does not change and the window stays open.
- **VH-9. After a copy.** In the app a successful ⌘↵ hides the window and returns focus to the application that was active before. The next time the window is shown, the whole prompt is selected once: typing, dictating or pasting replaces it and starts a new prompt (VH-13), while → or a click keeps editing the same chain. The select-all also happens after a restart; a launch that does not show the window keeps it for the first real show. Hiding with Esc instead of copying means the prompt was kept, and the next show does not select it.

### What changes the chain

- **VH-10. An action.** ⌘K (or a right click on a selection) opens the actions. An action targets the selection, or the whole prompt when nothing is selected. On a diff position it targets the right-hand text. The result replaces the target in the full prompt and becomes a new version (VH-1) shown as a diff. If the result equals the current text, the chain does not change and the hint line says `No changes`. With an empty or blank prompt, ⌘K only says `Write a prompt first`.
- **VH-11. A model reply.** Line breaks in the reply are normalised to `\n` and the reply is trimmed; the leading and trailing whitespace of the target is put back around it, so an edit never glues lines together. An empty reply is an error and changes nothing.
- **VH-12. A prefix action.** A rule with `prefix` (the built-in **Turn into goal** adds `/goal `) does not call the model. It puts the prefix at the very beginning of the whole prompt, whatever is selected, and shows the result as a diff with the caret after the prefix. A prompt that already starts with the prefix stays as it is: `No changes`.
- **VH-13. Typing.** Typing, pasting, dictating or deleting changes the current version in place; all other versions stay. A change on a diff position accepts the edit first. An edit that replaces or deletes the whole non-empty text (select all, then type, paste, drop or delete) starts a new prompt: the chain becomes that single version. The editor's own ⌘Z then brings the previous text back into the editor as an edit of that single version; the discarded versions do not come back.
- **VH-14. A Library entry.** Opening a template or a saved prompt replaces the prompt when the chain is a single blank version. Otherwise the entry becomes a new version (VH-1) without a label, shown as text. The caret goes to the first blank line of the entry, or to its end.
- **VH-15. While an edit runs.** The editor is read-only and the target shimmers; Copy, the Library and the steps are unavailable. Esc cancels the request: the chain does not change, the earlier selection comes back, and a reply that arrives later is ignored.

### Review mode

- **VH-16. Review keys.** An action, a step or a copy on a diff turns review mode on. In review mode, with no palette open and no edit running, ⌘← and ⌘Z step back, ⌘→ and ⇧⌘Z step forward. When there is no step in that direction the key is consumed and does nothing.
- **VH-17. Back to editing.** The first change to the text (VH-13) or an opened Library entry turns review mode off; ⌘← ⌘→ ⌘Z ⇧⌘Z then work as in any editor. The previous and next buttons at the sides of the window step through the chain at any time except while an edit runs, and turn review mode back on. The hint line names the steps that are available: `⌘← Back · ⌘→ Forward`.

### Persistence

- **VH-18. The draft survives a restart.** The chain, the position, review mode and the copy flag of VH-9 are stored in `localStorage['susi.draft.v3']`: shortly after each change, and at once on a copy, on hiding and when the page goes away. A stored value that does not describe a valid chain gives an empty prompt. A draft from the earlier format `susi.history.v2` is imported once, as a single version with its active text.
- **VH-19. Storage is full.** If the draft does not fit, Susi compacts the chain once — it keeps the first version and every version from the one before the current version onwards — and writes again. If that fails too, the hint line shows `Could not save the draft: …` and the window refuses to hide on Esc or ⌘↵, so the text is not lost. A ⌘↵ in this state still puts the text on the clipboard. After a compaction, the diff from the first version to the next kept one spans every dropped edit, so if that version came from an action, its label becomes `Earlier edits`; a version opened from the Library keeps no label and no diff.

## Worked examples

The examples use synthetic text. ⟨del⟩ and ⟨ins⟩ mark what the diff draws struck through and highlighted.

**Walking a two-action chain (VH-2, VH-3, VH-5, VH-6).** The user types `Check three files.`, runs Shorten, which returns `Check three reports.`, then Clarify, which returns `Check three reports by Friday.`. Clarify ran on the diff position, so it took the right-hand text of the first edit.

| Position | Editor shows | ⌘↵ copies | Then the chain stands on |
| --- | --- | --- | --- |
| text A | Check three files. | Check three files. | text A |
| diff(A, B) | Check three ⟨del⟩files⟨/del⟩⟨ins⟩reports⟨/ins⟩. | Check three reports. | text B |
| text B | Check three reports. | Check three reports. | text B |
| diff(B, C) | Check three reports⟨ins⟩ by Friday⟨/ins⟩. | Check three reports by Friday. | text C |
| text C | Check three reports by Friday. | Check three reports by Friday. | text C |

**A new action from an earlier position (VH-1, VH-10).** Standing on diff(A, B) of the chain above, the user runs Structure and gets D. The chain becomes A, B, D and shows diff(B, D); C is gone.

**Whitespace around the target (VH-11).** The prompt is `␣␣Check the logs and report back.⏎`. A free-form instruction `Say it like a pirate` gets the reply `⏎␣␣Check the logs.␣␣⏎`. The new version is `␣␣Check the logs.⏎`, and its label is `Say it like a pirate`.

**Turn into goal (VH-12).** With any part of `Add a dark mode toggle.` selected, Turn into goal gives the diff `⟨ins⟩/goal ⟨/ins⟩Add a dark mode toggle.` without a model call. Running it again on that version says `No changes`.

**Typing on a diff (VH-13, VH-17).** On diff(A, B) the user types `!` at the end. The marks disappear, the version B becomes `Check three reports.!`, the hint line clears, and ⌘← now moves the caret to the start of the line.

**After a copy (VH-9).** The user copies `First prompt, clarified.` and the window hides. On the next ⌘⇧Space the text is selected. Pressing → and typing ` More.` continues the same chain; typing `Second prompt.` instead replaces the selection and starts a new chain of one version.

## Not supported or switched off

These are deliberate limits of v0.1.1, not defects. Changing any of them is a change of this specification.

- **No branches.** The chain is linear. An action, or a Library entry, opened from an earlier position discards the versions to its right (VH-1); there is no tree of alternatives and no way to bring a discarded tail back.
- **No pruning by count.** The chain grows without a limit on the number of versions. The only pruning is the one-time compaction of VH-19 when storage is full.
- **Text only.** A version is plain text. Pasted images, files and rich text are not kept as such; only their plain text, if any, reaches the editor.
- **One prompt at a time.** There is one draft. Saving the current prompt to the Library is not part of Susi; the Library only reads files (see [Local files](local-files.md)).

## Verification

| ID | Test | Code |
| --- | --- | --- |
| VH-1 | `history.test.mjs` — apply shows its diff, drops the tail and ignores identical text | `Chain.append` in `src/history.ts` |
| VH-2, VH-3 | `history.test.mjs` — five positions, one step at a time; opening a library entry … appends without a diff position | `Chain.back`, `Chain.forward`, `hasDiff` |
| VH-4 | `composer.test.mjs` — rewrite a selection, read the diff … (hint text) | `textDiff`, `diffDecorations` in `src/editor.ts`; `hint()` in `src/main.ts` |
| VH-5, VH-6 | `composer.test.mjs` — copy takes A, B, B, C, C across a two-action chain; a copy on a diff accepts it | `copy()` in `src/main.ts` |
| VH-7 | `composer.test.mjs` — ⌘⇧↵ copies what ⌘↵ would and starts an empty prompt | `copy(true)` |
| VH-8 | `composer.test.mjs` — ⌘⇧↵ keeps the text when the copy fails or a palette is open; Library selects the first template … (⌘↵ with the Library open) | `copy()`, keydown handler |
| VH-9 | `composer.test.mjs` — after a copy the next launch selects all; the draft and its position survive a reload (copy flag) | `selectAfterCopy()`, `hide()` |
| VH-10 | `composer.test.mjs` — copy takes A, B, B, C, C (action on a diff); custom instruction, whole-prompt target …; a free-form instruction leads … | `openActions()`, `rewrite()`, `Chain.apply` |
| VH-11 | `composer.test.mjs` — custom instruction, whole-prompt target and whitespace preservation; pasting a spoken rule name … (CRLF) | `rewrite()` |
| VH-12 | `composer.test.mjs` — Turn into goal prepends /goal locally and can be stepped back | `prepend()` |
| VH-13 | `history.test.mjs` — typing edits in place …; `composer.test.mjs` — after a copy the next launch selects all … | `Chain.edit`, `Chain.reset`, `replacedAll` in `src/editor.ts` |
| VH-14 | `history.test.mjs` — opening a library entry …; `composer.test.mjs` — Library: ⌘L T 1 … (caret under the first heading) | `Chain.open`, `library.open` in `src/main.ts` |
| VH-15 | `composer.test.mjs` — Esc cancels a pending rewrite …; a cancelled whole-prompt rewrite gives back the bare caret | `rewrite()`, `settle()`, `cancel()`, `editor.lock` |
| VH-16, VH-17 | `composer.test.mjs` — rewrite a selection … (review keys turn into editor keys); copy takes A, B, B, C, C (⌘Z, ⇧⌘Z, side buttons) | keydown handler, `navigate()` |
| VH-18 | `history.test.mjs` — JSON round trip and rejection of garbage; `composer.test.mjs` — the draft and its position survive a reload; a v2 draft is imported once | `save()`, `loadChain()`, `Chain.restore` |
| VH-19 | `history.test.mjs` — compact keeps the first and the current pair (the merged step is labelled `Earlier edits`, a Library version stays unlabelled); `composer.test.mjs` — a full storage compacts the chain once … | `Chain.compact`, `save()`, `hide()` |

Run them with `npm test`. The same browser scenarios run in WebKit with `SUSI_ENGINE=webkit node --test tests/composer.test.mjs` after `npm run build`. The scenarios replace the model and every system call with a test double; the real clipboard, focus return and window showing are checked by hand in a separate macOS session.

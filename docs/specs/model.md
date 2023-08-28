# The model behind an edit

**Status:** describes Sushi v0.3.0 as implemented. Rules marked with an ID hold today and are checked by the tests listed under [Verification](#verification).

An action (⌘K) sends the target text and an instruction to a model and puts the reply into the chain as a new version ([VH-10](version-history.md#what-changes-the-chain)). This document fixes which model that is, what Sushi sends to it, how a hosted provider is connected, and what the user sees when an edit fails. By default the model is local: `qwen3.5:4b-mlx` through Ollama on the Mac, and nothing of the prompt leaves it. A hosted provider gets the instruction and the text only after the user connects it in Settings ▸ Model and keeps it chosen.

## Terms

- **Provider** — where an edit runs: `ollama` (local, the default) or one of the hosted providers `openrouter`, `openai` and `anthropic`. The menu, the hint and the messages name them OpenRouter, OpenAI and Claude.
- **Connected** — a hosted provider whose key is in the keychain (MD-11), or whose key of v0.2.1 is still in `model.json` (MD-12).
- **Active** — the provider `model.json` chooses (LF-20); edits run on it.
- **Target** — the selection, or the whole prompt when nothing is selected (VH-10).
- **Model name** — what the hint and the menu call the model: the part of the model ID after the last `/` (`gpt-6-luna` for `openai/gpt-6-luna`), or `qwen3.5:4b-mlx`.

## Rules

### Choosing the provider

- **MD-1. Ollama unless the file says otherwise.** Without `model.json` in the settings folder, or with `"provider": "ollama"`, every edit runs on Ollama as described in the [model guide](../content/guide/model.mdx): Sushi starts Ollama when needed, checks that the model is local and refuses one Ollama would forward elsewhere.
- **MD-2. A hosted provider when chosen.** With `"provider"` set to `openrouter`, `openai` or `anthropic`, every edit runs on that provider with its key from the keychain and the settings of its section (MD-10). Sushi reads the file again for every edit and every ⌘K, so a change takes effect at once.
- **MD-3. An invalid file stops edits.** An invalid `model.json` is reported by file and field (`model.json: openrouter.tier must be one of default, flex, fast, ultrafast.`), in the hint line on an edit, above the ⌘K field when it opens, as the first, disabled item of the Model menu, whose title then reads `Model · Needs attention` and whose last item reads **Fix model settings…** (MD-15), and in Settings ▸ Model, where no provider is marked in use ([ST-13](settings.md#saving)). Sushi does not fall back to Ollama by itself; the message offers it (MD-6).

### What goes out

- **MD-4. One request per edit.** Each request holds Sushi's system instruction, the one Ollama gets, and one user message with the instruction and the target text inside `<text>` tags, under the same 12 KB limit. Nothing else of the prompt, the chain, the library or the settings is sent, and no temperature:

  | Provider | Request | Also sent |
  | --- | --- | --- |
  | OpenRouter | `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer <key>` | `model`; `reasoning: {"effort": <reasoning>, "exclude": true}`, or `{"exclude": true}` without `reasoning`; `service_tier` from `tier`; `provider: {"data_collection": "deny"}`, so OpenRouter routes only to providers that do not train on the request. They may still retain it: zero data retention (`zdr`) is not requested, as it would leave no endpoint for some models; `X-Title: Sushi` and `HTTP-Referer: https://sushi.octolab.org/`, which name the app in the user's OpenRouter activity |
  | OpenAI | `POST https://api.openai.com/v1/chat/completions`, `Authorization: Bearer <key>` | `model`; `reasoning_effort` from `reasoning`; `store: false`, so OpenAI keeps no copy for its dashboard or evaluations |
  | Claude | `POST https://api.anthropic.com/v1/messages`, `x-api-key: <key>`, `anthropic-version: 2026-10-21` | `model`, `max_tokens: 16000`, the system instruction as `system`; `output_config: {"effort": <effort>}`; for the models that support it (`claude-fable-5-2`, `claude-fable-5-1`, `claude-opus-5-5`, `claude-opus-5`, `claude-sonnet-5-5`), `fallbacks: "default"` with `anthropic-beta: server-side-fallback-2026-07-01`, so another Claude model finishes an edit the chosen one declines |

- **MD-5. The key never reaches the page.** The key is read in the native part of Sushi for each request. It never reaches the page, the hint, an error message, a log or a problem report, and no command returns it. A provider's error message that quotes the key shows `…` in its place.

### When it fails

- **MD-6. Edit with Ollama.** When a hosted edit fails, the chain does not change and the hint line names the cause, ending with **Edit with Ollama**. `<Name>` is OpenRouter, OpenAI or Claude:

  | Cause | Message |
  | --- | --- |
  | No connection, DNS or TLS failure, or no answer within 60 s | `<Name> is not reachable. Edit with Ollama` |
  | 401 | `<Name> did not accept the key. Connect again · Edit with Ollama` |
  | The provider is chosen but has no key in the keychain | `<Name> is not connected. Connect again · Edit with Ollama` |
  | 402; OpenAI's 429 with `insufficient_quota`; Anthropic's 400 about the credit balance | `<Name>: the account is out of credits. Edit with Ollama` |
  | Any other 429 | `<Name> is busy right now. Edit with Ollama` |
  | Anthropic's 529, or an error of type `overloaded_error` | `<Name> is overloaded right now. Edit with Ollama` |
  | Claude stops with `stop_reason: "refusal"` | `Claude declined to edit this text. Edit with Ollama` |
  | Any other error status, an empty reply or a reply that is not JSON | `<Name>: <its message, at most 200 characters>. Edit with Ollama` |
  | An invalid `model.json` (MD-3) | `model.json: <the problem>. Edit with Ollama` |

  **Edit with Ollama** runs the same instruction on the same target through Ollama once (MD-1), whatever `model.json` says. The next edit uses `model.json` again. **Connect again** starts the flow of MD-14 or MD-13 for that provider, with its screens in front of every app (MD-17).
- **MD-7. Cut off.** A reply that ends because of its length (`finish_reason: "length"`, or `stop_reason: "max_tokens"` from Claude) gives `The model reached its context limit. Select a shorter passage.`, as with Ollama.

### What the user sees

- **MD-8. Who answered.** After an edit the hint names the model that answered, as the provider's reply names it (after a Claude fallback, the model that finished), else the model of the request, between the action and the time: `Shorten · gpt-6-luna · 3.0 s · 2 changes · ⌘← Back · ⌘→ Accept` (VH-4). Like the time, the name is kept in memory only.
- **MD-9. ⌘K with a hosted provider.** Opening the actions does not warm up a hosted model. It shows a note only when an edit is bound to fail: `model.json` is invalid (MD-3), or the active provider is not connected.

### Connecting a provider

- **MD-10. What a provider supplies.** Adding a provider means filling in these, and nothing else of the flow changes:

  | | OpenRouter | OpenAI | Claude |
  | --- | --- | --- | --- |
  | `provider` and keychain account | `openrouter` | `openai` | `anthropic` |
  | Receives the text | OpenRouter | OpenAI | Anthropic |
  | Who pays | the user's OpenRouter credits | the user's OpenAI API credits, not a ChatGPT subscription | the user's Anthropic API credits, not a Claude subscription |
  | How it connects | sign in through the browser (MD-14) | an API key pasted once (MD-13) | an API key pasted once (MD-13) |
  | Keys page | `openrouter.ai/settings/keys` | `platform.openai.com/api-keys` | `platform.claude.com/settings/keys` |
  | Default section | `model: openai/gpt-6-luna`, `reasoning: high`, `tier: fast` | `model: gpt-6-luna`, `reasoning: high` | `model: claude-opus-5-5`, `effort: low` |
  | The request and its failures | MD-4, MD-6 | MD-4, MD-6 | MD-4, MD-6 |

  The default model of OpenRouter is the one measured on the edit of [SUSI-6](../../.github/issues/SUSI-6.md); a section that names a `model` is taken as it is, so such a section without `reasoning` sends none; a section without `model`, an empty one included, gets the default model and the default of each option it leaves out. Connecting writes the default section when the file has none, so the file shows what an edit sends.
- **MD-11. The key lives in the keychain.** Each connected provider has one generic password in the login keychain: service `me.octopot.sushi`, account the provider's id, label `Sushi: <Name>`. Sushi creates, reads and deletes it through `/usr/bin/security`, and passes the key on its standard input, never on a command line. The item's access list therefore trusts `security` (`identifier "com.apple.security" and anchor apple`), not Sushi's signature, which an ad-hoc signed build changes with every release: after `brew upgrade` the key is read without a keychain prompt.
- **MD-12. A key from v0.2.1 moves.** A `key` that v0.2.1 read from the `openrouter` section of `model.json` moves to the keychain when Sushi starts (an upgrade starts it again). It leaves the file only once the keychain holds it, and `model`, `reasoning` and `tier` stay as they were. Until then edits keep using the key in the file; connecting OpenRouter again or disconnecting it removes that key from the file, so a new key or a disconnect always wins. Connecting OpenRouter again removes the old key from the file only after the keychain holds the new one, and only while the file still holds that same key; when the file cannot be changed, the flow says that edits keep using the old key until it is removed.
- **MD-13. Pasting a key.** **Connect…** on OpenAI or Claude in Settings ▸ Model ([ST-22](settings.md#model)), or **Connect again** after a failed edit (MD-6), opens one native screen that says what goes to the provider (the instruction and the selected text, or the whole prompt when nothing is selected), who pays and which model answers, with a secure field for the key and **Open the keys page**. Sushi checks a pasted key at once with `GET <api>/models`, which costs nothing, and says what is wrong without closing the screen: *This does not look like an API key.*, *OpenAI did not accept this key. Copy it again from the keys page.*, *Could not check the key: Claude is not reachable.* Only a key the provider accepted is stored. Under the field Sushi says what it holds, because a long key scrolls a secure field and leaves a few dots in view: the key's first seven and last four characters, the ones the provider's keys page shows, and its length (`sk-proj…9fQ2 · 164 characters`); a text shorter than 20 characters shows its length only.
- **MD-14. Signing in to OpenRouter.** **Connect…** on OpenRouter in Settings ▸ Model, or **Connect again** (MD-6), first shows the same kind of screen, then opens the browser at `https://openrouter.ai/auth` with an OAuth PKCE challenge (S256) and a callback to `http://127.0.0.1:<a free port>/callback/<a random path>`. When the user approves, the browser comes back there and Sushi exchanges the code with `POST https://openrouter.ai/api/v1/auth/keys` for a key on the user's own account, which shows on their OpenRouter keys page, where it can get a limit or be deleted. The user copies no key and edits no file. **Cancel** on Sushi's screen changes nothing. While the browser has not answered, Settings ▸ Model shows **Cancel** next to *Connecting…* ([ST-22](settings.md#model)): it ends the wait at once, changes nothing and says nothing, for a tab the user closed or a page of OpenRouter that failed. A denial in the browser, no answer within 5 minutes or a failed exchange keeps the previous choice and says why (MD-17); a new connect flow ends a sign-in that still waits. Connecting any provider takes effect whole or not at all as far as Sushi can tell: `model.json` is written first, then the key; a folder Sushi cannot write changes nothing. When the keychain refuses the key, Sushi puts the file back as it was, unless it changed again meanwhile: then it leaves the newer file as it is and says so, and when putting it back fails, it says which provider the file now chooses.
- **MD-15. The Model menu.** The title of **Model** in the menu bar menu names the model in use: `Model · qwen3.5:4b-mlx`, `Model · gpt-6-luna`, or `Model · Needs attention` with an invalid file (MD-3). The submenu lists only the choices: `Ollama · qwen3.5:4b-mlx (on this Mac)`, each connected provider as `<Name> · <model name>`, and an active provider without a key as `<Name> · not connected`, with a check mark on the active one; choosing one writes `provider` to `model.json` in one click, and with an invalid file the choices are disabled. Below a separator, **Model settings…** (**Fix model settings…** with an invalid file) opens Settings ▸ Model, where providers are connected, disconnected and set up ([ST-20 to ST-23](settings.md#model)). A successful connection makes that provider active and says so: *Connected to OpenRouter. Edits now go to OpenRouter · gpt-6-luna.*
- **MD-16. Disconnecting.** **Disconnect…** in Settings ▸ Model first asks *Disconnect <Name>?*, saying that Sushi forgets the key and, for the active provider, that edits then run on Ollama. **Disconnect** deletes the keychain item and says that the key still works until the user deletes it on the provider's keys page, with **Open the keys page**. Disconnecting the active provider makes Ollama active; disconnecting another one keeps the current choice. `model.json` changes first (Ollama chosen, a key of v0.2.1 dropped); when it cannot be written, or cannot be read while disconnecting OpenRouter (it may still hold a key of v0.2.1), the keychain item stays too and the alert says why, so Sushi never reports a key forgotten that the file still gives to every edit.
- **MD-17. Where a flow shows.** The screens of a connect or disconnect flow, its question, its key field and its result, belong to where it started. Started from the settings window, each is a sheet of that window, and the drafts of the window stay ([ST-22](settings.md#model)); such a flow never shows an alert in front of every app. When the window is closed while the flow runs, for example while the browser waits for the sign-in, or cannot take a sheet, nothing shows: a screen that would ask something answers as **Cancel**, a success shows only in the state (the Model menu, the pane), and a failure is kept and shown as a sheet the next time the window opens, a newer failure replacing an older one. Started from the panel (**Connect again**, MD-6), the screens are alerts in front of every app.

## Worked examples

**Connecting OpenRouter (MD-14, MD-15).** Settings ▸ Model ▸ OpenRouter ▸ **Connect…** → *Edits will go to OpenRouter: Sushi's instruction, the action and the selected text, or the whole prompt when nothing is selected. … Model: gpt-6-luna. Billed to your OpenRouter credits.* → Connect → the browser asks the user to sign in and approve → *Connected to OpenRouter*. `model.json` now reads:

```json
{
  "provider": "openrouter",
  "openrouter": {
    "model": "openai/gpt-6-luna",
    "reasoning": "high",
    "tier": "fast"
  }
}
```

⌘K → Shorten on `Please make sure that it follows the system appearance.` sends `model: openai/gpt-6-luna`, `reasoning: {effort: high, exclude: true}`, `service_tier: fast`, `provider: {data_collection: deny}`. The reply becomes a new version and the hint reads `Shorten · gpt-6-luna · 2.9 s · 1 change · ⌘← Back · ⌘→ Accept`.

**Back to Ollama for a while (MD-15).** Choosing `Ollama · qwen3.5:4b-mlx (on this Mac)` in the Model menu writes `"provider": "ollama"` and keeps the `openrouter` section and the key; choosing OpenRouter again needs no sign-in.

**Offline (MD-6).** Without a network the same edit gives `OpenRouter is not reachable. Edit with Ollama`. Clicking **Edit with Ollama** runs Shorten on the same sentence through Ollama, and the hint names `qwen3.5:4b-mlx`.

**A revoked key (MD-6).** After the key is deleted on the OpenRouter keys page, the next edit gives `OpenRouter did not accept the key. Connect again · Edit with Ollama`; **Connect again** opens the sign-in of MD-14.

## Not supported or switched off

- **No list of models.** The model of each provider is the default of MD-10 or the one written in its section; Settings ▸ Model takes it as free text, and **Browse models…** opens the provider's own list in the browser ([ST-23](settings.md#model)).
- **No automatic fallback.** A failed hosted edit never runs on Ollama without the user's click (MD-6).
- **No subscriptions.** A ChatGPT or Claude subscription is not used; OpenAI and Claude bill API credits. Anthropic's OAuth apps are built for organizations with a backend of their own and are not used.
- **The Ollama model is fixed.** `qwen3.5:4b-mlx` at `127.0.0.1:11434`, as before.
- **No streaming.** The reply comes back whole, for every provider.
- **The keychain item is readable by `security`.** Any program the user runs can read it with `security find-generic-password -w` without a prompt, as it could read the key in `model.json` before. A build signed with Developer ID could keep the key in an item that trusts Sushi alone; ad-hoc builds cannot without a prompt after every upgrade.

## Verification

| ID | Test | Code |
| --- | --- | --- |
| MD-1 | `model::tests::reads_the_choice` (no file, `ollama`) | `model::load` in `src-tauri/src/model.rs`; `infer` in `src-tauri/src/rewrite.rs` |
| MD-2 | `model::tests::reads_the_choice` | `edit` in `src-tauri/src/rewrite.rs` |
| MD-3 | `model::tests::rejects_invalid_files`; `providers::tests::the_model_menu_lists_the_choices_and_the_way_to_settings` (the problem row, the title, Fix model settings…) | `Settings::validate`; `model_menu` in `src-tauri/src/providers.rs` |
| MD-4 | `hosted::tests::openrouter_request`, `openai_request`, `anthropic_request` against a local mock server; `live_openrouter`, `live_openai`, `live_anthropic` (ignored, need `OPENROUTER_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) | `body`, `authorize`, `edit` in `src-tauri/src/hosted.rs` |
| MD-5 | `hosted::tests::errors_never_carry_the_key`; `report::tests::plants_a_marker_everywhere_and_finds_none_in_the_report` | `Failure::message` |
| MD-6 | `hosted::tests::maps_failures`; `composer.test.mjs` — an OpenRouter failure offers Edit with Ollama …; every hosted provider offers Connect again … | `classify`, `Failure`; `actionable()`, `rewrite()` in `src/main.ts` |
| MD-7 | `hosted::tests::maps_failures` (length, `max_tokens`) | `reply` |
| MD-8 | `composer.test.mjs` — an OpenRouter failure … (model name); `hosted::tests::anthropic_request` (the model a reply names) | `summary()` in `src/main.ts` |
| MD-9 | `composer.test.mjs` — an OpenRouter failure … (⌘K note) | `warm_model` in `src-tauri/src/rewrite.rs` |
| MD-10 | `providers::tests::every_provider_supplies_the_same_things`; `preferences::tests::a_connected_provider_is_spoken_of_in_the_present`; `model::tests::reads_the_choice`, `choosing_writes_the_defaults_and_keeps_the_rest` | `Provider` in `src-tauri/src/providers.rs`; `filled` in `src-tauri/src/model.rs` |
| MD-11 | `keychain::tests::stores_reads_and_forgets_a_key`, `the_item_trusts_the_security_tool_not_sushi`, `refuses_what_is_not_a_key` in a keychain file of their own; no prompt after an upgrade: by hand, after the release | `Keychain` in `src-tauri/src/keychain.rs` |
| MD-12 | `model::tests::a_key_from_v0_2_1_moves_to_the_keychain`; `providers::tests::the_old_key_leaves_the_file_only_once_the_new_one_is_stored`, `a_key_replaced_meanwhile_is_not_removed`, `a_refused_rollback_keeps_the_old_key_and_says_what_is_true` | `move_key`; `install` in `src-tauri/src/providers.rs` |
| MD-13 | `hosted::tests::checks_a_pasted_key`; the screen and the line under its field: by hand, PR-14 | `check_key`; `connect` in `src-tauri/src/providers.rs`; `sushi_alert`, `sushi_alert_sheet`, `key_accessory`, `key_note` in `src-tauri/src/macos.m` |
| MD-14 | `providers::tests::connecting_takes_effect_whole_or_not_at_all`, `a_refused_rollback_keeps_the_old_key_and_says_what_is_true`; `signin::tests::*` (the RFC 7636 challenge, the callback, a denial, the time limit, the exchange); `providers::tests::a_waiting_sign_in_ends_by_a_cancel_or_a_new_flow`; `settings.test.mjs` — model: … cancel the wait …; the sign-in on openrouter.ai: by hand | `src-tauri/src/signin.rs`; `sign_in`, `cancel_sign_in`, `start`, `install` in `src-tauri/src/providers.rs`; `prefs_connect_cancel` in `src-tauri/src/preferences.rs` |
| MD-15 | `providers::tests::the_model_menu_lists_the_choices_and_the_way_to_settings`; by hand: switch from the menu | `model_menu`, `menu`, `on_menu`, `choose` in `src-tauri/src/providers.rs` |
| MD-16 | `providers::tests::disconnecting_changes_the_file_first_or_not_at_all`; by hand: disconnect the active and another provider in Settings | `run_disconnect`, `release_file` |
| MD-17 | `providers::tests::a_flow_from_settings_never_raises_an_alert_over_another_app`; by hand: PR-14, PR-15 | `Origin`, `route`, `screen`, `conclude`, `alert_in` in `src-tauri/src/providers.rs`; `hold_note`, `open` in `src-tauri/src/settings_window.rs` |

# The model behind an edit

**Status:** describes Sushi v0.2.1 as implemented. Rules marked with an ID hold today and are checked by the tests listed under [Verification](#verification).

An action (⌘K) sends the target text and an instruction to a model and puts the reply into the chain as a new version ([VH-10](version-history.md#what-changes-the-chain)). This document fixes which model that is, what Sushi sends to it, and what the user sees when it fails. By default the model is local: `qwen3.5:4b-mlx` through Ollama on the Mac, and nothing of the prompt leaves it. A user may choose a hosted model through OpenRouter instead, in `model.json`.

## Terms

- **Provider** — where an edit runs: `ollama` (local, the default) or `openrouter` (hosted).
- **Target** — the selection, or the whole prompt when nothing is selected (VH-10).
- **Model name** — what the hint calls the model that answered: the part of the model ID after the last `/` (`gpt-6-luna` for `openai/gpt-6-luna`), or `qwen3.5:4b-mlx`.

## Rules

### Choosing the provider

- **MD-1. Ollama unless the file says otherwise.** Without `model.json` in the settings folder, or with `"provider": "ollama"`, every edit runs on Ollama as described in the [model guide](../content/guide/model.mdx): Sushi starts Ollama when needed, checks that the model is local and refuses one Ollama would forward elsewhere. Sushi never creates `model.json`.
- **MD-2. OpenRouter when chosen.** With `"provider": "openrouter"` and a valid `openrouter` section ([LF-20](local-files.md#modeljson--the-model)), every edit runs on OpenRouter. Sushi reads the file again for every edit and every ⌘K, so a change takes effect at once.
- **MD-3. An invalid file stops edits.** An invalid `model.json` is reported by file and field (`model.json: openrouter.key is empty.`), in the hint line on an edit and above the ⌘K field when it opens. Sushi does not fall back to Ollama by itself; the message offers it (MD-6).

### What goes out

- **MD-4. The request to OpenRouter.** One `POST https://openrouter.ai/api/v1/chat/completions` per edit with:
  - `model` from the file;
  - the system instruction Sushi also gives Ollama, and one user message with the instruction and the target text inside `<text>` tags, under the same 12 KB limit;
  - `reasoning: {"effort": <reasoning>, "exclude": true}` when the file sets `reasoning`, `{"exclude": true}` otherwise: the model may think, but its reasoning never comes back;
  - `service_tier` when the file sets `tier`;
  - `provider: {"data_collection": "deny"}`, so OpenRouter routes only to providers that do not store or train on the request;
  - the key as `Authorization: Bearer <key>`, and `X-Title: Sushi` with `HTTP-Referer: https://sushi.octolab.org/`, which name the app in the user's OpenRouter activity.

  Nothing else of the prompt, the chain, the library or the settings is sent. No temperature is sent: hosted reasoning models reject it.
- **MD-5. The key stays in the file.** The key is read in the native part of Sushi for each request. It never reaches the page, the hint, an error message or a log, and `settings_load` does not return it.

### When it fails

- **MD-6. Edit with Ollama.** When an OpenRouter edit fails, the chain does not change and the hint line names the cause, ending with **Edit with Ollama**:

  | Cause | Message |
  | --- | --- |
  | No connection, DNS or TLS failure, or no answer within 60 s | `OpenRouter is not reachable. Edit with Ollama` |
  | 401 or 403 | `OpenRouter did not accept the key in model.json. Edit with Ollama` |
  | 402 | `OpenRouter: the account is out of credits. Edit with Ollama` |
  | 429 | `OpenRouter is busy right now. Edit with Ollama` |
  | Any other error status, an empty reply or a reply that is not JSON | `OpenRouter: <its message, at most 200 characters>. Edit with Ollama` |
  | An invalid `model.json` (MD-3) | `model.json: <the problem>. Edit with Ollama` |

  **Edit with Ollama** runs the same instruction on the same target through Ollama once (MD-1), whatever `model.json` says. The next edit uses `model.json` again.
- **MD-7. Cut off.** A reply that ends because of its length (`finish_reason: "length"`) gives `The model reached its context limit. Select a shorter passage.`, as with Ollama.

### What the user sees

- **MD-8. Who answered.** After an edit the hint names the model that answered between the action and the time: `Shorten · gpt-6-luna · 3.0 s · 2 changes · ⌘← Back · ⌘→ Accept` (VH-4). Like the time, the name is kept in memory only.
- **MD-9. ⌘K with OpenRouter.** Opening the actions does not warm up a hosted model. It shows a note only when an edit is bound to fail: `model.json` is invalid (MD-3).

## Worked examples

**Choosing OpenRouter (MD-2, MD-4).** `model.json`:

```json
{
  "provider": "openrouter",
  "openrouter": {
    "key": "sk-or-v1-…",
    "model": "openai/gpt-6-luna",
    "reasoning": "high",
    "tier": "fast"
  }
}
```

⌘K → Shorten on `Please make sure that it follows the system appearance.` sends `model: openai/gpt-6-luna`, `reasoning: {effort: high, exclude: true}`, `service_tier: fast`, `provider: {data_collection: deny}`. The reply becomes a new version and the hint reads `Shorten · gpt-6-luna · 2.9 s · 1 change · ⌘← Back · ⌘→ Accept`.

**Back to Ollama for a while (MD-1).** Changing `"provider"` to `"ollama"` keeps the `openrouter` section for later; the next edit runs on Ollama.

**Offline (MD-6).** Without a network the same edit gives `OpenRouter is not reachable. Edit with Ollama`. Clicking **Edit with Ollama** runs Shorten on the same sentence through Ollama, and the hint names `qwen3.5:4b-mlx`.

## Not supported or switched off

- **No screen or menu for the model.** The provider and the key are edited in `model.json`, like every other setting.
- **The key is a file, not a Keychain item.** The settings folder is in the user's Library, which other users of the Mac cannot read; Sushi does not change the file's permissions.
- **No automatic fallback.** A failed OpenRouter edit never runs on Ollama without the user's click (MD-6).
- **One hosted provider.** Other OpenAI-compatible services, and signing in to OpenRouter through the browser, are not supported.
- **The Ollama model is fixed.** `qwen3.5:4b-mlx` at `127.0.0.1:11434`, as before.
- **No streaming.** The reply comes back whole, for both providers.

## Verification

| ID | Test | Code |
| --- | --- | --- |
| MD-1 | `model::tests::reads_the_choice` (no file, `ollama`) | `model::load` in `src-tauri/src/model.rs`; `infer` in `src-tauri/src/rewrite.rs` |
| MD-2 | `model::tests::reads_the_choice` (`openrouter`) | `model::load`; `rewrite` |
| MD-3 | `model::tests::rejects_invalid_files` | `model::load`, `Config::check` |
| MD-4 | `openrouter::tests::sends_the_request_and_reads_the_reply` against a local mock server; `openrouter::tests::live_edit` (ignored, needs `OPENROUTER_TOKEN`) | `openrouter::edit` in `src-tauri/src/openrouter.rs` |
| MD-5 | `openrouter::tests::errors_never_carry_the_key`; `settings_load` returns no model settings | `openrouter::edit`, `failure` |
| MD-6 | `openrouter::tests::maps_failures`; `composer.test.mjs` — an OpenRouter failure offers Edit with Ollama | `failure`; `actionable()`, `rewrite()` in `src/main.ts` |
| MD-7 | `openrouter::tests::maps_failures` (length) | `openrouter::edit` |
| MD-8 | `composer.test.mjs` — rewrite a selection, read the diff … (model name) | `summary()` in `src/main.ts` |
| MD-9 | `composer.test.mjs` — an OpenRouter failure offers Edit with Ollama (⌘K note) | `warm_model` in `src-tauri/src/rewrite.rs` |

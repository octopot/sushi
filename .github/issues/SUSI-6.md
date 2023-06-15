---
code: SUSI-6
id: I_kwDOVy11Hs8AAAABgwT4yA
databaseId: 6493108424
number: 7
url: https://github.com/octopot/sushi/issues/7
title: "rewrite: edit through OpenRouter, chosen in model.json"
issueType: Feature
labels:
  - "impact: high"
  - "scope: code"
assignees:
  - kamilsk
milestone: null
parent: null
issueFields: {}
state: OPEN
stateReason: null
duplicateOf: null
createdAt: 2026-11-19T15:33:01Z
updatedAt: 2026-11-19T15:34:31Z
lastEditedAt: 2026-11-19T15:34:31Z
closedAt: null
---

# rewrite: edit through OpenRouter, chosen in model.json

## Motivation

The local qwen3.5:4b-mlx leaves alone edits that change what a passage means ([[SUSI-5]]): asked to have Codex's remarks read with skepticism instead of Codex acting as the skeptic, it returns the paragraph as it was. A hosted model does that edit well and as fast: GPT-6 Luna through OpenRouter made it in about 3 s with high reasoning effort on the fast tier, against 2.6 s for the local model.

Ollama stays what Sushi ships with and the site's promise stays true by default: a user who wants a hosted model opts in with a file, as every other setting in Sushi is a file.

The work comes in two steps. v0.2.1 ships the provider without an announcement: the file, the request, the failures, specified in `docs/specs/model.md`. v0.3.0 announces it with a thought-out integration: how the user connects OpenRouter, the guide and the site. This issue stays open until then.

## Connecting through OpenRouter (for v0.3.0)

OpenRouter lets an app get a key without the user copying one: [OAuth PKCE](https://openrouter.ai/docs/use-cases/oauth-pkce). The app opens `https://openrouter.ai/auth?callback_url=<url>&code_challenge=<challenge>&code_challenge_method=S256`; the user signs in and approves; OpenRouter redirects to the callback with a `code`, and the app exchanges it at `POST https://openrouter.ai/api/v1/auth/keys` (with the `code_verifier`) for a new API key.

- The key is a new, separate key on the user's own account, billed to their credits. It shows on the user's OpenRouter keys page, where it can get a credit limit or be revoked like any other key; the app only stores it.
- The callback needs a URL Sushi answers: a custom scheme (`sushi://openrouter`, Tauri's deep-link plugin) or a one-shot server on `127.0.0.1`.
- Open questions for v0.3.0: where the key lives (the Keychain rather than `model.json`), whether Sushi offers a limit when connecting, how the user disconnects, and how the panel says which provider is active.

## PoC

```text
~/Library/Application Support/me.octopot.sushi/model.json:

{
  "provider": "openrouter",
  "openrouter": {
    "key": "sk-or-v1-…",
    "model": "openai/gpt-6-luna",
    "reasoning": "high",
    "tier": "fast"
  }
}

⌘K → Shorten  →  "Shorten · gpt-6-luna · 3.0 s · 2 changes · ⌘← Back · ⌘→ Accept"
Without network →  "OpenRouter is not reachable. Edit with Ollama"
```

## Acceptance criteria

- [ ] Without `model.json`, or with `"provider": "ollama"`, edits go to Ollama exactly as in v0.2.0.
- [ ] With `"provider": "openrouter"`, an edit sends the instruction and the target text with Sushi's system instruction to `openrouter.ai/api/v1/chat/completions`: the model from the file, `reasoning` with the effort from the file and `exclude: true`, `service_tier` from the file, and `provider.data_collection: "deny"`. Nothing else of the prompt leaves the Mac.
- [ ] The key is read from `model.json` on every edit and never reaches the page, the hint or an error message.
- [ ] An invalid `model.json` is reported by file and field, as `rules.json` is; ⌘K says so before an edit.
- [ ] A failed OpenRouter edit (no network, a rejected key, no credits, rate limit, a server error) stops with a plain message and **Edit with Ollama**, which runs the same edit on the same text locally.
- [ ] The hint after an edit names the model that answered.
- [ ] A spec (`docs/specs/model.md`, `local-files.md`, `files.cue`, an example file), Rust tests against a local mock server, an ignored live test with `OPENROUTER_TOKEN`, and browser scenarios for the messages and the summary.
- [ ] v0.3.0: connecting through OpenRouter, the model guide, the README, troubleshooting and the release note describe the option; the landing page still says that by default nothing leaves the Mac.

## Out of scope

In v0.2.1: a settings screen or menu for the model, signing in to OpenRouter through the browser, the key in the Keychain, an announcement on the site. At all: other hosted providers, a configurable Ollama model, falling back to Ollama without the user's click.

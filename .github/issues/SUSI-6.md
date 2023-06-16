---
code: SUSI-6
id: I_kwDOVy11Hs8AAAABgwT4yA
databaseId: 6493108424
number: 7
url: https://github.com/octopot/sushi/issues/7
title: "rewrite: connect OpenRouter from the menu, without copying a key"
issueType: Feature
labels:
  - "impact: high"
  - "scope: code"
assignees:
  - kamilsk
milestone: "[[SUSI-M2]]"
parent: null
issueFields: {}
state: OPEN
stateReason: null
duplicateOf: null
createdAt: 2026-11-19T15:33:01Z
updatedAt: 2026-11-23T10:50:36Z
lastEditedAt: 2026-11-23T10:50:36Z
closedAt: null
---

# rewrite: connect OpenRouter from the menu, without copying a key

## Motivation

The local qwen3.5:4b-mlx leaves alone edits that change what a passage means ([[SUSI-5]]): asked to have Codex's remarks read with skepticism instead of Codex acting as the skeptic, it returns the paragraph as it was. A hosted model does that edit well and as fast: GPT-6 Luna through OpenRouter made it in about 3 s with high reasoning effort on the fast tier, against 2.6 s for the local model.

v0.2.1 shipped the OpenRouter request without an announcement: a user who writes `model.json` by hand, with a key copied from the OpenRouter site, gets edits through it. That is a developer's path. A user should connect a hosted model in a few clicks from the menu, see at once what it costs them and what leaves the Mac, and never edit a file or copy a key. Ollama stays the default, and *by default nothing leaves your Mac* stays true.

OpenRouter lets an app get a key without the user copying one: [OAuth PKCE](https://openrouter.ai/docs/use-cases/oauth-pkce). The user signs in and approves in the browser, and the app receives a new key on the user's own account, billed to their credits; the key shows on their OpenRouter keys page, where it can get a limit or be revoked. Which callback URLs OpenRouter accepts from a desktop app (a custom scheme, a loopback port) has to be checked first.

This issue builds the way to connect a provider and uses it for OpenRouter. [[SUSI-10]] (OpenAI) and [[SUSI-11]] (Anthropic) reuse it.

## PoC

```text
Menu bar menu → Model ▸
  ✓ Ollama · qwen3.5:4b-mlx (on this Mac)
    Connect OpenRouter…

Connect OpenRouter…  → one screen, before the browser opens:
  "Edits go to OpenRouter: the instruction and the selected text,
   or the whole prompt when nothing is selected.
   Billed to your OpenRouter credits. Model: gpt-6-luna. [Connect] [Cancel]"
  → browser: sign in, approve → back in Sushi: "Connected to OpenRouter"

Model ▸
    Ollama · qwen3.5:4b-mlx (on this Mac)
  ✓ OpenRouter · gpt-6-luna
    Disconnect OpenRouter

⌘K → Shorten  →  "Shorten · gpt-6-luna · 3.0 s · 2 changes · ⌘← Back · ⌘→ Accept"
Without network →  "OpenRouter is not reachable. Edit with Ollama"
```

## Acceptance criteria

- [ ] **Connect.** **Model ▸ Connect OpenRouter…** first says in one screen what goes to OpenRouter (the instruction and the selected text, or the whole prompt when nothing is selected), who pays and which model answers, then signs in through the browser with PKCE. The user copies no key and edits no file. The default model is named in the specification.
- [ ] **Which model answers.** The **Model** menu shows the active provider and model with a check mark, and switching between Ollama and a connected provider takes one click. The hint after an edit names the model that answered.
- [ ] **Cancel and disconnect.** Cancelling, closing the browser or a failed exchange keeps the previous choice and says why. **Disconnect OpenRouter** forgets the key and says where it can be revoked on OpenRouter; disconnecting the active provider makes Ollama active, disconnecting another one keeps the current choice.
- [ ] **The key.** The key lives in the macOS Keychain, never reaches the page, the hint or an error message. After `brew upgrade` the key is read without a Keychain prompt; if the ad-hoc signed build cannot give that, the issue names another store. A key already in `model.json` from v0.2.1 keeps working: it moves to the Keychain and leaves the file only after it is stored there, while `reasoning` and `tier` stay as they were.
- [ ] **What leaves the Mac.** An edit through OpenRouter sends the instruction and the target text with Sushi's system instruction, with `provider.data_collection: "deny"`. Nothing else of the prompt leaves the Mac.
- [ ] **Failures.** A failed OpenRouter edit (no network, a revoked key, no credits, rate limit, a server error) stops with a plain message and **Edit with Ollama**, which runs the same edit on the same text locally. A revoked key also offers **Connect again**.
- [ ] **Shared flow.** Connecting, the Model menu, the Keychain entry and the failure messages are built once for any provider, so [[SUSI-10]] and [[SUSI-11]] add a provider without a new flow; the specification names what a provider supplies.
- [ ] **Docs and tests.** `docs/specs/model.md` and `local-files.md` describe the flow and the file; Rust tests cover the PKCE exchange and the requests against a local mock server; an ignored live test runs with `OPENROUTER_TOKEN`; browser scenarios cover the menu, the messages and the summary. The model guide, the README, troubleshooting and the release note describe the option; the landing page still says that by default nothing leaves the Mac.

## Out of scope

OpenAI ([[SUSI-10]]) and Anthropic ([[SUSI-11]]). A settings window, a list of every OpenRouter model, a configurable Ollama model, falling back to Ollama without the user's click.

---
code: SUSI-10
id: I_kwDOVy11Hs8AAAABht0X7w
databaseId: 6557603823
number: 14
url: https://github.com/octopot/sushi/issues/14
title: "rewrite: connect OpenAI and edit through its API"
issueType: Feature
labels:
  - "impact: medium"
  - "scope: code"
assignees:
  - kamilsk
milestone: "[[SUSI-M2]]"
parent: null
issueFields: {}
state: OPEN
stateReason: null
duplicateOf: null
createdAt: 2026-11-23T10:49:42Z
updatedAt: 2026-11-23T10:49:43Z
lastEditedAt: null
closedAt: null
---

# rewrite: connect OpenAI and edit through its API

## Motivation

Users who write prompts for Codex often already pay OpenAI. They should be able to edit through an OpenAI model directly, without an OpenRouter account in between, and connect it as easily as OpenRouter ([[SUSI-6]]): a few clicks from the menu, no file to edit.

How an app connects to OpenAI without the user copying a key has to be checked first. OpenAI may offer a sign-in billed to the user's ChatGPT subscription rather than to API credits; whether it exists for a third-party desktop app, and on what terms, is not known. An API key from [platform.openai.com](https://platform.openai.com/api-keys), billed to the user's API credits and pasted once, is the path that works today.

## PoC

```text
Menu bar menu → Model ▸ Connect OpenAI…
  → one screen: what goes to OpenAI, who pays, which model answers,
    and how to connect (sign in, or paste a key once with a link to the keys page)
  → "Connected to OpenAI"

⌘K → Shorten  →  "Shorten · <OpenAI model> · 2.4 s · 3 changes · ⌘← Back · ⌘→ Accept"
Without network →  "OpenAI is not reachable. Edit with Ollama"
```

## Acceptance criteria

- [ ] **Way to connect.** A comment on this issue compares what OpenAI offers a third-party macOS app (sign-in with the user's ChatGPT subscription, an API key from platform.openai.com) by effort for the user, who pays, terms and availability, and names the choice.
- [ ] **Connect.** **Model ▸ Connect OpenAI…** uses the flow of [[SUSI-6]]: one screen says what goes to OpenAI (the instruction and the selected text, or the whole prompt), who pays and which model answers. If a key is pasted, Sushi checks it at once and says what is wrong; the user edits no file.
- [ ] **What leaves the Mac.** An edit sends the instruction and the target text with Sushi's system instruction, and asks OpenAI not to store the request where the API allows it. Nothing else of the prompt leaves the Mac.
- [ ] **The key and the menu.** The credential lives where [[SUSI-6]] keeps keys and never reaches the page, the hint or an error message. The Model menu shows OpenAI as active; cancelling and **Disconnect OpenAI** follow the rules of [[SUSI-6]].
- [ ] **Failures.** No network, a rejected key, no credits, rate limit or a server error stop with a plain message and **Edit with Ollama**.
- [ ] **Docs and tests.** `docs/specs/model.md` gains the provider; Rust tests run against a local mock server, an ignored live test runs with `OPENAI_API_KEY`; the model guide names OpenAI.

## Out of scope

Choosing among all OpenAI models, images, audio, tools. Fallback to another provider without the user's click.

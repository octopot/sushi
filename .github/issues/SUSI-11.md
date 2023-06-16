---
code: SUSI-11
id: I_kwDOVy11Hs8AAAABht0cKQ
databaseId: 6557604905
number: 15
url: https://github.com/octopot/sushi/issues/15
title: "rewrite: connect Claude through the Anthropic API"
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
createdAt: 2026-11-23T10:49:46Z
updatedAt: 2026-11-23T10:49:47Z
lastEditedAt: null
closedAt: null
---

# rewrite: connect Claude through the Anthropic API

## Motivation

Users who write prompts for Claude Code often have an Anthropic account. They should be able to edit through a Claude model directly, without OpenRouter in between, and connect it as easily as OpenRouter ([[SUSI-6]]): a few clicks from the menu, no file to edit.

Anthropic does not allow third-party apps to use the tokens of a Claude subscription (Pro, Max). An API key from the Claude Console at [platform.claude.com](https://platform.claude.com/settings/keys), billed to the user's API credits and pasted once, is the path that works today. Anthropic also documents [OAuth apps](https://platform.claude.com/docs/en/manage-claude/oauth-apps/overview) that link a customer's billing without a pasted key, but they are built for organizations with direct API billing, an Admin or Billing role and a backend of the app's own; whether a local app like Sushi can use them has to be checked before choosing. It is not an equivalent of OpenRouter's PKCE.

## PoC

```text
Menu bar menu → Model ▸ Connect Claude…
  → one screen: what goes to Anthropic, who pays, which model answers,
    and how to connect (sign in, or paste a Console key once with a link to the keys page)
  → "Connected to Claude"

⌘K → Shorten  →  "Shorten · <Claude model> · 2.2 s · 3 changes · ⌘← Back · ⌘→ Accept"
Without network →  "Claude is not reachable. Edit with Ollama"
```

## Acceptance criteria

- [ ] **Way to connect.** A comment on this issue compares the Console API key and Anthropic's OAuth apps by effort for the user, who pays, what they require (billing, roles, a backend, review) and availability, and names the choice. A subscription token is never used.
- [ ] **Connect.** **Model ▸ Connect Claude…** uses the flow of [[SUSI-6]]: one screen says what goes to Anthropic (the instruction and the selected text, or the whole prompt), who pays and which model answers. If a key is pasted, Sushi checks it at once and says what is wrong; the user edits no file.
- [ ] **What leaves the Mac.** An edit sends the instruction and the target text with Sushi's system instruction. Nothing else of the prompt leaves the Mac.
- [ ] **The key and the menu.** The credential lives where [[SUSI-6]] keeps keys and never reaches the page, the hint or an error message. The Model menu shows Claude as active; cancelling and **Disconnect Claude** follow the rules of [[SUSI-6]].
- [ ] **Failures.** No network, a rejected key, no credits, rate limit, an overloaded API or a server error stop with a plain message and **Edit with Ollama**.
- [ ] **Docs and tests.** `docs/specs/model.md` gains the provider; Rust tests run against a local mock server, an ignored live test runs with `ANTHROPIC_API_KEY`; the model guide names Claude.

## Out of scope

Signing in with a Claude subscription. Choosing among all Claude models, tools, extended thinking settings. Fallback to another provider without the user's click.

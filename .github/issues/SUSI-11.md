---
code: SUSI-11
id: I_kwDOVy11Hs8AAAABht0cKQ
databaseId: 6557604905
number: 15
url: https://github.com/octopot/sushi/issues/15
title: "rewrite: connect Claude through the Anthropic API"
issueType: Feature
labels:
  - "scope: code"
  - "impact: medium"
assignees:
  - kamilsk
milestone: "[[SUSI-M2]]"
parent: null
issueFields: {}
state: CLOSED
stateReason: COMPLETED
duplicateOf: null
createdAt: 2026-11-23T10:49:46Z
updatedAt: 2026-11-24T13:45:19Z
lastEditedAt: 2026-11-24T13:44:55Z
closedAt: 2026-11-24T13:45:19Z
---

# rewrite: connect Claude through the Anthropic API

## Motivation

Users who write prompts for Claude Code often have an Anthropic account. They should be able to edit through a Claude model directly, without OpenRouter in between, and connect it as easily as OpenRouter ([[SUSI-6]]): a few clicks in Settings, no file to edit.

Anthropic does not allow third-party apps to use the tokens of a Claude subscription (Pro, Max). An API key from the Claude Console at [platform.claude.com](https://platform.claude.com/settings/keys), billed to the user's API credits and pasted once, is the path that works today. Anthropic also documents [OAuth apps](https://platform.claude.com/docs/en/manage-claude/oauth-apps/overview) that link a customer's billing without a pasted key, but they are built for organizations with direct API billing, an Admin or Billing role and a backend of the app's own; whether a local app like Sushi can use them has to be checked before choosing. It is not an equivalent of OpenRouter's PKCE.

## PoC

```text
Settings ▸ Model ▸ Claude ▸ Connect…
  → one sheet: what goes to Anthropic, who pays, which model answers,
    and a field for a Console key, pasted once, with a link to the keys page
  → "Connected to Claude"

⌘K → Shorten  →  "Shorten · <Claude model> · 2.2 s · 3 changes · ⌘← Back · ⌘→ Accept"
Without network →  "Claude is not reachable. Edit with Ollama"
```

## Acceptance criteria

- [x] **Way to connect.** A comment on this issue compares the Console API key and Anthropic's OAuth apps by effort for the user, who pays, what they require (billing, roles, a backend, review) and availability, and names the choice. A subscription token is never used.
- [x] **Connect.** **Connect…** on Claude in Settings ▸ Model uses the flow of [[SUSI-6]]: one sheet says what goes to Anthropic (the instruction and the selected text, or the whole prompt), who pays and which model answers, and takes a key pasted once. Sushi checks the key at once and says what is wrong; the user edits no file.
- [x] **What leaves the Mac.** An edit sends the instruction and the target text with Sushi's system instruction. Nothing else of the prompt leaves the Mac.
- [x] **The key and the menu.** The credential lives where [[SUSI-6]] keeps keys and never reaches the page, the hint or an error message. The Model menu shows Claude as active; cancelling and **Disconnect…** in Settings ▸ Model follow the rules of [[SUSI-6]].
- [x] **Failures.** No network, a rejected key, no credits, rate limit, an overloaded API or a server error stop with a plain message and **Edit with Ollama**.
- [x] **Docs and tests.** `docs/specs/model.md` gains the provider; Rust tests run against a local mock server, an ignored live test runs with `ANTHROPIC_API_KEY`; the model guide names Claude.

## Out of scope

Signing in with a Claude subscription. A list of Claude models to choose from: the model ID is typed. Tools. Fallback to another provider without the user's click.

<!-- 2026-11-24T12:02Z https://github.com/octopot/sushi/issues/15#issuecomment-7130909484
How Sushi connects to Claude: the choice made in v0.3.0.

| Way | Effort for the user | Who pays | What it requires | Availability |
| --- | --- | --- | --- | --- |
| Console API key, pasted once | Create a key at platform.claude.com/settings/keys and paste it into Sushi's sheet once; Sushi checks it at once | The user's Anthropic API credits | A Console account with credits | Works today |
| Anthropic OAuth apps | A sign-in that links billing | The customer organization's API billing | Direct API billing, an Admin or Billing role, and a backend of the app's own to hold the client secret | Built for organizations; a local app without a backend cannot hold the secret |
| A Claude subscription token (Pro, Max) | — | — | — | Not allowed for third-party apps; never used |

**Choice: the Console API key**, pasted into a secure field of the sheet that **Connect…** opens in Settings ▸ Model, checked at once and kept in the login keychain as *Sushi: Claude*. The rules are MD-4, MD-6, MD-10 and MD-13 in `docs/specs/model.md`.

The body is reworded to what v0.3.0 shipped: connecting and disconnecting live in Settings ▸ Model (#17), not in the menu, and *Effort* is an option of the provider there. Ticked criteria are proven by the tests the Verification table of `docs/specs/model.md` names. Left to check by hand: connecting with a real Console key and one edit through Claude; so far it ran against a mock server only.
-->

<!-- 2026-11-24T13:45Z https://github.com/octopot/sushi/issues/15#issuecomment-7133263804
Checked by hand with a real Console key in the owner's run by hand on 2026-11-24, on the v0.3.0 code with the fixes then on main (build `05a23ce-dirty`), macOS 27.2: a refused key, a real key, one edit through Claude, *Effort* changed and saved in `model.json`, and **Disconnect…**. Every criterion holds. The line under the key field described in #14 serves this sheet too.
-->

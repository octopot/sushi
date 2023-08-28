---
code: SUSI-10
id: I_kwDOVy11Hs8AAAABht0X7w
databaseId: 6557603823
number: 14
url: https://github.com/octopot/sushi/issues/14
title: "rewrite: connect OpenAI and edit through its API"
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
createdAt: 2026-11-23T10:49:42Z
updatedAt: 2026-11-24T13:45:16Z
lastEditedAt: 2026-11-24T13:44:53Z
closedAt: 2026-11-24T13:45:16Z
---

# rewrite: connect OpenAI and edit through its API

## Motivation

Users who write prompts for Codex often already pay OpenAI. They should be able to edit through an OpenAI model directly, without an OpenRouter account in between, and connect it as easily as OpenRouter ([[SUSI-6]]): a few clicks in Settings, no file to edit.

How an app connects to OpenAI without the user copying a key has to be checked first. OpenAI may offer a sign-in billed to the user's ChatGPT subscription rather than to API credits; whether it exists for a third-party desktop app, and on what terms, is not known. An API key from [platform.openai.com](https://platform.openai.com/api-keys), billed to the user's API credits and pasted once, is the path that works today.

## PoC

```text
Settings ▸ Model ▸ OpenAI ▸ Connect…
  → one sheet: what goes to OpenAI, who pays, which model answers,
    and a field for a key, pasted once, with a link to the keys page
  → "Connected to OpenAI"

⌘K → Shorten  →  "Shorten · <OpenAI model> · 2.4 s · 3 changes · ⌘← Back · ⌘→ Accept"
Without network →  "OpenAI is not reachable. Edit with Ollama"
```

## Acceptance criteria

- [x] **Way to connect.** A comment on this issue compares what OpenAI offers a third-party macOS app (sign-in with the user's ChatGPT subscription, an API key from platform.openai.com) by effort for the user, who pays, terms and availability, and names the choice.
- [x] **Connect.** **Connect…** on OpenAI in Settings ▸ Model uses the flow of [[SUSI-6]]: one sheet says what goes to OpenAI (the instruction and the selected text, or the whole prompt), who pays and which model answers, and takes a key pasted once. Sushi checks the key at once and says what is wrong; the user edits no file.
- [x] **What leaves the Mac.** An edit sends the instruction and the target text with Sushi's system instruction, and asks OpenAI not to store the request where the API allows it. Nothing else of the prompt leaves the Mac.
- [x] **The key and the menu.** The credential lives where [[SUSI-6]] keeps keys and never reaches the page, the hint or an error message. The Model menu shows OpenAI as active; cancelling and **Disconnect…** in Settings ▸ Model follow the rules of [[SUSI-6]].
- [x] **Failures.** No network, a rejected key, no credits, rate limit or a server error stop with a plain message and **Edit with Ollama**.
- [x] **Docs and tests.** `docs/specs/model.md` gains the provider; Rust tests run against a local mock server, an ignored live test runs with `OPENAI_API_KEY`; the model guide names OpenAI.

## Out of scope

A list of OpenAI models to choose from: the model ID is typed. Images, audio, tools. Fallback to another provider without the user's click.

<!-- 2026-11-24T12:02Z https://github.com/octopot/sushi/issues/14#issuecomment-7130908494
How Sushi connects to OpenAI: the choice made in v0.3.0.

| Way | Effort for the user | Who pays | Terms and availability |
| --- | --- | --- | --- |
| API key from platform.openai.com, pasted once | Create a key on the keys page and paste it into Sushi's sheet once; Sushi checks it at once | The user's OpenAI API credits | Works today for any app; the user can limit or delete the key on the keys page |
| Sign-in billed to a ChatGPT subscription | One sign-in, no key | The ChatGPT subscription | Not offered to third-party desktop apps: no documented flow bills a subscription for API calls |

**Choice: the API key**, pasted into a secure field of the sheet that **Connect…** opens in Settings ▸ Model, checked at once and kept in the login keychain as *Sushi: OpenAI*. Requests carry `store: false`. The rules are MD-4, MD-6, MD-10 and MD-13 in `docs/specs/model.md`. If OpenAI opens a sign-in for desktop apps, only the way this provider connects changes; the flow stays.

The body is reworded to what v0.3.0 shipped: connecting and disconnecting live in Settings ▸ Model (#17), not in the menu. Ticked criteria are proven by the tests the Verification table of `docs/specs/model.md` names. Left to check by hand: connecting with a real key, its sheet over the settings window (PR-14 of `docs/specs/panel.md`) and one edit through OpenAI; so far it ran against a mock server only.
-->

<!-- 2026-11-24T13:45Z https://github.com/octopot/sushi/issues/14#issuecomment-7133262801
Checked by hand with a real key in the owner's run by hand on 2026-11-24, on the v0.3.0 code with the fixes then on main (build `05a23ce-dirty`), macOS 27.2: the connect sheet over the settings window with the panel shown over it (PR-14), a refused key, a real key, one edit through OpenAI and **Disconnect…**. Every criterion holds.

One thing the run found: a pasted key scrolls the secure field and leaves a few dots in view, which read as a wrong paste. From v0.3.1 the sheet says under the field what it holds, `sk-proj…9fQ2 · 164 characters` (MD-13).
-->

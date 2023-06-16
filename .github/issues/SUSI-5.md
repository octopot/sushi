---
code: SUSI-5
id: I_kwDOVy11Hs8AAAABgv-jnA
databaseId: 6492758940
number: 6
url: https://github.com/octopot/sushi/issues/6
title: "rewrite: an edit the model leaves unchanged passes unnoticed"
issueType: Bug
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
createdAt: 2026-11-19T15:15:48Z
updatedAt: 2026-11-23T11:08:36Z
lastEditedAt: 2026-11-23T11:08:04Z
closedAt: 2026-11-23T11:08:36Z
---

# rewrite: an edit the model leaves unchanged passes unnoticed

## Problem

An edit can look as if nothing happened. When the model returns the text unchanged, the line above the bar says `No changes` for three seconds; a user who is dictating or reading the text misses it and cannot tell a refusal from a hang or a lost request. When the model changes one or two words of a long paragraph, the diff is there but hard to spot, and nothing says how much changed.

Seen with a request to change the meaning of a paragraph ("so that Codex's feedback is read with skepticism, rather than Codex acting as the skeptic"). Ollama's log shows the request answered in 2.6 s; the chain got no version, so the model returned the paragraph as it was. Repeating the request against qwen3.5:4b-mlx with Sushi's system instruction gives the text unchanged (instruction in English) or one or two words changed (in Russian). The model's limits are out of scope here; what the user sees of the outcome is not.

## PoC

```text
1. Type a paragraph, select it, press ⌘K and give an instruction the model leaves alone, e.g. "Rewrite so that Codex is not a skeptic; instead, its feedback is treated with skepticism."
2. The line above the bar says "No changes" and clears after three seconds; nothing else shows that the request ran.
3. With an instruction that changes one word of a long paragraph, the hint shows the action's name and the keys, but not that only one place changed.
```

## Expected behavior

The outcome of every model edit stays visible until the next step:

- When the model returns the text unchanged, the hint says so and stays until the user types, steps through versions or runs another action, offering ⌘K to try other words.
- When the edit gives a diff, the hint shows how long the model took and how many places changed, next to the action's name.

## Acceptance criteria

- [x] An unchanged reply leaves a hint that names the cause and stays past three seconds; typing, ⌘←/⌘→, ⌘K or ⌘L clears it.
- [x] A diff from the model shows its time and the number of changed places in the hint; a prefix action (Turn into goal) shows the count without a time.
- [x] Browser scenarios in `tests/composer.test.mjs` cover both; VH-10, the editing and actions guides and troubleshooting describe the new hint.

## Out of scope

A view of what was sent to the model and what came back; a larger model or a different system instruction.

<!-- 2026-11-23T11:30Z https://github.com/octopot/sushi/issues/6#issuecomment-7099087971
Closed: v0.2.1 shipped it. The hint keeps *No changes* until the next step and shows the model, the time and the changed places (`tests/composer.test.mjs`, VH-4, VH-10).
-->

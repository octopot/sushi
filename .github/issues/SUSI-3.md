---
code: SUSI-3
id: I_kwDOVy11Hs8AAAABgvfhdA
databaseId: 6492250484
number: 4
url: https://github.com/octopot/sushi/issues/4
title: "editor: a right click opens the macOS menu, not the actions"
issueType: Bug
labels:
  - "scope: code"
  - "impact: medium"
assignees:
  - kamilsk
milestone: "[[SUSI-M1]]"
parent: null
issueFields: {}
state: CLOSED
stateReason: COMPLETED
duplicateOf: null
createdAt: 2026-11-19T14:50:31Z
updatedAt: 2026-11-23T11:08:31Z
lastEditedAt: 2026-11-23T11:07:59Z
closedAt: 2026-11-23T11:08:31Z
---

# editor: a right click opens the macOS menu, not the actions

## Problem

A right click on a selection in the editor opens Sushi's actions (⌘K) instead of the context menu every macOS text field has, while a right click without a selection opens the usual menu. The same gesture gives two different menus depending on the selection, and on a selection the user loses Look Up, Translate, spelling, Speech, Services and the other system items. Actions already have their key, ⌘K, and a button in the bottom bar.

## PoC

```text
1. Show the panel, type a sentence and select a word.
2. Right-click the word: the actions open instead of the context menu.
3. Click away from the selection and right-click again: the macOS context menu opens.
```

## Expected behavior

A right click opens the macOS context menu, with or without a selection, as in any other text field. Actions open with ⌘K and the button.

## Acceptance criteria

- [x] A right click on a selection opens the system context menu and leaves the selection as it was; the actions stay closed.
- [x] A browser scenario in `tests/composer.test.mjs` fails on the old behaviour and passes on the new one.
- [x] README, the editing and keyboard guides, the landing page and VH-10 no longer offer the right click for actions; the release note of the version that ships it says so.

## Out of scope

Adding Sushi's own items, such as the actions, to the system context menu.

<!-- 2026-11-23T11:30Z https://github.com/octopot/sushi/issues/4#issuecomment-7099085640
Closed: v0.2.1 shipped it. A right click opens the macOS menu (`tests/composer.test.mjs`, VH-10), the guides no longer offer it for actions, and the v0.2.1 note says so.
-->

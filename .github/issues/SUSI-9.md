---
code: SUSI-9
id: I_kwDOVy11Hs8AAAABhsWBEw
databaseId: 6556057875
number: 13
url: https://github.com/octopot/sushi/issues/13
title: "app: report a problem from the menu, with an anonymized snapshot"
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
createdAt: 2026-11-23T09:17:05Z
updatedAt: 2026-11-23T09:17:15Z
lastEditedAt: null
closedAt: null
---

# app: report a problem from the menu, with an anonymized snapshot

## Motivation

When Sushi misbehaves for a user, today the only path to a fix is a developer conversation: the user is handed terminal commands, scripts that watch focus and system logs, and is asked for versions and settings. [[SUSI-7]] went that way: hours spent, and still no answer to what took focus away. Users of a prompt composer are not expected to debug a macOS app. Reporting a problem should be part of Sushi itself: the user starts it from the menu, says what happened in their own words, Sushi collects what support needs to reproduce it, removes everything personal, shows exactly what will leave the Mac, and sends it where it belongs in one step.

Error trackers such as Sentry solve this for developers: stack traces, breadcrumbs, dashboards. Here the reporter is the user, so the flow has to be friendly first and complete second, and it must keep Sushi's promise that nothing leaves the Mac without the user's say.

## PoC

```text
Menu bar menu → Report a Problem…

1. "What went wrong?"            the user types or dictates a few sentences
2. Up to three follow-up questions optional; locally with Ollama, with consent for OpenRouter:
                                 what were you doing, what did you expect, does it repeat
3. "Reproduce it now?"           optional: turns on the diagnostic recording of SUSI-7,
                                 the user repeats the steps, then finishes it, from the
                                 panel or from the menu bar menu
4. Preview                       the report exactly as it will be sent, and who can read it:
                                 description, answers, build info (SUSI-8), state snapshot,
                                 the recording; built only from listed fields
5. Send                          one click; the user gets a link or a reference to follow up
```

## Acceptance criteria

- [ ] **Starting.** **Report a Problem…** in the menu bar menu starts the flow. Starting it records nothing and sends nothing, and its first step is the description. The user can leave at any step without anything being sent. The messages in the panel that link to the flow are listed in the specification.
- [ ] **Reachable when the panel fails.** The flow can be started, the recording finished and the report sent when the panel does not show or does not stay open, as in [[SUSI-7]]. While a recording runs, the menu bar menu has the item that finishes it.
- [ ] **Describing.** The user describes the problem in free text, typed or dictated. Follow-up questions are optional, at most three, in the language of the description, and the user can skip them. The model receives only the description and the answers, never the snapshot or the recording. With Ollama the questions run locally. With OpenRouter, Sushi says that the description will go to OpenRouter and asks first; declining falls back to three fixed questions: what you did, what you expected, whether it repeats. The same fixed questions are used without a working model. `docs/specs/model.md` gains the rule.
- [ ] **Recording.** When the user chooses to reproduce, Sushi records what the diagnostic mode of [[SUSI-7]] records, in the same format, for the duration, with its notice. This switch lives in memory: Sushi still never creates the diagnostic file. This issue makes the recording a permanent part of Sushi, so it lifts the Cargo feature of [[SUSI-7]]. The recording turns off by itself when the user finishes it, leaves the flow or quits Sushi.
- [ ] **Snapshot.** The report carries:
  - the build info block of [[SUSI-8]];
  - the state of the panel: which view was open, the length of the version chain, whether an edit was running;
  - whether each settings file is present and valid, without its contents, and Sushi's messages about them by kind, without the quoted values;
  - the kind of library folder (default, custom or from the environment) without its path, and the number of actions and prompts;
  - the hotkey setup and the conflicts Sushi detected, the keyboard input source and the appearance;
  - the model provider, whether it is reachable, the Ollama version and whether the model is present;
  - the recording, if one was made.
- [ ] **Anonymizing.** The report is built only from the fields the specification lists; nothing else can enter it. It never holds:
  - prompt text, drafts, library names or contents, dictionary terms or action names;
  - API keys or file paths;
  - the user or computer name;
  - other apps' window titles.

  Bundle IDs of other apps stay, and the preview says so. The description and the answers are the user's words and are sent as written. A test plants a unique marker in every source of state and finds none in the report. The sources are the draft, each version of the chain, library files and their names, the dictionary, `rules.json`, the key in `model.json`, `library-path.txt`, a window title and the home folder name.
- [ ] **Preview and consent.** The user sees the whole report as it will be sent and who will be able to read it. They can edit the description and remove any attached part, and nothing leaves the Mac until they press Send. The report can also be saved as a file instead. The user may add a contact, empty by default; without one, the reference is the only way back.
- [ ] **Format and size.** A report has a versioned format in the specification, readable by a person and by an agent. It has a size limit that fits the destination. A recording over the limit is cut from the start, and the preview says so.
- [ ] **Sending.** One click delivers the report and gives the user a link or a reference. A report that can't be sent (no network, the service down) stays on the Mac and can be sent, saved or deleted later. The list of files Sushi writes in `docs/specs/local-files.md` gains the unsent reports.
- [ ] **Destination.** A comment on this issue compares the candidates and names the choice. The criteria are the effort for the user, whether a server or a secret of ours is needed, abuse, and who can read a report.
- [ ] **The promise stays true.** The site, the README and `docs/specs/` say what a report contains, where it goes and who can read it. *Nothing leaves your Mac* and *no server of ours* are reworded if the chosen destination needs it. The destination comparison counts a server of ours as a cost.
- [ ] **Specification and tests.** The flow is a specification in `docs/specs/`, with browser scenarios for each step run with the sending stubbed; the stage build never sends. A guide page on the site replaces the manual steps of *Report a problem* in `docs/content/guide/troubleshooting.mdx`. The flow's own text is English, as the rest of Sushi.

Builds on [[SUSI-7]] (the recording) and [[SUSI-8]] (the build info).

## Out of scope

- Crash reporting and automatic error collection without the user's action.
- Analytics and usage telemetry.
- Sending anything without the preview.
- Support's side of the flow: triage and replies.
- Screenshots: a picture of the panel would carry the prompt.

<!-- 2026-11-23T12:00Z https://github.com/octopot/sushi/issues/13#issuecomment-7096453605
Where reports could go: candidates, not a decision.

| Option | For a non-developer | Server or secret of ours | Abuse | Privacy |
| --- | --- | --- | --- | --- |
| Prefilled GitHub issue URL or issue form | Needs a GitHub account; a recording does not fit in a URL and has to be attached by hand | None | GitHub's own controls | Public, under the user's account |
| `mailto:` | Opens a draft but can't attach a file | None | Mailbox spam only | Private; reveals the user's address |
| Email draft through the macOS sharing service | One click to a draft with the report attached; a reply is the follow-up channel | None | Mailbox spam only | Private; reveals the user's address |
| Sentry User Feedback, hosted | The form is still ours to build; no account for the user | A third-party service; the key in the app is public by design | Anyone with the key can post; quotas only | A third party stores reports; scrubbing runs after sending |
| Sentry, self-hosted | Same | A heavy server to run | Same | Reports stay with us |
| A small relay (for example a Cloudflare Worker with a GitHub App) | Best: one click, no account, returns an issue link | A server of ours; the secret stays on it | Needs rate limits, size caps and deduplication; an ad-hoc signed app can't prove it is Sushi | The relay sees the IP; reports can go to a private repository |

- **Without a server:** a saved report plus a prefilled GitHub issue or an email draft. This keeps "no server of ours" true. Many of Sushi's users write prompts for coding agents and have a GitHub account.
- **One click for everyone:** the relay. It is the only option that sends "where it belongs in one step" without an account. Open-source examples of the pattern are BugDrop and appfeedback.
- **Sentry:** not a candidate. It adds a third party or a heavy server and still leaves the friendly form to build.

To check before choosing: the URL length GitHub accepts, how issue-form fields map to query parameters, and attachments through the sharing service with mail clients other than Mail.
-->

---
code: SUSI-9
id: I_kwDOVy11Hs8AAAABhsWBEw
databaseId: 6556057875
number: 13
url: https://github.com/octopot/sushi/issues/13
title: "app: report a problem from the menu as a text the user can edit and send"
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
createdAt: 2026-11-23T09:17:05Z
updatedAt: 2026-11-23T10:50:44Z
lastEditedAt: 2026-11-23T10:50:44Z
closedAt: null
---

# app: report a problem from the menu as a text the user can edit and send

## Motivation

When Sushi misbehaves for a user, today the only path to a fix is a developer conversation: the user is handed terminal commands, scripts that watch focus and system logs, and is asked for versions and settings. [[SUSI-7]] went that way: hours spent, and still no answer to what took focus away. Users of a prompt composer are not expected to debug a macOS app. Reporting a problem should be part of Sushi itself: the user starts it from the menu, says what happened in their own words, Sushi collects what support needs to reproduce it, removes everything personal, and hands the user a ready report as text: they read it, edit it and send it themselves, the way they already talk to the developer.

The first users are beta testers who are in touch with the developer, so a text they paste into a chat or an email is enough. Sending from Sushi itself, to GitHub or a service of ours, is a later decision, taken once this text shows what a good report holds.

Error trackers such as Sentry solve this for developers: stack traces, breadcrumbs, dashboards. Here the reporter is the user, so the flow has to be friendly first and complete second, and it must keep Sushi's promise that nothing leaves the Mac without the user's say.

## PoC

```text
Menu bar menu → Report a Problem…

1. "What went wrong?"            the user types or dictates a few sentences
2. Up to three follow-up questions optional; locally with Ollama, with consent for a hosted provider:
                                 what were you doing, what did you expect, does it repeat
3. "Reproduce it now?"           optional: turns on the diagnostic recording of SUSI-7,
                                 the user repeats the steps, then finishes it, from the
                                 panel or from the menu bar menu
4. The report                    one editable text: description, answers, build info
                                 (SUSI-8), state snapshot; the recording as a file next to it;
                                 built only from listed fields
5. Copy · Save                   Copy puts the text on the clipboard; Save writes the text
                                 and the recording to a folder and shows it in Finder
```

## Acceptance criteria

- [ ] **Starting.** **Report a Problem…** in the menu bar menu starts the flow. Starting it records nothing and sends nothing, and its first step is the description. The user can leave at any step. Sushi never sends the report. The messages in the panel that link to the flow are listed in the specification.
- [ ] **Reachable when the panel fails.** The flow can be started, the recording finished and the report copied or saved when the panel does not show or does not stay open, as in [[SUSI-7]]. Without the panel, **Report a Problem…** saves the report and the recording from the menu and shows them in Finder; the user opens the saved text, adds the description and edits it there before sending. While a recording runs, the menu bar menu has the item that finishes it.
- [ ] **Describing.** The user describes the problem in free text, typed or dictated. Follow-up questions are optional, at most three, in the language of the description, and the user can skip them. The model receives only the description and the answers, never the snapshot or the recording. With Ollama the questions run locally. With a hosted provider ([[SUSI-6]], [[SUSI-10]], [[SUSI-11]]), Sushi names the provider the description will go to and asks first; declining falls back to three fixed questions: what you did, what you expected, whether it repeats. The same fixed questions are used without a working model. `docs/specs/model.md` gains the rule.
- [ ] **Recording.** When the user chooses to reproduce, Sushi records what the diagnostic mode of [[SUSI-7]] records, in the same format, for the duration, with its notice. This switch lives in memory: Sushi still never creates the diagnostic file. This issue makes the recording a permanent part of Sushi, so it lifts the Cargo feature of [[SUSI-7]]. The recording turns off by itself when the user finishes it, leaves the flow or quits Sushi.
- [ ] **Snapshot.** The report carries:
  - the build info block of [[SUSI-8]];
  - the state of the panel: which view was open, the length of the version chain, whether an edit was running;
  - whether each settings file is present and valid, without its contents, and Sushi's messages about them by kind, without the quoted values;
  - the kind of library folder (default, custom or from the environment) without its path, and the number of actions and prompts;
  - the hotkey setup and the conflicts Sushi detected, the keyboard input source and the appearance;
  - the model provider, whether it is reachable, the Ollama version and whether the model is present;
  - the recording, if one was made.
- [ ] **Anonymizing.** The snapshot and the recording Sushi collects are built only from the fields the specification lists; nothing else can enter them. They never hold:
  - prompt text, drafts, library names or contents, dictionary terms or action names;
  - API keys or file paths;
  - the user or computer name;
  - other apps' window titles.

  Bundle IDs of other apps stay, and the report says so. The description and the answers are the user's words and are kept as written. A test plants a unique marker in every source of state and finds none in the report. The sources are the draft, each version of the chain, library files and their names, the dictionary, `rules.json`, the keys of connected providers (`model.json` and the Keychain), `library-path.txt`, a window title and the home folder name.
- [ ] **The report as text.** In the panel, the user sees the whole report as one text before they copy or save it, and can edit any part of it, the snapshot included, or remove a part; the recording is listed with its size and can be left out. **Copy** puts the text on the clipboard; **Save** writes the text and the recording to a folder and shows it in Finder. Sushi never sends the report. Hosted follow-up questions send only the description and the answers, with explicit consent; the flow makes no other network request.
- [ ] **Format and size.** A report has a versioned format in the specification, readable by a person and by an agent. The text fits a chat message or an email; the recording goes as a separate file. A recording over the size limit is cut from the start, and the report says so.
- [ ] **The promise stays true.** The site, the README and `docs/specs/` say what a report contains and that the user sends it themselves; *nothing leaves your Mac without your say* stays true.
- [ ] **Specification and tests.** The flow is a specification in `docs/specs/`, with browser scenarios for each step and a check that the flow makes no network request apart from the agreed follow-up questions. A guide page on the site replaces the manual steps of *Report a problem* in `docs/content/guide/troubleshooting.mdx`. The flow's own text is English, as the rest of Sushi.

Builds on [[SUSI-7]] (the recording) and [[SUSI-8]] (the build info).

## Out of scope

- Crash reporting and automatic error collection without the user's action.
- Analytics and usage telemetry.
- Sending from Sushi: a prefilled GitHub issue, an email draft or a service of ours. The comment below keeps the candidates for that later decision.
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

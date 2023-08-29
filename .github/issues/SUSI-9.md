---
code: SUSI-9
id: I_kwDOVy11Hs8AAAABhsWBEw
databaseId: 6556057875
number: 13
url: https://github.com/octopot/sushi/issues/13
title: "app: report a problem from the menu as a text the user can edit and send"
issueType: Feature
labels:
  - "scope: code"
  - "impact: high"
assignees:
  - kamilsk
milestone: "[[SUSI-M2]]"
parent: null
issueFields: {}
state: OPEN
stateReason: null
duplicateOf: null
createdAt: 2026-11-23T09:17:05Z
updatedAt: 2026-11-24T14:47:04Z
lastEditedAt: 2026-11-24T14:47:01Z
closedAt: null
---

# app: report a problem from the menu as a text the user can edit and send

## Motivation

When Sushi misbehaves for a user, today the only path to a fix is a developer conversation: the user is handed terminal commands, scripts that watch focus and system logs, and is asked for versions and settings. [[SUSI-7]] went that way: hours spent, and still no answer to what took focus away. Users of a prompt composer are not expected to debug a macOS app. Reporting a problem should be part of Sushi itself: the user starts it from the menu, says what happened in their own words, Sushi collects what support needs to reproduce it, removes everything personal, and hands the user a ready report as text: they read it, edit it and send it themselves, the way they already talk to the developer.

The first users are beta testers who are in touch with the developer, so a text they paste into a chat or an email is enough. Sending from Sushi itself, to GitHub or a service of ours, is a later decision, taken once this text shows what a good report holds.

Error trackers such as Sentry solve this for developers: stack traces, breadcrumbs, dashboards. Here the reporter is the user, so the flow has to be friendly first and complete second, and it must keep Sushi's promise that nothing leaves the Mac without the user's say.

## PoC

```text
Menu bar menu → Report a problem…

1. "What went wrong?"            the user types or dictates a few sentences
2. Up to three follow-up questions optional; locally with Ollama, with consent for a hosted provider:
                                 what were you doing, what did you expect, does it repeat
3. "Reproduce it now?"           optional: turns on the diagnostic recording of SUSI-7,
                                 the user repeats the steps, then finishes it, in the
                                 report's window, the panel or the menu bar menu
4. The report                    one editable text: description, answers, build info
                                 (SUSI-8), state snapshot; the recording as a file next to it;
                                 built only from listed fields
5. Copy · Save                   Copy puts the text on the clipboard; Save writes the text
                                 and the recording to a folder and shows it in Finder
```

## Acceptance criteria

- [x] **Starting.** **Report a problem…** in the menu bar menu starts the flow. Starting it records nothing and sends nothing, and its first step is the description. The user can leave at any step. Sushi never sends the report. The messages in the panel that link to the flow are listed in the specification.
- [x] **One way in.** The flow lives in a window of its own, which stays open while the user looks things up and uses the panel; the menu bar menu has one row for it and no second route. While a recording runs, the menu bar menu has the item that finishes it. When the panel does not show or does not stay open, as in [[SUSI-7]], the report can still be written, and the user also gets what support needs without a terminal: the build info and the diagnostic log from the settings window ([[SUSI-12]]).
- [x] **Describing.** The user describes the problem in free text, typed or dictated. Follow-up questions are optional, at most three, in the language of the description, and the user can skip them. The model receives only the description, never the answers, the snapshot or the recording. With Ollama the questions run locally. With a hosted provider ([[SUSI-6]], [[SUSI-10]], [[SUSI-11]]), Sushi names the provider the description will go to and asks first; declining with **Use standard questions** falls back to three fixed questions: what you did, what you expected, whether it repeats. The same fixed questions are used without a working model. The rule is RP-3 in `docs/specs/report.md`.
- [x] **Recording.** When the user chooses to reproduce, Sushi records what the diagnostic mode of [[SUSI-7]] records, in the same format, for the duration, into a file of its own, `report-recording.log`, with its notice. This switch lives in memory: the flow never creates `diagnostics.json`. This issue makes the recording a permanent part of Sushi, without the Cargo feature [[SUSI-7]] started with. The recording turns off by itself when the user finishes it, leaves the flow or quits Sushi.
- [x] **Snapshot.** The report carries:
  - the build info block of [[SUSI-8]];
  - the state of the panel: which view was open, the length of the version chain, whether an edit was running;
  - whether each settings file is present and valid, without its contents, and Sushi's messages about them by kind, without the quoted values;
  - the kind of library folder (default, custom or from the environment) without its path, and the number of actions and prompts;
  - the hotkey setup and the conflicts Sushi detected, the keyboard input source and the appearance;
  - the active provider and its model, the connected providers and how the last hosted edit ended; for Ollama, whether it runs, its version and whether the model is present. A hosted provider is not contacted;
  - the size of the recording, if one was made.
- [x] **Anonymizing.** The snapshot and the recording Sushi collects are built only from the fields the specification lists; nothing else can enter them. They never hold:
  - prompt text, drafts, library names or contents, dictionary terms or action names;
  - API keys or file paths;
  - the user or computer name;
  - other apps' window titles.

  Bundle IDs of other apps stay, and the report says so. The description and the answers are the user's words and are kept as written. A test plants a unique marker in every source of state and finds none in the report. The sources are the draft, each version of the chain, library files and their names, the dictionary, `rules.json`, the keys of connected providers (`model.json` and the Keychain), `library-path.txt`, a window title and the home folder name.
- [x] **The report as text.** In the report's window, the user sees the whole report as one text before they copy or save it, and can edit any part of it, the snapshot included, or remove a part; the recording is listed with its size and can be left out. **Copy** puts the text on the clipboard; **Save…** writes the text and the recording to a folder and shows it in Finder. Sushi never sends the report. Hosted follow-up questions send only the description, with explicit consent; the flow makes no other network request.
- [x] **Format and size.** A report has a versioned format in the specification, readable by a person and by an agent. The text fits a chat message or an email; the recording goes as a separate file. A recording over the size limit is cut from the start, and the report says so.
- [x] **The promise stays true.** The site, the README and `docs/specs/` say what a report contains and that the user sends it themselves; *nothing leaves your Mac without your say* stays true.
- [x] **Specification and tests.** The flow is a specification in `docs/specs/`, with browser scenarios for each step and a check that the flow makes no network request apart from the agreed follow-up questions. A guide page on the site replaces the manual steps of *Report a problem* in `docs/content/guide/troubleshooting.mdx`. The flow's own text is English, as the rest of Sushi.

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

<!-- 2026-11-24T12:02Z https://github.com/octopot/sushi/issues/13#issuecomment-7130914688
Reworded after v0.3.0 in four places: the model gets the description only, never the answers; the recording goes to a file of its own; the snapshot says how the last hosted edit ended instead of asking a provider; the button is **Save…**. Ticked criteria are proven by the tests the Verification table of `docs/specs/report.md` names.

Left to check by hand in the installed app: the menu row starts the flow, a dictated description, **Finish recording** from the menu bar menu, and **Save…** showing the folder in Finder.
-->

<!-- 2026-11-24T13:45Z https://github.com/octopot/sushi/issues/13#issuecomment-7133268669
Checked by hand in the owner's run by hand on 2026-11-24, on the v0.3.0 code with the fixes then on main (build `05a23ce-dirty`), macOS 27.2: the menu row starts the flow, a dictated description, the consent before a hosted provider gets the description, **Finish recording** from the menu bar menu, **Save…** and **Copy**. The criteria hold.

The run found one defect, fixed for v0.3.1: after a click on **Save…** or on the checkbox, ⌘↵ did nothing, because the app's WebKit takes the keyboard focus from the field on such a click and the flow listened for the key only inside itself. The panel now passes ⌘↵ to the flow wherever the focus is (RP-8), with a scenario that fails without the fix.

Open, from the same run: the owner found repeating the steps under a recording hard, and asked why the panel cannot be moved from the middle of the screen. Both need a decision before they become work; this issue stays open until the fix is seen in the installed app.
-->

<!-- 2026-11-24T14:46Z https://github.com/octopot/sushi/issues/13#issuecomment-7134941263
What made the report hard to write, in the owner's words after the run by hand: while describing a problem one looks things up, in other apps and in Sushi itself, or tries the case again. The flow covered the panel, and the panel hides when the keyboard leaves it, so the report went out of sight at every look elsewhere; Mission Control does not list the panel, and the way back was the menu.

Changed for v0.3.1: the report has a window of its own, a normal window like Settings. It stays open among other apps, moves and resizes, shows in Mission Control, and the panel works as usual while it is open; closing it keeps what was written. A recording runs with the window open at *Recording…*. The rules are RP-1, RP-2 and RP-5 in `docs/specs/report.md`, PN-9 and PN-10 in `docs/specs/panel.md`.

Checked by `tests/report.test.mjs` and by `tests/stage/report.sh`, which walks the real window to the report's text under the wallpaper, 10 checks. Left by hand: PR-24, the window among other apps and with the panel over it.
-->

<!-- 2026-11-24T15:00Z https://github.com/octopot/sushi/issues/13#issuecomment-7129470617
The owner's decision after seeing the menu of #17: **Report a problem…** is one row, and the route that saved a report without the panel is removed. The criterion *Reachable when the panel fails* became *One way in*. When the panel does not show or does not stay open, as in #11, the user sends the build info and the diagnostic log from Settings ▸ About; the report with its questions and snapshot needs the panel.
-->

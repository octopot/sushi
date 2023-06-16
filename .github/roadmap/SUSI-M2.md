---
code: SUSI-M2
id: MI_kwDOVy11Hs4BLjR-
databaseId: 19805310
number: 2
url: https://github.com/octopot/sushi/milestone/2
title: "M2: See what happens, pick your model"
state: OPEN
openIssueCount: null
closedIssueCount: null
dueOn: 2026-11-29T00:00:00Z
createdAt: 2026-11-23T10:49:16Z
updatedAt: 2026-11-23T10:51:06Z
closedAt: null
---

# M2: See what happens, pick your model

You always know what Sushi did and why: every edit says how it ended, the menu tells which build you run, and a problem can be reported without a terminal. When the local model cannot make an edit, you connect OpenRouter in a few clicks, without copying a key; OpenAI and Claude connect from the same menu, by sign-in or a key pasted once. Ollama stays the default.

**What you get after upgrading**

- After each edit the hint names the model, the time and how many places changed, or says plainly that nothing changed (shipped in v0.2.1).
- **Model** in the menu bar menu connects OpenRouter, OpenAI or Claude without editing a file, shows which model answers and switches back to Ollama in one click. Before connecting, Sushi says what leaves the Mac and who pays.
- The menu shows the version and build, and copies them in one click.
- The panel no longer hides after ⌘A, and when the panel hides by itself the reason can be found out.
- **Report a Problem…** turns your description and an anonymized snapshot into a text you can edit and send yourself; Sushi never sends it.

**Done when**

- An unchanged edit stays visible until your next step; a diff names the model, the time and the number of changes.
- The example edit of [[SUSI-6]] gives the expected diff through OpenRouter, connected without copying a key or editing a file; a failure offers **Edit with Ollama**.
- OpenAI and Claude connect through the same menu and flow, each by the way its issue chose.
- The build info copied from the menu matches `sushi version`.
- On the Mac where the panel hid, ⌘A selects all and the panel stays open; Caps Lock opens it without flicker; a click elsewhere still hides it.
- A user without a terminal, even with a broken panel, gets a report text from **Report a Problem…**; Sushi never sends it.

By default nothing leaves your Mac: a hosted provider gets the instruction and the text only after you connect it. Out of scope: sending reports from Sushi, a settings window.

## Issues

- [ ] [[SUSI-5]] — rewrite: an edit the model leaves unchanged passes unnoticed
- [ ] [[SUSI-6]] — rewrite: connect OpenRouter from the menu, without copying a key
- [ ] [[SUSI-7]] — panel: hides right after ⌘A selects all text, then flickers on Caps Lock
- [ ] [[SUSI-8]] — app: embed build info and show which version and build is running
- [ ] [[SUSI-9]] — app: report a problem from the menu as a text the user can edit and send
- [ ] [[SUSI-10]] — rewrite: connect OpenAI and edit through its API
- [ ] [[SUSI-11]] — rewrite: connect Claude through the Anthropic API

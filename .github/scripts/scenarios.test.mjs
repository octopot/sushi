import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { checklist, classify, index, lint, load, parse, scenarios, select } from './scenarios.mjs'

const script = resolve('.github/scripts/scenarios.mjs')

const SPEC = `# The panel

- **PN-1. On the current Space.** The panel shows there.
- **PN-4. Back where the user was.** Esc hides it.

## Verification

| PN-1 | PR-1 by hand |
`
const FEATURE = `# a comment
Feature: The panel on screen
  Window showing goes through the window server.
  When a test cannot reach it, a scenario does.

  Background:
    Given the build under test runs, started with:
      """
      open -g <path>/Sushi.app --args --hidden
        an indented line
      """

  @PR-1 @PN-1 @hands @smoke
  Scenario: The panel shows over a full-screen app
    Given a terminal in full screen (⌃⌘F)
    When I press Caps Lock
    Then the panel shows over the terminal
    And there is no Space animation
    But the terminal stays in full screen

  @PR-2 @PN-4
  @hands @account
  Scenario: Hiding gives the keyboard back
    When I press Esc
    And I press ⌘V
    Then ⌘V pastes the prompt into the terminal
    When I run the command:
      """
      sushi version
      """
    Then **Copy build info** says *Copied*
`

function fixture(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sushi-scenarios-'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  const run = (...args) => spawnSync(process.execPath, [script, ...args, '--dir', dir], { encoding: 'utf8' })
  try { return fn(dir, run) } finally { rmSync(dir, { recursive: true, force: true }) }
}

const good = { 'panel.md': SPEC, 'panel.feature': FEATURE }
const problems = (feature, spec = SPEC) => fixture({ 'panel.md': spec, 'panel.feature': feature }, (dir) => lint(dir))

test('a feature is read: the description, the background, tags over two lines, And and But, doc strings', () => {
  const feature = parse(FEATURE, 'panel.feature')
  assert.equal(feature.title, 'The panel on screen')
  assert.deepEqual(feature.description, ['Window showing goes through the window server.', 'When a test cannot reach it, a scenario does.'])
  assert.equal(feature.background.length, 1)
  assert.equal(feature.background[0].doc, 'open -g <path>/Sushi.app --args --hidden\n  an indented line')
  const [first, second] = feature.scenarios
  assert.equal(first.title, 'The panel shows over a full-screen app')
  assert.deepEqual(first.tags, ['PR-1', 'PN-1', 'hands', 'smoke'])
  assert.deepEqual(first.steps.map((s) => [s.keyword, s.kind]), [['Given', 'given'], ['When', 'when'], ['Then', 'then'], ['And', 'then'], ['But', 'then']])
  assert.deepEqual(second.tags, ['PR-2', 'PN-4', 'hands', 'account'])
  assert.deepEqual(second.steps.map((s) => s.kind), ['when', 'when', 'then', 'when', 'then'])
  assert.equal(second.steps[3].doc, 'sushi version')
  assert.deepEqual(classify(second), { id: 'PR-2', ids: ['PR-2'], runners: ['hands'], runner: 'hands', rules: ['PN-4'], needs: ['account'], occasions: [], unknown: [] })
})

test('a line that is not Gherkin names its file and line', () => {
  const broken = (text, message) => assert.throws(() => parse(text, 'x.feature'), { message })
  broken('Scenario: early\n', 'x.feature:1: Scenario before Feature')
  broken('Feature: a\n  Scenario: b\n    And nothing before it\n', 'x.feature:3: And needs a Given, When or Then before it')
  broken('Feature: a\n  Scenario: b\n    When I press Esc\n    the panel hides\n', 'x.feature:4: not a step: "the panel hides"')
  broken('Feature: a\n  Scenario Outline: b\n', /x\.feature:2: outlines, tables and Rule are not read here/)
  broken('Feature: a\n  Scenario: b\n    When I run:\n      """\n      open\n', /a doc string is not closed/)
  broken('Feature: a\n  @PR-1\n', /tags must be followed by a scenario/)
  broken('Feature: a\n  @PR-1 loose\n  Scenario: b\n', 'x.feature:2: "loose" is not a tag')
  broken('# only a comment\n', 'x.feature:1: no Feature')
})

test('lint passes scenarios that agree with the specification', () => {
  assert.deepEqual(fixture(good, (dir) => lint(dir)), [])
  fixture(good, (dir, run) => {
    const result = run('lint')
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /scenarios: 2 in 1 files agree with the specifications/)
  })
})

test('lint names what is wrong with a scenario', () => {
  const swap = (from, to) => problems(FEATURE.replace(from, to))
  assert.match(swap('@PR-1 @PN-1 @hands @smoke', '@PN-1 @hands').join('\n'), /panel\.feature:14: "The panel shows over a full-screen app" needs exactly one id tag \(@PR-n\), has 0/)
  assert.match(swap('@PR-1 @PN-1', '@PR-1 @PR-3 @PN-1').join('\n'), /PR-1 needs exactly one id tag \(@PR-n\), has 2/)
  assert.match(swap('@PR-1 @PN-1 @hands', '@PR-1 @PN-1').join('\n'), /PR-1 needs exactly one runner tag \(@hands or @agent\), has 0/)
  assert.match(swap('@PR-1 @PN-1 @hands', '@PR-1 @PN-1 @hands @agent').join('\n'), /PR-1 needs exactly one runner tag \(@hands or @agent\), has 2/)
  assert.match(swap('@PR-1 @PN-1 @hands', '@PR-1 @hands').join('\n'), /PR-1 names no rule it checks/)
  assert.match(swap('@PR-1 @PN-1', '@PR-1 @PN-9').join('\n'), /PR-1 is tagged @PN-9, and no specification states a rule PN-9/)
  assert.match(swap('@smoke', '@smokey').join('\n'), /PR-1 has an unknown tag @smokey/)
  assert.match(swap('@PR-2 @PN-4', '@PR-1 @PN-4').join('\n'), /panel\.feature:23: PR-1 is also the id of a scenario at panel\.feature:14/)
  assert.match(swap('    When I press Caps Lock\n', '').join('\n'), /PR-1 has no When step/)
  assert.match(swap('When I press Caps Lock', 'When Caps Lock is pressed').join('\n'), /panel\.feature:16: PR-1: write an action as "When I …"/)
  assert.match(problems(FEATURE.replace(/    Then the panel shows[^]*?full screen\n/, '')).join('\n'), /PR-1 has no Then step/)
})

test('lint ties the scenarios to the specifications', () => {
  assert.match(problems(FEATURE, `${SPEC}\n| PN-4 | PR-7 by hand |\n`).join('\n'), /panel\.md:10: mentions PR-7, and no scenario has that id/)
  assert.deepEqual(fixture({ 'panel.md': SPEC, 'other.feature': FEATURE }, (dir) => lint(dir)).filter((p) => /beside/.test(p)), ['other.feature:1: no specification other.md beside it'])
  const broken = fixture({ 'panel.md': SPEC, 'panel.feature': 'Feature: a\n  Scenario: b\n    nonsense\n' }, (dir, run) => run('lint'))
  assert.equal(broken.status, 1)
  assert.match(broken.stderr, /panel\.feature:3: not a step: "nonsense"/)
})

test('the index in a specification is checked and written', () => {
  const spec = `${SPEC}\n<!-- scenarios:index -->\nstale\n<!-- /scenarios:index -->\n\nafter\n`
  fixture({ 'panel.md': spec, 'panel.feature': FEATURE }, (dir, run) => {
    assert.match(lint(dir).join('\n'), /panel\.md: the index of scenarios is not current; run: node \.github\/scripts\/scenarios\.mjs index --write/)
    assert.equal(run('index', '--write').status, 0)
    assert.deepEqual(lint(dir), [])
    const written = readFileSync(join(dir, 'panel.md'), 'utf8')
    assert.ok(written.includes('| PR-1 | The panel shows over a full-screen app | [panel.feature](panel.feature) | PN-1 |'))
    assert.ok(written.endsWith('<!-- /scenarios:index -->\n\nafter\n'))
    assert.equal(run('index').stdout.trim(), index(load(dir)))
  })
})

test('a selection takes any of the tags, ids and rules, and leaves out what is skipped', () => {
  const features = [parse(FEATURE, 'panel.feature')]
  const ids = (selection) => select(features, selection).map((s) => s.id)
  assert.deepEqual(ids(), ['PR-1', 'PR-2'])
  assert.deepEqual(ids({ tags: ['smoke'] }), ['PR-1'])
  assert.deepEqual(ids({ tags: ['@smoke'], rules: ['PN-4'] }), ['PR-1', 'PR-2'])
  assert.deepEqual(ids({ ids: ['PR-2'] }), ['PR-2'])
  assert.deepEqual(ids({ skip: ['account'] }), ['PR-1'])
  assert.deepEqual(ids({ tags: ['hands'], skip: ['smoke', 'account'] }), [])
  assert.deepEqual(scenarios([parse(FEATURE.replace('@PR-1', '@PR-10'), 'panel.feature')]).map((s) => s.id), ['PR-2', 'PR-10'])
})

test('the checklist gives the setup, numbered actions and a box per expectation', () => {
  const text = checklist([parse(FEATURE, 'panel.feature')])
  assert.ok(text.startsWith('# Sushi acceptance checklist\n\n2 of 2 scenarios. '))
  assert.ok(text.includes(`## The panel on screen

From \`docs/specs/panel.feature\`.

Before each scenario:

- The build under test runs, started with:

  \`\`\`sh
  open -g <path>/Sushi.app --args --hidden
    an indented line
  \`\`\`

### PR-1 · The panel shows over a full-screen app

Rules: PN-1 · Run by: a person, by hand · Run: after every upgrade

Setup:

- A terminal in full screen (⌃⌘F)

1. Press Caps Lock
   - [ ] The panel shows over the terminal
   - [ ] There is no Space animation
   - [ ] The terminal stays in full screen

### PR-2 · Hiding gives the keyboard back
`), text)
  assert.ok(text.endsWith(`1. Press Esc
2. Press ⌘V
   - [ ] ⌘V pastes the prompt into the terminal
3. Run the command:

   \`\`\`sh
   sushi version
   \`\`\`

   - [ ] **Copy build info** says *Copied*
`), text)
})

test('the checklist starts at the lowest id and says what a scenario needs', () => {
  const later = parse(FEATURE.replace('@PR-1', '@PR-5').replace('@PR-2', '@PR-6'), 'a.feature')
  const earlier = parse('Feature: Later in the alphabet\n  @PR-3 @PN-1 @hands\n  Scenario: First by id\n    When I look\n    Then it is there\n', 'z.feature')
  const text = checklist([later, earlier])
  assert.ok(text.indexOf('## Later in the alphabet') < text.indexOf('## The panel on screen'))
  assert.ok(text.includes('Rules: PN-4 · Run by: a person, by hand · Needs: a real provider account; the edits cost money'))
  assert.ok(text.includes('1. Look\n   - [ ] It is there'))
})

test('the checklist command selects and writes a file', () => {
  fixture(good, (dir, run) => {
    const out = join(dir, 'checklist.md')
    const result = run('checklist', '--tag', 'smoke', '--out', out)
    assert.equal(result.status, 0, result.stderr)
    const text = readFileSync(out, 'utf8')
    assert.match(text, /^1 of 2 scenarios, selected with `--tag smoke`\./m)
    assert.ok(text.includes('### PR-1 ·') && !text.includes('### PR-2 ·'))
    const listed = run('list', '--rule', 'PN-4')
    assert.match(listed.stdout, /^PR-2 {3}panel\.feature {8}Hiding gives the keyboard back {3}@PN-4 @hands @account\n$/)
    assert.equal(run('checklist', '--tag').status, 1)
    assert.equal(run('nonsense').status, 2)
  })
})

test('the scenarios of this repository agree with its specifications', () => {
  assert.deepEqual(lint('docs/specs'), [])
  const all = scenarios(load('docs/specs'))
  assert.ok(all.length >= 27)
  assert.ok(select(load('docs/specs'), { tags: ['smoke'] }).length >= 1)
})

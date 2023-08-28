#!/usr/bin/env node
// The acceptance scenarios of the specifications: docs/specs/<spec>.feature beside <spec>.md.
// They cover what needs the real app in a real macOS session; this script keeps them tied to
// the rules and renders them as a checklist for a person or an agent. Zero dependencies.
//
//   scenarios.mjs lint                          (ids, tags, rules and the index agree with the specifications)
//   scenarios.mjs list [selection]              (id, file, title and tags, one scenario per line)
//   scenarios.mjs checklist [selection] [--out <file>]
//                                               (Markdown: setup, numbered actions, a box per expectation)
//   scenarios.mjs index [--write]               (the table of scenarios kept in the specification)
//
// A selection is any of --tag <tag>, --id <PR-n>, --rule <XX-n>, each repeatable: a scenario
// that matches one of them is taken, and --skip <tag> leaves a scenario out. No selection
// takes every scenario. --dir <folder> reads another folder than docs/specs.
//
// The Gherkin read here: Feature with its description, Background, Scenario, tags, the steps
// Given, When, Then, And, But, a doc string (""") under a step for a command, # comments.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = 'docs/specs'
const RUNNERS = { hands: 'a person, by hand', agent: 'an agent' }
// The tags a checklist is cut by: when a scenario is run, and what it needs beyond the app.
const OCCASIONS = { smoke: 'after every upgrade' }
const NEEDS = {
  account: 'a real provider account; the edits cost money',
  'writing-tools': 'Writing Tools turned on',
  'second-display': 'a second display',
  'affected-mac': 'the Mac where the panel hid (SUSI-7)',
  'fresh-account': 'a macOS account where Sushi never ran',
}
const SELECTION = { ...OCCASIONS, ...NEEDS }
const INDEX = ['<!-- scenarios:index -->', '<!-- /scenarios:index -->']
const KEYWORDS = { Given: 'given', When: 'when', Then: 'then' }
const UNSUPPORTED = /^(Scenario Outline|Scenario Template|Examples|Scenarios|Rule):|^\|/

const number = (id) => Number(id.slice(3))
const isId = (tag) => /^PR-\d+$/.test(tag)
const isRule = (tag) => /^[A-Z]{2}-\d+$/.test(tag) && !isId(tag)

// One feature file as { file, title, description, tags, background, scenarios }; a scenario is
// { title, line, tags, steps }, a step { keyword, kind, text, doc, line }, where kind is what And
// and But continue: given, when or then. Throws on a line it does not read, with file:line.
export function parse(text, file = 'feature') {
  const feature = { file, title: '', description: [], tags: [], background: [], scenarios: [] }
  const fail = (line, message) => { throw new Error(`${file}:${line}: ${message}`) }
  let steps = null // the steps being read: of the background or of a scenario
  let tags = []
  let doc = null // an open doc string: { indent, lines, step }
  let seen = false
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const trimmed = raw.trim()
    if (doc) {
      if (trimmed === '"""') { doc.step.doc = doc.lines.join('\n'); doc = null } else doc.lines.push(raw.slice(Math.min(doc.indent, raw.length - raw.trimStart().length)))
      return
    }
    if (!trimmed || trimmed.startsWith('#')) return
    if (trimmed === '"""') {
      const step = steps?.at(-1)
      if (!step) fail(line, 'a doc string belongs under a step')
      doc = { indent: raw.length - raw.trimStart().length, lines: [], step }
      return
    }
    if (trimmed.startsWith('@')) {
      for (const tag of trimmed.split(/\s+/)) {
        if (!/^@\S+$/.test(tag)) fail(line, `"${tag}" is not a tag`)
        tags.push(tag.slice(1))
      }
      return
    }
    if (UNSUPPORTED.test(trimmed)) fail(line, 'outlines, tables and Rule are not read here; write a Scenario with steps')
    const head = /^(Feature|Background|Scenario|Example):\s*(.*)$/.exec(trimmed)
    if (head) {
      const [, word, title] = head
      if (word === 'Feature') {
        if (seen) fail(line, 'one Feature per file')
        seen = true
        Object.assign(feature, { title, tags })
      } else if (!seen) {
        fail(line, `${word} before Feature`)
      } else if (word === 'Background') {
        if (tags.length) fail(line, 'tags belong to a scenario, not to the background')
        if (feature.scenarios.length) fail(line, 'the background comes before the scenarios')
        steps = feature.background
      } else {
        steps = []
        feature.scenarios.push({ title, line, tags: [...feature.tags, ...tags], steps })
      }
      tags = []
      return
    }
    if (tags.length) fail(line, 'tags must be followed by a scenario')
    // Under Feature and before the first Background or Scenario, every line is its description.
    if (seen && !steps) return void feature.description.push(trimmed)
    const step = /^(Given|When|Then|And|But)\s+(.*)$/.exec(trimmed)
    if (step) {
      if (!steps) fail(line, 'a step before Feature')
      const kind = KEYWORDS[step[1]] ?? steps.at(-1)?.kind
      if (!kind) fail(line, `${step[1]} needs a Given, When or Then before it`)
      steps.push({ keyword: step[1], kind, text: step[2], line })
      return
    }
    fail(line, `not a step: "${trimmed}"`)
  })
  if (doc) fail(text.split(/\r?\n/).length, 'a doc string is not closed')
  if (tags.length) fail(text.split(/\r?\n/).length, 'tags must be followed by a scenario')
  if (!seen) fail(1, 'no Feature')
  return feature
}

// The id, the rules, the runner and the selection tags of a scenario, with what is wrong.
export function classify(scenario) {
  const ids = scenario.tags.filter(isId)
  const runners = scenario.tags.filter((tag) => tag in RUNNERS)
  return {
    id: ids[0],
    ids,
    runners,
    runner: runners[0],
    rules: scenario.tags.filter(isRule),
    needs: scenario.tags.filter((tag) => tag in NEEDS),
    occasions: scenario.tags.filter((tag) => tag in OCCASIONS),
    unknown: scenario.tags.filter((tag) => !isId(tag) && !isRule(tag) && !(tag in RUNNERS) && !(tag in SELECTION)),
  }
}

// Every feature of dir, in the order of their file names.
export function load(dir = DIR) {
  return readdirSync(dir).filter((name) => name.endsWith('.feature')).sort()
    .map((name) => parse(readFileSync(join(dir, name), 'utf8'), name))
}

const specs = (dir) => readdirSync(dir).filter((name) => name.endsWith('.md')).sort()
  .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))

// Every scenario with its feature and tags sorted out, in the order of the ids.
export function scenarios(features) {
  return features.flatMap((feature) => feature.scenarios.map((scenario) => ({ feature, scenario, ...classify(scenario) })))
    .sort((a, b) => (a.id ? number(a.id) : Infinity) - (b.id ? number(b.id) : Infinity))
}

// The table of scenarios a specification keeps between the markers of INDEX.
export function index(features) {
  const escape = (text) => text.replaceAll('|', '\\|')
  return ['| ID | Scenario | File | Rules |', '| --- | --- | --- | --- |',
    ...scenarios(features).map((s) => `| ${s.id} | ${escape(s.scenario.title)} | [${s.feature.file}](${s.feature.file}) | ${s.rules.join(', ')} |`)].join('\n')
}

function indexed(text) {
  const from = text.indexOf(INDEX[0])
  const to = text.indexOf(INDEX[1])
  return from < 0 || to < from ? null : { from: from + INDEX[0].length, to }
}

// What is wrong with the scenarios of dir, as `file:line: problem` lines; empty when nothing is.
export function lint(dir = DIR) {
  const problems = []
  const files = specs(dir)
  const rules = new Set(files.flatMap(({ text }) => [...text.matchAll(/\*\*([A-Z]{2}-\d+)\. /g)].map((m) => m[1])))
  let features = []
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.feature')).sort()) {
    try { features.push(parse(readFileSync(join(dir, name), 'utf8'), name)) } catch (e) { problems.push(e.message) }
  }
  const seen = new Map()
  for (const feature of features) {
    const spec = feature.file.replace(/\.feature$/, '.md')
    if (!files.some(({ name }) => name === spec)) problems.push(`${feature.file}:1: no specification ${spec} beside it`)
    if (!feature.title) problems.push(`${feature.file}:1: the Feature has no title`)
    if (!feature.scenarios.length) problems.push(`${feature.file}:1: no scenarios`)
    for (const scenario of feature.scenarios) {
      const at = `${feature.file}:${scenario.line}`
      const tags = classify(scenario)
      const name = tags.id ?? `"${scenario.title}"`
      if (!scenario.title) problems.push(`${at}: ${name} has no title`)
      if (tags.ids.length !== 1) problems.push(`${at}: ${name} needs exactly one id tag (@PR-n), has ${tags.ids.length}`)
      if (tags.runners.length !== 1) problems.push(`${at}: ${name} needs exactly one runner tag (${Object.keys(RUNNERS).map((r) => `@${r}`).join(' or ')}), has ${tags.runners.length}`)
      if (!tags.rules.length) problems.push(`${at}: ${name} names no rule it checks (@PN-1, @ST-2, …)`)
      for (const rule of tags.rules) if (!rules.has(rule)) problems.push(`${at}: ${name} is tagged @${rule}, and no specification states a rule ${rule}`)
      for (const tag of tags.unknown) problems.push(`${at}: ${name} has an unknown tag @${tag}; the selection tags are ${Object.keys(SELECTION).map((t) => `@${t}`).join(', ')}`)
      for (const tag of new Set(scenario.tags.filter((t, i) => scenario.tags.indexOf(t) !== i))) problems.push(`${at}: ${name} repeats the tag @${tag}`)
      for (const step of scenario.steps.filter((s) => s.kind === 'when' && !/^I\s/.test(s.text))) {
        problems.push(`${feature.file}:${step.line}: ${name}: write an action as "${step.keyword} I …", so the checklist reads it as an instruction`)
      }
      if (!scenario.steps.some((s) => s.kind === 'when')) problems.push(`${at}: ${name} has no When step`)
      if (!scenario.steps.some((s) => s.kind === 'then')) problems.push(`${at}: ${name} has no Then step`)
      if (tags.id) {
        if (seen.has(tags.id)) problems.push(`${at}: ${tags.id} is also the id of a scenario at ${seen.get(tags.id)}`)
        else seen.set(tags.id, at)
      }
    }
  }
  for (const { name, text } of files) {
    text.split('\n').forEach((line, i) => {
      for (const [id] of line.matchAll(/\bPR-\d+\b/g)) {
        if (!seen.has(id)) problems.push(`${name}:${i + 1}: mentions ${id}, and no scenario has that id`)
      }
    })
    const table = indexed(text)
    if (table && text.slice(table.from, table.to).trim() !== index(features)) {
      problems.push(`${name}: the index of scenarios is not current; run: node .github/scripts/scenarios.mjs index --write`)
    }
  }
  return [...new Set(problems)]
}

// The scenarios a selection takes: any of the tags, ids or rules, minus the skipped tags.
export function select(features, { tags = [], ids = [], rules = [], skip = [] } = {}) {
  const bare = (list) => list.map((item) => item.replace(/^@/, ''))
  const [t, i, r, s] = [bare(tags), bare(ids), bare(rules), bare(skip)]
  const all = !t.length && !i.length && !r.length
  return scenarios(features).filter((x) => !s.some((tag) => x.scenario.tags.includes(tag))
    && (all || t.some((tag) => x.scenario.tags.includes(tag)) || i.includes(x.id) || r.some((rule) => x.rules.includes(rule))))
}

// A step as a line of the checklist: `I press Esc` reads `Press Esc`.
function phrase(text) {
  const plain = text.replace(/^I\s+/, '')
  return /^[a-z]/.test(plain) ? plain[0].toUpperCase() + plain.slice(1) : plain
}

function block(doc, indent) {
  return ['', '```sh', ...doc.split('\n'), '```', ''].map((line) => (line ? indent + line : line))
}

function setup(steps, indent = '') {
  return steps.flatMap((step) => [`${indent}- ${phrase(step.text)}`, ...(step.doc === undefined ? [] : block(step.doc, `${indent}  `))])
}

// The checklist of the selected scenarios, as Markdown. Given steps are the setup, each When is
// a numbered action, and each Then after it a box to tick when it held.
export function checklist(features, selection = {}, title = 'Sushi acceptance checklist') {
  const picked = select(features, selection)
  const total = scenarios(features).length
  const said = [
    ...(selection.tags ?? []).map((t) => `--tag ${t}`), ...(selection.ids ?? []).map((t) => `--id ${t}`),
    ...(selection.rules ?? []).map((t) => `--rule ${t}`), ...(selection.skip ?? []).map((t) => `--skip ${t}`),
  ].join(' ')
  const out = [
    `# ${title}`, '',
    `${picked.length} of ${total} scenarios${said ? `, selected with \`${said}\`` : ''}. They come from the \`.feature\` files in \`${DIR}\`; change a scenario there, never here.`, '',
    '- Build under test (`sushi version`, the `git hash` line):',
    '- Date, macOS version and who runs it:', '',
    'Tick a box when the expectation held. When it did not, leave the box open and write under it what happened instead. Afterwards the run gets a row in `docs/specs/runs.md`.', '',
  ]
  // The features in the order of their first scenario taken, so a run starts at the lowest id.
  for (const feature of [...new Set(picked.map((x) => x.feature))]) {
    const own = picked.filter((x) => x.feature === feature)
    out.push(`## ${feature.title}`, '', `From \`${DIR}/${feature.file}\`.`, '')
    if (feature.background.length) out.push('Before each scenario:', '', ...setup(feature.background), '')
    for (const { scenario, id, rules, runner, needs, occasions } of own) {
      out.push(`### ${id} · ${scenario.title}`, '')
      out.push([
        `Rules: ${rules.join(', ')}`, `Run by: ${RUNNERS[runner] ?? '?'}`,
        ...(occasions.length ? [`Run: ${occasions.map((o) => OCCASIONS[o]).join('; ')}`] : []),
        ...(needs.length ? [`Needs: ${needs.map((n) => NEEDS[n]).join('; ')}`] : []),
      ].join(' · '), '')
      const given = scenario.steps.filter((s) => s.kind === 'given')
      if (given.length) out.push('Setup:', '', ...setup(given), '')
      let n = 0
      for (const step of scenario.steps.filter((s) => s.kind !== 'given')) {
        if (step.kind === 'when') {
          out.push(`${++n}. ${phrase(step.text)}`)
          if (step.doc !== undefined) out.push(...block(step.doc, '   '))
        } else {
          const indent = n ? '   ' : ''
          out.push(`${indent}- [ ] ${phrase(step.text)}`)
          if (step.doc !== undefined) out.push(...block(step.doc, `${indent}  `))
        }
      }
      out.push('')
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}

function options(argv) {
  const opts = { tags: [], ids: [], rules: [], skip: [], dir: DIR }
  const lists = { '--tag': 'tags', '--id': 'ids', '--rule': 'rules', '--skip': 'skip' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--write') { opts.write = true; continue }
    const value = argv[++i]
    if (value === undefined || !(arg in lists || arg === '--out' || arg === '--dir')) throw new Error(`unknown or incomplete option ${arg}`)
    if (arg in lists) opts[lists[arg]].push(value)
    else opts[arg.slice(2)] = value
  }
  return opts
}

function main(argv) {
  const [command, ...rest] = argv
  const opts = options(rest)
  switch (command) {
    case 'lint': {
      const problems = lint(opts.dir)
      for (const problem of problems) console.error(problem)
      if (problems.length) process.exit(1)
      const all = scenarios(load(opts.dir))
      console.log(`scenarios: ${all.length} in ${new Set(all.map((s) => s.feature.file)).size} files agree with the specifications`)
      return
    }
    case 'list': {
      for (const s of select(load(opts.dir), opts)) {
        console.log([s.id.padEnd(6), s.feature.file.padEnd(20), s.scenario.title, `  ${s.scenario.tags.filter((t) => !isId(t)).map((t) => `@${t}`).join(' ')}`].join(' '))
      }
      return
    }
    case 'checklist': {
      const text = checklist(load(opts.dir), opts)
      if (opts.out) writeFileSync(opts.out, text)
      else process.stdout.write(text)
      return
    }
    case 'index': {
      const table = index(load(opts.dir))
      if (!opts.write) return void console.log(table)
      for (const { name, text } of specs(opts.dir)) {
        const at = indexed(text)
        if (at) writeFileSync(join(opts.dir, name), `${text.slice(0, at.from)}\n${table}\n${text.slice(at.to)}`)
      }
      return
    }
    default:
      console.error('usage: scenarios.mjs lint|list|checklist|index [--tag <tag>]... [--id <PR-n>]... [--rule <XX-n>]... [--skip <tag>]... [--out <file>] [--dir <folder>]')
      process.exit(2)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(`scenarios: ${e.message}`)
    process.exit(1)
  }
}

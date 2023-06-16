#!/usr/bin/env node
// docs/specs/files.cue and the app agree on the settings files (SUSI-12), for make config-vet.
// Zero dependencies: Node and cue.
//
//   files-schema.mjs [<fixture-dir>]
//
// The fixture comes from the Rust test preferences::tests::files_schema_corpus, in
// src-tauri/target/files-schema by default:
// - choices.json: the values the settings window offers for model.json. They must equal the
//   enums of `cue def docs/specs/files.cue -e '#Model' --out jsonschema`, in order, and cover
//   every enum the schema has.
// - accepted/<Definition>/*.json and rejected/<Definition>/*.json: files written through the
//   app's save paths, and the ones its validators refuse. Every accepted file passes
//   `cue vet -d '#<Definition>'`, every rejected one fails it.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..')
const SCHEMA = 'docs/specs/files.cue'
const fixture = resolve(process.argv[2] ?? join(ROOT, 'src-tauri/target/files-schema'))

const problems = []

if (!existsSync(join(fixture, 'choices.json'))) {
  console.error(`${fixture}/choices.json is missing: run cargo test --manifest-path src-tauri/Cargo.toml --release files_schema_corpus`)
  process.exit(2)
}

// ——— The enums of #Model against the choices the app offers ———

const schema = JSON.parse(execFileSync('cue', ['def', SCHEMA, '-e', '#Model', '--out', 'jsonschema'], { cwd: ROOT, encoding: 'utf8' }))

/** The enum of a JSON Schema node, following a local $ref. */
function values(node) {
  if (node?.$ref) node = schema.$defs?.[node.$ref.replace('#/$defs/', '')]
  return node?.enum
}

const enums = {}
for (const [key, node] of Object.entries(schema.properties ?? {})) {
  const list = values(node)
  if (list) enums[key] = list
  for (const [field, inner] of Object.entries(node.properties ?? {})) {
    const nested = values(inner)
    if (nested) enums[`${key}.${field}`] = nested
  }
}

const choices = JSON.parse(readFileSync(join(fixture, 'choices.json'), 'utf8'))
for (const key of new Set([...Object.keys(enums), ...Object.keys(choices)])) {
  const cue = JSON.stringify(enums[key] ?? null)
  const app = JSON.stringify(choices[key] ?? null)
  if (cue !== app) problems.push(`model.json ${key}: files.cue allows ${cue}, the app offers ${app}`)
}

// ——— The corpus ———

let vetted = 0
for (const kind of ['accepted', 'rejected']) {
  const base = join(fixture, kind)
  if (!existsSync(base)) {
    problems.push(`${base} is missing`)
    continue
  }
  for (const definition of readdirSync(base).sort()) {
    for (const file of readdirSync(join(base, definition)).filter(f => f.endsWith('.json')).sort()) {
      const path = join(base, definition, file)
      const run = spawnSync('cue', ['vet', SCHEMA, path, '-d', `#${definition}`], { cwd: ROOT, encoding: 'utf8' })
      vetted++
      if (kind === 'accepted' && run.status !== 0) {
        problems.push(`${kind}/${definition}/${file} is written by the app, and files.cue rejects it:\n${run.stderr.trim()}`)
      } else if (kind === 'rejected' && run.status === 0) {
        problems.push(`${kind}/${definition}/${file} is refused by the app, and files.cue accepts it`)
      }
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`files.cue agrees with the app: ${Object.keys(enums).length} enums, ${vetted} files vetted`)

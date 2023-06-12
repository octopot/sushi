import assert from 'node:assert/strict'
import test from 'node:test'
import { Chain } from '../src/history.ts'
import { fold, instructionFirst, phrase, rank, score } from '../src/fuzzy.ts'
import { textDiff } from '../src/editor.ts'

/** A →(Shorten) B →(Clarify) C, ending on text C. */
function abc() {
  const chain = new Chain('A')
  assert.equal(chain.apply('B', 'Shorten'), true)
  assert.equal(chain.apply('C', 'Clarify'), true)
  chain.forward()
  return chain
}
const position = chain => (chain.diff ? 'diff' : 'text') + chain.index

test('five positions, one step at a time, and the A/B/B/C/C copy rule', () => {
  const chain = abc()
  const expected = [['text0', 'A'], ['diff1', 'B'], ['text1', 'B'], ['diff2', 'C'], ['text2', 'C']]
  assert.deepEqual([position(chain), chain.text], expected[4])
  for (let i = 3; i >= 0; i--) {
    assert.equal(chain.back(), true)
    assert.deepEqual([position(chain), chain.text], expected[i])
    assert.equal(chain.review, true)
  }
  assert.equal(chain.back(), false)
  assert.equal(chain.canBack, false)
  assert.equal(chain.before, undefined)
  for (let i = 1; i <= 4; i++) {
    assert.equal(chain.forward(), true)
    assert.deepEqual([position(chain), chain.text], expected[i])
  }
  assert.equal(chain.forward(), false)
  chain.back()
  assert.equal(chain.before, 'B')
  assert.equal(chain.current.label, 'Clarify')
})

test('apply shows its diff, drops the tail and ignores identical text', () => {
  const chain = abc()
  chain.back(); chain.back(); chain.back()
  assert.equal(position(chain), 'diff1')
  assert.equal(chain.apply('B', 'Same'), false)
  assert.equal(chain.apply('D', 'Structure'), true)
  assert.deepEqual(chain.versions.map(v => v.text), ['A', 'B', 'D'])
  assert.equal(position(chain), 'diff2')
  assert.equal(chain.before, 'B')
  assert.equal(chain.review, true)
})

test('typing edits in place and keeps every other version', () => {
  const chain = abc()
  chain.back(); chain.back(); chain.back(); chain.back()
  chain.edit('A!')
  assert.deepEqual(chain.versions.map(v => v.text), ['A!', 'B', 'C'])
  assert.equal(chain.review, false)
  chain.forward()
  assert.equal(chain.before, 'A!')
  chain.edit('B!')
  assert.equal(chain.diff, false)
  assert.deepEqual(chain.versions.map(v => v.text), ['A!', 'B!', 'C'])
})

test('opening a library entry replaces a blank prompt or appends without a diff position', () => {
  const blank = new Chain('  ')
  blank.open('Template')
  assert.deepEqual(blank.versions, [{ text: 'Template' }])
  const chain = abc()
  chain.back(); chain.back()
  chain.open('T')
  assert.deepEqual(chain.versions.map(v => v.text), ['A', 'B', 'T'])
  assert.equal(chain.diff, false)
  assert.equal(chain.back(), true)
  assert.equal(position(chain), 'text1', 'an unlabeled version has no diff position')
  chain.reset('New')
  assert.deepEqual(chain.toJSON(), { versions: [{ text: 'New' }], index: 0, diff: false, review: false, copied: false })
})

test('the chain keeps every version; compact keeps the first and the current pair', () => {
  const chain = new Chain('0')
  for (let i = 1; i <= 60; i++) chain.apply(String(i), 'Step ' + i)
  assert.equal(chain.versions.length, 61)
  assert.equal(Chain.restore(JSON.parse(JSON.stringify(chain))).versions.length, 61)
  chain.back(); chain.back()
  assert.equal(position(chain), 'diff59')
  assert.equal(chain.compact(), true)
  assert.deepEqual(chain.versions.map(v => v.text), ['0', '58', '59', '60'])
  assert.deepEqual(chain.versions.map(v => v.label), [undefined, 'Earlier edits', 'Step 59', 'Step 60'],
    'the diff from the first text merges 58 edits, so it is not named after the last of them')
  assert.equal(position(chain), 'diff2')
  assert.equal(chain.text, '59')
  assert.equal(chain.before, '58')
  while (chain.back());
  assert.equal(chain.text, '0', 'the very first text stays reachable')
  assert.equal(chain.compact(), false)

  const opened = new Chain('0')
  opened.apply('1', 'Shorten')
  opened.open('2')
  opened.apply('3', 'Clarify')
  assert.equal(opened.compact(), true)
  assert.deepEqual(opened.versions, [{ text: '0' }, { text: '2' }, { text: '3', label: 'Clarify' }],
    'a version opened from the Library has no diff and stays without a label')
})

test('JSON round trip and rejection of garbage', () => {
  const chain = abc()
  chain.back()
  chain.copied = true
  const restored = Chain.restore(JSON.parse(JSON.stringify(chain)))
  assert.deepEqual(restored.toJSON(), chain.toJSON())
  for (const bad of [null, 1, 'x', {}, { versions: [], index: 0 }, { versions: [{ text: 1 }], index: 0 },
    { versions: [{ text: 'a' }], index: 1 }, { versions: [{ text: 'a', label: 3 }], index: 0 }])
    assert.deepEqual(Chain.restore(bad).toJSON(), new Chain().toJSON())
  assert.equal(Chain.restore({ versions: [{ text: 'a' }, { text: 'b' }], index: 1, diff: true }).diff, false)
})

test('fuzzy ranking', () => {
  const rules = ['Fix grammar', 'Make specific', 'Clarify', 'Shorten', 'Structure'].map(name => ({ name }))
  assert.equal(rank(rules, 'shrtn')[0].name, 'Shorten')
  assert.equal(rank(rules, 'clrf')[0].name, 'Clarify')
  const library = ['Bug report', 'Task brief', 'Dark mode toggle', 'Release review'].map(name => ({ name }))
  assert.deepEqual(rank(library, 're').map(i => i.name), ['Release review', 'Bug report'], 'two letters match substrings only')
  assert.deepEqual(rank(library, 'tb'), [])
  assert.deepEqual(rank([{ name: 'xa yyyyyyyy b c' }], 'abc'), [], 'a scattered match away from a word start is rejected')
  assert.equal(rank([{ name: 'about my big cat' }], 'abc').length, 1, 'a match anchored at a word start counts')
  assert.equal(rank(rules, '').length, 5)
  assert.deepEqual(rank(rules, 'zzz'), [])
  assert.ok(score('clar', 'Clarify') > score('lar', 'Clarify'), 'prefix beats substring')
  assert.ok(score('spec', 'Make specific') > score('ecif', 'Make specific'), 'word prefix beats substring')
  assert.ok(score('ecif', 'Make specific') > score('mksp', 'Make specific'), 'substring beats subsequence')
  assert.equal(score('Clarify', 'clarify'), 1000)
  assert.equal(score('cafe', 'Café'), 1000, 'diacritics are ignored')
  const items = [{ name: 'Alpha', aliases: ['short'] }, { name: 'Short' }]
  assert.equal(rank(items, 'short')[0].name, 'Short', 'aliases count slightly less')
  const detail = [{ name: 'MacWhisper', detail: 'mac whisper' }]
  assert.equal(rank(detail, 'whisp').length, 1)
  assert.equal(rank([{ name: 'x', detail: 'mac whisper' }], 'mwr').length, 0, 'detail matches by substring only')
  const stable = [{ name: 'Task one' }, { name: 'Task two' }]
  assert.deepEqual(rank(stable, 'task').map(i => i.name), ['Task one', 'Task two'])
  assert.equal(fold('  ÉLAN  Vital '), 'elan vital')
  const actions = [{ name: 'Shorten', aliases: ['make shorter', 'сократи'] }, { name: 'Clarify', aliases: ['make clearer'] },
    { name: 'Turn into goal', aliases: ['преврати в цель'] }]
  for (const query of ['Shorten', 'short', 'make', 'clear', 'сократи', 'into goal'])
    assert.equal(instructionFirst(actions, query), false, query + ': a strong match keeps the actions first')
  assert.equal(instructionFirst(actions, 'shrtn'), false, 'a short loose query still lists actions first')
  for (const query of ['перепиши формальнее и добавь критерии приёмки', 'make this more formal please', 'xyz'])
    assert.equal(instructionFirst(actions, query), true, query + ': the instruction comes first')
  assert.equal(phrase('Сделай  короче.'), phrase('сделай короче'))
})

test('textDiff round trip', () => {
  const cases = [['Please review all files.', 'Review all files today.'], ['', 'New'], ['Old', ''], ['a\nb', 'a\nc\nb'], ['same', 'same'],
    ['Please make sure that it follows the system appearance by default and also remembers whatever the user chose last time.',
      'Follow the system appearance by default and remember the user’s last choice.'],
    ["don't stop, we're close", 'do not stop; we are close'], ['keep red and blue', 'keep green or teal']]
  for (const [before, after] of cases) {
    const parts = textDiff(before, after)
    assert.equal(parts.filter(p => p.type !== 'ins').map(p => p.value).join(''), before)
    assert.equal(parts.filter(p => p.type !== 'del').map(p => p.value).join(''), after)
  }
  assert.deepEqual(textDiff('Please review it.', 'Review it.').map(p => p.type), ['del', 'ins', 'same'])
  assert.deepEqual(textDiff("the user's choice", 'the user’s choice'),
    [{ type: 'same', value: 'the ' }, { type: 'del', value: "user's" }, { type: 'ins', value: 'user’s' }, { type: 'same', value: ' choice' }],
    'an apostrophe stays inside its word')
  assert.deepEqual(textDiff('Please make sure that it follows the system.', 'Follow the system.'),
    [{ type: 'del', value: 'Please make sure that it follows' }, { type: 'ins', value: 'Follow' }, { type: 'same', value: ' the system.' }],
    'a rewritten phrase reads as one deletion and one insertion')
  assert.deepEqual(textDiff('keep red and blue', 'keep green or teal').map(p => p.type), ['same', 'del', 'ins'],
    'a short unchanged word between changes is folded in')
})

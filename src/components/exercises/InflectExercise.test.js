import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount, flushPromises } from '@vue/test-utils'
import InflectExercise from './InflectExercise.vue'
import DragTable from '../inflection/DragTable.vue'
import { isTableClean, markTableClean, resetProgress } from '../../stores/progress.js'
import { keyboard, resetHint } from '../../stores/keyboard.js'
import { state as vocabState } from '../../stores/vocab.js'
import { buildParadigm, buildShortParadigm } from '../../lib/paradigm.js'
import { loadFixtureWords } from '../../test/fixtures.js'

vi.mock('../../lib/speech.js', () => ({ speak: vi.fn(), speechSupported: () => false }))

// Any real word with a paradigm will do for the keyboard variant.
let word

beforeAll(() => {
  vocabState.words = loadFixtureWords()
  word = vocabState.words.find((w) => {
    try {
      return buildParadigm(w) != null
    } catch {
      return false
    }
  })
})

afterEach(() => resetHint())

function keyboardExercise() {
  return { id: 'ex1', kind: 'inflect', mode: 'keyboard', wordKey: word.key, lemma: word.ru }
}

async function fillTable(wrapper, correct = true) {
  for (const input of wrapper.findAll('input.ending-input')) {
    await input.setValue(correct ? (input.attributes('data-answer') ?? '') : 'ыыы')
  }
}

describe('InflectExercise', () => {
  it('auto-passes (does not soft-lock) when no paradigm is available', async () => {
    const saved = vocabState.words
    vocabState.words = [] // the word key resolves to nothing → no paradigm
    const wrapper = mount(InflectExercise, {
      props: { exercise: { id: 'ex0', kind: 'inflect', mode: 'bank', wordKey: 'missing', lemma: 'нет' } },
    })
    expect(wrapper.text()).toContain('No inflection table')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: true,
      correctedOnRetry: false,
      double: false,
    })
    vocabState.words = saved
  })

  it('withholds the keyboard hint for the first unaided try in keyboard mode', () => {
    const wrapper = mount(InflectExercise, { props: { exercise: keyboardExercise() } })
    expect(keyboard.allowed).toBe(false)
    wrapper.unmount()
    // Restored on leave so the next exercise's keyboard isn't left locked.
    expect(keyboard.allowed).toBe(true)
  })

  it('counts a table typed correctly without the hint double, with a 🔥 burst', async () => {
    const wrapper = mount(InflectExercise, { props: { exercise: keyboardExercise() } })
    await fillTable(wrapper, true)
    await wrapper.find('.row button.primary').trigger('click') // Check
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(true)
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: true,
      correctedOnRetry: false,
      double: true,
    })
  })

  it('unlocks the hint after a wrong first check and grades the retry', async () => {
    const wrapper = mount(InflectExercise, { props: { exercise: keyboardExercise() } })
    await fillTable(wrapper, false)
    await wrapper.find('.row button.primary').trigger('click') // first check → retry
    expect(wrapper.text()).toContain('Not quite')
    expect(keyboard.allowed).toBe(true)
    expect(wrapper.find('button.next').exists()).toBe(false) // not yet graded

    keyboard.on = true // the learner reaches for the hint on the aided retry
    await wrapper.vm.$nextTick()
    await fillTable(wrapper, true)
    await wrapper.find('.row button.primary').trigger('click') // second check grades
    await wrapper.find('button.next').trigger('click')
    // Correct on the retry: the first check missed, so this is a corrected retry,
    // never a first-try (let alone double) success.
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      correctedOnRetry: true,
      double: false,
    })
  })

  it('records the first miss (no double, no 🔥) when a retry corrects the table unaided (#447)', async () => {
    const wrapper = mount(InflectExercise, { props: { exercise: keyboardExercise() } })
    await fillTable(wrapper, false)
    await wrapper.find('.row button.primary').trigger('click') // first check → retry
    expect(wrapper.text()).toContain('Not quite')

    // Correct it on the retry without ever reaching for the keyboard hint.
    await fillTable(wrapper, true)
    await wrapper.find('.row button.primary').trigger('click') // second check grades
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(false)

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      correctedOnRetry: true,
      double: false,
    })
  })

  it('does not count a hint-assisted first-try success double', async () => {
    const wrapper = mount(InflectExercise, { props: { exercise: keyboardExercise() } })
    // The hint is withheld, but flipping it on (e.g. unlocked mid-exercise by a
    // retry elsewhere) must still cancel the double credit.
    keyboard.allowed = true
    keyboard.on = true
    await wrapper.vm.$nextTick()
    await fillTable(wrapper, true)
    await wrapper.find('.row button.primary').trigger('click')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: true,
      correctedOnRetry: false,
      double: false,
    })
  })
})

// ── The facts panel (#586) ────────────────────────────────────────────────
describe('InflectExercise word facts', () => {
  it('shows the word once the table is graded, never while it is being filled', async () => {
    const wrapper = mount(InflectExercise, { props: { exercise: keyboardExercise() } })
    expect(wrapper.findComponent({ name: 'WordFacts' }).exists()).toBe(false)

    await fillTable(wrapper, true)
    await wrapper.find('.row button.primary').trigger('click') // Check

    const facts = wrapper.findComponent({ name: 'WordFacts' })
    expect(facts.exists()).toBe(true)
    expect(facts.props('wordKey')).toBe(word.key)
  })
})

// ── Variant tables (#575) ─────────────────────────────────────────────────
describe('InflectExercise variant paradigms', () => {
  it('drills the named variant, not the word’s primary table', () => {
    const adj = vocabState.words.find((w) => buildParadigm(w) && buildShortParadigm(w))
    expect(adj, 'fixture has no adjective with both tables').toBeTruthy()
    const short = buildShortParadigm(adj)

    const exercise = { id: 'ex-v', kind: 'inflect', mode: 'bank', wordKey: adj.key, lemma: adj.ru }
    const primary = mount(InflectExercise, { props: { exercise } })
    const variant = mount(InflectExercise, { props: { exercise: { ...exercise, variant: 'short' } } })

    // The variant is labelled, so a learner asked for закры́т knows the short
    // form is wanted rather than the declension.
    expect(variant.text()).toContain(short.variantLabel)
    expect(primary.text()).not.toContain(short.variantLabel)
    // …and it really is the short table being rendered.
    for (const cell of short.cells) expect(variant.text()).toContain(cell.form)
  })

  it('renders a short-only word, whose primary table does not exist', () => {
    const only = vocabState.words.find((w) => !buildParadigm(w) && buildShortParadigm(w))
    expect(only, 'fixture has no short-only adjective').toBeTruthy()
    const exercise = { id: 'ex-o', kind: 'inflect', mode: 'bank', wordKey: only.key, lemma: only.ru }

    const wrapper = mount(InflectExercise, { props: { exercise: { ...exercise, variant: 'short' } } })
    expect(wrapper.text()).not.toContain('No inflection table')
    for (const cell of buildShortParadigm(only).cells) expect(wrapper.text()).toContain(cell.form)
    // Naming no variant asks for a table this word hasn't got — the builder never
    // does so, and the auto-pass fallback keeps it from soft-locking if it did.
    expect(mount(InflectExercise, { props: { exercise } }).text()).toContain('No inflection table')
  })
})

describe('InflectExercise — staged first pass (#645)', () => {
  // A fresh IndexedDB per test, so one test's clean table can't unstage another.
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory()
    await resetProgress()
  })

  const bankExercise = () => ({
    id: 'ex-bank',
    kind: 'inflect',
    mode: 'bank',
    wordKey: word.key,
    variant: null,
    lemma: word.ru,
  })

  it('asks for the staged pass until the learner has built the table cleanly', async () => {
    // Whether a table is small enough to skip the split is the table drill's
    // call (lib/tableStage.js); this is the flag that offers it.
    const wrapper = mount(InflectExercise, { props: { exercise: bankExercise() } })
    expect(wrapper.findComponent(DragTable).props('staged')).toBe(true)
  })

  it('remembers a table built with nothing in the wrong cell, and serves it whole after', async () => {
    const wrapper = mount(InflectExercise, { props: { exercise: bankExercise() } })
    const records = buildParadigm(word).cells.map((c) => ({
      slot: `${c.row}.${c.col}`,
      correct: true,
      // A stress warning is not a correction — it does not hold the table back.
      stressCorrect: false,
    }))
    wrapper.findComponent(DragTable).vm.$emit('graded', true, records)
    await flushPromises()

    expect(isTableClean(word.key)).toBe(true)
    const next = mount(InflectExercise, { props: { exercise: bankExercise() } })
    expect(next.findComponent(DragTable).props('staged')).toBe(false)
  })

  it('keeps staging a table that needed a correction', async () => {
    const wrapper = mount(InflectExercise, { props: { exercise: bankExercise() } })
    wrapper.findComponent(DragTable).vm.$emit('graded', false, [
      { slot: 'nom.sg', correct: false, stressCorrect: null },
    ])
    await flushPromises()

    expect(isTableClean(word.key)).toBe(false)
    const next = mount(InflectExercise, { props: { exercise: bankExercise() } })
    expect(next.findComponent(DragTable).props('staged')).toBe(true)
  })

  it('leaves the typed table alone — staging is the word bank\u2019s business', async () => {
    await markTableClean(word.key)
    const wrapper = mount(InflectExercise, { props: { exercise: keyboardExercise() } })
    expect(wrapper.findComponent(DragTable).exists()).toBe(false)
  })
})

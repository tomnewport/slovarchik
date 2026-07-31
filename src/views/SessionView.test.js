import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount, flushPromises } from '@vue/test-utils'

import * as idb from '../lib/idb.js'
import { state as vocabState } from '../stores/vocab.js'
import * as progress from '../stores/progress.js'
import { loadFixtureWords } from '../test/fixtures.js'

// A fixed two-exercise session so the runner flow is deterministic; both are
// keyboard-typing exercises so we can drive them through the real DOM. The list
// is mutable (via vi.hoisted) so a test can swap in a phrase exercise.
const { mockExercises, defaultExercises } = vi.hoisted(() => {
  const defaultExercises = [
    { id: 'ex0', kind: 'type', dimension: 'usage', level: 'learning', content: 'word', practiceIndex: 0, audio: false, targets: ['t1'], ru: 'дом', en: 'house' },
    { id: 'ex1', kind: 'type', dimension: 'usage', level: 'learning', content: 'word', practiceIndex: 1, audio: false, targets: ['t2'], ru: 'кот', en: 'cat' },
  ]
  return { mockExercises: { value: defaultExercises }, defaultExercises }
})
vi.mock('../lib/exerciseBuild.js', () => ({
  buildExercises: () => mockExercises.value,
}))

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { type: 'words' } }),
  useRouter: () => ({ push }),
}))

// Import after the mocks are registered.
const { default: SessionView } = await import('./SessionView.vue')

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  vocabState.words = loadFixtureWords()
  vocabState.status = 'ready'
  await progress.resetProgress()
  await progress.loadProgress()
  push.mockClear()
  mockExercises.value = defaultExercises
})

async function answer(wrapper, text) {
  await wrapper.find('input[lang="ru"]').setValue(text)
  await wrapper.find('button.check').trigger('click')
  // If the first wrong attempt shows a retry hint instead of revealing the
  // answer, submit once more so we reach the state where 'next' is visible.
  if (!wrapper.find('button.next').exists()) {
    await wrapper.find('input[lang="ru"]').setValue(text)
    await wrapper.find('button.check').trigger('click')
  }
  await wrapper.find('button.next').trigger('click')
  await flushPromises()
  await flushPromises() // second flush: fake-indexeddb uses setImmediate for oncomplete
}

// A record satisfying every learning criterion (→ mastered for an uninflected
// word), so a batch of such words counts as complete.
function masteredRecord(word) {
  const events = []
  for (const d of ['identification', 'usage', 'hearing']) {
    for (let i = 0; i < 3; i++) events.push({ dimension: d, level: 'learning', correct: true, ts: 1 })
  }
  for (let i = 0; i < 3; i++) events.push({ dimension: 'speaking', level: 'learning', correct: true, ts: 1 })
  return { word, events, learnedAt: 1, masteredAt: 1, peak: 3 }
}

describe('SessionView', () => {
  it('runs a session to completion, reports results and shows a summary', async () => {
    const wrapper = mount(SessionView)
    await flushPromises()

    // Linear progress meter: a single fill bar, starting empty.
    const fill = wrapper.find('.bar-fill')
    expect(fill.exists()).toBe(true)
    expect(fill.attributes('style')).toContain('width: 0%')

    await answer(wrapper, 'дом') // ex0 correct
    await answer(wrapper, 'кот') // ex1 correct

    expect(wrapper.text()).toContain('Session complete')
    expect(wrapper.text()).toContain('100%')
    // Each exercise reported its result to the store per dimension.
    expect(progress.stateOf('t1')).not.toBe('unknown')
    expect(progress.stateOf('t2')).not.toBe('unknown')
  })

  it('repeats wrong answers until they are cleared', async () => {
    const wrapper = mount(SessionView)
    await flushPromises()

    await answer(wrapper, 'дом') // ex0 correct
    await answer(wrapper, 'wrong') // ex1 wrong → re-queued

    // Still running: the repeat round re-presents the wrong exercise.
    expect(wrapper.text()).not.toContain('Session complete')
    expect(wrapper.text()).toContain('Fixing mistakes')

    await answer(wrapper, 'кот') // ex1 correct on repeat
    expect(wrapper.text()).toContain('Session complete')
    // First-attempt score: 1 of 2 correct.
    expect(wrapper.text()).toContain('50%')
  })

  it('celebrates a completed batch, advances it, and routes to the next', async () => {
    // The session's two target words make up the committed learning batch and
    // are already at mastery, so finishing the session completes the batch.
    progress.state.records = { t1: masteredRecord('t1'), t2: masteredRecord('t2') }
    await progress.commitBatch({
      name: 'animals',
      collection: 'animals',
      level: 'learning',
      color: 'green',
      words: ['t1', 't2'],
      size: 2,
    })

    const wrapper = mount(SessionView)
    await flushPromises()
    await answer(wrapper, 'дом')
    await answer(wrapper, 'кот')

    expect(wrapper.text()).toContain('Batch complete')
    expect(wrapper.text()).toContain('animals')
    // The completed batch is advanced (cleared) on entry to the summary.
    expect(progress.state.learning).toBe(null)

    await wrapper.find('.next-batch').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/batch', query: { level: 'learning' } })
  })

  it('shows an animated batch-progress gain when a batch climbs enough', async () => {
    // A fresh learning batch of the two session words: answering both nudges the
    // exercise bar up well past the 5% threshold without completing the batch.
    await progress.commitBatch({
      name: 'animals',
      collection: 'animals',
      level: 'learning',
      color: 'green',
      words: ['t1', 't2'],
      size: 2,
    })

    const wrapper = mount(SessionView)
    await flushPromises()
    await answer(wrapper, 'дом')
    await answer(wrapper, 'кот')

    expect(wrapper.text()).toContain('Session complete')
    // The batch did not complete, so it shows the climbing gain bar, not the
    // batch-complete celebration.
    expect(wrapper.text()).not.toContain('Batch complete')
    const gains = wrapper.find('.batch-gains')
    expect(gains.exists()).toBe(true)
    expect(gains.find('.gain-fill').exists()).toBe(true)
    expect(gains.text()).toContain('animals')
  })

  it('shows no gain bar when a batch barely moves', async () => {
    // A 20-word batch: two answered words is under the 5% threshold.
    await progress.commitBatch({
      name: 'animals',
      collection: 'animals',
      level: 'learning',
      color: 'green',
      words: Array.from({ length: 20 }, (_, i) => (i < 2 ? `t${i + 1}` : `pad${i}`)),
      size: 20,
    })

    const wrapper = mount(SessionView)
    await flushPromises()
    await answer(wrapper, 'дом')
    await answer(wrapper, 'кот')

    expect(wrapper.text()).toContain('Session complete')
    expect(wrapper.find('.batch-gains').exists()).toBe(false)
  })

  it('spares the assessed word a penalty when a phrase slips only elsewhere', async () => {
    // One phrase exercise: the word being assessed is школа (form школу); a slip
    // elsewhere in the phrase must not record (and slip) the word.
    mockExercises.value = [
      {
        id: 'ex0',
        kind: 'type',
        dimension: 'usage',
        level: 'learning',
        content: 'phrase',
        practiceIndex: 0,
        audio: false,
        targets: ['t1'],
        ru: 'я иду в школу',
        en: 'I am going to school',
        targetTokens: ['школу'],
      },
    ]

    const wrapper = mount(SessionView)
    await flushPromises()

    // Spell the assessed word right but slip elsewhere ("ыду"): the exercise is
    // wrong (re-queued — "Fixing mistakes"), but no attempt is recorded for t1.
    await wrapper.find('input[lang="ru"]').setValue('я ыду в школу')
    await wrapper.find('button.check').trigger('click')
    await wrapper.find('input[lang="ru"]').setValue('я ыду в школу')
    await wrapper.find('button.check').trigger('click')
    await wrapper.find('button.next').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('Fixing mistakes')
    // The word was not penalised — it has no recorded attempts and stays unknown.
    expect(progress.stateOf('t1')).toBe('unknown')
    expect(progress.state.records.t1).toBeUndefined()
  })

  it('penalises the assessed word when the slip is in the word itself', async () => {
    mockExercises.value = [
      {
        id: 'ex0',
        kind: 'type',
        dimension: 'usage',
        level: 'learning',
        content: 'phrase',
        practiceIndex: 0,
        audio: false,
        targets: ['t1'],
        ru: 'я иду в школу',
        en: 'I am going to school',
        targetTokens: ['школу'],
      },
    ]

    const wrapper = mount(SessionView)
    await flushPromises()

    // Mis-spell the assessed word ("школе"): the word is penalised as normal.
    await wrapper.find('input[lang="ru"]').setValue('я иду в школе')
    await wrapper.find('button.check').trigger('click')
    await wrapper.find('input[lang="ru"]').setValue('я иду в школе')
    await wrapper.find('button.check').trigger('click')
    await wrapper.find('button.next').trigger('click')
    await flushPromises()
    await flushPromises()

    const rec = progress.state.records.t1
    expect(rec).toBeDefined()
    expect(rec.events.some((e) => e.dimension === 'usage' && e.correct === false)).toBe(true)
  })

  it('asks for confirmation before closing', async () => {
    const wrapper = mount(SessionView)
    await flushPromises()

    await wrapper.find('button.close').trigger('click')
    expect(wrapper.find('.modal').exists()).toBe(true)
    expect(push).not.toHaveBeenCalled()

    await wrapper.findAll('.modal button').at(1).trigger('click') // "End session"
    expect(push).toHaveBeenCalledWith('/')
  })

  it('marks the current single-target word known and hides the button afterwards', async () => {
    const wrapper = mount(SessionView)
    await flushPromises()

    const knowBtn = wrapper.findAll('button.know').find((b) => b.text() === 'I know this word')
    expect(knowBtn).toBeTruthy()
    expect(progress.isKnown('t1')).toBe(false)

    await knowBtn.trigger('click')
    await flushPromises()

    expect(progress.isKnown('t1')).toBe(true)
    // Button clears once the word is flagged.
    expect(wrapper.findAll('button.know').some((b) => b.text() === 'I know this word')).toBe(false)
  })
})

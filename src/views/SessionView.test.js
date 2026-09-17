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
const { mockExercises, defaultExercises, buildSources } = vi.hoisted(() => {
  const defaultExercises = [
    { id: 'ex0', kind: 'type', dimension: 'usage', level: 'learning', content: 'word', practiceIndex: 0, audio: false, targets: ['t1'], ru: 'дом', en: 'house' },
    { id: 'ex1', kind: 'type', dimension: 'usage', level: 'learning', content: 'word', practiceIndex: 1, audio: false, targets: ['t2'], ru: 'кот', en: 'cat' },
  ]
  return { mockExercises: { value: defaultExercises }, defaultExercises, buildSources: { value: null } }
})
// Keep the real helpers (buildCombinedFlashcard, makeVisualReplacement, …) so
// the flashcard-repeat flow works; only the session builder is stubbed.
vi.mock('../lib/exerciseBuild.js', async (importActual) => {
  const actual = await importActual()
  return {
    ...actual,
    // Keep the sources the view hands the builder: what it passes (or forgets to
    // pass) decides which drills a session can serve.
    buildExercises: (session, sources) => {
      buildSources.value = sources
      return mockExercises.value
    },
  }
})

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
  buildSources.value = null
})

// Several of these actions are IndexedDB writes deep, and fake-indexeddb
// completes them on setImmediate — one or two flushes is not always enough.
async function settle() {
  for (let i = 0; i < 8; i++) await flushPromises()
}

// A never-met word is now introduced before its first exercise (#587). These
// tests are about the grading flow, so step past any card in the way.
async function passIntro(wrapper) {
  while (wrapper.find('button.got-it').exists()) {
    await wrapper.find('button.got-it').trigger('click')
    await settle()
  }
}

async function answer(wrapper, text) {
  await passIntro(wrapper)
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
  it('tells the builder which tables the learner has already assembled', async () => {
    // Typing a table's endings is only offered for a table already built from
    // the word bank (#645). That state is persisted per word, so the view has to
    // hand it to the builder — without it every typing slot degrades to the bank
    // drill forever and mastery usage for an inflecting word never advances.
    await progress.markTableClean('t1', null)

    mount(SessionView)
    await flushPromises()

    const { isTableClean } = buildSources.value
    expect(typeof isTableClean).toBe('function')
    expect(isTableClean('t1', null)).toBe(true)
    expect(isTableClean('t2', null)).toBe(false)
  })

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

  it('records one correct, hinted attempt for a word corrected on its built-in retry (#745)', async () => {
    const wrapper = mount(SessionView)
    await flushPromises()

    // ex0: wrong first, then corrected on the retry without the hint.
    await wrapper.find('input[lang="ru"]').setValue('wrong')
    await wrapper.find('button.check').trigger('click') // first wrong → retry
    await wrapper.find('input[lang="ru"]').setValue('дом')
    await wrapper.find('button.check').trigger('click') // corrected on retry
    await wrapper.find('button.next').trigger('click')
    await flushPromises()
    await flushPromises()

    // The corrected retry is not re-queued: the session moves straight on to ex1
    // rather than repeating ex0.
    expect(wrapper.text()).not.toContain('Fixing mistakes')
    // Exactly one attempt is recorded — never two first-try successes — and it
    // is correct: the do-over fixed it. It counts once and as a hinted answer,
    // so the schedule grows by the smaller factor and no 🔥 is earned.
    const rec = progress.state.records.t1
    expect(rec).toBeDefined()
    const usage = rec.events.filter((e) => e.dimension === 'usage')
    expect(usage).toEqual([expect.objectContaining({ correct: true, flawless: false })])
  })

  it('replays missed flashcard words as one combined board at the end (#472)', async () => {
    // A single flashcard board of three real vocab words (so the combined repeat
    // board can resolve them from the shaped vocab).
    const keys = vocabState.words.slice(0, 3).map((w) => w.key)
    mockExercises.value = [
      {
        id: 'm0',
        kind: 'match',
        dimension: 'identification',
        level: 'learning',
        content: 'word',
        practiceIndex: 0,
        audio: false,
        pairs: keys.map((k, i) => ({ key: k, ru: `слово${i}`, en: ['alpha', 'bravo', 'charlie'][i], label: ['alpha', 'bravo', 'charlie'][i] })),
        targets: keys,
        options: keys.map((k, i) => ({ key: k, en: ['alpha', 'bravo', 'charlie'][i], label: ['alpha', 'bravo', 'charlie'][i] })),
      },
    ]

    const wrapper = mount(SessionView)
    await flushPromises()

    // Card 0 wrong, cards 1 & 2 correct.
    await wrapper.find('.combo-input').setValue('zzz')
    await wrapper.find('form').trigger('submit') // reveal
    await wrapper.find('.next').trigger('click')
    await wrapper.find('.combo-input').setValue('bravo')
    await wrapper.find('.combo-input').setValue('charlie')
    // The board's `done` handler records three attempts to IndexedDB before the
    // combined repeat board is injected — flush until that settles.
    for (let i = 0; i < 8; i++) await flushPromises()

    // Not finished: the one missed word drives a combined repeat board.
    expect(wrapper.text()).not.toContain('Session complete')
    expect(wrapper.text()).toContain('Fixing mistakes')
    expect(wrapper.find('.combo-input').exists()).toBe(true)
    // A reading board's repeat stays a reading board (the Russian is shown).
    expect(wrapper.find('.ru').exists()).toBe(true)
    expect(wrapper.find('.big-speak').exists()).toBe(false)
  })

  it('replays missed listening words as a listening board (#472)', async () => {
    // A heard-word (audio) flashcard board: its misses must come back as audio.
    const keys = vocabState.words.slice(0, 2).map((w) => w.key)
    mockExercises.value = [
      {
        id: 'm0',
        kind: 'match',
        dimension: 'hearing',
        level: 'learning',
        content: 'word',
        practiceIndex: 0,
        audio: true,
        pairs: keys.map((k, i) => ({ key: k, ru: `слово${i}`, en: ['alpha', 'bravo'][i], label: ['alpha', 'bravo'][i] })),
        targets: keys,
        options: keys.map((k, i) => ({ key: k, en: ['alpha', 'bravo'][i], label: ['alpha', 'bravo'][i] })),
      },
    ]

    const wrapper = mount(SessionView)
    await flushPromises()

    // Card 0 wrong, card 1 correct.
    await wrapper.find('.combo-input').setValue('zzz')
    await wrapper.find('form').trigger('submit') // reveal
    await wrapper.find('.next').trigger('click')
    await wrapper.find('.combo-input').setValue('bravo')
    for (let i = 0; i < 8; i++) await flushPromises()

    expect(wrapper.text()).toContain('Fixing mistakes')
    // The repeat board is audio: the Russian is hidden and a speaker is shown.
    expect(wrapper.find('.big-speak').exists()).toBe(true)
    expect(wrapper.find('.ru').exists()).toBe(false)
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

  // ── The quick progression route (#725) ──────────────────────────────────
  // The mid-exercise "I know this word" button is gone; what replaces it is a
  // question the session only asks once the learner has answered the word's
  // exercises flawlessly.

  /**
   * Give `word` a flawless answer in every dimension but `usage` — a previous
   * session's work, which this one's usage exercise completes (#725). The
   * evidence is meant to accumulate across sessions, which is why it is stored
   * on the attempt rather than counted inside the session.
   */
  async function primeAllButUsage(word) {
    for (const dimension of ['identification', 'hearing', 'speaking']) {
      await progress.recordAttempt({
        word,
        dimension,
        level: 'learning',
        correct: true,
        flawless: true,
      })
    }
  }

  it('no longer offers a mid-exercise "I know this word" button', async () => {
    const wrapper = mount(SessionView)
    await flushPromises()
    expect(wrapper.text()).not.toContain('I know this word')
  })

  it('asks after a flawless pass, and promotes the word on a yes', async () => {
    await primeAllButUsage('t1')
    const wrapper = mount(SessionView)
    await flushPromises()

    // Nothing to ask about while the word is still being drilled.
    expect(wrapper.find('[data-testid="quick-offer"]').exists()).toBe(false)
    await answer(wrapper, 'дом') // ex0, right first time with no hint

    const offer = wrapper.find('[data-testid="quick-offer"]')
    expect(offer.exists()).toBe(true)
    expect(offer.find('h2').text()).toContain('learned this word already.')
    expect(offer.find('p.muted').text()).toContain('Shall we consider it learned?')
    expect(offer.text()).toContain('no separate mastery drills')
    expect(progress.isKnown('t1')).toBe(false)

    await offer.find('button.quick-yes').trigger('click')
    await settle()
    expect(progress.isKnown('t1')).toBe(true)
    expect(['learned', 'mastered']).toContain(progress.stateOf('t1'))
    // The lesson carries straight on with the next exercise.
    expect(wrapper.find('[data-testid="quick-offer"]').exists()).toBe(false)
  })

  it('says mastered only when the word has separate mastery drills', async () => {
    const word = vocabState.words.find((w) => progress.hasInflections(w.key))
    const key = word.key
    for (const dimension of ['identification', 'usage', 'hearing', 'speaking']) {
      for (let i = 0; i < 3; i++) {
        await progress.recordAttempt({
          word: key, dimension, level: 'learning', correct: true, flawless: true,
        })
      }
    }
    const masteryDimensions = progress.hasContextDrill(key)
      ? ['identification', 'context']
      : ['identification']
    for (const dimension of masteryDimensions) {
      await progress.recordAttempt({
        word: key, dimension, level: 'mastery', correct: true, flawless: true,
      })
    }
    mockExercises.value = [{ ...defaultExercises[0], targets: [key], level: 'mastery' }]
    const wrapper = mount(SessionView)
    await flushPromises()
    await answer(wrapper, 'дом')

    const offer = wrapper.find('[data-testid="quick-offer"]')
    expect(offer.exists()).toBe(true)
    expect(offer.find('h2').text()).toContain('mastered this word already.')
    expect(offer.find('p.muted').text()).toContain('Shall we consider it mastered?')
    expect(offer.text()).not.toContain('no separate mastery drills')
  })

  it('keeps teaching on a no, and asks only once', async () => {
    await primeAllButUsage('t1')
    const wrapper = mount(SessionView)
    await flushPromises()

    await answer(wrapper, 'дом')
    await wrapper.find('[data-testid="quick-offer"] button.quick-no').trigger('click')
    await settle()

    expect(progress.isKnown('t1')).toBe(false)
    expect(wrapper.find('[data-testid="quick-offer"]').exists()).toBe(false)
  })

  it('never asks about a word whose earlier work was not flawless', async () => {
    // Everything else answered, but with help somewhere along the way.
    for (const dimension of ['identification', 'hearing', 'speaking']) {
      await progress.recordAttempt({
        word: 't1',
        dimension,
        level: 'learning',
        correct: true,
        flawless: false,
      })
    }
    const wrapper = mount(SessionView)
    await flushPromises()
    await answer(wrapper, 'дом')
    expect(wrapper.find('[data-testid="quick-offer"]').exists()).toBe(false)
  })

  // The one thing the stored flag cannot see: the repeat round records a fresh,
  // flawless-looking attempt for a word that was missed ten minutes earlier.
  it('does not ask about a word this session had to repeat', async () => {
    await primeAllButUsage('t1')
    const wrapper = mount(SessionView)
    await flushPromises()

    await answer(wrapper, 'ххх') // ex0 missed — a slip, not a real word
    await answer(wrapper, 'кот') // ex1 fine
    await answer(wrapper, 'дом') // ex0 again, in the repeat round — now perfect
    expect(wrapper.find('[data-testid="quick-offer"]').exists()).toBe(false)
  })

  it('never asks about a word that needed the keyboard hint', async () => {
    await primeAllButUsage('t1')
    const wrapper = mount(SessionView)
    await flushPromises()
    await passIntro(wrapper)

    // Reach for the hint before answering: the answer is right, but not unaided.
    await wrapper.find('button.hint-pass').trigger('click')
    await answer(wrapper, 'дом')

    expect(wrapper.find('[data-testid="quick-offer"]').exists()).toBe(false)
  })
})

// ── The intro card's two buttons, end to end (#587) ─────────────────────────
describe('SessionView intro cards', () => {

  const intro = (id, key, pi) => ({
    id,
    kind: 'intro',
    graded: false,
    dimension: 'usage',
    level: 'learning',
    practiceIndex: pi,
    targets: [key],
  })
  const type = (id, key, ru, en, pi) => ({
    id,
    kind: 'type',
    dimension: 'usage',
    level: 'learning',
    content: 'word',
    practiceIndex: pi,
    audio: false,
    targets: [key],
    ru,
    en,
  })

  it('"Got it" moves on to the exercise, which still tests the word', async () => {
    mockExercises.value = [
      intro('i0', 'дом=house', 0),
      type('ex0', 'дом=house', 'дом', 'house', 0),
    ]
    const wrapper = mount(SessionView)
    await flushPromises()

    expect(wrapper.find('button.got-it').exists()).toBe(true)
    await wrapper.find('button.got-it').trigger('click')
    await flushPromises()
    await flushPromises()

    // The exercise it introduced is still there to be answered.
    expect(wrapper.find('input[lang="ru"]').exists()).toBe(true)
    expect(progress.wasIntroduced('дом=house')).toBe(true)
  })

  it('"I know this already" marks it known and skips its drilling', async () => {
    mockExercises.value = [
      intro('i0', 'дом=house', 0),
      type('ex0', 'дом=house', 'дом', 'house', 0),
      type('ex1', 'кот=cat', 'кот', 'cat', 1),
    ]
    const wrapper = mount(SessionView)
    await flushPromises()

    await wrapper.find('button.known').trigger('click')
    await settle()

    // Known, introduced — and its exercise is gone, not merely skipped past.
    // `known` relaxes the criteria; it does not award attempts, so the word's
    // state is still 'unknown' until it is answered once. The flag is the point.
    expect(progress.state.records['дом=house'].known).toBe(true)
    expect(wrapper.vm.runner.queue.map((e) => e.id)).not.toContain('ex0')
    // The next word's exercise is untouched.
    expect(wrapper.find('input[lang="ru"]').attributes('data-answer')).toBe('кот')
  })

  it('leaves the other words on a board when one of them is already known', async () => {
    mockExercises.value = [
      intro('i0', 'дом=house', 0),
      {
        id: 'ex0',
        kind: 'match',
        dimension: 'identification',
        level: 'learning',
        practiceIndex: 0,
        targets: ['дом=house', 'кот=cat', 'год=year'],
        pairs: [
          { key: 'дом=house', ru: 'дом', en: 'house' },
          { key: 'кот=cat', ru: 'кот', en: 'cat' },
          { key: 'год=year', ru: 'год', en: 'year' },
        ],
      },
    ]
    const wrapper = mount(SessionView)
    await flushPromises()

    await wrapper.find('button.known').trigger('click')
    await settle()

    // The board survives, minus the one pair.
    const board = wrapper.vm.runner.queue.find((e) => e.id === 'ex0')
    expect(board).toBeTruthy()
    expect(board.pairs.map((p) => p.key)).toEqual(['кот=cat', 'год=year'])
    expect(board.targets).not.toContain('дом=house')
  })
})

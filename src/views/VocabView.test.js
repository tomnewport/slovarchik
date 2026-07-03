import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VocabView from './VocabView.vue'
import { state } from '../stores/vocab.js'
import { state as progressState } from '../stores/progress.js'
import { shapeVocab } from '../lib/vocabBuild.js'
import { loadFixtureWords } from '../test/fixtures.js'

// Seed the reactive store with real vocab data so the menu is ready.
beforeAll(() => {
  state.words = loadFixtureWords()
  state.status = 'ready'
})

describe('VocabView', () => {
  it('shows the difficulty options on the menu', () => {
    const wrapper = mount(VocabView)
    expect(wrapper.text()).toContain('Easy')
    expect(wrapper.text()).toContain('Type it')
  })

  it('runs an easy-mode round and scores a correct match', async () => {
    const wrapper = mount(VocabView)
    // Start easy mode (first level card).
    await wrapper.findAll('button.card')[0].trigger('click')

    const cols = wrapper.findAll('.match-col')
    expect(cols).toHaveLength(2)
    const left = cols[0].findAll('button.match-item')
    const right = cols[1].findAll('button.match-item')
    expect(left.length).toBeGreaterThan(1)
    expect(right.length).toBe(left.length)

    // Pick the first Russian word, then its English partner in the other column.
    const targetId = wrapper.vm.boardLeft[0].id
    const rightIndex = wrapper.vm.boardRight.findIndex((w) => w.id === targetId)
    await left[0].trigger('click')
    await right[rightIndex].trigger('click')

    expect(wrapper.vm.score).toEqual({ right: 1, total: 1 })
    // The cleared pair is marked matched (faded out) in both columns.
    expect(left[0].classes()).toContain('matched')
    expect(right[rightIndex].classes()).toContain('matched')
  })

  it('counts a mismatched pair as a wrong attempt without clearing it', async () => {
    const wrapper = mount(VocabView)
    await wrapper.findAll('button.card')[0].trigger('click')

    const cols = wrapper.findAll('.match-col')
    const left = cols[0].findAll('button.match-item')
    const right = cols[1].findAll('button.match-item')

    // Pick a left word and a right word that belong to different pairs.
    const leftId = wrapper.vm.boardLeft[0].id
    const wrongIndex = wrapper.vm.boardRight.findIndex((w) => w.id !== leftId)
    await left[0].trigger('click')
    await right[wrongIndex].trigger('click')

    expect(wrapper.vm.score).toEqual({ right: 0, total: 1 })
    expect(left[0].classes()).not.toContain('matched')
    expect(right[wrongIndex].classes()).not.toContain('matched')
  })

  it('celebrates and auto-advances after a correct answer', async () => {
    vi.useFakeTimers()
    const wrapper = mount(VocabView)
    // Start typing mode — celebration applies to the typing drill.
    await wrapper.findAll('button.card')[1].trigger('click')

    // Pin to a word with no post-answer reminder: a correct heteronym or
    // aspect-pair answer intentionally shows a "Next" prompt instead of
    // auto-advancing (each covered by its own test), so leaving the question to
    // the random sample makes this assertion flaky.
    wrapper.vm.current = shapeVocab(loadFixtureWords()).find(
      (w) => !w.heteronyms?.length && !w.aspectPair,
    )
    await wrapper.vm.$nextTick()

    // Type the correct answer and submit.
    const want = wrapper.vm.current
    const answer = Array.isArray(want.en) ? want.en[0] : want.en
    await wrapper.find('input[type="text"]').setValue(answer)
    await wrapper.find('form').trigger('submit')

    // Celebration is showing and no manual "Next" button is offered.
    expect(wrapper.vm.wasCorrect).toBe(true)
    expect(wrapper.vm.celebrating).toBe(true)
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(true)
    expect(wrapper.text()).not.toContain('Next')

    // After the celebration window, it moves on to a fresh question.
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.answered).toBe(false)
    expect(wrapper.vm.celebrating).toBe(false)
  })

  it('shows a heteronym reminder and waits, even on a correct answer', async () => {
    vi.useFakeTimers()
    const wrapper = mount(VocabView)
    // Typing mode so the answer flows through record().
    await wrapper.findAll('button.card')[1].trigger('click')

    // Force the question to a known heteronym (сто́ить "to cost").
    const cost = shapeVocab(loadFixtureWords()).find((w) => w.id === 'стоить=to cost')
    expect(cost.heteronyms.length).toBeGreaterThan(0)
    wrapper.vm.current = cost
    await wrapper.vm.$nextTick()

    const answer = Array.isArray(cost.en) ? cost.en[0] : cost.en
    await wrapper.find('input[type="text"]').setValue(answer)
    await wrapper.find('form').trigger('submit')

    expect(wrapper.vm.wasCorrect).toBe(true)
    // The reminder is shown with the other stress/meaning spelled out …
    expect(wrapper.text()).toContain('Heteronym')
    expect(wrapper.text()).toContain('it stands')
    // … and a correct heteronym answer does NOT auto-advance: it waits.
    vi.advanceTimersByTime(2000)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.answered).toBe(true)
    expect(wrapper.text()).toContain('Next')
  })

  it('shows the aspect partner and waits, even on a correct answer', async () => {
    vi.useFakeTimers()
    const wrapper = mount(VocabView)
    await wrapper.findAll('button.card')[1].trigger('click') // typing mode

    // Force the question to a verb with a linked aspect partner.
    const govorit = shapeVocab(loadFixtureWords()).find((w) => w.id === 'говорить=to speak')
    expect(govorit.aspectPair).toMatchObject({ ru: 'сказа́ть', aspect: 'pf' })
    wrapper.vm.current = govorit
    await wrapper.vm.$nextTick()

    const answer = Array.isArray(govorit.en) ? govorit.en[0] : govorit.en
    await wrapper.find('input[type="text"]').setValue(answer)
    await wrapper.find('form').trigger('submit')

    expect(wrapper.vm.wasCorrect).toBe(true)
    // The partner is spelled out with its aspect and gloss …
    expect(wrapper.text()).toContain('Aspect pair')
    expect(wrapper.text()).toContain('imperfective')
    expect(wrapper.text()).toContain('сказа́ть')
    // … and the correct answer does NOT auto-advance: it waits to be read.
    vi.advanceTimersByTime(2000)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.answered).toBe(true)
    expect(wrapper.text()).toContain('Next')
  })

  it('clears a heteronym pair in easy mode without the typing-mode pause', async () => {
    const wrapper = mount(VocabView)
    await wrapper.findAll('button.card')[0].trigger('click') // easy / match

    // Force the board to a heteronym word; matching goes through resolveMatch(),
    // not record(), so the auto-advance pause must not apply here.
    const cost = shapeVocab(loadFixtureWords()).find((w) => w.id === 'стоить=to cost')
    expect(cost.heteronyms.length).toBeGreaterThan(0)
    wrapper.vm.boardLeft = [cost]
    wrapper.vm.boardRight = [cost]
    await wrapper.vm.$nextTick()

    const left = wrapper.findAll('.match-col')[0].findAll('button.match-item')
    const right = wrapper.findAll('.match-col')[1].findAll('button.match-item')
    await left[0].trigger('click')
    await right[0].trigger('click')

    expect(wrapper.vm.score.right).toBe(1)
    expect(left[0].classes()).toContain('matched')
    // No reminder / Next button in the matching flow.
    expect(wrapper.text()).not.toContain('Heteronym')
  })

  it('marks the typing input with the answer in EN → RU so the keyboard can hint it', async () => {
    const wrapper = mount(VocabView)
    // Switch to EN → RU so the answer is Russian (the on-screen keyboard case).
    await wrapper.find('button:nth-of-type(2)').trigger('click')
    await wrapper.findAll('button.card')[1].trigger('click') // Type it

    const input = wrapper.find('input[type="text"]')
    expect(input.attributes('lang')).toBe('ru')
    expect(input.attributes('data-answer')).toBe(wrapper.vm.current.ru)
  })

  it('leaves the typing input unmarked in RU → EN (English answer, device keyboard)', async () => {
    const wrapper = mount(VocabView)
    // Default direction is RU → EN; start typing mode.
    await wrapper.findAll('button.card')[1].trigger('click')

    const input = wrapper.find('input[type="text"]')
    expect(input.attributes('lang')).toBe('en')
    expect(input.attributes('data-answer')).toBeUndefined()
  })

  it('waits for the user after a wrong answer', async () => {
    const wrapper = mount(VocabView)
    // Start typing mode.
    await wrapper.findAll('button.card')[1].trigger('click')

    // Submit an answer that is definitely wrong.
    await wrapper.find('input[type="text"]').setValue('definitely-not-correct')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.vm.wasCorrect).toBe(false)
    expect(wrapper.vm.celebrating).toBe(false)
    expect(wrapper.text()).toContain('Next')
  })

  it('easy mode can hide Russian spellings and speak words on tap', async () => {
    const wrapper = mount(VocabView)
    // The menu toggle is hidden when speech is unavailable (as in jsdom), so
    // enable the option directly, then start easy mode.
    wrapper.vm.hideSpellings = true
    await wrapper.findAll('button.card')[0].trigger('click')

    const cols = wrapper.findAll('.match-col')
    const left = cols[0].findAll('button.match-item')
    // Russian text is replaced by a speaker icon …
    expect(left[0].text()).toContain('🔊')
    expect(left[0].text()).not.toContain(wrapper.vm.boardLeft[0].ru)

    // … and pairing still scores correctly.
    const right = cols[1].findAll('button.match-item')
    const targetId = wrapper.vm.boardLeft[0].id
    const rightIndex = wrapper.vm.boardRight.findIndex((w) => w.id === targetId)
    await left[0].trigger('click')
    await right[rightIndex].trigger('click')
    expect(wrapper.vm.score.right).toBe(1)
  })
})

describe('weighted vocab selection', () => {
  // Minimum events that push a word into the 'learned' state:
  // 3-of-4 correct for identification/usage/hearing, 3 speaking attempts.
  function makeLearnedEvents() {
    return [
      ...['identification', 'usage', 'hearing'].flatMap((dim) => [
        { level: 'learning', dimension: dim, correct: false, ts: 0 },
        { level: 'learning', dimension: dim, correct: true, ts: 1 },
        { level: 'learning', dimension: dim, correct: true, ts: 2 },
        { level: 'learning', dimension: dim, correct: true, ts: 3 },
      ]),
      { level: 'learning', dimension: 'speaking', correct: true, ts: 4 },
      { level: 'learning', dimension: 'speaking', correct: true, ts: 5 },
      { level: 'learning', dimension: 'speaking', correct: true, ts: 6 },
    ]
  }

  function learnedRecord(id, events = makeLearnedEvents()) {
    return { word: id, events, peak: 2, learnedAt: 1, masteredAt: null }
  }

  afterEach(() => {
    progressState.records = {}
  })

  it('falls back to all vocab when no words are learned yet', async () => {
    const wrapper = mount(VocabView)
    await wrapper.findAll('button.card')[1].trigger('click')
    const allWords = shapeVocab(loadFixtureWords())
    expect(allWords.some((w) => w.id === wrapper.vm.current?.id)).toBe(true)
  })

  it('restricts selection to learned words when progress exists', async () => {
    const words = shapeVocab(loadFixtureWords())
    const learnedWord = words[0]
    progressState.records = { [learnedWord.id]: learnedRecord(learnedWord.id) }

    // Only one word in the learned pool — every pick must return it.
    for (let i = 0; i < 5; i++) {
      const wrapper = mount(VocabView)
      await wrapper.findAll('button.card')[1].trigger('click')
      expect(wrapper.vm.current?.id).toBe(learnedWord.id)
    }
  })

  it('includes slipped (lost) words in the pool even when their state dropped below learned', async () => {
    const words = shapeVocab(loadFixtureWords())
    const slippedWord = words[0]
    // peak=2 (learned rank) with no events → stateOf returns 'unknown' → lost
    progressState.records = {
      [slippedWord.id]: { word: slippedWord.id, events: [], peak: 2, learnedAt: 1, masteredAt: null },
    }

    for (let i = 0; i < 5; i++) {
      const wrapper = mount(VocabView)
      await wrapper.findAll('button.card')[1].trigger('click')
      expect(wrapper.vm.current?.id).toBe(slippedWord.id)
    }
  })

  it('selects slipped words significantly more often than normal learned words', async () => {
    const words = shapeVocab(loadFixtureWords())
    const slippedWord = words[0]
    const learnedWord = words[1]
    // slipped → weight 20; learnedWord is the only non-priority so cutoff=1 → stale → weight 5
    // P(slipped) = 20/25 = 80 %, P(learned) = 5/25 = 20 %
    progressState.records = {
      [slippedWord.id]: { word: slippedWord.id, events: [], peak: 2, learnedAt: 1, masteredAt: null },
      [learnedWord.id]: learnedRecord(learnedWord.id),
    }

    const counts = { [slippedWord.id]: 0, [learnedWord.id]: 0 }
    for (let i = 0; i < 60; i++) {
      const wrapper = mount(VocabView)
      await wrapper.findAll('button.card')[1].trigger('click')
      const id = wrapper.vm.current?.id
      if (id in counts) counts[id]++
    }
    // With 80 % vs 20 % probability the slipped word must dominate.
    expect(counts[slippedWord.id]).toBeGreaterThan(counts[learnedWord.id])
  })
})

afterEach(() => {
  vi.useRealTimers()
})

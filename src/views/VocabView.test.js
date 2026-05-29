import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VocabView from './VocabView.vue'
import { state } from '../stores/vocab.js'
import { keyboardHint } from '../stores/keyboard.js'
import { hintLetters } from '../lib/quiz.js'
import { shapeVocab } from '../lib/vocabBuild.js'
import { loadFixtureWords } from '../test/fixtures.js'

// Seed the reactive store with real vocab data so the menu is ready.
beforeAll(() => {
  state.words = loadFixtureWords()
  state.status = 'ready'
})

describe('VocabView', () => {
  it('shows the three difficulty options on the menu', () => {
    const wrapper = mount(VocabView)
    expect(wrapper.text()).toContain('Easy')
    expect(wrapper.text()).toContain('Intermediate')
    expect(wrapper.text()).toContain('Advanced')
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
    // Start advanced (typing) mode — celebration applies to the typing drills.
    await wrapper.findAll('button.card')[2].trigger('click')

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
    // Advanced (typing) mode so the answer flows through record().
    await wrapper.findAll('button.card')[2].trigger('click')

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

  it('highlights the Russian answer letters on the keyboard in intermediate EN → RU', async () => {
    const wrapper = mount(VocabView)
    // Switch to EN → RU so the answer is Russian (the on-screen keyboard case).
    await wrapper.find('button:nth-of-type(2)').trigger('click')
    // Start intermediate mode (second level card).
    await wrapper.findAll('button.card')[1].trigger('click')

    const expected = hintLetters(wrapper.vm.current.ru)
    expect(keyboardHint.letters).toEqual(expected)
    expect(keyboardHint.letters.size).toBeGreaterThan(0)

    // Leaving the drill (Change mode) clears the hint.
    const back = wrapper.findAll('button').find((b) => b.text() === 'Change mode')
    await back.trigger('click')
    expect(keyboardHint.letters.size).toBe(0)
  })

  it('leaves the keyboard hint empty in intermediate RU → EN (English answer)', async () => {
    const wrapper = mount(VocabView)
    // Default direction is RU → EN; start intermediate mode.
    await wrapper.findAll('button.card')[1].trigger('click')
    expect(keyboardHint.letters.size).toBe(0)
  })

  it('waits for the user after a wrong answer', async () => {
    const wrapper = mount(VocabView)
    // Start advanced (typing) mode.
    await wrapper.findAll('button.card')[2].trigger('click')

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

afterEach(() => {
  vi.useRealTimers()
})

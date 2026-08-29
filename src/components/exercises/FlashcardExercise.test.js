import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

// Speech + feedback are side effects; SpeakButton needs speechSupported/SLOW_RATE.
vi.mock('../../lib/speech.js', () => ({
  speak: vi.fn(),
  speechSupported: () => true,
  SLOW_RATE: 0.7,
}))
vi.mock('../../stores/settings.js', () => ({
  playFeedback: vi.fn(),
  settings: {},
}))

// Recognition is controllable per test: `listenImpl` decides what the mic does.
let listenImpl = () => ({ stop() {}, abort() {} })
vi.mock('../../lib/recognition.js', () => ({
  recognitionSupported: () => true,
  gradeSpoken: (guesses, target) => ({
    correct: guesses.some((g) => String(g).toLowerCase() === String(target).toLowerCase()),
    similarity: 1,
    best: guesses[0] ?? '',
  }),
  listen: (opts) => listenImpl(opts),
}))

import { speak } from '../../lib/speech.js'
import { playFeedback } from '../../stores/settings.js'
import FlashcardExercise from './FlashcardExercise.vue'
import { state as vocabState } from '../../stores/vocab.js'
import { shapeVocab } from '../../lib/vocabBuild.js'
import { loadFixtureWords } from '../../test/fixtures.js'

const exercise = {
  id: 'f0',
  kind: 'match',
  dimension: 'identification',
  level: 'learning',
  audio: false,
  pairs: [
    { key: 'a', ru: 'весна', en: 'spring' },
    { key: 'b', ru: 'ме́сяц', en: 'month' },
  ],
  targets: ['a', 'b'],
}

beforeEach(() => {
  vi.clearAllMocks()
  listenImpl = () => ({ stop() {}, abort() {} })
})

describe('FlashcardExercise', () => {
  it('shows the Russian word and a card counter in visual mode', () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    expect(wrapper.find('.ru').text()).toBe('весна')
    expect(wrapper.find('.count').text()).toContain('Card 1 of 2')
  })

  it('shows the part of speech on the card when present (#503)', () => {
    const withPos = { ...exercise, pairs: [{ key: 'a', ru: 'весна', en: 'spring', pos: 'noun' }] }
    const wrapper = mount(FlashcardExercise, { props: { exercise: withPos } })
    expect(wrapper.find('.pos').text()).toBe('noun')
  })

  it('omits the part-of-speech tag when the card carries none', () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    expect(wrapper.find('.pos').exists()).toBe(false)
  })

  it('renders no options when the exercise carries no autocomplete pool', () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    expect(wrapper.findAll('.option').length).toBe(0)
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('advances to the next card once the English is typed correctly', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('spring')
    // Second card is now shown, first was answered cleanly (chime played).
    expect(wrapper.find('.ru').text()).toBe('ме́сяц')
    expect(wrapper.find('.count').text()).toContain('Card 2 of 2')
    expect(playFeedback).toHaveBeenCalledWith(true)
  })

  it('reveals the correct answer when a wrong guess is submitted', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('summer')
    await wrapper.find('form').trigger('submit')
    // Still on card 1, but the answer is now revealed for the learner to read.
    expect(wrapper.find('.ru').text()).toBe('весна')
    expect(wrapper.find('.reveal').exists()).toBe(true)
    expect(wrapper.find('.reveal-en').text()).toBe('spring')
    expect(playFeedback).toHaveBeenLastCalledWith(false)
  })

  it('moves on from the revealed answer when Enter is pressed again', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('summer')
    await wrapper.find('form').trigger('submit') // reveal card 1
    await wrapper.find('form').trigger('submit') // continue
    expect(wrapper.find('.reveal').exists()).toBe(false)
    expect(wrapper.find('.ru').text()).toBe('ме́сяц')
  })

  it('a card guessed wrong is reported wrong even after moving on', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('summer') // wrong on card 1
    await wrapper.find('form').trigger('submit') // reveal
    await wrapper.find('.next').trigger('click') // continue to card 2
    await wrapper.find('.combo-input').setValue('month') // card 2 clean
    const payload = wrapper.emitted('done')[0][0]
    expect(payload.correct).toBe(false)
    expect(payload.wrong).toEqual(['a'])
  })

  it('Pass reveals the answer and reports the passed key as wrong', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('spring') // card 1 correct
    await wrapper.find('.pass').trigger('click') // card 2 passed
    expect(wrapper.find('.reveal-en').text()).toBe('month')
    await wrapper.find('.next').trigger('click') // finish
    const payload = wrapper.emitted('done')[0][0]
    expect(payload.correct).toBe(false)
    expect(payload.wrong).toEqual(['b'])
  })

  it('emits an all-correct result when every card is answered', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.combo-input').setValue('spring')
    await wrapper.find('.combo-input').setValue('month')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, wrong: [] })
  })

  it('audio mode hides the Russian text and reads it aloud on appearance', () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: { ...exercise, audio: true } } })
    expect(wrapper.find('.ru').exists()).toBe(false)
    expect(wrapper.find('.big-speak').exists()).toBe(true)
    expect(speak).toHaveBeenCalledWith('весна')
  })

  it('lets the learner answer by speaking instead of typing', async () => {
    listenImpl = (opts) => {
      opts.onEnd('spring', [])
      return { stop() {}, abort() {} }
    }
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.speak-toggle').trigger('click')
    // The spoken "spring" was accepted and the card advanced.
    expect(wrapper.find('.ru').text()).toBe('ме́сяц')
  })

  it('a wrong spoken answer reveals the correct answer', async () => {
    listenImpl = (opts) => {
      opts.onEnd('winter', [])
      return { stop() {}, abort() {} }
    }
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('.speak-toggle').trigger('click')
    expect(wrapper.find('.reveal-en').text()).toBe('spring')
  })
})

describe('FlashcardExercise type-ahead options (#473)', () => {
  const withOptions = {
    id: 'fo',
    kind: 'match',
    dimension: 'identification',
    level: 'learning',
    audio: false,
    pairs: [
      { key: 'a', ru: 'весна', en: 'spring', label: 'spring' },
      { key: 'b', ru: 'ме́сяц', en: 'month', label: 'month' },
    ],
    targets: ['a', 'b'],
    options: [
      { key: 'a', en: 'spring', label: 'spring' },
      { key: 'b', en: 'month', label: 'month' },
      { key: 'x', en: 'summer', label: 'summer' },
    ],
  }

  const optionByLabel = (wrapper, label) =>
    wrapper.findAll('.option').find((b) => b.text() === label)

  it('shows nothing before the learner types, then suggestions after', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: withOptions } })
    expect(wrapper.findAll('.option').length).toBe(0)
    await wrapper.find('.combo-input').setValue('s')
    expect(wrapper.findAll('.option').length).toBeGreaterThan(0)
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
  })

  it('picking the correct suggestion advances the card', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: withOptions } })
    await wrapper.find('.combo-input').setValue('s') // partial — no auto-advance
    await optionByLabel(wrapper, 'spring').trigger('click')
    expect(wrapper.find('.ru').text()).toBe('ме́сяц')
    expect(playFeedback).toHaveBeenLastCalledWith(true)
  })

  it('picking a wrong suggestion reveals the answer and reports it wrong', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: withOptions } })
    await wrapper.find('.combo-input').setValue('s')
    await optionByLabel(wrapper, 'summer').trigger('click') // wrong for "spring"
    expect(wrapper.find('.reveal-en').text()).toBe('spring')
    await wrapper.find('.next').trigger('click')
    await wrapper.find('.combo-input').setValue('month')
    expect(wrapper.emitted('done')[0][0].wrong).toEqual(['a'])
  })

  it('tells same-base forms apart by their label', async () => {
    const hat = {
      id: 'fh',
      kind: 'match',
      dimension: 'identification',
      level: 'learning',
      audio: false,
      pairs: [{ key: 'h2', ru: 'шля́па', en: 'hat', label: 'hat (brimmed)' }],
      targets: ['h2'],
      options: [
        { key: 'h1', en: 'hat', label: 'hat (winter)' },
        { key: 'h2', en: 'hat', label: 'hat (brimmed)' },
      ],
    }
    const wrapper = mount(FlashcardExercise, { props: { exercise: hat } })
    await wrapper.find('.combo-input').setValue('h') // both hats appear
    // The other hat form is graded wrong even though its base gloss matches.
    await optionByLabel(wrapper, 'hat (winter)').trigger('click')
    expect(wrapper.find('.reveal').exists()).toBe(true)
    expect(playFeedback).toHaveBeenLastCalledWith(false)
  })

  it('accepts the exact same-base form when picked', async () => {
    const hat = {
      id: 'fh',
      kind: 'match',
      dimension: 'identification',
      level: 'learning',
      audio: false,
      pairs: [{ key: 'h2', ru: 'шля́па', en: 'hat', label: 'hat (brimmed)' }],
      targets: ['h2'],
      options: [
        { key: 'h1', en: 'hat', label: 'hat (winter)' },
        { key: 'h2', en: 'hat', label: 'hat (brimmed)' },
      ],
    }
    const wrapper = mount(FlashcardExercise, { props: { exercise: hat } })
    await wrapper.find('.combo-input').setValue('h')
    await optionByLabel(wrapper, 'hat (brimmed)').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({ correct: true, wrong: [] })
  })
})

// ── A wrong guess that names a real, related word (#589) ────────────────────
// The mirror of the spelling direction: shown «одева́ться» and told "to put on",
// the drill can say that belongs to «надева́ть» instead of just failing the card.
describe('FlashcardExercise diagnoses a placeable wrong guess', () => {
  const words = loadFixtureWords()

  // The drill's own autocomplete pool doubles as the gloss index (see
  // buildGlossIndex), so build it exactly as exerciseBuild does.
  const optionPool = shapeVocab(words).map((w) => {
    const en = Array.isArray(w.en) ? (w.en[0] ?? '') : (w.en ?? '')
    return { key: w.id, ru: w.ru, en, label: w.note ? `${en} (${w.note})` : en }
  })

  const dress = {
    ...exercise,
    pairs: [
      { key: 'одеваться=to get dressed', ru: 'одева́ться', en: 'to get dressed' },
      { key: 'ме́сяц=month', ru: 'ме́сяц', en: 'month' },
    ],
    targets: ['одеваться=to get dressed', 'ме́сяц=month'],
    options: optionPool,
  }

  const guess = async (wrapper, text) => {
    await wrapper.find('input.combo-input').setValue(text)
    await wrapper.find('form').trigger('submit')
  }
  // A correct answer advances the moment it is typed — no Enter, by design —
  // unless the word has facts to read (#586), when the card holds for a Next.
  const answerRight = async (wrapper, text) => {
    await wrapper.find('input.combo-input').setValue(text)
    const next = wrapper.find('button.next')
    if (next.exists()) await next.trigger('click')
  }

  beforeEach(() => {
    vocabState.words = words
    vocabState.status = 'ready'
  })

  it('names the word the guess actually describes, and keeps the card open', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: dress } })
    await guess(wrapper, 'to put on')

    const correction = wrapper.find('.correction')
    expect(correction.text()).toContain('«надева́ть»')
    // Not revealed: the answer is still to be produced.
    expect(wrapper.find('.reveal').exists()).toBe(false)
    expect(wrapper.find('input.combo-input').attributes('readonly')).toBeUndefined()
  })

  it('never states the English, which is the answer here', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: dress } })
    await guess(wrapper, 'to put on')
    expect(wrapper.find('.correction').text()).not.toContain('to get dressed')
  })

  it('lets the learner go again, as often as it takes', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: dress } })
    await guess(wrapper, 'to put on')
    await guess(wrapper, 'castle')
    expect(wrapper.find('.correction').text()).toContain('«за́мок»')
    expect(wrapper.find('.reveal').exists()).toBe(false)
  })

  it('still reports the card wrong after an eventual correct answer', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: dress } })
    await guess(wrapper, 'to put on')
    await answerRight(wrapper, 'to get dressed') // right at last — already missed
    await answerRight(wrapper, 'month')

    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      wrong: ['одеваться=to get dressed'],
    })
  })

  it('reveals at once for a guess it cannot place — the loop stays fast', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: dress } })
    await guess(wrapper, 'flibbertigibbet')
    expect(wrapper.find('.correction').exists()).toBe(false)
    expect(wrapper.find('.reveal').exists()).toBe(true)
  })

  it('Pass still reveals, whatever is in the box', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: dress } })
    await wrapper.find('input.combo-input').setValue('to put on')
    await wrapper.find('button.pass').trigger('click')
    expect(wrapper.find('.reveal').exists()).toBe(true)
  })

  it('clears the correction when the next card comes up', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: dress } })
    await guess(wrapper, 'to put on')
    expect(wrapper.find('.correction').exists()).toBe(true)
    await answerRight(wrapper, 'to get dressed')
    expect(wrapper.find('.correction').exists()).toBe(false)
  })
})

describe('a correct card holds only when it has something to say (#586)', () => {
  const words = loadFixtureWords()
  const dressed = {
    ...exercise,
    pairs: [
      { key: 'одеваться=to get dressed', ru: 'одева́ться', en: 'to get dressed' },
      { key: 'ме́сяц=month', ru: 'ме́сяц', en: 'month' },
    ],
    targets: ['одеваться=to get dressed', 'ме́сяц=month'],
  }

  beforeEach(() => {
    vocabState.words = words
    vocabState.status = 'ready'
  })

  it('holds a right answer open on a word with facts, so they can be read', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: dressed } })
    await wrapper.find('input.combo-input').setValue('to get dressed')

    // Still on card 1, marked correct, with the facts on screen.
    expect(wrapper.find('.count').text()).toContain('Card 1 of 2')
    expect(wrapper.find('.reveal.solved').text()).toContain('Correct')
    expect(wrapper.findComponent({ name: 'WordFacts' }).exists()).toBe(true)
    expect(wrapper.emitted('done')).toBeUndefined()

    // Next moves on, and the card still counts as answered correctly.
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.find('.count').text()).toContain('Card 2 of 2')
  })

  it('does not name the answer again, or paint the input as a miss', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise: dressed } })
    await wrapper.find('input.combo-input').setValue('to get dressed')
    expect(wrapper.find('.reveal-en').exists()).toBe(false)
    expect(wrapper.find('input.combo-input').classes()).toContain('solved')
    expect(wrapper.find('input.combo-input').classes()).not.toContain('revealed')
  })

  it('advances at once when the word has nothing to add — the loop stays fast', async () => {
    // Keys 'a'/'b' are in no vocabulary, so there are no facts to hold for.
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('input.combo-input').setValue('spring')
    expect(wrapper.find('.count').text()).toContain('Card 2 of 2')
    expect(wrapper.find('button.next').exists()).toBe(false)
  })
})

describe('the facts panel never precedes the answer (#586)', () => {
  it('appears only once the card is revealed', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    expect(wrapper.findComponent({ name: 'WordFacts' }).exists()).toBe(false)

    await wrapper.find('button.pass').trigger('click')
    expect(wrapper.findComponent({ name: 'WordFacts' }).exists()).toBe(true)
  })

  it('is gone again on the next card', async () => {
    const wrapper = mount(FlashcardExercise, { props: { exercise } })
    await wrapper.find('button.pass').trigger('click')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.findComponent({ name: 'WordFacts' }).exists()).toBe(false)
  })
})

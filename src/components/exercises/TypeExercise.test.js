import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { mount } from '@vue/test-utils'
import TypeExercise from './TypeExercise.vue'
import { keyboard, resetHint } from '../../stores/keyboard.js'
import { state as vocabState } from '../../stores/vocab.js'
import { state as progressState } from '../../stores/progress.js'
import { loadFixtureWords } from '../../test/fixtures.js'

beforeAll(() => {
  vocabState.words = loadFixtureWords()
  vocabState.status = 'ready'
})

afterEach(() => {
  resetHint()
  progressState.records = {}
  progressState.learning = null
  progressState.mastery = null
})

const exercise = {
  id: 'ex0',
  kind: 'type',
  dimension: 'usage',
  level: 'learning',
  content: 'word',
  audio: false,
  targets: ['дом=house'],
  ru: 'дом',
  en: 'house',
}

describe('TypeExercise', () => {
  it('shows the part of speech the answer should be (#503)', () => {
    const wrapper = mount(TypeExercise, { props: { exercise: { ...exercise, en: 'cold', pos: 'adjective' } } })
    expect(wrapper.find('.pos').text()).toBe('adjective')
  })

  it('omits the part-of-speech tag when the exercise carries none', () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    expect(wrapper.find('.pos').exists()).toBe(false)
  })

  it('shows the English cue and grades a correct answer', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    expect(wrapper.text()).toContain('house')

    await wrapper.find('input[lang="ru"]').setValue('дом')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.text()).toContain('Correct')

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')).toBeTruthy()
    // Correct without touching the hint → counts double, with a 🔥 burst.
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: true,
      correctedOnRetry: false,
      double: true,
      wordCorrect: true,
    })
  })

  it('annotates what the English prompt cannot say on its own', () => {
    const wrapper = mount(TypeExercise, {
      props: {
        exercise: {
          ...exercise,
          content: 'phrase',
          ru: 'Хо́чешь ча́ю?',
          en: 'Do you want tea?',
          enNotes: ['you-informal'],
        },
      },
    })
    // Without the note there is no way to know the answer wants ты, not вы.
    expect(wrapper.find('.prompt').text()).toContain('you (informal)')
  })

  it('fires a burst and counts double when correct without the hint', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(false)

    await wrapper.find('input[lang="ru"]').setValue('дом')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(true)

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: true,
      correctedOnRetry: false,
      double: true,
      wordCorrect: true,
    })
  })

  it('does not count double (or burst) once the hint has been switched on', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    keyboard.on = true // learner reaches for the hint
    await wrapper.vm.$nextTick()

    await wrapper.find('input[lang="ru"]').setValue('дом')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(false)

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: true,
      correctedOnRetry: false,
      double: false,
      wordCorrect: true,
    })
  })

  it('offers a retry on the first wrong answer, then reveals on the second', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    await wrapper.find('input[lang="ru"]').setValue('кот')
    await wrapper.find('button.check').trigger('click')
    // First wrong attempt → retry hint shown, answer not yet revealed.
    expect(wrapper.find('.retry-hint').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Answer:')

    // Second wrong attempt → answer revealed.
    await wrapper.find('input[lang="ru"]').setValue('кот')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.text()).toContain('Answer:')

    await wrapper.find('button.next').trigger('click')
    // A word (no targetTokens): the slip is necessarily in the word, so it is
    // penalised — wordCorrect mirrors the failed grade. Both tries wrong, so it
    // is not a corrected retry.
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      correctedOnRetry: false,
      double: false,
      wordCorrect: false,
    })
  })

  it('records the first miss (not a double success) when a retry corrects a word (#447)', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    // Wrong first, then the right answer on the retry — without touching the hint.
    await wrapper.find('input[lang="ru"]').setValue('кот')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.find('.retry-hint').exists()).toBe(true)

    await wrapper.find('input[lang="ru"]').setValue('дом')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.text()).toContain('Correct')
    // No 🔥: a corrected retry is not first-try recall.
    expect(wrapper.findComponent({ name: 'CelebrationBurst' }).props('show')).toBe(false)

    await wrapper.find('button.next').trigger('click')
    // The first retrieval failed: report the miss, flagged as corrected on retry,
    // never a double first-try success.
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      correctedOnRetry: true,
      double: false,
      wordCorrect: false,
    })
  })

  it('accepts an alsoRu synonym as correct', async () => {
    const wrapper = mount(TypeExercise, {
      props: { exercise: { ...exercise, ru: 'автомобиль', alsoRu: ['маши́на'] } },
    })
    await wrapper.find('input[lang="ru"]').setValue('машина')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.text()).toContain('Correct')
  })

  it('ignores stress, case and ё/е when grading (hints never penalise)', async () => {
    const wrapper = mount(TypeExercise, {
      props: { exercise: { ...exercise, ru: 'всё' } },
    })
    await wrapper.find('input[lang="ru"]').setValue('ВСЕ')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.text()).toContain('Correct')
  })

  // Collateral-damage guard for phrase spelling: a phrase carries targetTokens
  // naming the word being assessed, so a slip elsewhere doesn't penalise the word.
  const phrase = {
    ...exercise,
    content: 'phrase',
    targets: ['школа=school'],
    ru: 'я иду в школу',
    en: 'I am going to school',
    targetTokens: ['школу'],
  }

  it('reports the phrase wrong but the word right when the slip is elsewhere', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: phrase } })
    // Mis-spell a different word ("ыду") but spell the assessed word correctly.
    await wrapper.find('input[lang="ru"]').setValue('я ыду в школу')
    await wrapper.find('button.check').trigger('click') // first wrong → retry
    await wrapper.find('input[lang="ru"]').setValue('я ыду в школу')
    await wrapper.find('button.check').trigger('click') // second wrong → revealed

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      correctedOnRetry: false,
      double: false,
      wordCorrect: true,
    })
  })

  it('spares the word but records the phrase miss when a retry fixes a slip elsewhere (#447)', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: phrase } })
    // First try: assessed word (школу) right, slip elsewhere ("ыду").
    await wrapper.find('input[lang="ru"]').setValue('я ыду в школу')
    await wrapper.find('button.check').trigger('click') // first wrong → retry
    // Retry fixes the other word — the whole phrase is now correct.
    await wrapper.find('input[lang="ru"]').setValue('я иду в школу')
    await wrapper.find('button.check').trigger('click')

    await wrapper.find('button.next').trigger('click')
    // The exercise was missed first try (corrected on retry), but the word's own
    // first retrieval succeeded, so it is still spared a penalty.
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      correctedOnRetry: true,
      double: false,
      wordCorrect: true,
    })
  })

  it('reports both the phrase and the word wrong when the slip is in the word', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: phrase } })
    await wrapper.find('input[lang="ru"]').setValue('я иду в школе')
    await wrapper.find('button.check').trigger('click')
    await wrapper.find('input[lang="ru"]').setValue('я иду в школе')
    await wrapper.find('button.check').trigger('click')

    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      correctedOnRetry: false,
      double: false,
      wordCorrect: false,
    })
  })

  it('withholds the keyboard hint on a phrase until the first attempt is made', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: phrase } })
    // Withheld while the first, unaided attempt is in progress.
    expect(keyboard.allowed).toBe(false)

    await wrapper.find('input[lang="ru"]').setValue('я иду в школе')
    await wrapper.find('button.check').trigger('click') // first wrong → unlock
    // Now the learner may reach for the hint on the retry.
    expect(keyboard.allowed).toBe(true)
  })

  it('withholds the keyboard hint on a single word until the first attempt is made', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    expect(keyboard.allowed).toBe(false)

    await wrapper.find('input[lang="ru"]').setValue('кот')
    await wrapper.find('button.check').trigger('click') // first wrong → unlock
    expect(keyboard.allowed).toBe(true)
  })

  it('maps where a close phrase attempt went wrong, without revealing the letters', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: phrase } })
    // One slip (школе for школу) → close enough to show the error map.
    await wrapper.find('input[lang="ru"]').setValue('я иду в школе')
    await wrapper.find('button.check').trigger('click')

    const map = wrapper.find('.error-map')
    expect(map.exists()).toBe(true)
    // The single slip (е typed for у) is flagged showing what the learner
    // typed — never the correct letter, so the retry is still a spelling.
    const wrong = map.findAll('.cell.wrong')
    expect(wrong).toHaveLength(1)
    expect(wrong[0].text()).toBe('е')
  })

  it('maps where a close single-word attempt went wrong', async () => {
    const wrapper = mount(TypeExercise, {
      props: { exercise: { ...exercise, ru: 'автомобиль' } },
    })
    // One slip (автамобиль for автомобиль) → close enough to show the map.
    await wrapper.find('input[lang="ru"]').setValue('автамобиль')
    await wrapper.find('button.check').trigger('click')

    const map = wrapper.find('.error-map')
    expect(map.exists()).toBe(true)
    const wrong = map.findAll('.cell.wrong')
    expect(wrong).toHaveLength(1)
    expect(wrong[0].text()).toBe('а')
  })

  it('shows no error map when the attempt is nowhere near', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: phrase } })
    await wrapper.find('input[lang="ru"]').setValue('нет')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.find('.error-map').exists()).toBe(false)
    // The retry is still offered — just without the map.
    expect(wrapper.find('.retry-hint').exists()).toBe(true)
  })

  it('grades how the first miss missed instead of a flat "not quite" (#523)', async () => {
    const wrapper = mount(TypeExercise, {
      props: { exercise: { ...exercise, ru: 'автомобиль' } },
    })
    // One slip in a ten-letter word → "Not quite" band.
    await wrapper.find('input[lang="ru"]').setValue('автамобиль')
    await wrapper.find('button.check').trigger('click')
    const hint = wrapper.find('.retry-hint')
    expect(hint.text()).toContain('Not quite')
    // A far-off answer reads red ("Incorrect"), a close one amber.
    expect(hint.classes()).toContain('notQuite')
  })

  it('calls a nowhere-near single word "Incorrect"', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    await wrapper.find('input[lang="ru"]').setValue('кот')
    await wrapper.find('button.check').trigger('click')
    const hint = wrapper.find('.retry-hint')
    expect(hint.text()).toContain('Incorrect')
    expect(hint.classes()).toContain('incorrect')
  })

  it('names a missing word on a phrase miss', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: phrase } })
    // Dropped "в" — the rest present and in order.
    await wrapper.find('input[lang="ru"]').setValue('я иду школу')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.find('.retry-hint').text()).toContain('One word missing')
  })

  it('offers a chip reorder when the words are right but the order is wrong', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: phrase } })
    await wrapper.find('input[lang="ru"]').setValue('школу я иду в')
    await wrapper.find('button.check').trigger('click')

    expect(wrapper.find('.retry-hint').text()).toContain('Right words, wrong order')
    // The text input gives way to a chip bank; no error map here.
    expect(wrapper.find('input[lang="ru"]').exists()).toBe(false)
    expect(wrapper.find('.error-map').exists()).toBe(false)
    const bankChips = wrapper.findAll('.reorder .bank .chip')
    expect(bankChips.map((c) => c.text()).sort()).toEqual(['в', 'иду', 'школу', 'я'])
  })

  it('grades the rearranged chips and credits a corrected retry (#447)', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: phrase } })
    await wrapper.find('input[lang="ru"]').setValue('школу я иду в')
    await wrapper.find('button.check').trigger('click')

    // Tap the chips into the correct order: я иду в школу.
    const order = ['я', 'иду', 'в', 'школу']
    for (const word of order) {
      const chip = wrapper.findAll('.reorder .bank .chip').find((c) => c.text() === word)
      await chip.trigger('click')
    }
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.text()).toContain('Correct')

    await wrapper.find('button.next').trigger('click')
    // A reorder success is a corrected retry, never a first-try double.
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      correctedOnRetry: true,
      double: false,
      wordCorrect: true,
    })
  })

  // Dictionary: the unlearned words of a phrase, revealed with no penalty.
  const dictPhrase = {
    ...phrase,
    targets: ['абзац=paragraph'],
    ru: 'В э́том абза́це две оши́бки.',
    en: 'There are two mistakes in this paragraph.',
    targetTokens: ['абзаце'],
  }
  // Combining stress marks stripped so assertions don't depend on exact codepoints.
  const bare = (s) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()

  it("lists the phrase's unlearned words alphabetically, never the assessed word", async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: dictPhrase } })
    await wrapper.find('.dict-toggle').trigger('click')
    const words = wrapper.findAll('.dict-ru').map((n) => bare(n.text()))
    // абзац (the assessed word) is excluded; the rest appear, alphabetised.
    expect(words).toEqual(['в', 'две', 'ошибки', 'этом'])
  })

  it('would reveal a recognised word unless it is the exercise subject', async () => {
    // Same phrase, but nothing marked as the assessed word: абзац now shows,
    // proving the explicit guard (not the batch filter) is what hides it above.
    const wrapper = mount(TypeExercise, {
      props: { exercise: { ...dictPhrase, targets: [], targetTokens: [] } },
    })
    await wrapper.find('.dict-toggle').trigger('click')
    const words = wrapper.findAll('.dict-ru').map((n) => bare(n.text()))
    expect(words).toContain('абзаце')
  })
})

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

  // An aspect pair shares its gloss and its note, so the aspect is the only
  // thing on the prompt that says which of the two is wanted (#527).
  const kill = { ...exercise, targets: ['убить=to kill'], ru: 'уби́ть', en: 'to kill', note: 'to murder', pos: 'verb' }

  it('names the aspect of a perfective verb (#527)', () => {
    const wrapper = mount(TypeExercise, { props: { exercise: { ...kill, aspect: 'pf' } } })
    expect(wrapper.find('.pos').text()).toBe('verb · perfective')
  })

  it('names the aspect of its imperfective partner (#527)', () => {
    const wrapper = mount(TypeExercise, {
      props: { exercise: { ...kill, ru: 'убива́ть', aspect: 'impf' } },
    })
    expect(wrapper.find('.pos').text()).toBe('verb · imperfective')
  })

  it('shows the part of speech alone for a word with no aspect', () => {
    const wrapper = mount(TypeExercise, { props: { exercise: { ...exercise, pos: 'noun' } } })
    expect(wrapper.find('.pos').text()).toBe('noun')
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
    // A misspelling, not a word: the one-retry rule still governs these (#588
    // only changes what happens when the answer is a real, related word).
    const wrapper = mount(TypeExercise, { props: { exercise } })
    await wrapper.find('input[lang="ru"]').setValue('квакозябр')
    await wrapper.find('button.check').trigger('click')
    // First wrong attempt → retry hint shown, answer not yet revealed.
    expect(wrapper.find('.retry-hint').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Answer:')

    // Second wrong attempt → answer revealed.
    await wrapper.find('input[lang="ru"]').setValue('квакозябр')
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
    // Wrong first ("кот" is a real word, so it is diagnosed), then the right
    // answer on the retry — without touching the hint. Grading is unchanged
    // either way: the first attempt is the evidence.
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

  // ── A wrong answer that is a real, related word (#588) ────────────────────
  // «сшить» and «шить» are an aspect pair sharing one base gloss, so a rejection
  // that quotes the gloss tells the learner nothing they weren't already
  // thinking. These are the regressions that motivated the whole feature.
  const sew = { ...exercise, targets: ['шить=to sew'], ru: 'шить', en: 'to sew', pos: 'verb', aspect: 'impf' }

  it('diagnoses a real, related word instead of rejecting it', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: sew } })
    await wrapper.find('input[lang="ru"]').setValue('сшить')
    await wrapper.find('button.check').trigger('click')

    const hint = wrapper.find('.retry-hint')
    expect(hint.text()).toContain('«сшить»')
    expect(hint.text()).toContain('a single completed action')
    expect(hint.classes()).toContain('lexical')
  })

  it('re-opens the input rather than revealing, however many lexical tries it takes', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: sew } })
    for (const attempt of ['сшить', 'кот', 'дом']) {
      await wrapper.find('input[lang="ru"]').setValue(attempt)
      await wrapper.find('button.check').trigger('click')
      // Every one diagnosed, the answer never given away, the input still open.
      expect(wrapper.find('.retry-hint').classes(), attempt).toContain('lexical')
      expect(wrapper.text(), attempt).not.toContain('Answer:')
      expect(wrapper.find('input[lang="ru"]').exists(), attempt).toBe(true)
    }
  })

  it('never spells the answer out while the learner is still trying', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: sew } })
    await wrapper.find('input[lang="ru"]').setValue('сшить')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.find('.retry-hint').text()).not.toMatch(/(^|[^\p{L}])шить([^\p{L}]|$)/u)
  })

  it('still grades the first attempt, and only the first', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: sew } })
    await wrapper.find('input[lang="ru"]').setValue('сшить')
    await wrapper.find('button.check').trigger('click')
    await wrapper.find('input[lang="ru"]').setValue('кот')
    await wrapper.find('button.check').trigger('click')
    await wrapper.find('input[lang="ru"]').setValue('шить')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.text()).toContain('Correct')

    await wrapper.find('button.next').trigger('click')
    // Byte-identical to what one wrong attempt then a correction reports today.
    expect(wrapper.emitted('done')[0][0]).toEqual({
      correct: false,
      correctedOnRetry: true,
      double: false,
      wordCorrect: false,
    })
  })

  it('lets the learner end the loop with I don’t know, once confirmed', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: sew } })
    // The confirmation is the only thing that reveals: the link itself never does.
    expect(wrapper.find('button.reveal').exists()).toBe(false)

    await wrapper.find('input[lang="ru"]').setValue('сшить')
    await wrapper.find('button.check').trigger('click')
    await wrapper.find('button.dunno').trigger('click')
    expect(wrapper.text()).not.toContain('Answer:')
    await wrapper.find('button.reveal').trigger('click')

    expect(wrapper.text()).toContain('Answer:')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toMatchObject({ correct: false, correctedOnRetry: false })
  })

  // The misclick this whole flow exists to prevent: Next belongs to the answered
  // state, so an open question must never offer it.
  it('offers no Next while the question is still open', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    expect(wrapper.find('button.next').exists()).toBe(false)

    await wrapper.find('input[lang="ru"]').setValue('дом')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.find('button.next').exists()).toBe(true)
  })

  it('says what I don’t know costs, and grades nothing until it is confirmed', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    await wrapper.find('button.dunno').trigger('click')

    const confirm = wrapper.find('.dunno-confirm')
    expect(confirm.text()).toContain('I don’t know')
    expect(confirm.text()).toContain('marked wrong')
    // Still unanswered: no reveal, no verdict, no Next.
    expect(wrapper.text()).not.toContain('Answer:')
    expect(wrapper.find('button.next').exists()).toBe(false)

    await wrapper.find('button.keep-trying').trigger('click')
    expect(wrapper.find('.dunno-confirm').exists()).toBe(false)
    expect(wrapper.emitted('done')).toBeUndefined()
    // And the way back out is still there.
    expect(wrapper.find('button.dunno').exists()).toBe(true)
  })

  it('gives up on an untouched prompt only through the confirmation', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise } })
    await wrapper.find('button.dunno').trigger('click')
    await wrapper.find('button.reveal').trigger('click')

    expect(wrapper.text()).toContain('Answer:')
    await wrapper.find('button.next').trigger('click')
    expect(wrapper.emitted('done')[0][0]).toMatchObject({ correct: false, wordCorrect: false })
  })

  it('treats a true synonym gently — right knowledge, wrong slot', async () => {
    const car = { ...exercise, targets: ['машина=car'], ru: 'маши́на', en: 'car', pos: 'noun' }
    const wrapper = mount(TypeExercise, { props: { exercise: car } })
    await wrapper.find('input[lang="ru"]').setValue('автомоби́ль')
    await wrapper.find('button.check').trigger('click')

    const hint = wrapper.find('.retry-hint')
    expect(hint.text()).toContain('«автомоби́ль»')
    // Amber, never the red reserved for a flat rejection.
    expect(hint.classes()).not.toContain('incorrect')
  })

  it('unlocks the keyboard hint after a lexical miss, like any other', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: sew } })
    expect(keyboard.allowed).toBe(false)
    await wrapper.find('input[lang="ru"]').setValue('сшить')
    await wrapper.find('button.check').trigger('click')
    expect(keyboard.allowed).toBe(true)
  })

  it('still shows the error map when the answer is a slip, not a word', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: { ...exercise, ru: 'до́мик', en: 'little house' } } })
    await wrapper.find('input[lang="ru"]').setValue('домек')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.find('.error-map').exists()).toBe(true)
    expect(wrapper.find('.retry-hint').classes()).not.toContain('lexical')
  })

  // ── The answer-leak guard for the facts panel (#586) ──────────────────────
  it('shows no facts panel until the answer is resolved', async () => {
    // A `build` fact spells the word out in morphemes, so the panel appearing
    // one moment early would simply hand over the answer.
    const wrapper = mount(TypeExercise, { props: { exercise } })
    expect(wrapper.findComponent({ name: 'WordFacts' }).exists()).toBe(false)

    await wrapper.find('input[lang="ru"]').setValue('квакозябр')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.findComponent({ name: 'WordFacts' }).exists()).toBe(false)

    await wrapper.find('input[lang="ru"]').setValue('дом')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.findComponent({ name: 'WordFacts' }).exists()).toBe(true)
  })

  it('shows the facts of the word a phrase drills, once it is resolved', async () => {
    const wrapper = mount(TypeExercise, { props: { exercise: phrase } })
    expect(wrapper.findComponent({ name: 'WordFacts' }).exists()).toBe(false)

    await wrapper.find('input[lang="ru"]').setValue('я иду в школу')
    await wrapper.find('button.check').trigger('click')
    const facts = wrapper.findComponent({ name: 'WordFacts' })
    expect(facts.exists()).toBe(true)
    expect(facts.props('wordKey')).toBe('школа=school')
  })

  it('offers no facts panel for a set spanning several words', async () => {
    const many = { ...phrase, targets: ['школа=school', 'идти=to go'] }
    const wrapper = mount(TypeExercise, { props: { exercise: many } })
    await wrapper.find('input[lang="ru"]').setValue('я иду в школу')
    await wrapper.find('button.check').trigger('click')
    expect(wrapper.findComponent({ name: 'WordFacts' }).exists()).toBe(false)
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
    await wrapper.find('input[lang="ru"]').setValue('квакозябр')
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

import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { mount, flushPromises } from '@vue/test-utils'

import * as idb from '../lib/idb.js'
import { state as vocabState } from '../stores/vocab.js'
import * as progress from '../stores/progress.js'
import WordProgressModal from './WordProgressModal.vue'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  vocabState.words = [{ key: 'w0', headword: 'дом', meaning: 'house', hasInflections: true, pos: 'noun' }]
  await progress.resetProgress()
  await progress.loadProgress()
})

describe('WordProgressModal — "I know this word" (#321)', () => {
  it('flags the word known, shows the confirmation, and can undo it', async () => {
    const wrapper = mount(WordProgressModal, { props: { wordKey: 'w0' } })
    await flushPromises()

    // The offer is shown while the word is not yet known.
    const knowBtn = wrapper.find('button.know')
    expect(knowBtn.exists()).toBe(true)
    expect(progress.isKnown('w0')).toBe(false)

    await knowBtn.trigger('click')
    await flushPromises()
    await flushPromises() // second flush: fake-indexeddb settles the write on setImmediate

    // Now flagged: the store agrees and the UI swaps to the "known" badge.
    expect(progress.isKnown('w0')).toBe(true)
    expect(wrapper.find('.known-badge').exists()).toBe(true)
    expect(wrapper.find('button.know').exists()).toBe(false)

    // Undo restores the offer and clears the flag.
    await wrapper.find('button.linkish').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(progress.isKnown('w0')).toBe(false)
    expect(wrapper.find('button.know').exists()).toBe(true)
  })
})

describe('WordProgressModal — the full explanation (the row is abbreviated)', () => {
  it('shows the authored meaning whole, its alternates, and the spelled-out aspect', async () => {
    vocabState.words = [
      {
        key: 'сшить=to sew',
        headword: 'сшить',
        meaning: 'to sew',
        meaningFull: 'to sew (join with thread)',
        meaningsAlt: ['to stitch', 'to make up'],
        aspect: 'pf',
        aspectPair: { key: 'шить=to sew' },
        pos: 'verb',
      },
    ]
    const wrapper = mount(WordProgressModal, { props: { wordKey: 'сшить=to sew' } })
    await flushPromises()

    expect(wrapper.find('.meaning').text()).toBe('to sew (join with thread)')
    expect(wrapper.find('.meaning-alt').text()).toBe('also: to stitch; to make up')
    expect(wrapper.findAll('.chip').map((c) => c.text())).toContain('perfective')
  })

  it('falls back to the key gloss and hides the alternates line when there are none', async () => {
    const wrapper = mount(WordProgressModal, { props: { wordKey: 'w0' } })
    await flushPromises()

    expect(wrapper.find('.meaning').text()).toBe('house')
    expect(wrapper.find('.meaning-alt').exists()).toBe(false)
  })
})

describe('WordProgressModal — what slipped, and what would win it back', () => {
  const DAY = 86400000
  const ev = (dimension, level, correct, ts) => ({ dimension, level, correct, ts })
  const LEARNING = ['identification', 'usage', 'hearing', 'speaking']
  const MASTERY = ['identification', 'usage', 'context']
  /** Every criterion of a level met, over two calendar days (#313). */
  const met = (level, dims) =>
    dims.flatMap((d, i) => [
      ev(d, level, true, 10 * DAY + i),
      ev(d, level, true, 13 * DAY + i),
      ev(d, level, true, 14 * DAY + i),
    ])

  function track(events, peak) {
    vocabState.words = [
      {
        key: 'w0',
        headword: 'дом',
        meaning: 'house',
        pos: 'noun',
        hasInflections: true,
        hasContextDrill: true,
      },
    ]
    progress.state.records.w0 = { word: 'w0', events, peak }
  }

  it('names the drop and prices each skill that owes answers', async () => {
    // Mastered, then two wrong mastery-usage answers: the word is back to
    // `learned` and owes exactly that one skill.
    track(
      [
        ...met('learning', LEARNING),
        ...met('mastery', MASTERY),
        ev('usage', 'mastery', false, 20 * DAY),
        ev('usage', 'mastery', false, 20 * DAY + 1),
      ],
      3, // peak: mastered
    )
    const wrapper = mount(WordProgressModal, { props: { wordKey: 'w0' } })
    await flushPromises()

    const panel = wrapper.find('.recovery')
    expect(panel.exists()).toBe(true)
    expect(panel.classes()).toContain('slipped')
    expect(panel.find('.recovery-move').text()).toBe('Mastered → Learned')
    const steps = panel.findAll('.recovery-step')
    expect(steps).toHaveLength(1)
    expect(steps[0].find('.step-name').text()).toContain('Usage')
    expect(steps[0].find('.step-need').text()).toBe('2 correct answers')
  })

  it('tells an at-risk word which single answer secures it', async () => {
    track([...met('learning', LEARNING), ...met('mastery', MASTERY), ev('hearing', 'learning', false, 20 * DAY)], 3)
    const wrapper = mount(WordProgressModal, { props: { wordKey: 'w0' } })
    await flushPromises()

    const panel = wrapper.find('.recovery')
    expect(panel.classes()).toContain('at-risk')
    // Nothing has actually dropped yet, so there is no from → to to show.
    expect(panel.find('.recovery-move').exists()).toBe(false)
    expect(panel.find('.recovery-step .step-name').text()).toContain('Hearing')
    expect(panel.find('.step-need').text()).toBe('1 correct answer')
  })

  it('says nothing at all for a word that is holding steady', async () => {
    track([...met('learning', LEARNING), ...met('mastery', MASTERY)], 3)
    const wrapper = mount(WordProgressModal, { props: { wordKey: 'w0' } })
    await flushPromises()
    expect(wrapper.find('.recovery').exists()).toBe(false)
  })

  it('offers to set aside, not to un-batch, a word that is in no batch', async () => {
    track([...met('learning', LEARNING)], 2)
    const wrapper = mount(WordProgressModal, { props: { wordKey: 'w0' } })
    await flushPromises()
    await wrapper.find('button.leave').trigger('click')
    expect(wrapper.find('.confirm-msg').text()).toContain('Set')
    expect(wrapper.find('.confirm-msg').text()).not.toContain('current batch')

    progress.state.learning = { name: 'animals', level: 'learning', words: ['w0'], size: 1 }
    const inBatch = mount(WordProgressModal, { props: { wordKey: 'w0' } })
    await flushPromises()
    await inBatch.find('button.leave').trigger('click')
    expect(inBatch.find('.confirm-msg').text()).toContain('current batch')
  })
})

describe('WordProgressModal — when the word comes back (the scheduler, #313)', () => {
  const DAY = 86400000
  const LEARNING = ['identification', 'usage', 'hearing', 'speaking']

  // The component reads the real clock, so these fixtures are anchored to it.
  const NOW = Date.now()
  const ev = (dimension, level, correct, ts) => ({ dimension, level, correct, ts })
  /** Every learning criterion met, on two calendar days. */
  const learned = (at) =>
    LEARNING.flatMap((d, i) => [
      ev(d, 'learning', true, at - DAY + i),
      ev(d, 'learning', true, at + i),
      ev(d, 'learning', true, at + i + 1),
    ])

  function track(rec) {
    vocabState.words = [
      { key: 'w0', headword: 'дом', meaning: 'house', pos: 'noun', hasInflections: true },
    ]
    progress.state.records.w0 = { word: 'w0', events: [], peak: 0, ...rec }
  }

  const open = async () => {
    const wrapper = mount(WordProgressModal, { props: { wordKey: 'w0' } })
    await flushPromises()
    return wrapper
  }

  it('shows no panel for a word the engine has never recorded', async () => {
    vocabState.words = [{ key: 'w0', headword: 'дом', meaning: 'house', pos: 'noun' }]
    const wrapper = await open()
    expect(wrapper.find('.review').exists()).toBe(false)
  })

  it('gives a row per scheduled skill, naming its interval and when it is next due', async () => {
    track({
      events: learned(NOW - 10 * DAY),
      peak: 2,
      learnedAt: NOW - 10 * DAY,
      confirmedAt: NOW - 9 * DAY,
      schedule: {
        // Resting: answered this morning on a four-day interval.
        identification: { stability: 4 * DAY, due: NOW + 4 * DAY, lastReview: NOW },
        // Overdue by two days on a two-day interval.
        usage: { stability: 2 * DAY, due: NOW - 2 * DAY, lastReview: NOW - 4 * DAY },
      },
    })
    const rows = (await open()).findAll('.review-dim')
    expect(rows).toHaveLength(2)
    // Most overdue leads — the order the due queue itself draws in.
    expect(rows[0].find('.dim-name').text()).toContain('Usage')
    expect(rows[0].find('.dim-name').text()).toContain('every 2 days')
    expect(rows[0].find('.dim-status').text()).toBe('2 days overdue')
    expect(rows[0].classes()).toContain('due')
    expect(rows[1].find('.dim-name').text()).toContain('Identification')
    expect(rows[1].find('.dim-status').text()).toBe('in 4 days')
    expect(rows[1].classes()).not.toContain('due')
  })

  it('says the clock has not started for a word with no schedule yet', async () => {
    // A record written before the scheduler existed: migrations normalise it to
    // an empty schedule, which fills in on the word's next answer.
    track({ events: learned(NOW - 30 * DAY), peak: 2, learnedAt: NOW - 30 * DAY, confirmedAt: NOW - 30 * DAY, schedule: {} })
    const wrapper = await open()
    expect(wrapper.find('.review').exists()).toBe(true)
    expect(wrapper.findAll('.review-dim')).toHaveLength(0)
    expect(wrapper.find('.review-note').text()).toContain('No reviews scheduled yet')
  })

  it('marks a word that finished its batch today as unconfirmed, with the date it can be settled', async () => {
    track({ events: learned(NOW - 3600000), peak: 2, learnedAt: NOW - 3600000, schedule: {} })
    const line = (await open()).find('.confirm-line')
    expect(line.classes()).toContain('wait')
    expect(line.find('.confirm-badge').text()).toBe('Unconfirmed')
    expect(line.find('.confirm-text').text()).toContain('proves working memory')
    expect(line.find('.confirm-text').text()).toContain('from')
  })

  it('marks the confirmation review as due once the word has slept on it', async () => {
    track({ events: learned(NOW - 3 * DAY), peak: 2, learnedAt: NOW - 3 * DAY, schedule: {} })
    const line = (await open()).find('.confirm-line')
    expect(line.find('.confirm-badge').text()).toBe('Review due')
  })

  it('reports a confirmed word, and a failed review, in their own words', async () => {
    track({ events: learned(NOW - 5 * DAY), peak: 2, learnedAt: NOW - 5 * DAY, confirmedAt: NOW - 4 * DAY, schedule: {} })
    let line = (await open()).find('.confirm-line')
    expect(line.classes()).toContain('good')
    expect(line.find('.confirm-badge').text()).toBe('Confirmed')

    track({ events: learned(NOW - 5 * DAY), peak: 2, learnedAt: NOW - 5 * DAY, confirmFailedAt: NOW - DAY, schedule: {} })
    line = (await open()).find('.confirm-line')
    expect(line.classes()).toContain('bad')
    expect(line.find('.confirm-badge').text()).toBe('Not retained')
    expect(line.find('.confirm-text').text()).toContain('back in the current batch')
  })

  it('says a word flagged known has the wait waived (#321)', async () => {
    track({ events: learned(NOW - 3 * DAY), peak: 2, learnedAt: NOW - 3 * DAY, known: true, schedule: {} })
    const line = (await open()).find('.confirm-line')
    expect(line.find('.confirm-badge').text()).toBe('Waived')
  })

  it('says nothing about confirmation for a word still being learned', async () => {
    track({ events: [ev('identification', 'learning', true, NOW)], peak: 1, schedule: {} })
    const wrapper = await open()
    expect(wrapper.find('.confirm-line').exists()).toBe(false)
  })
})

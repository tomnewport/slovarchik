import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import yaml from 'js-yaml'

vi.mock('../../lib/speech.js', () => ({
  speak: vi.fn(),
  speechSupported: () => true,
  SLOW_RATE: 0.7,
}))
vi.mock('../../stores/settings.js', () => ({
  settings: { factsExpanded: false },
}))

import { speak } from '../../lib/speech.js'
import IntroCard from './IntroCard.vue'
import { state as vocabState } from '../../stores/vocab.js'
import { state as progressState } from '../../stores/progress.js'
import { buildWords } from '../../lib/vocabBuild.js'

const fromYaml = (files) => buildWords(files.map(({ pos, text }) => ({ pos, doc: yaml.load(text) })))

const doc = `
words:
  "переводить=to translate":
    cefr_level: B1
    accented: переводи́ть
    aspect: impf
    en_gb:
      standard: to translate (from one language to another)
    usage:
      - { ru: Он перево́дит дли́нную и о́чень сло́жную кни́гу., en_gb: He is translating a long and very complicated book. }
      - { ru: Я перевожу́., en_gb: I am translating. }
    facts:
      - kind: build
        text: Literally to lead across.
        parts:
          - { ru: "пере-", en: "across" }
          - { ru: "вод", en: "lead" }
          - { ru: "-и́ть", en: "verb ending" }
`

const nouns = `
words:
  "стол=table":
    cefr_level: A1
    accented: стол
    gender: m
    animacy: i
    en_gb: { standard: table }
`

const exercise = {
  id: 'intro1',
  kind: 'intro',
  graded: false,
  dimension: 'usage',
  level: 'learning',
  practiceIndex: 0,
  targets: ['переводить=to translate'],
}

const mountFor = (key = 'переводить=to translate') =>
  mount(IntroCard, { props: { exercise: { ...exercise, targets: [key] } } })

beforeEach(() => {
  vi.clearAllMocks()
  vocabState.words = fromYaml([
    { pos: 'verb', text: doc },
    { pos: 'noun', text: nouns },
  ])
  vocabState.status = 'ready'
  progressState.records = {}
})

describe('IntroCard', () => {
  it('shows the headword and its meaning, with the disambiguating note', () => {
    const wrapper = mountFor()
    expect(wrapper.find('.ru').text()).toBe('переводи́ть')
    expect(wrapper.find('.meaning').text()).toContain('to translate')
    expect(wrapper.find('.meaning').text()).toContain('from one language to another')
  })

  it('reads the word aloud once as the card appears', () => {
    mountFor()
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak).toHaveBeenCalledWith('переводи́ть')
  })

  it('shows the part of speech and aspect — a verb pair needs both', () => {
    expect(mountFor().text()).toContain('verb · imperfective')
  })

  it('shows a noun’s gender instead', () => {
    const text = mountFor('стол=table').text()
    expect(text).toContain('masculine')
    expect(text).toContain('A1')
  })

  it('picks the shortest usage example — a first meeting is not the place for the longest', () => {
    const wrapper = mountFor()
    expect(wrapper.find('.ex-ru').text()).toContain('Я перевожу́.')
    expect(wrapper.find('.ex-en').text()).toBe('I am translating.')
  })

  it('offers no example block for a word with no usage', () => {
    expect(mountFor('стол=table').find('.example').exists()).toBe(false)
  })

  it('shows the facts panel expanded — this is the card that exists to tell them', () => {
    const wrapper = mountFor()
    // No disclosure to click: the breakdown is simply there.
    expect(wrapper.find('.facts-toggle').exists()).toBe(false)
    expect(wrapper.findAll('.morph').map((c) => c.find('.morph-ru').text())).toEqual([
      'пере-',
      'вод',
      '-и́ть',
    ])
  })

  it('continues to the exercise on Got it', async () => {
    const wrapper = mountFor()
    await wrapper.find('button.got-it').trigger('click')
    expect(wrapper.emitted('done')).toHaveLength(1)
    expect(wrapper.emitted('known')).toBeUndefined()
  })

  it('reports "I know this already" separately', async () => {
    const wrapper = mountFor()
    await wrapper.find('button.known').trigger('click')
    expect(wrapper.emitted('known')).toHaveLength(1)
    expect(wrapper.emitted('done')).toBeUndefined()
  })

  it('renders without crashing for a word that is not in the store', () => {
    const wrapper = mountFor('нет=nope')
    expect(wrapper.find('.got-it').exists()).toBe(true)
    expect(speak).not.toHaveBeenCalled()
  })
})

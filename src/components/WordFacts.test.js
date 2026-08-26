import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import yaml from 'js-yaml'

vi.mock('../lib/speech.js', () => ({
  speak: vi.fn(),
  speechSupported: () => true,
  SLOW_RATE: 0.7,
}))

import WordFacts from './WordFacts.vue'
import { state as vocabState } from '../stores/vocab.js'
import { state as progressState } from '../stores/progress.js'
import { settings } from '../stores/settings.js'
import { buildWords } from '../lib/vocabBuild.js'

const fromYaml = (files) => buildWords(files.map(({ pos, text }) => ({ pos, doc: yaml.load(text) })))

const verbs = `
words:
  "водить=to lead":
    cefr_level: B1
    accented: води́ть
    aspect: impf
    en_gb: { standard: to lead }
  "переводить=to translate":
    cefr_level: B1
    accented: переводи́ть
    aspect: impf
    pair: "перевести=to translate"
    en_gb: { standard: to translate }
    facts:
      - kind: memory
        text: A translator leads a sentence across a border.
      - kind: build
        text: Literally to lead across.
        parts:
          - { ru: "пере-", en: "across, over, re-" }
          - { ru: "вод", en: "lead" }
          - { ru: "-и́ть", en: "verb ending" }
      - kind: root
        text: Same root as водить.
        see: ["водить=to lead"]
  "перевести=to translate":
    cefr_level: B1
    accented: перевести́
    aspect: pf
    pair: "переводить=to translate"
    en_gb: { standard: to translate }
  "думать=to think":
    cefr_level: A1
    accented: ду́мать
    aspect: impf
    en_gb: { standard: to think }
`

const mountFor = (wordKey, props = {}) =>
  mount(WordFacts, { props: { wordKey, ...props } })

beforeEach(() => {
  vocabState.words = fromYaml([{ pos: 'verb', text: verbs }])
  vocabState.status = 'ready'
  progressState.records = {}
  settings.factsExpanded = true // render the body without clicking, in most tests
})

describe('WordFacts', () => {
  it('renders the morpheme chips in order, with their glosses', () => {
    const wrapper = mountFor('переводить=to translate')
    const chips = wrapper.findAll('.morph')
    expect(chips.map((c) => c.find('.morph-ru').text())).toEqual(['пере-', 'вод', '-и́ть'])
    expect(chips[0].find('.morph-en').text()).toBe('across, over, re-')
  })

  it('gives a screen reader the joined-up word, not a run of fragments', () => {
    const wrapper = mountFor('переводить=to translate')
    expect(wrapper.find('.chips').attributes('aria-label')).toContain('переводи́ть:')
  })

  it('orders the facts build → root → memory, whatever order they were written', () => {
    const wrapper = mountFor('переводить=to translate')
    const text = wrapper.text()
    expect(text.indexOf('Literally to lead across')).toBeLessThan(text.indexOf('Same root'))
    expect(text.indexOf('Same root')).toBeLessThan(text.indexOf('A translator leads'))
  })

  it('shows a derived aspect partner even with no authored data at all', () => {
    const wrapper = mountFor('перевести=to translate')
    expect(wrapper.find('.related').exists()).toBe(true)
    expect(wrapper.text()).toContain('переводи́ть')
    expect(wrapper.find('.relation').text()).toBe('imperfective partner')
  })

  it('renders nothing at all for a word with neither facts nor relations', () => {
    const wrapper = mountFor('думать=to think')
    expect(wrapper.find('.word-facts').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('opens a related word when its row is tapped', async () => {
    const wrapper = mountFor('перевести=to translate', { navigable: true })
    await wrapper.find('.word-rows .word-link').trigger('click')
    expect(wrapper.emitted('open-word')[0]).toEqual(['переводить=to translate'])
  })

  it("opens a fact's see link too", async () => {
    const wrapper = mountFor('переводить=to translate', { navigable: true })
    await wrapper.find('.see .word-link').trigger('click')
    expect(wrapper.emitted('open-word')[0]).toEqual(['водить=to lead'])
  })

  // Only a host with somewhere to go can honour `open-word`. Mid-drill there is
  // nowhere to navigate to, and a row that looks tappable but does nothing is
  // worse than a row that doesn't.
  it('renders rows as buttons only where the host can navigate', () => {
    const navigable = mountFor('перевести=to translate', { navigable: true })
    expect(navigable.find('.word-rows button.word-link').exists()).toBe(true)

    const plain = mountFor('перевести=to translate')
    expect(plain.find('.word-rows button.word-link').exists()).toBe(false)
    expect(plain.find('.word-rows span.word-link').exists()).toBe(true)
  })

  it('emits nothing when a non-navigable row is clicked', async () => {
    const wrapper = mountFor('перевести=to translate')
    await wrapper.find('.word-rows .word-link').trigger('click')
    expect(wrapper.emitted('open-word')).toBeUndefined()
  })

  it('leaves an unresolvable row unclickable even when navigable', () => {
    // A heteronym or same-gloss row carries only a spelling when the word map
    // can't resolve it; there is no key to open.
    const wrapper = mount(WordFacts, {
      props: { wordKey: 'перевести=to translate', navigable: true },
    })
    expect(wrapper.findAll('.word-rows .word-link').length).toBeGreaterThan(0)
  })

  it('marks a related word the learner has not met yet', () => {
    const wrapper = mountFor('перевести=to translate')
    expect(wrapper.find('.word-rows li').classes()).toContain('unmet')
  })

  it('drops the mark once the word has been met', () => {
    // A single attempt is enough to leave 'unknown' — the mark is about whether
    // the learner has met the word, not whether they have learned it.
    progressState.records = {
      'переводить=to translate': {
        word: 'переводить=to translate',
        events: [{ level: 'learning', dimension: 'identification', correct: true, ts: 1 }],
        peak: 1,
        learnedAt: null,
        masteredAt: null,
      },
    }
    const wrapper = mountFor('перевести=to translate')
    expect(wrapper.find('.word-rows li').classes()).not.toContain('unmet')
  })

  it('starts collapsed behind a disclosure by default', () => {
    settings.factsExpanded = false
    const wrapper = mountFor('переводить=to translate')
    expect(wrapper.find('.facts-toggle').exists()).toBe(true)
    expect(wrapper.find('.facts-body').exists()).toBe(false)
  })

  it('opens on the disclosure, and honours the auto-expand preference', async () => {
    settings.factsExpanded = false
    const wrapper = mountFor('переводить=to translate')
    await wrapper.find('.facts-toggle').trigger('click')
    expect(wrapper.find('.facts-body').exists()).toBe(true)

    settings.factsExpanded = true
    expect(mountFor('переводить=to translate').find('.facts-body').exists()).toBe(true)
  })

  it('has no disclosure at all when opened outright (the intro card)', () => {
    settings.factsExpanded = false
    const wrapper = mountFor('переводить=to translate', { open: true })
    expect(wrapper.find('.facts-toggle').exists()).toBe(false)
    expect(wrapper.find('.facts-body').exists()).toBe(true)
  })

  it('keeps easily-confused words in their own block, with the authored why', () => {
    vocabState.words = fromYaml([
      {
        pos: 'verb',
        text: `
words:
  "звенеть=to ring":
    cefr_level: B2
    accented: звене́ть
    en_gb:
      standard: to ring (of a bell)
  "звонить=to call":
    cefr_level: A2
    accented: звони́ть
    en_gb:
      standard: to call (to phone someone)
    confusable_with:
      - key: "звенеть=to ring"
        why: A bell does one and a person does the other.
`,
      },
    ])
    const wrapper = mountFor('звонить=to call')
    const block = wrapper.find('.confused')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('звене́ть')
    expect(block.find('.why').text()).toBe('A bell does one and a person does the other.')
    // Not duplicated into Related words.
    expect(wrapper.findAll('.related:not(.confused)')).toHaveLength(0)
  })
})

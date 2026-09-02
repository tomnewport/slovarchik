import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import yaml from 'js-yaml'

import ComprehensionCheck from './ComprehensionCheck.vue'
import { state as vocabState } from '../stores/vocab.js'
import { buildWords, shapeContextPhrases } from '../lib/vocabBuild.js'
import { indexPhrases } from '../lib/phraseContext.js'

const doc = `
words:
  "поблагодарить=to thank":
    cefr_level: A2
    accented: поблагодари́ть
    aspect: pf
    pair: "благодарить=to thank"
    en_gb: { standard: to thank }
    usage:
      - ru: Она́ поблагодари́ла учи́теля.
        en_gb: She thanked the teacher.
        inflect: { token: 2, tense: past, person: past_f, rule: verb-past }
  "благодарить=to thank":
    cefr_level: A2
    accented: благодари́ть
    aspect: impf
    pair: "поблагодарить=to thank"
    en_gb: { standard: to thank }
  "стол=table":
    cefr_level: A1
    gender: m
    animacy: i
    accented: стол
    en_gb: { standard: table }
    usage:
      - { ru: Стол большо́й., en_gb: The table is big. }
`

const phrase = { ru: 'Она́ поблагодари́ла учи́теля.', source: 'поблагодарить=to thank' }

beforeEach(() => {
  const words = buildWords([{ pos: 'verb', doc: yaml.load(doc) }])
  vocabState.words = words
  vocabState.contextPhrases = indexPhrases(shapeContextPhrases(words))
})

describe('ComprehensionCheck', () => {
  it('renders nothing for a sentence that hides nothing', () => {
    const w = mount(ComprehensionCheck, { props: { phrase: { ru: 'Стол большо́й.', source: 'стол=table' } } })
    expect(w.text()).toBe('')
    expect(w.find('.probe').exists()).toBe(false)
  })

  it('asks the question and marks the right reading once picked', async () => {
    const w = mount(ComprehensionCheck, { props: { phrase } })
    const options = w.findAll('button.option')
    expect(options).toHaveLength(2)
    // Nothing is given away before the learner commits.
    expect(w.find('.why').exists()).toBe(false)

    await options[1].trigger('click') // the perfective reading, which is right
    expect(w.text()).toContain('Yes')
    expect(w.find('.why').text()).toContain('благодари́ть')
    expect(w.emitted('answered')[0][0]).toEqual({ kind: 'aspect', correct: true })
  })

  // The translation was already graded and right, so a wrong pick costs nothing
  // — it reveals the reading and says so mildly.
  it('teaches rather than fails on a wrong pick', async () => {
    const w = mount(ComprehensionCheck, { props: { phrase } })
    await w.findAll('button.option')[0].trigger('click')
    expect(w.text()).toContain('Not quite')
    expect(w.emitted('answered')[0][0].correct).toBe(false)
    // The answer is still shown, whichever was picked.
    expect(w.findAll('button.option.answer')).toHaveLength(1)
    // And it cannot be re-answered into a different verdict.
    await w.findAll('button.option')[1].trigger('click')
    expect(w.emitted('answered')).toHaveLength(1)
  })

  it('resets when the drill moves to another sentence', async () => {
    const w = mount(ComprehensionCheck, { props: { phrase } })
    await w.findAll('button.option')[0].trigger('click')
    expect(w.find('.why').exists()).toBe(true)
    await w.setProps({ phrase: { ...phrase } })
    expect(w.find('.why').exists()).toBe(false)
  })
})

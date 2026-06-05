import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

import HintablePhrase from './HintablePhrase.vue'
import { state as vocabState } from '../stores/vocab.js'
import { state as progressState } from '../stores/progress.js'
import { loadFixtureWords } from '../test/fixtures.js'

beforeAll(() => {
  vocabState.words = loadFixtureWords()
  vocabState.status = 'ready'
})

afterEach(() => {
  progressState.records = {}
  progressState.learning = null
  progressState.mastery = null
})

describe('HintablePhrase', () => {
  it('makes an unlearned word tappable and reveals its meaning on click', async () => {
    const wrapper = mount(HintablePhrase, { props: { text: 'В э́том абза́це две оши́бки.' } })

    const button = wrapper.findAll('button.tap').find((b) => b.text().includes('абза́це'))
    expect(button).toBeTruthy()
    expect(wrapper.text()).not.toContain('paragraph') // hidden until tapped

    await button.trigger('click')
    expect(wrapper.text()).toContain('paragraph')

    await button.trigger('click') // tapping again hides it
    expect(wrapper.text()).not.toContain('paragraph')
  })

  it('shows the meaning inline (always) in inline mode', () => {
    const wrapper = mount(HintablePhrase, {
      props: { text: 'В э́том абза́це две оши́бки.', mode: 'inline' },
    })
    expect(wrapper.findAll('button.tap')).toHaveLength(0)
    expect(wrapper.text()).toContain('paragraph')
  })

  it('does not hint a word that is in the current batch', () => {
    progressState.learning = { level: 'learning', name: 'Test', words: ['абзац=paragraph'] }
    const wrapper = mount(HintablePhrase, { props: { text: 'В э́том абза́це две оши́бки.' } })
    const абзаце = wrapper.findAll('button.tap').find((b) => b.text().includes('абза́це'))
    expect(абзаце).toBeUndefined()
  })
})

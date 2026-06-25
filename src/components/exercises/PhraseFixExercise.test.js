import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import PhraseFixExercise from './PhraseFixExercise.vue'

const exercise = {
  kind: 'phrase-fix',
  tokens: ['Я', 'ду́маю', 'о', 'апре́ле'],
  targetIndex: 3,
  lemma: 'апрель',
  answerAccented: 'апре́ле',
  answer: 'апреле',
  slotLabel: 'Singular · Prepositional',
  en: "I'm thinking about April.",
  ru: 'Я ду́маю о апре́ле',
}

describe('PhraseFixExercise', () => {
  // Vue's template compiler strips a static whitespace-only `<span> </span>`,
  // which silently ran the words together (e.g. "Ядумаюоапреле"). The separator
  // must survive compilation, so assert on the rendered text directly.
  it('renders spaces between the phrase tokens', () => {
    const w = mount(PhraseFixExercise, { props: { exercise } })
    expect(w.find('.phrase-line').text()).toBe('Я ду́маю о апрель')
  })

  it('keeps the spacing once the answer is revealed', async () => {
    const w = mount(PhraseFixExercise, { props: { exercise } })
    await w.find('input').setValue('апреле')
    await w.find('form').trigger('submit')
    expect(w.find('.phrase-line').text()).toBe('Я ду́маю о апре́ле')
  })
})

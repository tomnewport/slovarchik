import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import AnnotatedEnglish from './AnnotatedEnglish.vue'

describe('AnnotatedEnglish', () => {
  it('renders the plain phrase when nothing is ambiguous', () => {
    const wrapper = mount(AnnotatedEnglish, { props: { text: 'Good morning!', notes: [] } })
    expect(wrapper.text()).toBe('Good morning!')
    expect(wrapper.find('.note').exists()).toBe(false)
  })

  it('marks the ambiguous word and notes what the Russian commits to', () => {
    const wrapper = mount(AnnotatedEnglish, {
      props: { text: 'Do you want tea?', notes: ['you-informal'] },
    })
    expect(wrapper.find('.ambiguous').text()).toBe('you')
    expect(wrapper.find('.note').text()).toBe('(informal)')
    expect(wrapper.text()).toBe('Do you (informal) want tea?')
  })

  it('annotates the speaker and the person addressed independently', () => {
    const wrapper = mount(AnnotatedEnglish, {
      props: { text: 'I told you.', notes: ['you-informal', 'speaker-f'] },
    })
    expect(wrapper.text()).toBe('I (female speaker) told you (informal).')
  })

  it('trails a note that has no English word to attach to', () => {
    const wrapper = mount(AnnotatedEnglish, {
      props: { text: 'Read the first paragraph.', notes: ['you-formal'] },
    })
    expect(wrapper.find('.ambiguous').exists()).toBe(false)
    expect(wrapper.text()).toBe('Read the first paragraph. (formal or plural “you”)')
  })
})

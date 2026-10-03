import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('../stores/reports.js', () => ({ submitReport: vi.fn(async () => ({ queued: false })) }))
globalThis.__APP_COMMIT_HASH__ = 'test'

import ReportButton from './ReportButton.vue'

describe('ReportButton', () => {
  it('thanks the learner once they report, until the next exercise', async () => {
    const wrapper = mount(ReportButton, { props: { exercise: { ru: 'дом', en: 'house' } } })
    expect(wrapper.find('.contribute-note').exists()).toBe(false)
    await wrapper.find('button.report-btn').trigger('click')
    await new Promise((r) => setTimeout(r))
    expect(wrapper.find('.contribute-note').text()).toContain('Thank you')

    await wrapper.setProps({ exercise: { ru: 'кот', en: 'cat' } })
    expect(wrapper.find('.contribute-note').exists()).toBe(false)
  })
})

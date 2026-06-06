import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

import ErrorToast from './ErrorToast.vue'
import { raiseError, dismissToast } from '../stores/errorToast.js'

afterEach(() => dismissToast())

describe('ErrorToast', () => {
  it('stays hidden until an error is raised', () => {
    const wrapper = mount(ErrorToast)
    expect(wrapper.find('.error-toast').exists()).toBe(false)
  })

  it('builds a report URL carrying the message, stack and build identifier', () => {
    raiseError(new Error('boom'))
    const wrapper = mount(ErrorToast)
    const href = wrapper.find('.toast-report').attributes('href')
    const body = new URL(href).searchParams.get('body')
    expect(decodeURIComponent(new URL(href).searchParams.get('title'))).toContain('boom')
    // The build identifier is what lets us tell a stale-PWA report from a live
    // regression — it must be present in every report (#190 follow-up).
    expect(body).toContain('**App version:**')
    expect(body).toContain('**Stack trace:**')
  })
})

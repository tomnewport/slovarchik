import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  state,
  initAppUpdate,
  applyUpdate,
  checkForUpdate,
  resetAppUpdate,
} from './appUpdate.js'

/**
 * A stand-in for `registerSW` from `virtual:pwa-register`: captures the
 * callbacks the store hands it, so a test can fire them the way workbox would.
 */
function fakeRegisterSW({ updateSW = vi.fn(async () => {}), registration = null } = {}) {
  const hooks = {}
  const register = vi.fn((options) => {
    hooks.needRefresh = options.onNeedRefresh
    hooks.immediate = options.immediate
    options.onRegisteredSW?.('/sw.js', registration ?? undefined)
    return updateSW
  })
  return { register, hooks, updateSW }
}

beforeEach(() => {
  resetAppUpdate()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  resetAppUpdate()
})

describe('appUpdate store', () => {
  it('registers immediately and reports no update until one arrives', () => {
    const { register, hooks } = fakeRegisterSW()
    initAppUpdate(register)

    expect(register).toHaveBeenCalledTimes(1)
    expect(hooks.immediate).toBe(true)
    expect(state.available).toBe(false)
  })

  it('flags an update instead of reloading when a new build is waiting', () => {
    const reload = vi.fn()
    const { register, hooks } = fakeRegisterSW()
    initAppUpdate(register, { reload })

    hooks.needRefresh()

    // The whole point of #691: noticing the new build does not take it.
    expect(state.available).toBe(true)
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(reload).not.toHaveBeenCalled()
  })

  it('takes the update only when asked, telling the worker to skip waiting', async () => {
    const reload = vi.fn()
    const { register, hooks, updateSW } = fakeRegisterSW()
    initAppUpdate(register, { reload })
    hooks.needRefresh()

    await applyUpdate()

    expect(updateSW).toHaveBeenCalledWith(true)
    expect(state.applying).toBe(true)
  })

  it('reloads anyway when the new worker never takes over', async () => {
    const reload = vi.fn()
    const { register, hooks } = fakeRegisterSW()
    initAppUpdate(register, { reload })
    hooks.needRefresh()

    await applyUpdate()
    expect(reload).not.toHaveBeenCalled()

    // The plugin's own `controlling` listener normally reloads us first. When
    // there turns out to be no waiting worker it never fires, and the button
    // must not simply be dead.
    vi.advanceTimersByTime(5_000)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('still lands on the new build when the skip-waiting message throws', async () => {
    const reload = vi.fn()
    const updateSW = vi.fn(async () => {
      throw new Error('no worker')
    })
    const { register, hooks } = fakeRegisterSW({ updateSW })
    initAppUpdate(register, { reload })
    hooks.needRefresh()

    await applyUpdate()
    vi.advanceTimersByTime(5_000)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('ignores a second press while the first is in flight', async () => {
    const reload = vi.fn()
    const { register, hooks, updateSW } = fakeRegisterSW()
    initAppUpdate(register, { reload })
    hooks.needRefresh()

    await applyUpdate()
    await applyUpdate()

    expect(updateSW).toHaveBeenCalledTimes(1)
  })

  it('finds a waiting worker on an explicit check, without the callback', async () => {
    const registration = { update: vi.fn(async () => {}), waiting: {} }
    const { register } = fakeRegisterSW({ registration })
    initAppUpdate(register)

    expect(await checkForUpdate()).toBe(true)
    expect(registration.update).toHaveBeenCalled()
    expect(state.available).toBe(true)
  })

  it('reports no update when the check finds nothing waiting', async () => {
    const registration = { update: vi.fn(async () => {}), waiting: null }
    const { register } = fakeRegisterSW({ registration })
    initAppUpdate(register)

    expect(await checkForUpdate()).toBe(false)
    expect(state.available).toBe(false)
  })

  it('survives a failed check (offline) without claiming an update', async () => {
    const registration = {
      update: vi.fn(async () => {
        throw new Error('offline')
      }),
      waiting: null,
    }
    const { register } = fakeRegisterSW({ registration })
    initAppUpdate(register)

    expect(await checkForUpdate()).toBe(false)
  })

  it('is a no-op check when no worker ever registered', async () => {
    expect(await checkForUpdate()).toBe(false)
  })
})

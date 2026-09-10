import { describe, it, expect, vi } from 'vitest'

import { coalesce } from './coalesce.js'

/** A promise plus its resolve/reject, so a test can hold a call open. */
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('coalesce', () => {
  it('runs the wrapped function once for concurrent calls', async () => {
    const gate = deferred()
    const fn = vi.fn(() => gate.promise)
    const guarded = coalesce(fn)

    const a = guarded()
    const b = guarded()
    const c = guarded()
    expect(fn).toHaveBeenCalledTimes(1)

    gate.resolve('value')
    expect(await Promise.all([a, b, c])).toEqual(['value', 'value', 'value'])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('hands every joined caller the same promise', () => {
    const guarded = coalesce(() => deferred().promise)
    expect(guarded()).toBe(guarded())
  })

  it('runs again once the previous call has settled', async () => {
    const fn = vi.fn(async () => 'v')
    const guarded = coalesce(fn)

    await guarded()
    await guarded()

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('passes through the arguments of the call that started the run', async () => {
    const fn = vi.fn(async (a, b) => a + b)
    const guarded = coalesce(fn)

    expect(await guarded(1, 2)).toBe(3)
    expect(fn).toHaveBeenCalledWith(1, 2)
  })

  it('rejects every joined caller and frees the slot for a retry', async () => {
    const gate = deferred()
    const fn = vi.fn(() => gate.promise)
    const guarded = coalesce(fn)

    const a = guarded()
    const b = guarded()
    gate.reject(new Error('boom'))

    await expect(a).rejects.toThrow('boom')
    await expect(b).rejects.toThrow('boom')

    // A failed boot must be retryable, not latched.
    fn.mockImplementation(async () => 'recovered')
    expect(await guarded()).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('turns a synchronous throw into a rejection rather than leaving the slot stuck', async () => {
    const fn = vi.fn(() => {
      throw new Error('sync boom')
    })
    const guarded = coalesce(fn)

    await expect(guarded()).rejects.toThrow('sync boom')

    fn.mockImplementation(async () => 'ok')
    expect(await guarded()).toBe('ok')
  })

  it('keeps separate wrappers independent', async () => {
    const one = vi.fn(async () => 1)
    const two = vi.fn(async () => 2)
    const a = coalesce(one)
    const b = coalesce(two)

    expect(await Promise.all([a(), b()])).toEqual([1, 2])
    expect(one).toHaveBeenCalledTimes(1)
    expect(two).toHaveBeenCalledTimes(1)
  })
})

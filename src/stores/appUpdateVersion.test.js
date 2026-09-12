import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import * as idb from '../lib/idb.js'
import {
  state,
  installed,
  deployedStatus,
  initAppUpdate,
  checkForUpdate,
  loadUpdateCheck,
  resetAppUpdate,
} from './appUpdate.js'

// The version half of the store: what the deployment says it is serving,
// and when it last said anything at all. Split from appUpdate.test.js because
// these need real timers and a real (faked) IndexedDB, and that file runs the
// service-worker half under `vi.useFakeTimers()`.

/** A `registerSW` stand-in, as in appUpdate.test.js. */
function fakeRegisterSW({ registration = null } = {}) {
  const hooks = {}
  const register = vi.fn((options) => {
    hooks.needRefresh = options.onNeedRefresh
    options.onRegisteredSW?.('/sw.js', registration ?? undefined)
    return vi.fn(async () => {})
  })
  return { register, hooks }
}

/** A `fetch` that answers the version request with `body`. */
function serving(body, { ok = true } = {}) {
  return vi.fn(async () => ({
    ok,
    json: async () => body,
  }))
}

const FUTURE = '2099-01-01T00:00:00.000Z'
const PAST = '2000-01-01T00:00:00.000Z'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  resetAppUpdate()
})

afterEach(() => {
  resetAppUpdate()
  vi.unstubAllGlobals()
})

describe('checking the deployed version', () => {
  it('records what the deployment is serving, and when it said so', async () => {
    vi.stubGlobal('fetch', serving({ commit: 'deadbee', released: FUTURE }))
    const before = Date.now()

    await checkForUpdate()

    expect(state.deployed).toEqual({ commit: 'deadbee', released: FUTURE })
    expect(state.lastCheckedAt).toBeGreaterThanOrEqual(before)
    expect(state.lastCheckFailed).toBe(false)
    expect(deployedStatus.value).toBe('newer')
  })

  it('asks for the deployed copy, not a cached one', async () => {
    // A cached answer would be the build doing the asking, so this check could
    // never report anything but "up to date".
    const fetchMock = serving({ commit: 'deadbee', released: FUTURE })
    vi.stubGlobal('fetch', fetchMock)

    await checkForUpdate()

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toMatch(/version\.json$/)
    expect(options).toMatchObject({ cache: 'no-store' })
  })

  it('calls the running build current when the deployment serves it', async () => {
    vi.stubGlobal('fetch', serving({ commit: installed.commit, released: PAST }))

    await checkForUpdate()

    expect(deployedStatus.value).toBe('current')
  })

  it('leaves the last good answer standing when the check cannot reach the network', async () => {
    vi.stubGlobal('fetch', serving({ commit: 'deadbee', released: FUTURE }))
    await checkForUpdate()
    const checkedAt = state.lastCheckedAt

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await checkForUpdate()

    // The point of the pair: the offline attempt is reported as a failure, and
    // the age on screen stays the age of the last real answer rather than
    // being refreshed by an attempt that learned nothing.
    expect(state.lastCheckFailed).toBe(true)
    expect(state.lastCheckedAt).toBe(checkedAt)
    expect(state.deployed).toEqual({ commit: 'deadbee', released: FUTURE })
  })

  it('counts a reply it cannot read as a check that happened, with nothing to compare', async () => {
    // A deploy older than version.json itself, or a host answering with HTML.
    vi.stubGlobal('fetch', serving('<!doctype html>', { ok: false }))

    await checkForUpdate()

    expect(state.lastCheckFailed).toBe(false)
    expect(state.lastCheckedAt).toBeTruthy()
    expect(state.deployed).toBeNull()
    expect(deployedStatus.value).toBe('unknown')
  })

  it('survives a body that is not JSON at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        },
      })),
    )

    await checkForUpdate()

    expect(state.deployed).toBeNull()
    expect(state.lastCheckFailed).toBe(false)
  })

  it('replaces a stale reading rather than date-stamping it with a fresh check', async () => {
    vi.stubGlobal('fetch', serving({ commit: 'deadbee', released: FUTURE }))
    await checkForUpdate()

    vi.stubGlobal('fetch', serving(null, { ok: false }))
    await checkForUpdate()

    expect(state.deployed).toBeNull()
  })

  it('still reports a waiting worker, and shares one run between concurrent callers', async () => {
    const registration = { update: vi.fn(async () => {}), waiting: {} }
    const fetchMock = serving({ commit: 'deadbee', released: FUTURE })
    vi.stubGlobal('fetch', fetchMock)
    initAppUpdate(fakeRegisterSW({ registration }).register)

    const [a, b] = await Promise.all([checkForUpdate(), checkForUpdate()])

    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(state.available).toBe(true)
    // Coalesced: the second caller joins the first run instead of being dropped.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('clears the checking flag even when the fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    await checkForUpdate()

    expect(state.checking).toBe(false)
  })
})

describe('remembering the last check', () => {
  it('restores the last answer so a reload does not report "never"', async () => {
    vi.stubGlobal('fetch', serving({ commit: 'deadbee', released: FUTURE }))
    await checkForUpdate()
    const checkedAt = state.lastCheckedAt

    resetAppUpdate() // as if the page had been reloaded
    expect(state.lastCheckedAt).toBeNull()
    await loadUpdateCheck()

    expect(state.lastCheckedAt).toBe(checkedAt)
    expect(state.deployed).toEqual({ commit: 'deadbee', released: FUTURE })
  })

  it('does not overwrite a check made this session', async () => {
    vi.stubGlobal('fetch', serving({ commit: 'older00', released: PAST }))
    await checkForUpdate()
    resetAppUpdate()

    vi.stubGlobal('fetch', serving({ commit: 'deadbee', released: FUTURE }))
    await checkForUpdate()
    await loadUpdateCheck()

    expect(state.deployed).toEqual({ commit: 'deadbee', released: FUTURE })
  })

  it('has nothing to restore before the first check', async () => {
    await loadUpdateCheck()

    expect(state.lastCheckedAt).toBeNull()
    expect(state.deployed).toBeNull()
    expect(deployedStatus.value).toBe('unknown')
  })

  it('ignores a stored record of the wrong shape', async () => {
    await idb.setMeta('updateCheck', 'not a record')
    await loadUpdateCheck()
    expect(state.lastCheckedAt).toBeNull()

    await idb.setMeta('updateCheck', { lastCheckedAt: 'yesterday', deployed: 'nope' })
    await loadUpdateCheck()
    expect(state.lastCheckedAt).toBeNull()
    expect(state.deployed).toBeNull()
  })

  it('carries on when storage is unavailable', async () => {
    // Private mode, a blocked origin: the check still stands for this session.
    globalThis.indexedDB = undefined
    vi.stubGlobal('fetch', serving({ commit: 'deadbee', released: FUTURE }))

    await expect(checkForUpdate()).resolves.toBe(false)
    expect(state.deployed).toEqual({ commit: 'deadbee', released: FUTURE })
    await expect(loadUpdateCheck()).resolves.toBeUndefined()
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { pwaState, initPwa, checkForUpdate, _resetForTests } from './pwa.js'

// A fake ServiceWorkerRegistration whose listeners we can fire by hand.
function fakeRegistration(extra = {}) {
  const listeners = {}
  return {
    waiting: null,
    installing: null,
    update: vi.fn(async () => {}),
    addEventListener: (type, cb) => {
      listeners[type] = cb
    },
    emit: (type) => listeners[type]?.(),
    ...extra,
  }
}

function stubServiceWorker(reg, { controller = {} } = {}) {
  globalThis.navigator.serviceWorker = {
    controller,
    getRegistration: async () => reg,
    ready: Promise.resolve(reg),
    addEventListener: () => {},
  }
}

beforeEach(() => {
  _resetForTests()
  localStorage.clear()
})

afterEach(() => {
  delete globalThis.navigator.serviceWorker
})

describe('pwa store', () => {
  it('reports unsupported when the browser has no service worker', async () => {
    await initPwa()
    expect(pwaState.supported).toBe(false)
    expect(pwaState.ready).toBe(false)
  })

  it('marks the app offline-ready once a worker controls the page', async () => {
    stubServiceWorker(fakeRegistration())
    await initPwa()
    expect(pwaState.supported).toBe(true)
    expect(pwaState.ready).toBe(true)
    expect(pwaState.offlineReady).toBe(true)
  })

  it('flags an update when a new worker installs behind an existing controller', async () => {
    const sw = { state: 'installing', addEventListener: vi.fn() }
    const reg = fakeRegistration({ installing: sw })
    stubServiceWorker(reg)
    await initPwa()
    // The store wired a statechange listener on the installing worker.
    const onState = sw.addEventListener.mock.calls.find((c) => c[0] === 'statechange')?.[1]
    expect(onState).toBeTypeOf('function')
    sw.state = 'installed'
    onState()
    expect(pwaState.updateAvailable).toBe(true)
  })

  it('check for updates calls update() and stamps a persisted timestamp', async () => {
    const reg = fakeRegistration()
    stubServiceWorker(reg)
    await initPwa()
    expect(pwaState.lastChecked).toBeNull()
    await checkForUpdate()
    expect(reg.update).toHaveBeenCalledOnce()
    expect(pwaState.lastChecked).toBeTypeOf('number')
    expect(Number(localStorage.getItem('pwa:lastChecked'))).toBe(pwaState.lastChecked)
  })

  it('restores the last-checked timestamp from storage on init', async () => {
    localStorage.setItem('pwa:lastChecked', '1700000000000')
    await initPwa()
    expect(pwaState.lastChecked).toBe(1700000000000)
  })
})

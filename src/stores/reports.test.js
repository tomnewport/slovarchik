import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import * as idb from '../lib/idb.js'
import { state, loadReports, queueReport, removeReport } from './reports.js'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
  state.pending = []
  state.loaded = false
})

describe('reports store', () => {
  it('loads an empty queue from a fresh database', async () => {
    await loadReports()
    expect(state.pending).toEqual([])
    expect(state.loaded).toBe(true)
  })

  it('queues a report and reflects it in state', async () => {
    await queueReport({ ru: 'кот', en: 'cat', url: 'https://example.com' })
    expect(state.pending).toHaveLength(1)
    expect(state.pending[0].ru).toBe('кот')
  })

  it('uses a UUID (string) as the id, not a timestamp integer', async () => {
    await queueReport({ ru: 'кот', url: 'https://example.com' })
    expect(typeof state.pending[0].id).toBe('string')
  })

  it('persists reports to IndexedDB so they survive loadReports', async () => {
    await queueReport({ ru: 'кот', en: 'cat', url: 'https://example.com' })
    state.pending = []
    state.loaded = false
    await loadReports()
    expect(state.pending).toHaveLength(1)
    expect(state.pending[0].ru).toBe('кот')
  })

  it('removes a report from state and IndexedDB', async () => {
    await queueReport({ ru: 'кот', url: 'https://example.com' })
    const id = state.pending[0].id
    await removeReport(id)
    expect(state.pending).toHaveLength(0)
    // Confirm removal from IDB too
    state.loaded = false
    await loadReports()
    expect(state.pending).toHaveLength(0)
  })

  it('can queue multiple reports and remove one selectively', async () => {
    await queueReport({ ru: 'кот', url: 'https://a.com' })
    await queueReport({ ru: 'пёс', url: 'https://b.com' })
    const firstId = state.pending[0].id
    await removeReport(firstId)
    expect(state.pending).toHaveLength(1)
    expect(state.pending[0].ru).toBe('пёс')
  })
})

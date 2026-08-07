// The invariant these cover: every `idb` write unwraps Vue's proxies itself
// (#534), so a store can hand over reactive state without a defensive clone.
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { reactive } from 'vue'

import * as idb from './idb.js'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  idb._resetForTests()
})

describe('idb writes accept reactive state', () => {
  it('stores a reactive progress record with nested reactive maps', async () => {
    const state = reactive({
      records: { дом: { word: 'дом', events: [{ dim: 'spell', ok: true }], schedule: { due: 42 } } },
    })
    await idb.putProgress(state.records['дом'])
    const [stored] = await idb.getAllProgress()
    expect(stored).toEqual({
      word: 'дом',
      events: [{ dim: 'spell', ok: true }],
      schedule: { due: 42 },
    })
  })

  it('stores a meta value assembled from reactive reads', async () => {
    const state = reactive({ learning: { level: 'learning', words: ['дом', 'кот'] } })
    await idb.setMeta('batch:learning', { batch: state.learning })
    expect(await idb.getMeta('batch:learning')).toEqual({
      batch: { level: 'learning', words: ['дом', 'кот'] },
    })
  })

  it('detaches the stored copy from later mutations of the source', async () => {
    const state = reactive({ activity: { '2026-08-07': { count: 1 } } })
    await idb.setMeta('streak:activity', state.activity)
    state.activity['2026-08-07'].count = 99
    expect(await idb.getMeta('streak:activity')).toEqual({ '2026-08-07': { count: 1 } })
  })

  it('stores a reactive file record', async () => {
    const state = reactive({ doc: { words: { дом: { en: 'house' } } } })
    await idb.putFile({ file: 'nouns.json', pos: 'noun', doc: state.doc })
    const [stored] = await idb.getAllFiles()
    expect(stored.doc).toEqual({ words: { дом: { en: 'house' } } })
  })

  it('stores a reactive report record', async () => {
    const state = reactive({ report: { id: 'r1', context: { word: 'дом' } } })
    await idb.putReport(state.report)
    expect(await idb.getAllReports()).toEqual([{ id: 'r1', context: { word: 'дом' } }])
  })
})

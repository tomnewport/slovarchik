// Reactive store for pending (offline-queued) issue reports.
import { reactive } from 'vue'
import * as idb from '../lib/idb.js'

export const state = reactive({
  pending: [],
  loaded: false,
})

export async function loadReports() {
  state.pending = await idb.getAllReports()
  state.loaded = true
}

export async function queueReport(reportData) {
  const record = { id: crypto.randomUUID(), ...reportData, queuedAt: Date.now() }
  await idb.putReport(record)
  state.pending = [...state.pending, record]
  return record
}

export async function removeReport(id) {
  await idb.deleteReport(id)
  state.pending = state.pending.filter((r) => r.id !== id)
}

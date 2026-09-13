// Reactive store for pending (offline-queued) issue reports.
import { reactive } from 'vue'
import * as idb from '../lib/idb.js'
import { buildIssueUrl } from '../lib/reportIssue.js'
import { coalesce } from '../lib/coalesce.js'

export const state = reactive({
  pending: [],
  loaded: false,
})

/** Load the offline-queued reports. Coalesced (#659) — HomeView's `onMounted`
 * can fire while an earlier mount's load is still in flight. */
async function doLoadReports() {
  state.pending = await idb.getAllReports()
  state.loaded = true
}

export const loadReports = coalesce(doLoadReports)

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

/**
 * Open a pre-filled GitHub issue for the given exercise context. When offline,
 * the report is queued in IndexedDB to submit later instead.
 * @param {PlainObject} ctx  context for {@link buildIssueUrl}
 * @returns {Promise<{queued: boolean}>}  whether it was queued for later
 */
export async function submitReport(ctx) {
  const url = buildIssueUrl(ctx)
  if (navigator.onLine) {
    window.open(url, '_blank', 'noopener')
    return { queued: false }
  }
  await queueReport({ ...ctx, url })
  return { queued: true }
}

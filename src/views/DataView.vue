<script setup>
// Data screen: JSON backup (export / validated import), a reminder that data
// lives only in this browser, how long the app has been in use, and the
// release date of the running code plus when the dictionaries were last
// updated (with actions to fetch the latest).
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import * as progress from '../stores/progress.js'
import { getAllFiles } from '../lib/idb.js'
import { syncFromNetwork } from '../stores/vocab.js'
import {
  settings,
  loadSettings,
  setSuccessSound,
  setErrorSound,
  OFF,
} from '../stores/settings.js'
import { SUCCESS_SOUNDS, NEUTRAL_SOUNDS, playSound, audioSupported } from '../lib/feedbackSound.js'

const soundsSupported = audioSupported()

// Picking a sound previews it (unless turning it off) and saves the choice.
function chooseSuccess(id) {
  setSuccessSound(id)
  if (id !== OFF) playSound('success', id)
}
function chooseError(id) {
  setErrorSound(id)
  if (id !== OFF) playSound('neutral', id)
}

const APP_BUILD = typeof __APP_BUILD_DATE__ === 'string' ? __APP_BUILD_DATE__ : null

const router = useRouter()
const files = ref([])
const importText = ref('')
const importStatus = ref(null) // { ok, message }
const updating = ref(false)
const updateStatus = ref(null)
const resetConfirm = ref(false)

const exportText = computed(() => JSON.stringify(progress.exportData(), null, 2))
const downloadHref = computed(
  () => 'data:application/json;charset=utf-8,' + encodeURIComponent(exportText.value),
)

const daysUsing = computed(() => {
  const since = progress.state.firstUseAt
  if (!since) return 0
  return Math.max(1, Math.ceil((Date.now() - since) / 86_400_000))
})

function fmtDate(value) {
  if (!value) return 'unknown'
  const d = typeof value === 'number' ? new Date(value) : new Date(String(value))
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toLocaleDateString()
}

async function loadFiles() {
  files.value = (await getAllFiles())
    .map((f) => ({ file: f.file, updated: f.updated }))
    .sort((a, b) => a.file.localeCompare(b.file))
}

async function copyExport() {
  try {
    await navigator.clipboard?.writeText(exportText.value)
  } catch {
    /* clipboard may be unavailable; the textarea is still selectable */
  }
}

async function doImport() {
  let data
  try {
    data = JSON.parse(importText.value)
  } catch {
    importStatus.value = { ok: false, message: 'That is not valid JSON.' }
    return
  }
  try {
    await progress.importData(data)
    importStatus.value = { ok: true, message: 'Imported — your progress has been restored.' }
  } catch (err) {
    importStatus.value = { ok: false, message: err.message }
  }
}

async function updateDictionaries() {
  updating.value = true
  updateStatus.value = null
  try {
    const changed = await syncFromNetwork()
    await loadFiles()
    updateStatus.value = changed ? 'Dictionaries updated.' : 'Already up to date.'
  } catch {
    updateStatus.value = 'Could not reach the network.'
  } finally {
    updating.value = false
  }
}

function reloadApp() {
  window.location.reload()
}

async function doReset() {
  await progress.resetProgress()
  router.push('/')
}

onMounted(async () => {
  if (!progress.state.loaded) await progress.loadProgress()
  await loadSettings()
  await loadFiles()
})
</script>

<template>
  <section class="grid" style="gap: 1.25rem">
    <h1>Your data</h1>

    <div class="card warn">
      <p>
        Everything you do stays in <strong>this browser</strong> — there's no
        account and no server. If you clear your browser data or lose this
        device, your progress <strong>cannot be recovered</strong>. Export a
        backup to keep it safe.
      </p>
      <p class="muted" v-if="daysUsing">You've been learning here for {{ daysUsing }} day{{ daysUsing === 1 ? '' : 's' }}.</p>
    </div>

    <!-- Feedback sounds -->
    <div class="card">
      <h2>Feedback sounds</h2>
      <p class="muted">
        A short sound plays when you finish an exercise — a bright one when it's
        all correct, a softer one when you slipped. Tap an option to preview it.
      </p>
      <p v-if="!soundsSupported" class="muted">
        This browser can't play these sounds.
      </p>
      <template v-else>
        <div class="sound-group">
          <span class="sound-label">Correct</span>
          <div class="chips">
            <button
              v-for="s in SUCCESS_SOUNDS"
              :key="s.id"
              type="button"
              class="chip"
              :class="{ on: settings.successSound === s.id }"
              @click="chooseSuccess(s.id)"
            >
              {{ s.label }}
            </button>
            <button
              type="button"
              class="chip off"
              :class="{ on: settings.successSound === OFF }"
              @click="chooseSuccess(OFF)"
            >
              Off
            </button>
          </div>
        </div>

        <div class="sound-group">
          <span class="sound-label">With mistakes</span>
          <div class="chips">
            <button
              v-for="s in NEUTRAL_SOUNDS"
              :key="s.id"
              type="button"
              class="chip"
              :class="{ on: settings.errorSound === s.id }"
              @click="chooseError(s.id)"
            >
              {{ s.label }}
            </button>
            <button
              type="button"
              class="chip off"
              :class="{ on: settings.errorSound === OFF }"
              @click="chooseError(OFF)"
            >
              Off
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- Export -->
    <div class="card">
      <h2>Export</h2>
      <textarea class="json" readonly :value="exportText" rows="6" aria-label="Backup JSON" />
      <div class="row">
        <button class="primary copy" @click="copyExport">Copy</button>
        <a class="download" :href="downloadHref" download="slovarchik-backup.json">Download .json</a>
      </div>
    </div>

    <!-- Import -->
    <div class="card">
      <h2>Import</h2>
      <p class="muted">Paste a backup to restore it. This replaces your current progress.</p>
      <textarea v-model="importText" class="json" rows="6" placeholder="Paste backup JSON…" aria-label="Import JSON" />
      <div class="row">
        <button class="primary do-import" :disabled="!importText.trim()" @click="doImport">Import</button>
        <span v-if="importStatus" class="status" :class="importStatus.ok ? 'ok' : 'no'">
          {{ importStatus.message }}
        </span>
      </div>
    </div>

    <!-- Reset -->
    <div class="card">
      <h2>Reset</h2>
      <p class="muted">Permanently delete all your progress and start over from scratch. This cannot be undone.</p>
      <div class="row">
        <template v-if="!resetConfirm">
          <button class="reset-btn" @click="resetConfirm = true">Reset all progress</button>
        </template>
        <template v-else>
          <button class="reset-confirm" @click="doReset">Yes, delete everything</button>
          <button class="reset-cancel" @click="resetConfirm = false">Cancel</button>
        </template>
      </div>
    </div>

    <!-- Versions -->
    <div class="card">
      <h2>Versions</h2>
      <p>App code released: <strong>{{ fmtDate(APP_BUILD) }}</strong></p>
      <ul class="dicts">
        <li v-for="f in files" :key="f.file">
          {{ f.file }} — updated {{ fmtDate(f.updated) }}
        </li>
        <li v-if="!files.length" class="muted">No dictionaries cached yet.</li>
      </ul>
      <div class="row">
        <button class="update-dicts" :disabled="updating" @click="updateDictionaries">
          {{ updating ? 'Checking…' : 'Update dictionaries' }}
        </button>
        <button class="update-app" @click="reloadApp">Reload for latest app</button>
        <span v-if="updateStatus" class="status muted">{{ updateStatus }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.warn strong {
  color: var(--text);
}
.json {
  width: 100%;
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
  background: var(--bg-soft);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem;
  resize: vertical;
}
.download {
  display: inline-flex;
  align-items: center;
  padding: 0.6rem 1rem;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
  text-decoration: none;
}
.status.ok {
  color: var(--good);
}
.status.no {
  color: var(--bad);
}
.dicts {
  margin: 0.5rem 0;
  padding-left: 1.2rem;
}
.sound-group {
  margin-top: 0.75rem;
}
.sound-label {
  display: block;
  font-size: 0.85rem;
  color: var(--muted);
  margin-bottom: 0.4rem;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.chip {
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text);
  font-size: 0.9rem;
}
.chip.on {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 20%, var(--card));
}
.chip.off.on {
  border-color: var(--muted);
  background: color-mix(in srgb, var(--muted) 20%, var(--card));
}
.reset-btn,
.reset-confirm {
  background: var(--bad);
  color: #fff;
  border: none;
}
.reset-btn:hover,
.reset-confirm:hover {
  opacity: 0.85;
}
</style>

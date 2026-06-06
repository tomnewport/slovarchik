import { reactive } from 'vue'

export const errorToastState = reactive({ error: null })

export function raiseError(err) {
  errorToastState.error = err instanceof Error ? err : new Error(String(err ?? 'Unknown error'))
}

export function dismissToast() {
  errorToastState.error = null
}

// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-task-completion-notify.test.ts

import { randomUUID } from 'node:crypto'
import { processPendingVoiceTaskCompletionNotifies } from '../services/voice-task-completion-notify.js'

const POLL_INTERVAL_MS = 5_000

let timer: ReturnType<typeof setInterval> | null = null
let activeRun: Promise<unknown> | null = null
const workerId = `voice-completion-${randomUUID()}`

function kick(): void {
  if (activeRun) return
  activeRun = processPendingVoiceTaskCompletionNotifies({ workerId })
    .catch((error) => console.error('[voice-task-completion-notify] drain failed', error))
    .finally(() => { activeRun = null })
}

export function startVoiceTaskCompletionNotifyJob(): void {
  if (timer) return
  timer = setInterval(kick, POLL_INTERVAL_MS)
  timer.unref?.()
  kick()
}

export async function stopVoiceTaskCompletionNotifyJob(): Promise<void> {
  if (timer) clearInterval(timer)
  timer = null
  await activeRun
}

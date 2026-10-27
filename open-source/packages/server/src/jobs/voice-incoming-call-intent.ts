// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-incoming-call-intent.test.ts

import { randomUUID } from 'node:crypto'
import { processPendingVoiceIncomingCallIntents } from '../services/voice-incoming-call-intent.js'

const POLL_INTERVAL_MS = 2_000
const workerId = `voice-call-${randomUUID()}`
let timer: ReturnType<typeof setInterval> | null = null
let activeRun: Promise<unknown> | null = null

function kick(): void {
  if (activeRun) return
  activeRun = processPendingVoiceIncomingCallIntents({ workerId })
    .catch((error) => console.error('[voice-incoming-call-intent] drain failed', error))
    .finally(() => { activeRun = null })
}

export function startVoiceIncomingCallIntentJob(): void {
  if (timer) return
  timer = setInterval(kick, POLL_INTERVAL_MS)
  timer.unref?.()
  kick()
}

export async function stopVoiceIncomingCallIntentJob(): Promise<void> {
  if (timer) clearInterval(timer)
  timer = null
  await activeRun
}

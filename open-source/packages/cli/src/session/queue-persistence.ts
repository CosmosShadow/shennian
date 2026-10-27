// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-chat-queue-1.test.ts
import { readQueue, writeQueue } from './queue-storage.js'
import type { LocalQueuedChatMessage } from './queue-message.js'
import { nowIso } from './queue-message.js'

export function removeQueuedBatch(sessionId: string, batch: LocalQueuedChatMessage[]): number {
  if (batch.length === 0) return readQueue().sessions[sessionId]?.length ?? 0
  const latest = readQueue()
  const dispatchedIds = new Set(batch.map((message) => message.id))
  const remaining = (latest.sessions[sessionId] ?? []).filter(
    (message) => !dispatchedIds.has(message.id),
  )
  if (remaining.length) latest.sessions[sessionId] = remaining
  else delete latest.sessions[sessionId]
  writeQueue(latest)
  return remaining.length
}

export function logQueueLifecycle(
  event: string,
  sessionId: string,
  fields: Record<string, unknown>,
  level: 'info' | 'error' = 'info',
): void {
  const message = `[chat.queue] ${JSON.stringify({ at: nowIso(), event, sessionId, ...fields })}`
  if (level === 'error') console.error(message)
  else console.info(message)
}


export function markExternalQueued(batch: LocalQueuedChatMessage[], queuedSubmissionId?: string): void {
  const queue = readQueue()
  const ids = new Set(batch.map((message) => message.id))
  const pending = queue.sessions[batch[0]!.sessionId] ?? []
  let changed = false
  for (const message of pending) {
    if (!ids.has(message.id)) continue
    message.externalQueuedSubmissionId = queuedSubmissionId || message.id
    message.updatedAt = nowIso()
    changed = true
  }
  if (changed) writeQueue(queue)
}

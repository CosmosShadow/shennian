// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/queue-diagnostics.test.ts
import { diagnoseWorkDir, queueRecoveryGuidance } from './queue-dispatch-failure.js'
import type { QueueFile } from './queue-storage.js'

export type QueueDeliveryState = 'waiting' | 'retrying' | 'blocked' | 'handed_to_codex_desktop'

export type QueueDiagnosticItem = {
  messageId: string
  ageSeconds: number
  delivery: QueueDeliveryState
  agentType: string
  modelId: string | null
  workDir: string
  /** `ok`, or why the bound directory cannot be used. */
  workDirStatus: 'ok' | 'not_found' | 'not_directory' | 'unavailable'
  origin: string
  block?: { code: string; attempts?: number; retryInSeconds?: number; whatToDo?: string }
}

/**
 * Read-only view of what is waiting to be delivered and why, for the owner's own AI.
 * Never includes message text, attachments or credentials.
 */
export function buildQueueDiagnostics(
  queue: QueueFile,
  now = Date.now(),
  inspectWorkDir: (workDir: string | undefined) => string | null = diagnoseWorkDir,
) {
  const sessions = Object.entries(queue.sessions).flatMap(([sessionId, messages]) => {
    if (!messages.length) return []
    const pending: QueueDiagnosticItem[] = messages.map((message) => {
      const problem = inspectWorkDir(message.workDir)
      const block = message.dispatchBlock
      const waiting = Boolean(block && block.retryAt > now)
      const delivery: QueueDeliveryState = message.externalQueuedSubmissionId
        ? 'handed_to_codex_desktop'
        : waiting ? 'blocked' : block ? 'retrying' : 'waiting'
      return {
        messageId: message.id,
        ageSeconds: Math.max(0, Math.round((now - Date.parse(message.createdAt)) / 1000)),
        delivery,
        agentType: message.agentType,
        modelId: message.modelId ?? null,
        workDir: message.workDir,
        workDirStatus: problem ? (problem.replace('agent_workdir_', '') as QueueDiagnosticItem['workDirStatus']) : 'ok',
        origin: message.trigger?.kind ?? 'personal',
        ...(block ? {
          block: {
            code: block.code,
            ...(block.attempts ? { attempts: block.attempts } : {}),
            ...(waiting ? { retryInSeconds: Math.ceil((block.retryAt - now) / 1000) } : {}),
            ...(queueRecoveryGuidance(block.code, { workDir: message.workDir }) ? {
              whatToDo: queueRecoveryGuidance(block.code, { workDir: message.workDir }),
            } : {}),
          },
        } : {}),
      }
    })
    return [{ sessionId, pending }]
  })
  return { pendingCount: sessions.reduce((total, entry) => total + entry.pending.length, 0), sessions }
}

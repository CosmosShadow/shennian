// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/project-coordination-runtime.test.ts
import fs from 'node:fs'
import { isInternalSession } from '@shennian/wire'
import { listSessionRecords } from '../session/store.js'
import type { SessionManagerRuntime } from '../session/types.js'
import { readQueue } from '../session/queue-storage.js'
import { projectCoordinationStore as store, type CoordinationTask } from './store.js'

/** Already enabled projects adopt once on their first read/admission after upgrading. */
export function ensureProjectAdoption(runtime: SessionManagerRuntime, workDir: string) {
  const state = store.read(workDir)
  if (state.enabled && state.adoptionVersion !== 1) {
    return store.configure(workDir, { enabled: true }, existingProjectTasks(runtime, store.directory(workDir).canonical))
  }
  return state
}

/** Snapshot existing work synchronously; adoption never dispatches, stops, or replays a turn. */
export function existingProjectTasks(runtime: SessionManagerRuntime, workDir: string): CoordinationTask[] {
  const tasks: CoordinationTask[] = []
  const queue = readQueue()
  const external = runtime.nativeFusion?.getActiveRuns?.() ?? []
  for (const record of listSessionRecords()) {
    if (record.deletedAt || isInternalSession({ ...record, id: record.sessionId })) continue
    try { if (fs.realpathSync(runtime.resolvePath(record.workDir)) !== workDir) continue } catch { continue }
    const active = runtime.sessions.get(record.sessionId)
    if (active?.managedRoomContextToken) continue
    const pending = (queue.sessions[record.sessionId] ?? [])
      .filter(message => !message.managedRoom && !message.managedAgentDirect)
    const observed = external.find(run => run.sessionId === record.sessionId)
    const live = Boolean(active?.currentRunId || observed || runtime.chatQueue?.isDispatching?.(record.sessionId))
    const phase = active?.currentRunPhase
    const waiting = live && (phase === 'waiting_approval' || phase === 'waiting_user_input')
    const timestamp = (value?: string | null) => Number.isFinite(Date.parse(value ?? '')) ? Date.parse(value!) : Date.now()
    tasks.push({
      id: record.sessionId, title: record.title || pending[0]?.text.trim().split('\n')[0]?.slice(0, 100) || record.sessionId,
      agentType: record.agentType, priority: 0,
      access: record.agentType === 'codex' && record.codexSettings?.sandbox === 'read-only' && record.codexSettings.approvalPolicy === 'never' ? 'read' : 'write',
      status: live ? waiting ? 'waiting' : 'running' : pending.length ? 'queued'
        : record.status === 'completed' ? 'completed' : record.status === 'failed' ? 'failed' : 'memo',
      ...(waiting ? { waitingReason: phase! } : {}),
      ...(live ? { admittedRequestId: `adopted:${active?.currentRunId || observed?.runId || `dispatching:${record.sessionId}`}` } : {}),
      requestIds: pending.map(message => message.clientMessageId ?? message.id),
      createdAt: timestamp(record.createdAt), updatedAt: timestamp(record.lastActivityAt),
      ...(pending.length ? { queuedAt: timestamp(pending[0]!.createdAt) } : {}),
      ...(!live && !pending.length && record.lastMessagePreview ? { result: record.lastMessagePreview.slice(0, 4000) } : {}),
    })
  }
  return tasks
}

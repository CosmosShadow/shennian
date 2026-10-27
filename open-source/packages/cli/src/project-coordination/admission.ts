// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/project-coordination-runtime.test.ts
import type { SessionManagerRuntime } from '../session/types.js'
import type { LocalQueuedChatMessage } from '../session/queue-message.js'
import { projectCoordinationStore as store } from './store.js'
import { listSessionRecords } from '../session/store.js'
import { ensureProjectAdoption } from './adopt.js'
export class CoordinationWaiting extends Error { constructor() { super('coordination_waiting'); this.name = 'CoordinationWaiting' } }
export function validateCoordinationSession(runtime: SessionManagerRuntime, input: { workDir?: string; sessionId?: string; sessionMode?: string; managedRoom?: unknown; managedAgentDirect?: unknown }) {
  if (!input.workDir || input.managedRoom || input.managedAgentDirect) return
  const mode = input.sessionMode ?? listSessionRecords().find(r => r.sessionId === input.sessionId)?.sessionMode
  if (mode === 'manager' && store.enabled(runtime.resolvePath(input.workDir))) throw new Error('coordination_legacy_manager_unsupported')
}
export function admitProjectTurn(runtime: SessionManagerRuntime, batch: LocalQueuedChatMessage[], pendingTaskIds?: string[]) {
  const first = batch[0]!
  if (first.managedRoom || first.managedAgentDirect || first.trigger?.kind === 'room_activation') return
  const workDir = runtime.resolvePath(first.workDir)
  if (!store.enabled(workDir)) return
  ensureProjectAdoption(runtime, workDir)
  validateCoordinationSession(runtime, first)
  for (const m of batch) {
    const record = listSessionRecords().find(r => r.sessionId === m.sessionId)
    // An on-request approval can grant a write even in a read-only sandbox.
    const readOnly = m.agentType === 'codex' && record?.codexSettings?.sandbox === 'read-only'
      && record.codexSettings.approvalPolicy === 'never'
    store.enqueue(workDir, m.sessionId, m.text, m.agentType, m.clientMessageId ?? m.id, readOnly ? 'read' : 'write')
  }
  if (!store.admit(workDir, first.sessionId, first.clientMessageId ?? first.id, pendingTaskIds)) throw new CoordinationWaiting()
}

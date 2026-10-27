// @arch docs/architecture/app/chat-draft-storage.md
// @test src/__tests__/local-session-draft.test.ts
import type { NianSession } from '@shennian/wire'
import type { MachineSessionCreateInput } from '../machines/machineAccountClient.types'

export function buildLocalSessionDraft(
  input: MachineSessionCreateInput,
  userId: string,
  id: string,
  now = new Date().toISOString(),
): NianSession {
  if (!userId || !input.machineId.trim() || !input.workDir.trim()) throw new Error('project_context_required')
  return {
    ...input,
    id,
    userId,
    localCreationState: 'draft',
    agentSessionId: null,
    modelSource: 'session',
    title: input.title ?? '',
    status: 'active',
    bodyStorageMode: 'machine_local',
    localReady: false,
    bodyRevision: 0,
    indexRevision: 0,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    canManage: true,
  }
}

export function localSessionCreateInput(session: NianSession): MachineSessionCreateInput {
  return {
    title: session.title || undefined,
    machineId: session.machineId,
    agentType: session.agentType,
    workDir: session.workDir,
    modelId: session.modelId ?? undefined,
    sessionMode: session.sessionMode ?? 'standard',
    ...(session.sessionScope === 'steward' ? { sessionScope: 'steward' as const } : {}),
    managerConfig: session.managerConfig ?? undefined,
    managerDefaultWorkerAgentType: session.managerDefaultWorkerAgentType,
    managerDefaultWorkerModelId: session.managerDefaultWorkerModelId,
  }
}

/** Same ID for the draft, outbox and remote session; retry cannot fork a conversation. */
export function createLocalSessionPromoter(options: {
  read: (id: string) => Promise<NianSession | undefined>
  create: (id: string, input: MachineSessionCreateInput) => Promise<NianSession>
  persist: (session: NianSession) => Promise<void>
  publish: (session: NianSession) => void
  accountId: () => string
}) {
  const pending = new Map<string, Promise<void>>()
  return function ensureCreated(id: string): Promise<void> {
    const existing = pending.get(id)
    if (existing) return existing
    const task = (async () => {
      const session = await options.read(id)
      if (!session) throw new Error('Session is unavailable')
      if (session.userId !== options.accountId()) throw new Error('Account changed')
      if (session.localCreationState !== 'draft') return
      const remote = await options.create(id, localSessionCreateInput(session))
      if (remote.id !== id || remote.userId !== session.userId) throw new Error('Session creation identity mismatch')
      if (options.accountId() !== session.userId) throw new Error('Account changed')
      const current = await options.read(id)
      if (!current || current.deletedAt) throw new Error('Session was deleted')
      const created: NianSession = { ...remote, ...current, localCreationState: 'created' }
      await options.persist(created)
      if (options.accountId() !== session.userId || !(await options.read(id))) throw new Error('Session is unavailable')
      options.publish(created)
    })().finally(() => pending.delete(id))
    pending.set(id, task)
    return task
  }
}

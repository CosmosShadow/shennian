// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/room-agent-settings.test.ts
import type { NianSession } from '@shennian/wire'

type RestartTarget = { roomId: string; bindingId: string; agentIdentityId: string; session: NianSession }
type RestartDependencies = {
  create: (agentIdentityId: string, assignmentIntentId: string) => Promise<NianSession>
  persist: (session: NianSession) => Promise<void>
  restart: (session: NianSession, params: Record<string, string>) => Promise<{ ok?: boolean; error?: string }>
  remove: (sessionId: string) => Promise<unknown>
}

// Keep replacement/rollback semantics independent of navigation. Success, cancel
// and failure must not pop the settings page back to the conversation.
export async function restartRoomAgentSession(target: RestartTarget, deps: RestartDependencies) {
  const assignmentIntentId = `${target.roomId}:${target.agentIdentityId}:restart:${Date.now()}:${Math.random().toString(36).slice(2)}`
  let replacement: NianSession | null = null
  let bindingReplaced = false
  try {
    replacement = await deps.create(target.agentIdentityId, assignmentIntentId)
    await deps.persist(replacement)
    const result = await deps.restart(replacement, {
      roomId: target.roomId, bindingId: target.bindingId, agentIdentityId: target.agentIdentityId,
      previousNianSessionId: target.session.id, nianSessionId: replacement.id,
      assignmentIntentId, agentType: replacement.agentType,
    })
    if (!result.ok) throw new Error(result.error ?? 'managed_agent_restart_failed')
    bindingReplaced = true
    await deps.remove(target.session.id).catch(() => {})
    return replacement
  } catch (error) {
    if (replacement && !bindingReplaced) await deps.remove(replacement.id).catch(() => {})
    throw error
  }
}

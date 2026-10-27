// @arch docs/features/agent-workspaces.md#四信息架构
// @test ../../__tests__/desktop-agent-detail-screen.test.ts
import type { AgentWorkspaceSession } from '@shennian/wire'

export function desktopAgentEditorFallback(input: { agentId?: string; returnTo?: string; roomId?: string }) {
  if (input.agentId) return { pathname: '/(main)/agents/[agentId]' as const, params: { agentId: input.agentId } }
  if (input.returnTo === 'room-agent-add' && input.roomId) {
    return { pathname: '/(main)/spaces/agent-add' as const, params: { roomId: input.roomId } }
  }
  return { pathname: '/(main)/agents' as const }
}

export function desktopAgentConversations(sessions: AgentWorkspaceSession[], contextRoomId: string) {
  return sessions.filter((session) => session.room && (!contextRoomId || session.room.roomId === contextRoomId))
}

export function desktopAgentConversationLocation(agentId: string, session: AgentWorkspaceSession) {
  if (!session.room) throw new Error('Agent conversation has no Room binding.')
  return {
    pathname: '/(main)/room-workspace' as const,
    params: { roomId: session.room.roomId, scopedAgentSessionId: session.id, scopedAgentIdentityId: agentId },
  }
}

export function resolveDesktopAgentRoom(roomIds: string[], choice: string | undefined): string | null {
  return choice && roomIds.includes(choice) ? choice : roomIds[0] ?? null
}

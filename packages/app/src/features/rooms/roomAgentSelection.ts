// @arch docs/features/agent-workspaces.md
// @test src/__tests__/room-agent-selection.test.ts
import type { AgentWorkspace, RoomActivationMode } from '@shennian/wire'
import type { RoomMemberView } from './types'

export type ManagedRoomBindingResult = {
  binding?: {
    id?: unknown
    roomId?: unknown
    agentIdentityId?: unknown
    agentMembershipId?: unknown
    nianSessionId?: unknown
    status?: unknown
    activationMode?: unknown
  }
  idempotent?: unknown
}

export function isExpectedManagedRoomBinding(
  value: unknown,
  expected: {
    roomId: string
    agentIdentityId: string
    nianSessionId: string
    activationMode: RoomActivationMode
  },
): boolean {
  if (!value || typeof value !== 'object') return false
  const binding = (value as ManagedRoomBindingResult).binding
  return Boolean(
    binding &&
    typeof binding.id === 'string' &&
    binding.id.length > 0 &&
    typeof binding.agentMembershipId === 'string' &&
    binding.agentMembershipId.length > 0 &&
    binding.roomId === expected.roomId &&
    binding.agentIdentityId === expected.agentIdentityId &&
    binding.nianSessionId === expected.nianSessionId &&
    binding.activationMode === expected.activationMode &&
    (binding.status === 'active' || binding.status === 'paused'),
  )
}

export function getAddedRoomAgentIds(
  agents: AgentWorkspace[],
  members: RoomMemberView[],
  roomId: string,
  addedIds: string[],
): Set<string> {
  const ids = new Set(addedIds)
  for (const member of members) {
    if (member.principalType === 'agent') {
      const id = member.agentIdentityId ?? member.ownBinding?.agentIdentityId
      if (id) ids.add(id)
    }
  }
  for (const agent of agents) {
    if (
      agent.sessions.some(
        (session) => session.room?.roomId === roomId && session.room.status !== 'detached',
      )
    )
      ids.add(agent.id)
  }
  return ids
}

// Selection is a local draft; toggling never creates a session or removes a member.
export function toggleRoomAgentSelection(ids: string[], id: string, existing: Set<string>) {
  if (existing.has(id)) return ids
  return ids.includes(id) ? ids.filter((selected) => selected !== id) : [...ids, id]
}

// Stop on the first failure. Successful entries have already been removed from the draft.
export async function submitRoomAgentSelection<T>(
  agents: T[],
  add: (agent: T) => Promise<boolean>,
) {
  for (const agent of agents) {
    if (!(await add(agent))) return false
  }
  return true
}

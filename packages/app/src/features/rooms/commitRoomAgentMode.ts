// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/commit-room-agent-mode.test.ts
import type { RoomActivationMode } from '@shennian/wire'
import type { RoomMemberView } from './types'
import { canChangeRoomAgentMode } from './roomAgentMode'

/** A radio selection commits immediately after exact owner/binding revalidation. */
export async function commitRoomAgentMode(target: {
  accountId: string; roomId: string; memberId: string; agentIdentityId: string; sessionId: string
  original: RoomActivationMode; desired: RoomActivationMode
}, deps: {
  accountId: () => string | null | undefined
  read: () => Promise<RoomMemberView[]>
  update: (mode: RoomActivationMode) => Promise<unknown>
}) {
  const checkAccount = () => { if (deps.accountId() !== target.accountId) throw new Error('account_changed') }
  checkAccount()
  if (target.desired === target.original) return false
  const members = await deps.read()
  checkAccount()
  const member = members.find((item) => item.id === target.memberId)
  if (!member || !canChangeRoomAgentMode(member, target.accountId)
    || member.agentIdentityId !== target.agentIdentityId || member.ownBinding?.nianSessionId !== target.sessionId) {
    throw new Error('room_agent_binding_unavailable')
  }
  if (member.ownBinding.activationMode === target.desired) return false
  if (member.ownBinding.activationMode !== target.original) throw new Error('agent_mode_conflict')
  await deps.update(target.desired)
  checkAccount()
  return true
}

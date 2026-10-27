// @covers packages/app/src/features/rooms/roomAgentMode.ts
// @covers packages/app/src/features/rooms/components/RoomAgentModePicker.tsx
// @covers packages/app/src/features/rooms/components/RoomAgentWorkSettingsSheet.tsx
import { describe, expect, it } from 'vitest'
import { applyRoomAgentMode, canChangeRoomAgentMode } from '../features/rooms/roomAgentMode'
import type { RoomMemberView } from '../features/rooms/types'
const agent: RoomMemberView = {
  id: 'member',
  principalType: 'agent',
  ownerUserId: 'owner',
  parentHumanMembershipId: 'human',
  displayAlias: 'Agent',
  role: 'member',
  joinedAt: '',
  avatar: null,
  ownerAvatar: null,
  agentParticipation: { activationMode: 'paused', availability: 'unavailable' },
  ownBinding: {
    agentMembershipId: 'member',
    nianSessionId: 'session',
    status: 'paused',
    activationMode: 'paused',
    availability: 'unavailable',
    lastMessagePreview: null,
  },
}
describe('Room work mode controls', () => {
  it('lets the owner change a soft pause even while the machine is offline', () => {
    expect(canChangeRoomAgentMode(agent, 'owner')).toBe(true)
    expect(canChangeRoomAgentMode(agent, 'other')).toBe(false)
    expect(canChangeRoomAgentMode(agent, null)).toBe(false)
  })
  it('does not permit detached, security-quarantined or missing bindings', () => {
    expect(canChangeRoomAgentMode({ ...agent, ownBinding: null }, 'owner')).toBe(false)
    expect(
      canChangeRoomAgentMode(
        { ...agent, ownBinding: { ...agent.ownBinding!, status: 'detached' } },
        'owner',
      ),
    ).toBe(false)
    expect(canChangeRoomAgentMode({ ...agent, principalType: 'human' }, 'owner')).toBe(false)
  })
  it.each(['auto_follow', 'mention_only', 'paused'] as const)(
    'projects %s without faking availability or replacing a session',
    (activationMode) => {
      const updated = applyRoomAgentMode(agent, {
        activationMode,
        status: activationMode === 'paused' ? 'paused' : 'active',
      })
      expect(updated.ownBinding?.activationMode).toBe(activationMode)
      expect(updated.agentParticipation?.activationMode).toBe(activationMode)
      expect(updated.ownBinding?.availability).toBe('unavailable')
      expect(updated.agentParticipation?.availability).toBe('unavailable')
      expect(updated.ownBinding?.nianSessionId).toBe('session')
      expect(agent.ownBinding?.activationMode).toBe('paused')
    },
  )
})

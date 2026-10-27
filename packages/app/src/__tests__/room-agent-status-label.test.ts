// @covers packages/app/src/features/rooms/components/RoomAgentStatusLabel.tsx

import { describe, expect, it } from 'vitest'
import en from '../../../../open-source/packages/shared/src/i18n/en'
import zh from '../../../../open-source/packages/shared/src/i18n/zh'
import { getRoomMemberParticipation } from '../features/rooms/roomPresentation'
import type { RoomMemberView } from '../features/rooms/types'
import {
  getRoomAgentStatusPresentation,
  isRoomAgentIdentityDimmed,
  roomActivationModeToParticipation,
} from '../features/rooms/components/roomAgentStatusPresentation'

describe('RoomAgentStatusLabel', () => {
  it('gives every participation state a stable icon and semantic color', () => {
    expect(getRoomAgentStatusPresentation('auto')).toEqual({
      icon: 'chatbubble-ellipses-outline',
      labelKey: 'spaces_agent_status_auto',
      colorToken: 'successText',
    })
    expect(getRoomAgentStatusPresentation('mention')).toEqual({
      icon: 'at-circle-outline',
      labelKey: 'spaces_agent_status_mention',
      colorToken: 'navigationSelected',
    })
    expect(getRoomAgentStatusPresentation('paused')).toEqual({
      icon: 'pause-circle-outline',
      labelKey: 'spaces_agent_status_paused',
      colorToken: 'error',
    })
  })

  it('maps the editable work modes to the same compact status model', () => {
    expect(roomActivationModeToParticipation('auto_follow')).toBe('auto')
    expect(roomActivationModeToParticipation('mention_only')).toBe('mention')
    expect(roomActivationModeToParticipation('paused')).toBe('paused')
  })

  it('derives the @ picker status for another member\'s Agent from the public projection, and none for humans', () => {
    const member = (overrides: Partial<RoomMemberView>): RoomMemberView => ({
      id: 'm1',
      principalType: 'agent',
      ownerUserId: 'other-user',
      parentHumanMembershipId: 'h1',
      displayAlias: 'pi智能体',
      role: 'member',
      joinedAt: '2026-09-20T00:00:00.000Z',
      avatar: null,
      ownerAvatar: null,
      ...overrides,
    })
    const agent = (activationMode: 'auto_follow' | 'mention_only' | 'paused', availability: 'available' | 'unavailable' = 'available') =>
      member({ agentParticipation: { activationMode, availability } })
    expect(getRoomMemberParticipation(agent('auto_follow'))).toBe('auto')
    expect(getRoomMemberParticipation(agent('mention_only'))).toBe('mention')
    expect(getRoomMemberParticipation(agent('paused'))).toBe('paused')
    // Machine unavailability never rewrites the configured work mode.
    expect(getRoomMemberParticipation(agent('auto_follow', 'unavailable'))).toBe('auto')
    expect(getRoomMemberParticipation(member({ principalType: 'human', agentParticipation: undefined }))).toBeNull()
  })

  it('keeps a paused Agent identity visible and only dims actual unavailability', () => {
    expect(isRoomAgentIdentityDimmed('paused')).toBe(false)
    expect(isRoomAgentIdentityDimmed('auto')).toBe(false)
    expect(isRoomAgentIdentityDimmed('mention')).toBe(false)
    expect(isRoomAgentIdentityDimmed('offline')).toBe(true)
  })

  it('uses the compact mention-trigger wording in both languages', () => {
    expect(zh.spaces_agent_status_mention).toBe('触发响应')
    expect(zh.spaces_agent_status_full_mention).toBe('触发响应')
    expect(en.spaces_agent_status_mention).toBe('Mention to respond')
    expect(en.spaces_agent_status_full_mention).toBe('Mention to respond')
  })
})

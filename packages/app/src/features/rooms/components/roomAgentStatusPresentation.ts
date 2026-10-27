// @arch docs/features/network-rooms/ui.md#二成员信息架构
// @test src/__tests__/room-agent-status-label.test.ts

import type { CompactAgentParticipation } from '@shennian/shared/agent-participation'
import type { RoomActivationMode } from '@shennian/wire'

export type RoomAgentStatusPresentation = {
  icon:
    | 'chatbubble-ellipses-outline'
    | 'at-circle-outline'
    | 'pause-circle-outline'
    | 'cloud-offline-outline'
  labelKey:
    | 'spaces_agent_status_auto'
    | 'spaces_agent_status_mention'
    | 'spaces_agent_status_paused'
    | 'spaces_agent_status_offline'
  colorToken: 'successText' | 'navigationSelected' | 'error' | 'textSecondary'
}

export function roomActivationModeToParticipation(
  mode: RoomActivationMode,
): Exclude<CompactAgentParticipation, 'offline'> {
  if (mode === 'auto_follow') return 'auto'
  if (mode === 'mention_only') return 'mention'
  return 'paused'
}

export function isRoomAgentIdentityDimmed(
  participation: CompactAgentParticipation | null | undefined,
): boolean {
  return participation === 'offline'
}

export function getRoomAgentStatusPresentation(
  participation: CompactAgentParticipation,
): RoomAgentStatusPresentation {
  if (participation === 'auto') {
    return { icon: 'chatbubble-ellipses-outline', labelKey: 'spaces_agent_status_auto', colorToken: 'successText' }
  }
  if (participation === 'mention') {
    return { icon: 'at-circle-outline', labelKey: 'spaces_agent_status_mention', colorToken: 'navigationSelected' }
  }
  if (participation === 'paused') {
    return { icon: 'pause-circle-outline', labelKey: 'spaces_agent_status_paused', colorToken: 'error' }
  }
  return { icon: 'cloud-offline-outline', labelKey: 'spaces_agent_status_offline', colorToken: 'textSecondary' }
}

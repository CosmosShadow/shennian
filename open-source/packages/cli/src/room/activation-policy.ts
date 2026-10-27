// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-activation-policy.test.ts

import type { RoomMessageView } from '@shennian/wire'
import type { RoomSessionRegistration } from './session-registry.js'

export type RoomActivationCause = 'human_message' | 'explicit_mention' | 'room_event'

export type RoomActivationTarget = {
  registration: RoomSessionRegistration
  cause: RoomActivationCause
}

export function selectRoomActivationTargets(
  message: RoomMessageView,
  registrations: RoomSessionRegistration[],
): RoomActivationTarget[] {
  if (message.deletedAt) return []
  const mentionedAgents = new Set(
    (message.mentions ?? [])
      .filter((mention) => mention.principalType === 'agent')
      .map((mention) => mention.membershipId),
  )
  const eligible = registrations.filter(isEligible)

  if (message.kind === 'system') {
    if (!isAutoFollowRoomEvent(message)) return []
    return eligible
      .filter((registration) =>
        registration.binding!.activationMode === 'auto_follow' &&
        registration.binding!.agentMembershipId !== message.systemEvent?.subjectMembershipId,
      )
      .map((registration) => ({ registration, cause: 'room_event' }))
  }

  if (message.author.principalType === 'agent') {
    return eligible
      .filter((registration) =>
        registration.binding!.agentMembershipId !== message.author.membershipId &&
        mentionedAgents.has(registration.binding!.agentMembershipId!),
      )
      .map((registration) => ({ registration, cause: 'explicit_mention' }))
  }

  if (mentionedAgents.size > 0) {
    return eligible
      .filter((registration) => mentionedAgents.has(registration.binding!.agentMembershipId!))
      .map((registration) => ({ registration, cause: 'explicit_mention' }))
  }

  return eligible
    .filter((registration) => registration.binding!.activationMode === 'auto_follow')
    .map((registration) => ({ registration, cause: 'human_message' }))
}

function isAutoFollowRoomEvent(message: RoomMessageView): boolean {
  const event = message.systemEvent
  if (!event) return false
  if (
    (event.type === 'membership_joined' || event.type === 'membership_left') &&
    event.subjectPrincipalType === 'agent'
  ) return false
  return (
    event.type === 'membership_joined' ||
    event.type === 'membership_left' ||
    event.type === 'membership_removed' ||
    event.type === 'room_renamed'
  )
}

function isEligible(registration: RoomSessionRegistration): boolean {
  return Boolean(
    registration.lifecycleState !== 'closed' &&
    registration.binding?.status === 'active' &&
    registration.binding.activationMode !== 'paused' &&
    registration.binding.agentMembershipId,
  )
}

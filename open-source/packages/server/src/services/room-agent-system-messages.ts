// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-agent-system-messages.test.ts

import type { RoomActivationMode } from '@shennian/wire'

export function roomAgentJoinedSystemText(
  displayAlias: string,
  activationMode: RoomActivationMode,
): string {
  if (activationMode === 'auto_follow') {
    return `${displayAlias} joined the Room and will automatically follow group messages.`
  }
  if (activationMode === 'mention_only') {
    return `${displayAlias} joined the Room and will respond only when mentioned.`
  }
  return `${displayAlias} joined the Room with work paused.`
}

export function roomAgentModeChangedSystemText(
  displayAlias: string,
  activationMode: RoomActivationMode,
): string {
  if (activationMode === 'auto_follow') {
    return `${displayAlias} changed work mode to automatically follow group messages.`
  }
  if (activationMode === 'mention_only') {
    return `${displayAlias} changed work mode to respond only when mentioned.`
  }
  return `${displayAlias} changed work mode to paused.`
}

export type RoomAgentUnavailableReason = 'machine_offline' | 'paused' | 'recovering' | 'unavailable'

/** Tells the sender why an Agent that this message should reach cannot respond right now. */
export function roomAgentUnavailableSystemText(
  displayAlias: string,
  reason: RoomAgentUnavailableReason,
): string {
  if (reason === 'machine_offline') {
    return `${displayAlias}'s machine is offline and cannot respond to this message.`
  }
  if (reason === 'paused') {
    return `${displayAlias} is paused and will not respond to this message.`
  }
  if (reason === 'recovering') {
    return `${displayAlias} is recovering and cannot respond to this message yet.`
  }
  return `${displayAlias} is temporarily unable to respond to this message.`
}

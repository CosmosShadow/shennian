// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/room-agent-mode.test.ts
import { createContext, useEffect, useState } from 'react'
import type { RoomActivationMode } from '@shennian/wire'
import { useAuthStore } from '../../../config/auth'
import { roomAccountClient } from '../roomAccountClient'
import type { RoomMemberView } from '../types'
import { RoomAgentWorkSettingsSheet } from './RoomAgentWorkSettingsSheet'

export type RoomAgentModeTarget = {
  roomId: string
  roomName: string
  agentIdentityId: string
  sessionId: string
  activationMode?: RoomActivationMode
}
export const RoomAgentModeContext = createContext<RoomAgentModeTarget | null>(null)

/** Resolve the current owner membership, never manufacture one from a cached session. */
export function RoomAgentModePicker({
  target,
  onClose,
  onUpdated,
  inline = false,
}: {
  target: RoomAgentModeTarget
  inline?: boolean
  onClose: () => void
  onUpdated?: (agent: RoomMemberView) => void
}) {
  const userId = useAuthStore((state) => state.user?.id)
  const [member, setMember] = useState<RoomMemberView | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setMember(null)
    setFailed(false)
    void roomAccountClient
      .listMembers(target.roomId)
      .then((members) => {
        if (!active) return
        const found = members.find(
          (item) =>
            item.principalType === 'agent' &&
            item.ownerUserId === userId &&
            item.agentIdentityId === target.agentIdentityId &&
            item.ownBinding?.nianSessionId === target.sessionId,
        )
        if (found) setMember(found)
        else setFailed(true)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [target.roomId, target.agentIdentityId, target.sessionId, userId, attempt])
  return (
    <RoomAgentWorkSettingsSheet
      inline={inline}
      loadFailed={failed}
      onRetry={() => setAttempt((value) => value + 1)}
      roomId={target.roomId}
      roomName={target.roomName}
      agent={member}
      visible
      onClose={onClose}
      onAgentUpdated={(updated) => {
        setMember(updated)
        onUpdated?.(updated)
      }}
    />
  )
}

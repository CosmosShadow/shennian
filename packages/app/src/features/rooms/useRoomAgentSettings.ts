// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/room-agent-settings.test.ts
import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import type { AgentWorkspace, NianSession } from '@shennian/wire'
import { sessionAccountClient } from '../sessions/sessionAccountClient'
import { agentAccountClient } from '../agents/agentAccountClient'
import { subscribeAgentRefresh } from '../agents/agentEvents'
import {
  isRoomAccountForbidden,
  isRoomAccountNotFound,
  roomAccountClient,
} from './roomAccountClient'
import { subscribeRoomEvents } from './roomEvents'
import type { LinkedRoomBindingView, RoomDetailView, RoomMemberView } from './types'

export type RoomAgentSettingsData = {
  room: RoomDetailView
  member: RoomMemberView
  agent: AgentWorkspace
  session: NianSession
  binding: LinkedRoomBindingView
}

export function useRoomAgentSettings(
  roomId: string,
  agentIdentityId: string,
  accountId: string | null,
) {
  const [data, setData] = useState<RoomAgentSettingsData | null>(null)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    if (!accountId) {
      setData(null)
      setFailed(true)
      return
    }
    try {
      const [room, members] = await Promise.all([
        roomAccountClient.getRoom(roomId),
        roomAccountClient.listMembers(roomId),
      ])
      const member = members.find(
        (item) =>
          item.principalType === 'agent' &&
          item.agentIdentityId === agentIdentityId &&
          item.ownerUserId === accountId,
      )
      const sessionId = member?.ownBinding?.nianSessionId
      if (!member || !sessionId) {
        if (request === generation.current) setData(null)
        throw new Error('room_agent_binding_unavailable')
      }
      const [agent, session, binding] = await Promise.all([
        agentAccountClient.getAgent(agentIdentityId),
        sessionAccountClient.getSession(sessionId),
        roomAccountClient.getSessionBinding(sessionId),
      ])
      if (
        !binding ||
        binding.room.id !== roomId ||
        session.id !== sessionId ||
        session.agentIdentityId !== agentIdentityId
      ) {
        if (request === generation.current) setData(null)
        throw new Error('room_agent_binding_unavailable')
      }
      if (request !== generation.current) return
      setData({ room: room.room, member, agent, session, binding })
      setFailed(false)
    } catch (error) {
      if (request !== generation.current) return
      // Fail closed: stale settings must not authorize a restart after removal.
      if (isRoomAccountForbidden(error) || isRoomAccountNotFound(error)) setData(null)
      setFailed(true)
    }
  }, [roomId, agentIdentityId, accountId])

  useFocusEffect(
    useCallback(() => {
      void refresh()
      const unsubscribeRoom = subscribeRoomEvents((event) => {
        if (
          'roomId' in event &&
          event.roomId === roomId &&
          event.event !== 'room.message.created' &&
          event.event !== 'room.read.local'
        )
          void refresh()
      })
      const unsubscribeAgent = subscribeAgentRefresh(() => void refresh())
      return () => {
        generation.current++
        unsubscribeRoom()
        unsubscribeAgent()
      }
    }, [refresh, roomId]),
  )

  return { data, failed, refresh }
}

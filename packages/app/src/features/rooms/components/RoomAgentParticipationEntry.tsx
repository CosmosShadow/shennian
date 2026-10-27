// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/agent-participation-navigation.test.ts
import { useEffect, useRef } from 'react'
import { useRouter } from 'expo-router'
import type { NianSession } from '@shennian/wire'
import { useAuthStore } from '../../../config/auth'
import { selectRoomParticipationAgent } from '../agentParticipationNavigation'
import type { RoomMemberView } from '../types'

/** Navigation bridge for existing member/profile selection state. Never renders an overlay. */
export function RoomAgentParticipationEntry({ roomId, members, agentIdentityId, visible, onClose, loading = false }: {
  roomId: string; members: RoomMemberView[]; agentIdentityId?: string | null; visible: boolean
  onClose: () => void; loading?: boolean; onUpdated?: () => void
  onRestarted?: (previousSessionId: string, replacement: NianSession) => void
}) {
  const router = useRouter()
  const accountId = useAuthStore((state) => state.user?.id)
  const opened = useRef(false)
  useEffect(() => {
    if (!visible) { opened.current = false; return }
    if (loading || opened.current) return
    opened.current = true
    const selected = selectRoomParticipationAgent(members, accountId, agentIdentityId)
    onClose()
    if (selected?.agentIdentityId) router.navigate({ pathname: '/(main)/agents/[agentId]', params: {
      agentId: selected.agentIdentityId, contextRoomId: roomId,
    } })
    else router.navigate({ pathname: '/(main)/spaces/agent-settings', params: { roomId, agentIdentityId: agentIdentityId ?? '' } })
  }, [accountId, agentIdentityId, loading, members, onClose, roomId, router, visible])
  return null
}

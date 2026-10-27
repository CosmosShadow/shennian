// @arch docs/architecture/app/modular-features.md#聊天-feature

import { useEffect, useState } from 'react'
import type { AgentWorkspace, NianSession } from '@shennian/wire'
import { agentAccountClient } from '../../agents/agentAccountClient'
import { roomAccountClient } from '../../rooms/roomAccountClient'
import type { LinkedRoomBindingView } from '../../rooms/types'
import { sessionAccountClient } from '../../sessions/sessionAccountClient'

export function useChatSessionContext({
  indexedSession,
  sessionId,
  upsertSession,
  workspaceAgentIdentityId,
  workspaceRoomId,
}: {
  indexedSession?: NianSession
  sessionId: string
  upsertSession: (session: NianSession) => void
  workspaceAgentIdentityId?: string
  workspaceRoomId?: string
}) {
  const [directSession, setDirectSession] = useState<NianSession | null>(null)
  const session = indexedSession ?? (directSession?.id === sessionId ? directSession : undefined)
  const effectiveAgentIdentityId = session?.agentIdentityId || workspaceAgentIdentityId
  const [managedAgentProfile, setManagedAgentProfile] = useState<AgentWorkspace | null>(null)
  const [managedAgentProfileState, setManagedAgentProfileState] = useState<
    'idle' | 'loading' | 'ready' | 'failed'
  >('idle')
  const [roomSessionState, setRoomSessionState] = useState<'idle' | 'loading' | 'ready' | 'failed'>(
    'idle',
  )
  const [linkedRoomBinding, setLinkedRoomBinding] = useState<LinkedRoomBindingView | null>(null)

  useEffect(() => {
    if (indexedSession) {
      setDirectSession(null)
      return
    }
    let active = true
    void sessionAccountClient.getSession(sessionId).then((loaded) => {
        if (active) setDirectSession(loaded)
      })
      .catch(() => {
        if (active) setDirectSession(null)
      })
    return () => {
      active = false
    }
  }, [indexedSession, sessionId])

  useEffect(() => {
    if (!workspaceRoomId) {
      setRoomSessionState('ready')
      return
    }
    let active = true
    setRoomSessionState('loading')
    void sessionAccountClient.getSession(sessionId).then((roomSession) => {
        if (!active) return
        if (workspaceAgentIdentityId && roomSession.agentIdentityId !== workspaceAgentIdentityId) {
          setRoomSessionState('failed')
          return
        }
        upsertSession(roomSession)
        setRoomSessionState('ready')
      })
      .catch(() => {
        if (active) setRoomSessionState('failed')
      })
    return () => {
      active = false
    }
  }, [sessionId, upsertSession, workspaceAgentIdentityId, workspaceRoomId])

  useEffect(() => {
    let active = true
    setManagedAgentProfile(null)
    setManagedAgentProfileState(effectiveAgentIdentityId ? 'loading' : 'ready')
    if (!effectiveAgentIdentityId)
      return () => {
        active = false
      }
    void agentAccountClient
      .getAgent(effectiveAgentIdentityId)
      .then((agent) => {
        if (!active) return
        setManagedAgentProfile(agent)
        setManagedAgentProfileState('ready')
      })
      .catch(() => {
        if (active) setManagedAgentProfileState('failed')
      })
    return () => {
      active = false
    }
  }, [effectiveAgentIdentityId])

  useEffect(() => {
    let active = true
    setLinkedRoomBinding(null)
    void roomAccountClient.getSessionBinding(sessionId).then((binding) => {
        if (active) setLinkedRoomBinding(binding)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [sessionId])

  return {
    effectiveAgentIdentityId,
    linkedRoomBinding,
    managedAgentProfile,
    managedAgentProfileState,
    roomSessionState,
    session,
  }
}

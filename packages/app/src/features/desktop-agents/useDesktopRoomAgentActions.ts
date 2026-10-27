// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test ../../__tests__/desktop-room-agent-actions.test.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NianSession } from '@shennian/wire'
import { useMachinesStore, useSessionsStore } from '@shennian/shared'
import { useAuthStore } from '../../config/auth'
import type { RoomAgentSettingsData } from '../rooms/useRoomAgentSettings'
import { stopRoomAgentTask } from '../rooms/stopRoomAgentTask'
import { requireDesktopAccountSyncBridge } from '../desktop-control/desktopAccountRuntime'
import { createDesktopRoomAgentActions, executeDesktopRoomAgentAction, type DesktopRoomAgentActionState, type DesktopRoomAgentActionTarget } from './desktopRoomAgentActions'

type Options = {
  data: RoomAgentSettingsData | null; accountId: string | null; canManage: boolean
  refresh(): Promise<void>; onRemoved?(): void
  onRestarted?(previousSessionId: string, replacement: NianSession): void
}
export function useDesktopRoomAgentActions(options: Options) {
  const current = useRef(options); current.current = options
  const { accountId } = options
  const [state, setState] = useState<DesktopRoomAgentActionState>({ busy: null, error: null, blocked: false })
  const [confirmation, setConfirmation] = useState<{
    action: 'stop' | 'restart' | 'remove'
    target: DesktopRoomAgentActionTarget
    agentName: string
  } | null>(null)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)
  // The parent is keyed by account + Room + Agent, not replacement Session ID.
  const actor = useMemo(() => createDesktopRoomAgentActions({
    isCurrent: () => Boolean(accountId) && useAuthStore.getState().user?.id === accountId,
    operationId: () => crypto.randomUUID(), execute: executeDesktopRoomAgentAction, publish: setState,
    async committed(action, result) {
      if (action === 'restart' && 'session' in result) {
        current.current.onRestarted?.(result.previousSessionId, result.session)
        await current.current.refresh()
      } else if (action === 'remove' && 'removed' in result) current.current.onRemoved?.()
    },
    refresh: () => current.current.refresh(),
  }), [accountId])
  useEffect(() => {
    actor.start()
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id) actor.stop()
    })
    return () => { actor.stop(); unsubscribe() }
  }, [actor])
  const target = (): DesktopRoomAgentActionTarget | null => {
    const { data, canManage } = current.current
    if (!data || !canManage || state.busy || stopping || state.blocked || useAuthStore.getState().user?.id !== accountId) return null
    return { roomId: data.room.id, agentIdentityId: data.agent.id, memberId: data.member.id, bindingId: data.binding.id, sessionId: data.session.id }
  }
  const requestRestart = () => {
    const value = target()
    if (!value) return
    setConfirmation({ action: 'restart', target: value, agentName: current.current.data!.agent.displayName })
  }
  const requestStop = () => {
    const value = target()
    if (!value) return
    setConfirmation({ action: 'stop', target: value, agentName: current.current.data!.agent.displayName })
  }
  const requestRemove = () => {
    const value = target()
    if (!value) return
    setConfirmation({ action: 'remove', target: value, agentName: current.current.data!.agent.displayName })
  }
  const confirmRequestedAction = () => {
    if (!confirmation) return
    const pending = confirmation
    setConfirmation(null)
    if (pending.action === 'stop') {
      void (async () => {
        const data = current.current.data
        if (!data || data.session.id !== pending.target.sessionId) return
        const session = useSessionsStore.getState().sessions.find(item => item.id === data.session.id)
          ?? data.session
        const machine = useMachinesStore.getState().machines.find(item => item.id === session.machineId)
        if (!machine?.online || !machine.daemonInstallationId) {
          setStopError('room_agent_machine_offline')
          return
        }
        setStopping(true)
        setStopError(null)
        try {
          await stopRoomAgentTask(session, machine.daemonInstallationId, (machineId, method, params) =>
            requireDesktopAccountSyncBridge().command({
              requestId: crypto.randomUUID(),
              operation: 'machine.chat.abort',
              args: [machineId, params, 15_000, 30_000],
            }).then((result) => result.ok
              ? ({ type: 'res', id: 'desktop-room-agent-stop', ok: true, payload: result.value })
              : ({ type: 'res', id: 'desktop-room-agent-stop', ok: false, error: result.error.message })))
          await current.current.refresh()
        } catch (error) {
          setStopError(error instanceof Error ? error.message : 'agent_stop_failed')
        } finally {
          setStopping(false)
        }
      })()
      return
    }
    void actor.submit(pending.action, pending.target)
  }
  return {
    ...state,
    busy: stopping ? 'stop' as const : state.busy,
    error: stopError ?? state.error,
    confirmation,
    requestStop,
    requestRestart,
    requestRemove,
    cancelRequestedAction: () => setConfirmation(null),
    confirmRequestedAction,
    reconcile: actor.reconcile,
  }
}

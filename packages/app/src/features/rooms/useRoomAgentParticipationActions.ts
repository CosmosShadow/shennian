// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/room-agent-settings.test.ts
import { useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  getSessionLiveActivity,
  useChatStore,
  useMachinesStore,
  useSessionsStore,
} from '@shennian/shared'
import type { NianSession } from '@shennian/wire'
import { agentAccountClient } from '../agents/agentAccountClient'
import { useAuthStore } from '../../config/auth'
import { accountRuntime } from '../account-runtime/accountRuntime'
import { publishAgentRefreshEvent } from '../agents/agentEvents'
import { removeRoomAgent } from './removeRoomAgent'
import { publishRoomRelayEvent, publishRoomReplicaRevision } from './roomEvents'
import { restartRoomAgentSession } from './restartRoomAgentSession'
import { stopRoomAgentTask } from './stopRoomAgentTask'
import type { RoomAgentSettingsData } from './useRoomAgentSettings'

export function useRoomAgentParticipationActions({
  data,
  accountId,
  canManage,
  refresh,
  onRemoved,
  onRestarted,
}: {
  data: RoomAgentSettingsData | null
  accountId: string | null
  canManage: boolean
  refresh: () => Promise<void>
  onRemoved?: () => void
  onRestarted?: (previousSessionId: string, replacement: NianSession) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<'stop' | 'restart' | 'remove' | null>(null)
  const inFlight = useRef(false)
  const alive = useRef(true)
  const current = useRef({ data, accountId, canManage })
  current.current = { data, accountId, canManage }
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const assertAccount = () => {
    if (!accountId || useAuthStore.getState().user?.id !== accountId)
      throw new Error('account_changed')
  }
  const isSameContext = () =>
    alive.current &&
    current.current.accountId === accountId &&
    useAuthStore.getState().user?.id === accountId
  const isCurrent = (target: RoomAgentSettingsData) =>
    isSameContext() &&
    current.current.data?.room.id === target.room.id &&
    current.current.data?.member.id === target.member.id &&
    current.current.data?.session.id === target.session.id &&
    current.current.canManage
  const publish = (target: RoomAgentSettingsData) => {
    const frame = {
      type: 'event' as const,
      event: 'room.membership.updated',
      payload: {
        event: 'room.membership.updated',
        roomId: target.room.id,
        entityId: target.member.id,
      },
    }
    publishRoomRelayEvent(frame)
    publishAgentRefreshEvent(frame)
    publishRoomReplicaRevision(target.room.id, ['members'])
  }
  const performRestart = async (target: RoomAgentSettingsData) => {
    if (!isCurrent(target) || inFlight.current) return
    const session = target.session
    const chat = useChatStore.getState()
    if (
      (chat.sessionId === session.id && chat.runPhase !== 'idle') ||
      getSessionLiveActivity(session)
    ) {
      Alert.alert(t('session_restart'), t('session_restart_running'))
      return
    }
    const machine = useMachinesStore
      .getState()
      .machines.find((item) => item.id === session.machineId)
    if (!machine?.online || !machine.daemonInstallationId) {
      Alert.alert(t('session_restart'), t('session_restart_offline'))
      return
    }
    inFlight.current = true
    setBusy('restart')
    try {
      const replacement = await restartRoomAgentSession(
        {
          roomId: target.room.id,
          agentIdentityId: target.agent.id,
          bindingId: target.binding.id,
          session,
        },
        {
          create: agentAccountClient.createRoomSession,
          persist: async (next) => {
            assertAccount()
            useSessionsStore.getState().upsertSession(next)
            await accountRuntime.persistSession(next)
          },
          restart: (next, params) => {
            assertAccount()
            return accountRuntime.requestMachine(
              next.machineId,
              'room.agent.restart-managed',
              params,
              {
                connectTimeoutMs: 15_000,
                responseTimeoutMs: 120_000,
              },
            )
          },
          remove: (id) => {
            assertAccount()
            return accountRuntime.deleteSession(id, 'none')
          },
        },
      )
      if (!isSameContext()) return
      onRestarted?.(session.id, replacement)
      publish(target)
      await refresh()
      // Keep the same inline controls/panel open. Replacing a Session never pushes or pops a route.
    } catch {
      if (isCurrent(target))
        Alert.alert(t('session_restart_failed'), t('session_restart_failed_message'))
    } finally {
      inFlight.current = false
      if (alive.current) setBusy(null)
    }
  }
  const requestRestart = () => {
    if (!data || !canManage || inFlight.current) return
    const target = data
    Alert.alert(
      t('session_restart_confirm_title', { agent: data.agent.displayName }),
      t('session_restart_confirm'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('session_restart_confirm_action'), onPress: () => void performRestart(target) },
      ],
    )
  }
  const performStop = async (target: RoomAgentSettingsData) => {
    if (!isCurrent(target) || inFlight.current) return
    const session = useSessionsStore.getState().sessions.find((item) => item.id === target.session.id)
      ?? target.session
    const machine = useMachinesStore.getState().machines.find((item) => item.id === session.machineId)
    if (!machine?.online || !machine.daemonInstallationId) {
      Alert.alert(t('agent_task_stop_title'), t('session_restart_offline'))
      return
    }
    inFlight.current = true
    setBusy('stop')
    try {
      await stopRoomAgentTask(session, machine.daemonInstallationId, (machineId, method, params) =>
        accountRuntime.requestMachine(machineId, method, params, {
          connectTimeoutMs: 15_000,
          responseTimeoutMs: 30_000,
        }))
      if (isSameContext()) await refresh()
    } catch (error) {
      if (!isCurrent(target)) return
      Alert.alert(
        t('agent_task_stop_title'),
        error instanceof Error && error.message === 'room_agent_no_active_task'
          ? t('agent_task_stop_not_running')
          : t('agent_task_stop_failed'),
      )
    } finally {
      inFlight.current = false
      if (alive.current) setBusy(null)
    }
  }
  const requestStop = () => {
    if (!data || !canManage || inFlight.current) return
    const target = data
    Alert.alert(t('agent_task_stop_confirm_title'), t('agent_task_stop_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('agent_task_stop_action'),
        style: 'destructive',
        onPress: () => void performStop(target),
      },
    ])
  }
  const performRemove = async (target: RoomAgentSettingsData) => {
    if (!isCurrent(target) || inFlight.current || !accountId) return
    inFlight.current = true
    setBusy('remove')
    try {
      await removeRoomAgent({ accountId, roomId: target.room.id, membershipId: target.member.id,
        agentId: target.agent.id, sessionId: target.session.id }, () => isCurrent(target))
      // A successful removal can publish the authoritative membership update
      // before this await resumes. The relationship disappearing must not turn
      // a successful mutation into a stuck, failed detail page.
      if (!isSameContext()) return
      onRemoved?.()
    } catch {
      if (isSameContext()) Alert.alert(t('error'), t('spaces_manage_action_failed'))
    } finally {
      inFlight.current = false
      if (alive.current) setBusy(null)
    }
  }
  const requestRemove = () => {
    if (!data || !canManage || inFlight.current) return
    const target = data
    Alert.alert(
      t('spaces_agent_remove_confirm_title', { name: data.agent.displayName }),
      undefined,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('spaces_member_remove_action'),
          style: 'destructive',
          onPress: () => void performRemove(target),
        },
      ],
    )
  }
  return { busy, requestStop, requestRestart, requestRemove }
}

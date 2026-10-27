import { authApi } from '../../../config/api'
// @arch docs/architecture/data-sync.md#8-app-级统一正文副本与列表发布屏障
// @test src/__tests__/personal-body-replica-sync.test.ts

import { useEffect, useState } from 'react'
import { AppState, Platform } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import {
  getRelayManager,
  setRuntimeGauge,
  useChatStore,
  useMachinesStore,
  useSessionsStore,
} from '@shennian/shared'
import { useAuthStore } from '../../../config/auth'
import { db, personalSessionBodyStore } from '../../../storage/db'
import { getHydratedInstallationId, hydrateInstallationId } from '../../auth/utils/installation'
import {
  buildPersonalBodyReplicaMachineSignal,
  PersonalBodyReplicaSyncCoordinator,
} from './personalBodyReplicaCoordinator'
import { subscribePersonalBodyReplicaTargetChange } from './personalBodyReplicaSignals'
import { isAccountReplicaSyncEnabled } from '../../../utils/controlSurfaceLayout'
import { SESSION_SYNC_DATA_EPOCH, SESSION_SYNC_PROTOCOL_VERSION, type SessionHistorySyncPage } from '@shennian/wire'
import { ChatOutboundReconciler } from './chatOutboundReconciler'
import { requestDurableMessageStatus } from '../utils/durableSend'
import { mutateActiveChatSession } from '../utils/activeSessionMutation'

let activeCoordinator: PersonalBodyReplicaSyncCoordinator | null = null

export function syncVisiblePersonalSessionBody(sessionId: string): Promise<void> {
  return activeCoordinator?.syncVisibleSession(sessionId) ?? Promise.resolve()
}

export function usePersonalBodyReplicaSync(): void {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const [appInstallationId, setAppInstallationId] = useState(getHydratedInstallationId)
  useEffect(() => {
    if (!isAccountReplicaSyncEnabled(Platform.OS) || appInstallationId) return
    let cancelled = false
    void hydrateInstallationId().then((value) => {
      if (!cancelled) setAppInstallationId(value)
    })
    return () => { cancelled = true }
  }, [appInstallationId])
  useEffect(() => {
    if (!accountId || !appInstallationId || !isAccountReplicaSyncEnabled(Platform.OS)) return
    const outbound = new ChatOutboundReconciler({
      accountId,
      store: personalSessionBodyStore,
      isActive: () => useAuthStore.getState().user?.id === accountId && AppState.currentState === 'active',
      onRecovered: (sessionId, message) => {
        mutateActiveChatSession(sessionId, (state) => state.upsertMessage(message))
      },
      queryStatus: async (sessionId, message) => {
        const session = await db.getSession(sessionId)
        if (useAuthStore.getState().user?.id !== accountId || AppState.currentState !== 'active') throw new Error('inactive_account')
        const machine = useMachinesStore.getState().machines.find((item) => item.id === session?.machineId)
        const manager = getRelayManager()
        if (!manager || !machine?.online || !machine.daemonInstallationId) throw new Error('machine_offline')
        return requestDurableMessageStatus(
          (frame) => manager.sendWhenReady(machine.id, frame, 5_000, 15_000),
          {
            protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
            dataEpoch: SESSION_SYNC_DATA_EPOCH,
            daemonInstallationId: machine.daemonInstallationId,
            sessionId,
            clientMessageId: message.clientMessageId,
          },
        )
      },
    })
    const coordinator = new PersonalBodyReplicaSyncCoordinator({
      accountId,
      appInstallationId,
      store: personalSessionBodyStore,
      getRelayManager,
      readCloudPage: async ({ sessionId, ...params }) => {
        if (useAuthStore.getState().user?.id !== accountId) throw new Error('inactive_account')
        const page = await authApi<SessionHistorySyncPage>(`/sessions/${encodeURIComponent(sessionId)}/cloud-history/sync`, {
          method: 'POST', body: JSON.stringify(params),
        })
        if (useAuthStore.getState().user?.id !== accountId) throw new Error('inactive_account')
        return page
      },
      getSessions: () => db.getSessionSyncTargets?.() ?? db.getSessions(),
      getSession: (sessionId) => db.getSessionSyncTarget?.(sessionId) ?? db.getSession(sessionId),
      getMachines: () => useMachinesStore.getState().machines,
      getCurrentSessionId: () => useChatStore.getState().sessionId,
      onSessionCommitted: async (sessionId) => {
        const published = await db.getSession(sessionId)
        if (published) useSessionsStore.getState().upsertSession(published)
      },
    })
    activeCoordinator = coordinator
    const request = (sessionId?: string) => { void coordinator.requestSync(sessionId); void outbound.request(true) }
    let machinesSignal = buildPersonalBodyReplicaMachineSignal(useMachinesStore.getState().machines)
    const unsubscribers = [
      subscribePersonalBodyReplicaTargetChange(request),
      useMachinesStore.subscribe(() => {
        const next = buildPersonalBodyReplicaMachineSignal(useMachinesStore.getState().machines)
        if (next === machinesSignal) return
        machinesSignal = next
        request()
      }),
    ]
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') request()
    })
    let wasOffline = false
    const network = NetInfo.addEventListener((state) => {
      if (state.isConnected === false) wasOffline = true
      else if (state.isConnected === true && wasOffline) {
        wasOffline = false
        request()
      }
    })
    request()
    return () => {
      if (activeCoordinator === coordinator) activeCoordinator = null
      coordinator.stop()
      outbound.stop()
      for (const unsubscribe of unsubscribers) unsubscribe()
      appState.remove()
      network()
      setRuntimeGauge('personal_body_replica.pending_sessions', 0)
    }
  }, [accountId, appInstallationId])
}

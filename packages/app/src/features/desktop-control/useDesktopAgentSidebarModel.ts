// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @test ../../__tests__/desktop-agent-list-projection.test.ts
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAuthStore } from '../../config/auth'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { getAgentListSnapshot, setAgentListSnapshot } from '../agents/agentListCache'
import { subscribeAgentRefresh } from '../agents/agentEvents'
import { resolveAgentListUiState } from '../agents/agentListUiState'
import type { AgentSidebarModel } from '../agents/useAgentSidebarModel.types'
import { desktopAccountActions } from './useDesktopAccountSync'
import { DesktopAgentListProjection } from './desktopAgentListProjection'
import { desktopAgentPort } from '../desktop-agents/desktopAgentPort'

export function useDesktopAgentSidebarModel(): AgentSidebarModel {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const networkStatus = useNetworkStatus()
  const controller = useMemo(() => new DesktopAgentListProjection({
    initial: getAgentListSnapshot(accountId),
    isCurrent: () => accountId !== null && useAuthStore.getState().user?.id === accountId,
    read: () => {
      if (!accountId) throw new Error('Desktop Agent projection requires an account.')
      return desktopAgentPort.listAgents()
    },
    subscribeRevision: (listener) => subscribeAgentRefresh((event) => {
      if (event.event === 'agent.replica.updated') listener()
    }),
    requestSync: () => desktopAccountActions.reconcile(),
    onSnapshot: (agents) => setAgentListSnapshot(accountId, agents),
  }), [accountId])
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  useEffect(() => controller.start(), [controller])
  return { agents: state.agents, retry: controller.retry,
    state: resolveAgentListUiState({ count: state.agents.length, initialLoadPending: state.loading,
      refreshFailed: state.failed, offline: networkStatus === 'offline' }) }
}

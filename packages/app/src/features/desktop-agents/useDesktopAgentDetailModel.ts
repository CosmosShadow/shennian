// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @test src/__tests__/desktop-agent-detail-projection.test.ts
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAuthStore } from '../../config/auth'
import { DesktopAgentDetailProjection } from '../desktop-control/desktopAgentDetailProjection'
import { desktopAccountActions } from '../desktop-control/useDesktopAccountSync'
import { subscribeAgentRefresh } from '../agents/agentEvents'
import type { AgentDetailModel, AgentDetailModelOptions } from '../agents/useAgentDetailModel.types'
import { desktopAgentPort } from './desktopAgentPort'

export function useDesktopAgentDetailModel({ accountId, agentId, onUnavailable }: AgentDetailModelOptions): AgentDetailModel {
  const controller = useMemo(() => new DesktopAgentDetailProjection({
    agentId,
    isCurrent: () => Boolean(accountId) && useAuthStore.getState().user?.id === accountId,
    read: () => {
      if (!accountId) throw new Error('Desktop Agent projection requires an account.')
      return desktopAgentPort.getAgent(agentId)
    },
    recover: desktopAgentPort.recoverAgent,
    subscribeRevision: (listener) => subscribeAgentRefresh((event) => {
      if (event.event === 'agent.replica.updated') listener()
    }),
    requestSync: () => desktopAccountActions.reconcile(),
    onUnavailable,
  }), [accountId, agentId, onUnavailable])
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  useEffect(() => controller.start(), [controller])
  return { ...state, refresh: controller.refresh, repair: controller.repair, isCurrent: controller.isCurrent }
}

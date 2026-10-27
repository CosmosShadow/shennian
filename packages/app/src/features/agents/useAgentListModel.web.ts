// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @test packages/app/src/__tests__/agent-list-platform-model.test.ts
import { useMemo } from 'react'
import { Alert } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { useDesktopAgentSidebarModel } from '../desktop-control/useDesktopAgentSidebarModel'
import { agentAccountClient } from './agentAccountClient.web'
import { createDesktopAgentListActions } from './desktopAgentListActions'
import type { AgentListModel } from './useAgentListModel.types'

export function useAgentListModel(): AgentListModel {
  const projection = useDesktopAgentSidebarModel()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const { t } = useTranslation()
  const actions = useMemo(() => createDesktopAgentListActions({
    isCurrent: () => accountId !== null && useAuthStore.getState().user?.id === accountId,
    client: agentAccountClient,
    onError: (action) => Alert.alert(t(action === 'pin' ? 'agents_pin_failed' : 'agents_delete_failed')),
  }), [accountId, t])
  return { agents: projection.agents, listUiState: projection.state,
    load: projection.retry, ...actions }
}

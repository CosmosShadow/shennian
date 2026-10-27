// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @test packages/app/src/__tests__/agent-list-account-state.test.ts
import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'expo-router'
import { agentAccountClient } from './agentAccountClient'
import { useAuthStore } from '../../config/auth'
import { db } from '../../storage/db'
import { projectAgentWorkspaceRuntimeUnavailable } from '@shennian/shared'
import { subscribeAgentRefresh } from './agentEvents'
import { getAgentListSnapshot, setAgentListSnapshot } from './agentListCache'
import { applyAgentListResult, switchAgentListAccount, updateAgentListForAccount,
  type AgentListAccountState } from './agentListAccountState'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { resolveAgentListUiState } from './agentListUiState'
import type { AgentSidebarModel } from './useAgentSidebarModel.types'

export function useAgentSidebarModel(): AgentSidebarModel {
  const pathname = usePathname()
  const user = useAuthStore((state) => state.user)
  const accountId = user?.id ?? null
  const networkStatus = useNetworkStatus()
  const initialSnapshot = getAgentListSnapshot(accountId)
  const [agentList, setAgentList] = useState<AgentListAccountState>(() => ({
    accountId,
    agents: initialSnapshot ?? [],
  }))
  const [requestState, setRequestState] = useState(() => ({
    accountId,
    initialLoadPending: accountId !== null && initialSnapshot === null,
    refreshFailed: false,
  }))
  const agents = switchAgentListAccount(
    agentList,
    accountId,
    getAgentListSnapshot(accountId),
  ).agents
  const refresh = useCallback(async () => {
    if (!accountId) return
    setRequestState((current) => ({
      accountId,
      initialLoadPending: current.accountId === accountId && current.initialLoadPending,
      refreshFailed: false,
    }))
    try {
      const refreshedAgents = await agentAccountClient.listAgents()
      setAgentList((current) => applyAgentListResult(current, accountId, refreshedAgents))
      setAgentListSnapshot(accountId, refreshedAgents)
      await db.replaceAgents(accountId, refreshedAgents)
    } catch {
      setRequestState((current) =>
        current.accountId === accountId ? { ...current, refreshFailed: true } : current,
      )
    } finally {
      setRequestState((current) =>
        current.accountId === accountId ? { ...current, initialLoadPending: false } : current,
      )
    }
  }, [accountId])

  useEffect(() => {
    const snapshot = getAgentListSnapshot(accountId)
    setAgentList((current) => switchAgentListAccount(current, accountId, snapshot))
    setRequestState({
      accountId,
      initialLoadPending: accountId !== null && snapshot === null,
      refreshFailed: false,
    })
    let active = true
    if (accountId) {
      void db
        .getAgents(accountId)
        .then((cached) => {
          if (active) setAgentList((current) => applyAgentListResult(current, accountId, cached))
        })
        .finally(() => {
          if (active) {
            setRequestState((current) =>
              current.accountId === accountId ? { ...current, initialLoadPending: false } : current,
            )
          }
        })
    }
    void refresh()
    const unsubscribe = subscribeAgentRefresh((event) => {
      if (event.event === 'machine.removed') {
        const payload = event.payload as { machineId?: unknown } | undefined
        if (typeof payload?.machineId === 'string') {
          setAgentList((current) =>
            updateAgentListForAccount(current, accountId, (items) =>
              items.map((agent) =>
                projectAgentWorkspaceRuntimeUnavailable(agent, payload.machineId as string),
              ),
            ),
          )
        }
      }
      void refresh()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [accountId, pathname, refresh])

  const currentRequestState =
    requestState.accountId === accountId
      ? requestState
      : {
          accountId,
          initialLoadPending: accountId !== null && getAgentListSnapshot(accountId) === null,
          refreshFailed: false,
        }
  return {
    agents,
    state: resolveAgentListUiState({
      count: agents.length,
      initialLoadPending: currentRequestState.initialLoadPending,
      refreshFailed: currentRequestState.refreshFailed,
      offline: networkStatus === 'offline',
    }),
    retry: refresh,
  }
}

// @arch docs/features/agent-workspaces.md
// @test packages/app/src/__tests__/agent-list-platform-model.test.ts
import { useCallback, useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { projectAgentWorkspaceRuntimeUnavailable } from '@shennian/shared'
import type { AgentWorkspace } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { db } from '../../storage/db'
import { agentAccountClient } from './agentAccountClient.native'
import { deleteAgentWorkspace } from './deleteAgentWorkspace.native'
import { getAgentListSnapshot, setAgentListSnapshot } from './agentListCache'
import { subscribeAgentRefresh } from './agentEvents'
import { applyAgentListResult, switchAgentListAccount, updateAgentListForAccount, type AgentListAccountState } from './agentListAccountState'
import { resolveAgentListUiState } from './agentListUiState'
import type { AgentListModel } from './useAgentListModel.types'

export function useAgentListModel(): AgentListModel {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const { t } = useTranslation()
  const [agentList, setAgentList] = useState<AgentListAccountState>(() => ({
    accountId,
    agents: getAgentListSnapshot(accountId) ?? [],
  }))
  const [requestState, setRequestState] = useState(() => ({
    accountId,
    initialLoadPending: accountId !== null && getAgentListSnapshot(accountId) === null,
    refreshFailed: false,
  }))
  const agents = switchAgentListAccount(
    agentList,
    accountId,
    getAgentListSnapshot(accountId),
  ).agents
  useEffect(() => {
    const snapshot = getAgentListSnapshot(accountId)
    setAgentList((current) => switchAgentListAccount(current, accountId, snapshot))
    setRequestState({
      accountId,
      initialLoadPending: accountId !== null && snapshot === null,
      refreshFailed: false,
    })
    if (!accountId) return
    let active = true
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
    return () => {
      active = false
    }
  }, [accountId])
  const load = useCallback(async () => {
    if (!accountId) return
    setRequestState((current) => ({
      accountId,
      initialLoadPending: current.accountId === accountId && current.initialLoadPending,
      refreshFailed: false,
    }))
    try {
      const nextAgents = await agentAccountClient.listAgents()
      setAgentList((current) => applyAgentListResult(current, accountId, nextAgents))
      setAgentListSnapshot(accountId, nextAgents)
      await db.replaceAgents(accountId, nextAgents)
    } catch (error) {
      setRequestState((current) =>
        current.accountId === accountId ? { ...current, refreshFailed: true } : current,
      )
      if (__DEV__) console.warn('[agents] Failed to refresh agent list', error)
    } finally {
      setRequestState((current) =>
        current.accountId === accountId ? { ...current, initialLoadPending: false } : current,
      )
    }
  }, [accountId])
  const togglePin = useCallback(
    async (agent: AgentWorkspace) => {
      const pinned = !agent.pinnedAt
      const optimistic = pinned ? new Date().toISOString() : null
      setAgentList((current) =>
        updateAgentListForAccount(current, accountId, (items) =>
          sortAgents(
            items.map((item) => (item.id === agent.id ? { ...item, pinnedAt: optimistic } : item)),
          ),
        ),
      )
      try {
        const updatedAgent = await agentAccountClient.updateAgent(agent.id, { pinned })
        setAgentList((current) =>
          updateAgentListForAccount(current, accountId, (items) =>
            sortAgents(items.map((item) => (item.id === agent.id ? updatedAgent : item))),
          ),
        )
        if (accountId) await db.upsertAgent(accountId, updatedAgent)
      } catch {
        setAgentList((current) =>
          updateAgentListForAccount(current, accountId, (items) =>
            sortAgents(items.map((item) => (item.id === agent.id ? agent : item))),
          ),
        )
        Alert.alert(t('agents_pin_failed'))
      }
    },
    [accountId, t],
  )
  const remove = useCallback(
    async (agent: AgentWorkspace) => {
      try {
        if (!accountId) return
        await deleteAgentWorkspace(accountId, agent)
        setAgentList((current) =>
          updateAgentListForAccount(current, accountId, (items) =>
            items.filter((item) => item.id !== agent.id),
          ),
        )
      } catch (error) {
        if (__DEV__) console.warn('[agents] Failed to delete agent', error)
        Alert.alert(t('agents_delete_failed'))
      }
    },
    [accountId, t],
  )
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )
  useEffect(
    () =>
      subscribeAgentRefresh((event) => {
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
        void load()
      }),
    [accountId, load],
  )
  useEffect(() => setAgentListSnapshot(accountId, agents), [accountId, agents])
  const currentRequestState =
    requestState.accountId === accountId
      ? requestState
      : {
          accountId,
          initialLoadPending: accountId !== null && getAgentListSnapshot(accountId) === null,
          refreshFailed: false,
        }
  const listUiState = resolveAgentListUiState({
    count: agents.length,
    initialLoadPending: currentRequestState.initialLoadPending,
    refreshFailed: currentRequestState.refreshFailed,
    offline: false,
  })
  return { agents, listUiState, load, togglePin, remove }
}

function sortAgents(agents: AgentWorkspace[]): AgentWorkspace[] {
  return [...agents].sort((left, right) => {
    if (Boolean(left.pinnedAt) !== Boolean(right.pinnedAt)) return left.pinnedAt ? -1 : 1
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  })
}

// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @test src/__tests__/agent-workspaces-navigation.test.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { projectAgentWorkspaceRuntimeUnavailable } from '@shennian/shared'
import { useAuthStore } from '../../config/auth'
import { db } from '../../storage/db.native'
import { agentAccountClient, isAgentAccountNotFound } from './agentAccountClient.native'
import { subscribeAgentRefresh } from './agentEvents'
import { applyAgentDetailResult, switchAgentDetailAccount, updateAgentDetailForAccount,
  type AgentDetailAccountState } from './agentDetailAccountState'
import type { AgentDetailModel, AgentDetailModelOptions } from './useAgentDetailModel.types'

export function useAgentDetailModel({ accountId, agentId, onUnavailable }: AgentDetailModelOptions): AgentDetailModel {
  const [agentDetail, setAgentDetail] = useState<AgentDetailAccountState>(() => ({ accountId, agentId, agent: null }))
  const agent = switchAgentDetailAccount(agentDetail, accountId, agentId).agent
  const [repairing, setRepairing] = useState(false)
  const repairInFlight = useRef(false)
  const loadedDetailsRef = useRef(new Set<string>())
  const scope = JSON.stringify([accountId, agentId])
  const context = useRef(scope)
  context.current = scope
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const isCurrent = useCallback(() => alive.current && context.current === scope
    && Boolean(accountId) && useAuthStore.getState().user?.id === accountId, [accountId, scope])
  useFocusEffect(useCallback(() => {
    setAgentDetail((current) => switchAgentDetailAccount(current, accountId, agentId))
    if (!accountId) return
    let active = true
    void db.getAgent(accountId, agentId).then((cached) => {
      if (!active || !cached || !isCurrent()) return
      loadedDetailsRef.current.add(scope)
      setAgentDetail((current) => applyAgentDetailResult(current, accountId, agentId, cached))
    }).catch(() => {})
    return () => { active = false }
  }, [accountId, agentId, isCurrent, scope]))
  const refresh = useCallback(async () => {
    if (!accountId || !isCurrent()) return
    try {
      const refreshedAgent = await agentAccountClient.getAgent(agentId)
      if (!isCurrent()) return
      loadedDetailsRef.current.add(scope)
      setAgentDetail((current) => applyAgentDetailResult(current, accountId, agentId, refreshedAgent))
      await db.upsertAgent(accountId, refreshedAgent)
    } catch (error) {
      if (!isCurrent()) return
      if (isAgentAccountNotFound(error)) {
        await db.removeAgent(accountId, agentId)
        if (isCurrent()) onUnavailable()
      } else if (!loadedDetailsRef.current.has(scope)) onUnavailable()
    }
  }, [accountId, agentId, isCurrent, onUnavailable, scope])
  useFocusEffect(useCallback(() => { void refresh() }, [refresh]))
  useEffect(() => subscribeAgentRefresh((event) => {
    if (!isCurrent()) return
    if (event.event === 'machine.removed') {
      const payload = event.payload as { machineId?: unknown } | undefined
      if (typeof payload?.machineId === 'string') setAgentDetail((current) =>
        updateAgentDetailForAccount(current, accountId, agentId, (item) =>
          projectAgentWorkspaceRuntimeUnavailable(item, payload.machineId as string)))
    }
    void refresh()
  }), [accountId, agentId, isCurrent, refresh])
  const repair = useCallback(async () => {
    if (repairInFlight.current || repairing || !agent || agent.repairAction !== 'retry' || !accountId || !isCurrent()) return
    repairInFlight.current = true
    setRepairing(true)
    try {
      const recovered = await agentAccountClient.recoverAgent(agentId)
      if (!isCurrent()) return
      setAgentDetail((current) => applyAgentDetailResult(current, accountId, agentId, recovered))
      await db.upsertAgent(accountId, recovered)
    } finally { repairInFlight.current = false; if (isCurrent()) setRepairing(false) }
  }, [accountId, agent, agentId, isCurrent, repairing])
  return { agent, repairing, failed: false, refresh, repair, isCurrent }
}

// @arch docs/features/agent-native-capabilities.md
// @test src/__tests__/agent-capabilities-source.test.ts

import { useCallback, useMemo, useState, type RefObject } from 'react'
import type { AgentNativeCapability } from '@shennian/wire'
import { appendCapabilityInvocation } from '../utils/capabilityDraft'

type RelaySend = (frame: never) => Promise<{ ok: boolean; payload?: unknown; error?: string }>

type Params = {
  agentType: string
  machineId: string | null
  relayState: string
  send: RelaySend
  showToast: (message: string, type: 'success' | 'error' | 'info') => void
  t: (key: string, options?: any) => string
  machineOffline: boolean
  workDir: string
  setShowComposerMenu: (value: boolean) => void
  setInput: (updater: string | ((prev: string) => string)) => void
  textInputRef: RefObject<{ focus?: () => void } | null>
}

const SUPPORTED_AGENT_TYPES = new Set(['codex', 'claude', 'workbuddy'])

export function useAgentCapabilities(params: Params) {
  const {
    agentType,
    machineId,
    relayState,
    send,
    showToast,
    t,
    machineOffline,
    workDir,
    setShowComposerMenu,
    setInput,
    textInputRef,
  } = params
  const [visible, setVisible] = useState(false)
  const [capabilities, setCapabilities] = useState<AgentNativeCapability[]>([])
  const [loading, setLoading] = useState(false)
  const supported = useMemo(() => SUPPORTED_AGENT_TYPES.has(agentType), [agentType])

  const refresh = useCallback(async () => {
    if (!machineId || relayState !== 'connected' || !supported) return
    setLoading(true)
    try {
      const result = await send({
        type: 'req',
        method: 'agent.capabilities.list',
        params: { agentType, workDir },
      } as never)
      if (!result.ok) throw new Error(result.error || t('agent_capabilities_unavailable'))
      const payload = result.payload as {
        supported?: boolean
        capabilities?: AgentNativeCapability[]
      } | undefined
      setCapabilities(payload?.supported === false ? [] : payload?.capabilities ?? [])
    } catch (error) {
      setCapabilities([])
      showToast(error instanceof Error ? error.message : String(error), 'info')
    } finally {
      setLoading(false)
    }
  }, [agentType, machineId, relayState, send, showToast, supported, t, workDir])

  const open = useCallback(() => {
    if (machineOffline) {
      showToast(t('machine_offline_error'), 'error')
      return
    }
    setShowComposerMenu(false)
    setVisible(true)
    void refresh()
  }, [machineOffline, refresh, setShowComposerMenu, showToast, t])

  const select = useCallback((capability: AgentNativeCapability) => {
    setVisible(false)
    setInput((previous) => appendCapabilityInvocation(previous, capability.invocation))
    requestAnimationFrame(() => textInputRef.current?.focus?.())
  }, [setInput, textInputRef])

  return { visible, setVisible, capabilities, loading, supported, refresh, open, select }
}

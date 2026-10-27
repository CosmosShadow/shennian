// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/reasoning-effort-storage.test.ts
// @test src/__tests__/chat-screen-utils.test.ts

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentType, ModelInfo } from '@shennian/wire'
import {
  resolveReasoningEffort,
  supportsReasoningEffort,
} from '../../../utils/models'
import {
  getReasoningEffortPreference,
  hydrateReasoningEffortStorage,
  saveReasoningEffortPreference,
} from '../utils/reasoningEffortStorage'
import { getReasoningEffortDisplayLabel } from '../utils/reasoningEffortLabel'

type ReasoningEffort = NonNullable<ModelInfo['supportedReasoningEfforts']>[number]

type Options = {
  sessionId?: string
  agentType: AgentType
  currentModel?: ModelInfo
  t: (key: string, options?: any) => string
}

type PreferredReasoningEffortState = {
  key: string | null
  value: string | null
}

export function useReasoningEffortPreference({
  agentType,
  currentModel,
}: Options): {
  canShowReasoningEffort: boolean
  effectiveReasoningEffort?: string
  reasoningEfforts: ReasoningEffort[]
  currentReasoningLabel: string
  setPreferredReasoningEffort: (value: string | null) => void
} {
  const modelId = currentModel?.id ?? null
  const reasoningEfforts = useMemo(
    () => currentModel?.supportedReasoningEfforts ?? [],
    [currentModel?.supportedReasoningEfforts],
  )
  const canShowReasoningEffort = supportsReasoningEffort(agentType, currentModel)
  const preferenceKey = modelId && canShowReasoningEffort ? `${agentType}:${modelId}` : null
  const [preferredReasoningEffortState, setPreferredReasoningEffortState] =
    useState<PreferredReasoningEffortState>(() => ({ key: null, value: null }))
  const restoredReasoningEffort =
    preferenceKey && preferredReasoningEffortState.key === preferenceKey
      ? preferredReasoningEffortState.value
      : null

  useEffect(() => {
    let cancelled = false

    if (!modelId || !canShowReasoningEffort || !preferenceKey) {
      setPreferredReasoningEffortState({ key: null, value: null })
      return
    }

    setPreferredReasoningEffortState({
      key: preferenceKey,
      value: getReasoningEffortPreference(agentType, modelId),
    })

    void hydrateReasoningEffortStorage().finally(() => {
      if (cancelled) return
      setPreferredReasoningEffortState({
        key: preferenceKey,
        value: getReasoningEffortPreference(agentType, modelId),
      })
    })

    return () => {
      cancelled = true
    }
  }, [agentType, canShowReasoningEffort, modelId, preferenceKey])

  const setPreferredReasoningEffort = useCallback(
    (value: string | null) => {
      const nextValue = value?.trim() || null
      setPreferredReasoningEffortState({ key: preferenceKey, value: nextValue })
      if (!nextValue || !modelId || !canShowReasoningEffort) return
      if (!reasoningEfforts.some((effort) => effort.id === nextValue)) return
      saveReasoningEffortPreference(agentType, modelId, nextValue)
    },
    [agentType, canShowReasoningEffort, modelId, preferenceKey, reasoningEfforts],
  )

  const effectiveReasoningEffort = resolveReasoningEffort(
    agentType,
    currentModel,
    restoredReasoningEffort,
  )
  const currentReasoningLabel = getReasoningEffortDisplayLabel(
    effectiveReasoningEffort,
    reasoningEfforts,
  )

  return {
    canShowReasoningEffort,
    effectiveReasoningEffort,
    reasoningEfforts,
    currentReasoningLabel,
    setPreferredReasoningEffort,
  }
}

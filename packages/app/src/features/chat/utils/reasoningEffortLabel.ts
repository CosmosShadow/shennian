// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test packages/app/src/__tests__/chat-screen-utils.test.ts

import type { ModelInfo } from '@shennian/wire'

type ReasoningEffort = NonNullable<ModelInfo['supportedReasoningEfforts']>[number]

const REASONING_EFFORT_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  ultra: 'Ultra',
  max: 'Max',
}

export function getReasoningEffortDisplayLabel(
  effortId: string | undefined,
  reasoningEfforts: ReasoningEffort[],
): string {
  if (!effortId) return ''
  const normalized = effortId.trim().toLowerCase()
  return (
    REASONING_EFFORT_LABELS[normalized] ??
    reasoningEfforts.find((effort) => effort.id === effortId)?.name ??
    effortId
  )
}

// @covers src/features/agents/agent-voice-configuration.ts

import { describe, expect, it } from 'vitest'
import { applyAgentVoicePatch } from '../features/agents/agent-voice-configuration'

const baseline = {
  displayName: '产品助手',
  description: '整理产品需求',
  systemPrompt: '主动总结讨论。',
}

describe('agent voice draft patch', () => {
  it('applies only fields that have not changed manually since the request started', () => {
    expect(
      applyAgentVoicePatch({
        baseline,
        current: { ...baseline, description: '我刚刚手工改过的介绍' },
        patch: {
          displayName: '小策',
          description: '模型生成的介绍',
          systemPrompt: '主动总结讨论。涉及开发先给方案。',
        },
      }),
    ).toEqual({
      next: {
        displayName: '小策',
        description: '我刚刚手工改过的介绍',
        systemPrompt: '主动总结讨论。涉及开发先给方案。',
      },
      appliedFields: ['displayName', 'systemPrompt'],
      conflictedFields: ['description'],
    })
  })

  it('ignores missing and identical patch fields', () => {
    expect(
      applyAgentVoicePatch({
        baseline,
        current: baseline,
        patch: { displayName: baseline.displayName },
      }),
    ).toEqual({ next: baseline, appliedFields: [], conflictedFields: [] })
  })
})

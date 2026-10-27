// @arch open-source/docs/cli-runtime.md
// @covers e2e-relay-result.ts

import { describe, expect, it } from 'vitest'
import { evaluateRelayResult } from './e2e-relay-result.js'

const prompt = '严格返回一个hello，只有hello，不要解释'

describe('Relay E2E result evaluation', () => {
  it('accepts the requested answer after echoed user messages', () => {
    expect(evaluateRelayResult({
      collectedText: `${prompt}${prompt}hello`,
      prompt,
      gotFinal: true,
      gotError: '',
      timedOut: false,
    }).passed).toBe(true)
  })

  it('rejects an authentication failure even when echoed prompts contain hello', () => {
    const result = evaluateRelayResult({
      collectedText: `${prompt}${prompt}Claude authentication failed. Run "claude auth login" and retry.`,
      prompt,
      gotFinal: true,
      gotError: '',
      timedOut: false,
    })
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('not the requested exact hello')
  })
})

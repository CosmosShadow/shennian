// @covers src/services/personal-modules/listening-decision.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listeningNeedsAnalysis,
  decideListeningAnalysis,
} from '../services/personal-modules/listening-decision.js'
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
const setup = () => {
  vi.stubEnv('LISTENING_DECISION_ENABLED', 'true')
  vi.stubEnv('LISTENING_DECISION_WORKSPACE_ID', 'test-workspace')
  vi.stubEnv('DASHSCOPE_API_KEY', 'unit-only')
}
const answer = (patch: Record<string, unknown> = {}) => ({
  answers: {
    action: {
      type: 'choice',
      choice: 'observe',
      confidence: 0.99,
      probabilities: { action: 0.005, observe: 0.99, uncertain: 0.005 },
      ...patch,
    },
  },
})
describe('optional domestic System One gate', () => {
  it('honors explicit disabling and never sends credentials without valid configuration', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    vi.stubEnv('LISTENING_DECISION_ENABLED', 'false')
    expect(await listeningNeedsAnalysis({ pending: [] })).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
    setup()
    vi.stubEnv('LISTENING_DECISION_WORKSPACE_ID', 'bad/path?key=')
    expect(await listeningNeedsAnalysis({})).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('skips text analysis only on a well-formed, high-confidence observation result', async () => {
    setup()
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => answer() }))
    vi.stubGlobal('fetch', fetcher)
    expect(await listeningNeedsAnalysis({ pending: ['synthetic text'] })).toBe(false)
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone',
    )
    const request = JSON.parse(
      (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    )
    expect(request.model).toBe('decision-model-preview')
    expect(request.questions.action.type).toBe('choice')
  })
  it('falls through on uncertainty, action, invalid probabilities, refusal and network errors', async () => {
    setup()
    for (const patch of [
      { choice: 'action' },
      { choice: 'uncertain' },
      { confidence: 0.5 },
      { probabilities: { observe: 1 } },
      { probabilities: { action: 0, observe: 1.5, uncertain: -0.5 } },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, json: async () => answer(patch) })),
      )
      expect(await listeningNeedsAnalysis({})).toBe(true)
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false })),
    )
    expect(await listeningNeedsAnalysis({})).toBe(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('timeout')
      }),
    )
    expect(await listeningNeedsAnalysis({})).toBe(true)
  })
})

describe('semantic addressing and explicit classifier receipts', () => {
  it('uses configured classifier by default and lets it distinguish ambient speech from a natural call', async () => {
    setup()
    vi.stubEnv('LISTENING_DECISION_ENABLED', '')
    const payload: {
      model?: string
      usage?: { input_tokens: number }
      latency_ms?: number
      answers: Record<
        string,
        { type: string; choice: string; confidence: number; probabilities: Record<string, number> }
      >
    } = answer({
      choice: 'action',
      probabilities: { action: 0.99, observe: 0.005, uncertain: 0.005 },
    })
    payload.model = 'decision-model-preview'
    payload.usage = { input_tokens: 120 }
    payload.latency_ms = 30
    payload.answers.addressing = {
      type: 'choice',
      choice: 'ambient',
      confidence: 0.99,
      probabilities: { assistant: 0.005, ambient: 0.99, uncertain: 0.005 },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => payload })),
    )
    expect(
      await decideListeningAnalysis({ policy: { trigger: 'name' }, pending: ['转述他人的要求'] }),
    ).toMatchObject({
      needsAnalysis: false,
      provider: 'decision-model-preview',
      reason: 'not_addressed',
      inputTokens: 120,
      serverLatencyMs: 30,
    })
    payload.answers.addressing.choice = 'assistant'
    payload.answers.addressing.probabilities = { assistant: 0.99, ambient: 0.005, uncertain: 0.005 }
    expect(
      await decideListeningAnalysis({
        policy: { trigger: 'name' },
        pending: ['哎，沈念，帮我处理一下'],
      }),
    ).toMatchObject({ needsAnalysis: true, provider: 'decision-model-preview', reason: 'action' })
  })
  it('does not pretend a fallback or a mismatched upstream model used the decision model', async () => {
    setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ ...answer(), model: 'other' }) })),
    )
    expect(await decideListeningAnalysis({})).toMatchObject({
      provider: 'text_fallback',
      needsAnalysis: true,
      reason: 'unavailable',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ answers: {} }) })),
    )
    expect(await decideListeningAnalysis({})).toMatchObject({
      provider: 'text_fallback',
      needsAnalysis: true,
      reason: 'unavailable',
    })
    vi.stubEnv('LISTENING_DECISION_WORKSPACE_ID', '')
    vi.stubEnv('DASHSCOPE_REALTIME_WORKSPACE_ID', '')
    expect(await decideListeningAnalysis({})).toMatchObject({
      provider: 'text_fallback',
      needsAnalysis: true,
      reason: 'not_configured',
    })
  })
})

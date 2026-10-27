// @covers open-source/packages/server/src/services/interactive-web/providers.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contentProviderConfig, createInteractiveModel, parseModelStep, providerJson, readLimited, toProviderMessages } from '../services/interactive-web/providers.js'
import { INTERACTIVE_AGENT_ENTRY_TOOLS } from '../services/interactive-web/agent-loop.js'
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('interactive compatible provider adapter', () => {
  it('encodes valid function names and retains assistant/tool call association', () => {
    expect(toProviderMessages([{ role: 'assistant', content: '', calls: [{ id: 'c', name: 'tools.find', args: { query: 'x' } }] },
      { role: 'tool', callId: 'c', content: '[]' }])).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'tools_find', arguments: '{"query":"x"}' } }] },
      { role: 'tool', tool_call_id: 'c', content: '[]' },
    ])
    expect(parseModelStep({ choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'tools_find', arguments: '{"query":"x"}' } }] } }] },
      { tools_find: 'tools.find' }).calls?.[0]?.name).toBe('tools.find')
  })
  it('rejects malformed model tool arguments, empty responses and unbounded bodies', async () => {
    expect(() => parseModelStep({ choices: [] })).toThrow('invalid_model_response')
    expect(() => parseModelStep({ choices: [{ message: { tool_calls: [{ id: 'x', function: { name: 'x', arguments: '[]' } }] } }] })).toThrow('invalid_model_tool_arguments')
    await expect(readLimited(new Response('x'.repeat(20)), 10)).rejects.toThrow('provider_result_too_large')
    await expect(providerJson('https://example.test', '', {}, new AbortController().signal)).rejects.toThrow('model_not_configured')
  })
  it('rejects credential-bearing and non-HTTPS provider configuration', () => {
    vi.stubEnv('PLATFORM_TEXT_BASE_URL', 'http://internal.test')
    expect(contentProviderConfig).toThrow('invalid_platform_model_configuration')
    vi.stubEnv('PLATFORM_TEXT_BASE_URL', 'https://user:secret@provider.test')
    expect(contentProviderConfig).toThrow('invalid_platform_model_configuration')
  })
  it('never logs provider error bodies or retries paid calls, and honors per-turn budgets', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ error: 'sensitive-provider-body' }), { status: 429 }))
    vi.stubGlobal('fetch', request)
    await expect(providerJson('https://example.test', 'private', {}, new AbortController().signal)).rejects.toThrow('provider_http_429')
    expect(request).toHaveBeenCalledOnce()
    const limited = createInteractiveModel(1800, 100)
    await expect(limited([{ role: 'user', content: 'x' }], INTERACTIVE_AGENT_ENTRY_TOOLS, new AbortController().signal)).rejects.toThrow('model_token_budget_exhausted')
    expect(request).toHaveBeenCalledOnce()
  })
})

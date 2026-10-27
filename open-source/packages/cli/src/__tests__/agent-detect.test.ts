// @covers open-source/packages/cli/src/agents/detect.ts
// @covers open-source/packages/cli/src/agents/model-values.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../agents/command-spec.js', () => ({
  resolveBuiltinCommand: (type: string) => ({ command: type, args: [] }),
  getBuiltinAgentVersion: () => 'test',
}))
vi.mock('../agents/auth-status.js', () => ({ probeBuiltinAuthStatus: async () => 'unknown' }))
const discovery = vi.hoisted(() => ({ customAgents: {} as Record<string, unknown>, adapters: {} as Record<string, unknown> }))
vi.mock('../config/index.js', () => ({ loadConfig: () => ({ customAgents: discovery.customAgents }) }))
vi.mock('../adapter-kit/registry.js', () => ({ listNodeAdapters: () => discovery.adapters }))
vi.mock('../agents/node-adapter.js', () => ({ syncNodeAdapterAgents: vi.fn() }))
vi.mock('../agents/custom-managed-runtime.js', () => ({
  registerCustomRuntimeSecurity: vi.fn(), resolveCustomRuntimeExecutableFingerprint: () => undefined,
}))
beforeEach(() => { discovery.customAgents = {}; discovery.adapters = {} })
vi.mock('../agents/acp/discovery.js', () => ({ discoverAcpAgents: async () => [] }))

import { detectAgents, isPiCodingAgentRuntimeCompatible } from '../agents/detect.js'

describe('Agent provider discovery', () => {
  it('never advertises disabled or historical providers for new sessions', async () => {
    const agents = await detectAgents()
    expect(agents.map((agent) => agent.type)).not.toContain('manager')
    expect(agents.map((agent) => agent.type)).not.toContain('pi')
    expect(agents.map((agent) => agent.type)).not.toContain('gemini')
  })

  it('limits an explicit refresh to the requested built-in Agent', async () => {
    const agents = await detectAgents({ agentType: 'claude' })
    expect(agents.map((agent) => agent.type)).toEqual(['claude'])
  })

  it('accepts a supported Pi launcher independently of the daemon Node runtime', () => {
    expect(isPiCodingAgentRuntimeCompatible('0.85.1')).toBe(true)
    expect(isPiCodingAgentRuntimeCompatible('v0.85.1')).toBe(true)
    expect(isPiCodingAgentRuntimeCompatible('0.84.9')).toBe(false)
    expect(isPiCodingAgentRuntimeCompatible(undefined)).toBe(false)
  })
})

describe('custom model runtime values', () => {
  it('does not advertise a saved {id,name} selection as an object-valued wire model', async () => {
    discovery.customAgents = { dsh: { command: 'dsh-fixture', caps: {
      name: 'DSH', mode: 'stdio', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
      defaultModel: 'deepseek-chat',
    } } }
    const agents = await detectAgents({ agentType: 'custom:dsh' })
    expect(agents[0]?.models).toEqual([{ id: 'deepseek-chat', name: 'DeepSeek Chat', isDefault: true }])
  })

  it('normalizes old node registration values without changing string model support', async () => {
    discovery.adapters = { dsh: { name: 'DSH', models: [
      'model-a', { id: 'model-b', name: 'Model B' }, null, {}, { id: {} }, 'model-a',
    ], defaultModel: 'model-b' } }
    const agents = await detectAgents({ agentType: 'custom:dsh' })
    expect(agents[0]?.models).toEqual([
      { id: 'model-a', name: 'model-a', isDefault: false },
      { id: 'model-b', name: 'Model B', isDefault: true },
    ])
  })
})

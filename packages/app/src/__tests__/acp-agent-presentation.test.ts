// @covers src/features/machines/utils/acp-agent-presentation.ts

import { describe, expect, it, vi } from 'vitest'
import { getAgentPreparationState, testAgentPreparationReply } from '../features/machines/utils/agentPreparation'
import type { AgentInfo, Machine } from '@shennian/wire'
import {
  getAgentStatusKind,
  groupInstalledAgents,
} from '../features/machines/utils/acp-agent-presentation'

const machine = (overrides: Partial<Machine> = {}): Machine => ({
  id: 'machine-1',
  name: 'Mac',
  os: 'macos',
  paired: true,
  online: true,
  lastSeen: '2026-09-09T00:00:00Z',
  agentList: [],
  ...overrides,
})

describe('ACP machine presentation', () => {
  it('keeps one discovery-ordered product list while retaining internal integration metadata', () => {
    const projected = groupInstalledAgents(
      machine({
        agentList: ['codex', 'acp:qwen-code', 'acp:company-agent', 'unknown'],
        agents: [
          { type: 'codex', models: [] },
          { type: 'acp:qwen-code', models: [], integration: 'acp' },
          { type: 'acp:company-agent', models: [], integration: 'acp' },
        ],
      }),
    )
    expect(projected.deep.map((row) => row.type)).toEqual(['codex'])
    expect(projected.acp.map((row) => row.type)).toEqual(['acp:qwen-code', 'acp:company-agent'])
    expect(projected.all.map((row) => row.type)).toEqual([
      'codex',
      'acp:qwen-code',
      'acp:company-agent',
    ])
    expect(groupInstalledAgents(machine({ agentList: ['codex'] })).acp).toEqual([])
    expect(groupInstalledAgents(machine()).deep).toEqual([])
  })

  it('maps offline, unknown auth, required auth, ready and version errors deterministically', () => {
    expect(
      getAgentStatusKind(false, { type: 'acp:qwen-code', models: [], authState: 'ready' }),
    ).toBe('installed')
    expect(
      getAgentStatusKind(true, { type: 'acp:qwen-code', models: [], authState: 'unknown' }),
    ).toBe('installed')
    expect(
      getAgentStatusKind(true, { type: 'acp:qwen-code', models: [], authState: 'required' }),
    ).toBe('auth_required')
    expect(
      getAgentStatusKind(true, { type: 'acp:qwen-code', models: [], authState: 'ready' }),
    ).toBe('available')
    expect(
      getAgentStatusKind(true, {
        type: 'acp:qwen-code',
        models: [],
        authState: 'ready',
        runtime: { compatibility: 'version_mismatch' },
      }),
    ).toBe('version_mismatch')
  })
})

// @covers src/features/machines/utils/agentPreparation.ts
describe('AI preparation decisions', () => {
  const host = machine({agentList: ['codex']})
  it('uses the existing hello validation route with the chosen target, directory and model; does not create an object', async () => {
    const request = vi.fn(async () => ({ ok: true, payload: { ready: true } }))
    await testAgentPreparationReply(host, 'codex', ' /project ', 'chosen-model', request)
    expect(request).toHaveBeenCalledExactlyOnceWith(host.id, 'agent.workspace.validate', {
      runtimeAdapter: 'codex', workDir: '/project', modelId: 'chosen-model', sessionMode: 'standard',
    }, { connectTimeoutMs: 10_000, responseTimeoutMs: 70_000 })
  })
  it('does not turn missing confirmation or authentication failure into success', async () => {
    await expect(testAgentPreparationReply(host, 'codex', '/project', null,
      async () => ({ ok: true, payload: {} }))).rejects.toThrow('agent_validation_response_failed')
    await expect(testAgentPreparationReply(host, 'codex', '/project', null,
      async () => ({ ok: false, error: 'agent_validation_runtime_auth_required' })))
      .rejects.toThrow('agent_validation_runtime_auth_required')
  })
  it.each([{ online: false }, { role: 'granted' as const }, { agentList: [] }])('does not test an unavailable or shared machine: %j', async (change) => {
    const request = vi.fn()
    await expect(testAgentPreparationReply({ ...host, ...change }, 'codex', '/project', null, request)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
  it('does not infer sign-in or model permission from installation or a model list', () => {
    const info: AgentInfo = {type: 'codex', models: [{id: 'sample', name: 'Sample'}]}
    expect(getAgentStatusKind(true, info)).toBe('installed')
    expect(getAgentPreparationState(host, 'codex', info)).toBe('unknown')
    expect(getAgentStatusKind(true, {...info, authState: 'error'})).toBe('auth_error')
  })
  it.each([
    ['required', 'login'], ['unknown', 'unknown'], ['error', 'configuration'], ['ready', 'authenticated'],
  ] as const)('maps %s credentials to %s without making a model request', (authState, expected) => {
    expect(getAgentPreparationState(host, 'codex', {type: 'codex', models: [], authState})).toBe(expected)
  })
  it('keeps offline, shared and missing tools distinct from account setup', () => {
    expect(getAgentPreparationState({...host, online:false}, 'codex')).toBe('offline')
    expect(getAgentPreparationState({...host, role:'granted'}, 'codex')).toBe('owner')
    expect(getAgentPreparationState({...host, agentList:[]}, 'codex')).toBe('missing')
    expect(getAgentPreparationState(host, 'codex', {type:'codex',models:[],runtime:{compatibility:'version_mismatch'}})).toBe('version')
  })
})

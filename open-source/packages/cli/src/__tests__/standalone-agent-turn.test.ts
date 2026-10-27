// @covers src/room/standalone-agent-turn.ts
// @covers src/session/queued-chat-dispatch.ts
import { describe, expect, it, vi } from 'vitest'
import type { AgentWorkspace } from '@shennian/wire'
import { prepareStandaloneAgentTurn } from '../room/standalone-agent-turn.js'
import { managedManagerEventContext } from '../session/queued-chat-dispatch.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'
import { testPermissionPolicy } from './room-activation-test-fixtures.js'

function setup() {
  const agent = {
    id: 'agent', machineId: 'machine', status: 'active', runtimeAdapter: 'codex',
    workDir: '/test/project', modelId: 'agent-model', systemPrompt: 'Be concise.',
    sessionMode: 'standard', managerConfig: null,
    permissionPolicy: testPermissionPolicy(), permissionConfirmation: null,
    sessions: [{ id: 'session', machineId: 'machine', status: 'active', room: null, modelId: null }],
  } as unknown as AgentWorkspace
  const policy = { requestedPolicy: testPermissionPolicy(),
    enforcement: { level: 'hard', effectivePolicy: testPermissionPolicy(), unsupportedCapabilities: [] }, adapterPolicy: { workDir: '/resolved/project' },
  } as unknown as CompiledManagedAgentPolicy
  const list = vi.fn(async () => ({ agents: [agent] }))
  const resolvePolicy = vi.fn(async () => policy)
  return { agent, policy, list, resolvePolicy }
}

describe('owner standalone Agent conversation', () => {
  it('prepares a fresh policy and prompt without a Room registry, token or tools', async () => {
    const h = setup()
    const turn = await prepareStandaloneAgentTurn('session', h)
    expect(turn).toMatchObject({ standalone: true, agentType: 'codex', effectiveModelId: 'agent-model',
      agentSessionId: 'managed:session', workDir: '/resolved/project', managedRoomContextToken: '',
      managedAgentPolicy: h.policy, managedRoomPromptSnapshot: { allowedRoomOperations: [] } })
    expect(turn?.systemPrompt).toContain('Be concise.')
    expect(turn?.systemPrompt).toContain('没有群聊读取、发送或成员管理权限')
    expect(h.resolvePolicy).toHaveBeenCalledWith({ registration: { runtimeAdapter: 'codex' },
      permissionPolicy: h.agent.permissionPolicy, permissionConfirmation: null, workDir: '/test/project' })
    expect(managedManagerEventContext(turn!)).toMatchObject({ source: 'manager_event', standalone: true, managedAgentPolicy: h.policy })
    h.agent.systemPrompt = 'New instructions'
    h.agent.sessions[0]!.modelId = 'session-model'
    const next = await prepareStandaloneAgentTurn('session', h)
    expect(next?.systemPrompt).toContain('New instructions')
    expect(next?.effectiveModelId).toBe('session-model')
    expect(h.resolvePolicy).toHaveBeenCalledTimes(2)
  })
  it('does not infer an Agent from an arbitrary session ID', async () => {
    const h = setup()
    expect(await prepareStandaloneAgentTurn('unknown', h)).toBeNull()
    expect(h.resolvePolicy).not.toHaveBeenCalled()
    h.agent.sessions = []
    expect(await prepareStandaloneAgentTurn('session', h)).toBeNull()
  })
  it.each(['room', 'deleted', 'machine', 'policy'] as const)('fails closed for %s', async (kind) => {
    const h = setup()
    if (kind === 'room') h.agent.sessions[0]!.room = { roomId: 'room' } as never
    if (kind === 'deleted') h.agent.status = 'deleted'
    if (kind === 'machine') h.agent.sessions[0]!.machineId = 'other-machine'
    if (kind === 'policy') h.agent.permissionPolicy = undefined
    await expect(prepareStandaloneAgentTurn('session', h)).rejects.toThrow('managed_agent_context_unavailable')
    expect(h.resolvePolicy).not.toHaveBeenCalled()
  })
  it('never downgrades a permission compiler failure to an ordinary personal send', async () => {
    const h = setup()
    h.resolvePolicy.mockRejectedValueOnce(new Error('managed_agent_runtime_changed'))
    await expect(prepareStandaloneAgentTurn('session', h)).rejects.toThrow('managed_agent_runtime_changed')
  })
})

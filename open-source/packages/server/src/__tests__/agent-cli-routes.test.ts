// @covers src/routes/agent-cli.ts

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  createSession: vi.fn(),
  removeMembership: vi.fn(),
  finalize: vi.fn(),
}))
const database = vi.hoisted(() => ({
  machineFind: vi.fn(),
  membershipFindUnique: vi.fn(),
  membershipFindFirst: vi.fn(),
}))
const events = vi.hoisted(() => ({ room: vi.fn(), message: vi.fn() }))

vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators(app: ReturnType<typeof Fastify>) {
    app.decorateRequest('userId', '')
    app.decorateRequest('machineId', '')
  },
  async requireUserOrMachineAuth(request: { userId: string; machineId: string }) {
    request.userId = 'user-1'
    request.machineId = 'machine-1'
  },
  requireActivePlan: vi.fn(async () => {}),
}))
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    machine: { findFirst: database.machineFind },
    roomMembership: {
      findUnique: database.membershipFindUnique,
      findFirst: database.membershipFindFirst,
    },
  },
}))
vi.mock('../services/agent-workspaces.js', () => ({
  listAgentWorkspaces: services.list,
  getAgentWorkspace: services.get,
  createAgentWorkspace: services.create,
  updateAgentWorkspace: services.update,
  deleteAgentWorkspace: services.delete,
  createAgentWorkspaceSession: services.createSession,
  AgentWorkspaceError: class AgentWorkspaceError extends Error {
    constructor(readonly code: string, message: string) { super(message) }
  },
}))
vi.mock('../services/managed-agent-permission-policy.js', () => ({
  parseManagedAgentRuntimeProtection: (value: unknown) => value,
}))
vi.mock('../services/room-core.js', () => ({ removeRoomMembership: services.removeMembership }))
vi.mock('../services/room-session-cleanup.js', () => ({
  finalizeExclusiveRoomSessionDeletions: services.finalize,
}))
vi.mock('../services/room-events.js', () => ({
  broadcastRoomEvent: events.room,
  broadcastRoomMessageRecord: events.message,
}))
vi.mock('../services/room-policy.js', () => ({
  RoomPolicyError: class RoomPolicyError extends Error {
    constructor(readonly code: string, message: string) { super(message) }
  },
}))

import { agentCliRoutes } from '../routes/agent-cli.js'

describe('machine-auth Agent CLI routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    database.machineFind.mockResolvedValue({
      agents: [{
        type: 'codex',
        managedAgentProtection: {
          level: 'hard', runtimeVersion: '1.2.3', platform: 'darwin',
          executableFingerprint: 'sha256:codex', unsupportedCapabilities: [],
        },
      }],
    })
  })

  it('scopes listing to the authenticated machine and fixes new Agents to standard native-full', async () => {
    services.list.mockResolvedValue([])
    services.create.mockResolvedValue({ id: 'agent-1' })
    const app = Fastify()
    await app.register(agentCliRoutes, { prefix: '/agent-cli' })

    await app.inject({ method: 'GET', url: '/agent-cli/agents' })
    const response = await app.inject({
      method: 'POST',
      url: '/agent-cli/agents',
      payload: {
        displayName: '客服', description: '帮助群成员', systemPrompt: '回答问题',
        runtimeAdapter: 'codex', workDir: '/code/shennian', modelId: 'model-a',
      },
    })

    expect(services.list).toHaveBeenCalledWith('user-1', 'machine-1')
    expect(response.statusCode).toBe(201)
    expect(services.create).toHaveBeenCalledWith('user-1', expect.objectContaining({
      machineId: 'machine-1',
      sessionMode: 'standard',
      managerConfig: null,
      permissionPolicy: expect.objectContaining({ executionMode: 'native-full', fileAccess: 'host-full' }),
      permissionConfirmation: {
        runtimeAdapter: 'codex', runtimeVersion: '1.2.3', platform: 'darwin',
        executableFingerprint: 'sha256:codex', executionMode: 'native-full',
        hostFullAccess: true, limitedProtection: false,
      },
    }))
    await app.close()
  })

  it('persists an explicit restricted Codex policy only with hard runtime evidence', async () => {
    database.machineFind.mockResolvedValue({ agents: [{
      type: 'codex', supportsManagedAgent: true,
      managedAgentProtection: {
        level: 'hard', runtimeVersion: '0.152.1', platform: 'darwin',
        executableFingerprint: 'sha256:codex', unsupportedCapabilities: [],
        capabilityMatrix: {
          fileAccess: { 'workspace-read': true, 'workspace-write': true, 'host-full': true },
          externalCapabilities: Object.fromEntries(['commandNetwork', 'webSearch', 'browser',
            'computerUse', 'mcp'].map((name) => [name, { allow: true, deny: true }])),
        },
      },
    }] })
    services.create.mockResolvedValue({ id: 'isolated' })
    const app = Fastify()
    await app.register(agentCliRoutes, { prefix: '/agent-cli' })
    const policy = { version: 1, executionMode: 'restricted', fileAccess: 'workspace-write',
      externalCapabilities: { commandNetwork: false, webSearch: false,
        browser: false, computerUse: false, mcp: false } }
    const payload = { displayName: 'Friend', description: 'Private', runtimeAdapter: 'codex',
      workDir: '/tmp/friend', permissionPolicy: policy }
    const response = await app.inject({ method: 'POST', url: '/agent-cli/agents', payload })
    expect(response.statusCode).toBe(201)
    expect(services.create).toHaveBeenCalledWith('user-1', expect.objectContaining({
      permissionPolicy: policy,
    }))
    database.machineFind.mockResolvedValue({ agents: [{ type: 'codex', supportsManagedAgent: true,
      managedAgentProtection: { level: 'partial', platform: 'darwin', unsupportedCapabilities: [] },
    }] })
    const rejected = await app.inject({ method: 'POST', url: '/agent-cli/agents', payload })
    expect(rejected.statusCode).toBe(400)
    expect(services.create).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it('rejects hidden advanced fields', async () => {
    const app = Fastify()
    await app.register(agentCliRoutes, { prefix: '/agent-cli' })
    const create = await app.inject({
      method: 'POST', url: '/agent-cli/agents',
      payload: { displayName: 'x', sessionMode: 'manager' },
    })
    const update = await app.inject({
      method: 'PATCH', url: '/agent-cli/agents/agent-1',
      payload: { permissionPolicy: { executionMode: 'restricted' } },
    })
    expect(create.statusCode).toBe(400)
    expect(update.statusCode).toBe(400)
    expect(services.create).not.toHaveBeenCalled()
    expect(services.update).not.toHaveBeenCalled()
    await app.close()
  })

  it('confirms a checked runtime change without exposing advanced policy fields', async () => {
    services.get.mockResolvedValue({
      id: 'agent-1',
      runtimeAdapter: 'claude',
      permissionPolicy: {
        version: 1, executionMode: 'native-full', fileAccess: 'host-full',
        externalCapabilities: {
          commandNetwork: true, webSearch: true, browser: true,
          computerUse: true, mcp: true,
        },
      },
    })
    services.update.mockResolvedValue({ id: 'agent-1', runtimeAdapter: 'codex' })
    const app = Fastify()
    await app.register(agentCliRoutes, { prefix: '/agent-cli' })
    const response = await app.inject({
      method: 'PATCH', url: '/agent-cli/agents/agent-1', payload: { runtimeAdapter: 'codex' },
    })
    expect(response.statusCode).toBe(200)
    expect(services.get).toHaveBeenCalledWith('user-1', 'agent-1', 'machine-1')
    expect(services.update).toHaveBeenCalledWith('user-1', 'agent-1', {
      runtimeAdapter: 'codex',
      permissionConfirmation: {
        runtimeAdapter: 'codex', runtimeVersion: '1.2.3', platform: 'darwin',
        executableFingerprint: 'sha256:codex', executionMode: 'native-full',
        hostFullAccess: true, limitedProtection: false,
      },
    }, 'machine-1')
    await app.close()
  })

  it('preserves a historical restricted policy when its runtime changes', async () => {
    database.machineFind.mockResolvedValue({
      agents: [{
        type: 'codex',
        managedAgentProtection: {
          level: 'partial', runtimeVersion: '1.2.3', platform: 'darwin',
          executableFingerprint: 'sha256:codex', unsupportedCapabilities: ['sandbox'],
        },
      }],
    })
    services.get.mockResolvedValue({
      id: 'agent-1', runtimeAdapter: 'claude',
      permissionPolicy: {
        version: 4, executionMode: 'restricted', fileAccess: 'host-full',
        externalCapabilities: {
          commandNetwork: false, webSearch: false, browser: false,
          computerUse: false, mcp: false,
        },
      },
    })
    services.update.mockResolvedValue({ id: 'agent-1', runtimeAdapter: 'codex' })
    const app = Fastify()
    await app.register(agentCliRoutes, { prefix: '/agent-cli' })
    const response = await app.inject({
      method: 'PATCH', url: '/agent-cli/agents/agent-1', payload: { runtimeAdapter: 'codex' },
    })
    expect(response.statusCode).toBe(200)
    expect(services.update).toHaveBeenCalledWith('user-1', 'agent-1', {
      runtimeAdapter: 'codex',
      permissionConfirmation: expect.objectContaining({
        executionMode: 'restricted', hostFullAccess: true, limitedProtection: true,
      }),
    }, 'machine-1')
    await app.close()
  })

  it('creates an idempotent dedicated Room session only after exact membership and ownership checks', async () => {
    database.membershipFindUnique.mockResolvedValue({
      id: 'human-1', status: 'active', room: { status: 'active' },
    })
    services.get.mockResolvedValue({ id: 'agent-1', sessions: [] })
    services.createSession.mockResolvedValue({ id: 'session-1', agentType: 'codex' })
    const app = Fastify()
    await app.register(agentCliRoutes, { prefix: '/agent-cli' })
    const response = await app.inject({
      method: 'POST',
      url: '/agent-cli/agents/agent-1/room-sessions',
      payload: {
        roomId: 'room-1', assignmentIntentId: 'intent-12345678', activationMode: 'auto_follow',
      },
    })
    expect(response.statusCode).toBe(201)
    expect(services.get).toHaveBeenCalledWith('user-1', 'agent-1', 'machine-1')
    expect(services.createSession).toHaveBeenCalledWith(
      'user-1', 'agent-1', { assignmentIntentId: 'intent-12345678' }, 'machine-1',
    )
    await app.close()
  })

  it('removes only the authenticated owner\'s exact Agent membership and finalizes cleanup', async () => {
    services.get.mockResolvedValue({ id: 'agent-1' })
    database.membershipFindUnique.mockResolvedValue({
      id: 'human-1', status: 'active', room: { status: 'active' },
    })
    database.membershipFindFirst.mockResolvedValue({ id: 'member-agent-1' })
    services.removeMembership.mockResolvedValue({
      removedMembershipIds: ['member-agent-1'],
      committedSessionDeletions: [{ sessionId: 'session-1' }],
      messages: [{ id: 'system-1' }],
      idempotent: false,
    })
    const app = Fastify()
    await app.register(agentCliRoutes, { prefix: '/agent-cli' })
    const response = await app.inject({
      method: 'POST', url: '/agent-cli/agents/agent-1/rooms/room-1/remove', payload: {},
    })
    expect(response.json()).toEqual({ removed: true, idempotent: false })
    expect(database.membershipFindFirst).toHaveBeenCalledWith({
      where: {
        roomId: 'room-1', agentIdentityId: 'agent-1', ownerUserId: 'user-1',
        principalType: 'agent', status: 'active',
      },
      select: { id: true },
    })
    expect(services.removeMembership).toHaveBeenCalledWith({
      roomId: 'room-1', actorMembershipId: 'human-1', targetMembershipId: 'member-agent-1',
    })
    expect(services.finalize).toHaveBeenCalledWith([{ sessionId: 'session-1' }])
    expect(events.message).toHaveBeenCalledWith('room-1', { id: 'system-1' })
    await app.close()
  })
})

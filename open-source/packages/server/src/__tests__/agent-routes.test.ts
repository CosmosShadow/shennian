// @covers open-source/packages/server/src/routes/agents.ts

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => ({
  listAgentWorkspaces: vi.fn(),
  createAgentWorkspace: vi.fn(),
  getAgentWorkspace: vi.fn(),
  updateAgentWorkspace: vi.fn(),
  deleteAgentWorkspace: vi.fn(),
  createAgentWorkspaceSession: vi.fn(),
}))
const auth = vi.hoisted(() => ({
  user: vi.fn(),
  userOrMachine: vi.fn(),
}))
const avatars = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn() }))
const roomEvents = vi.hoisted(() => ({ identityUpdated: vi.fn() }))

// This route suite must not query a configured database for the review-account guard.
vi.mock('../lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn(async () => ({ phone: null })) } },
}))
vi.mock('../services/agent-workspaces.js', () => ({
  ...services,
  AgentWorkspaceError: class AgentWorkspaceError extends Error {},
}))
vi.mock('../services/agent-avatar.js', () => ({
  updateAgentAvatar: avatars.update,
  removeAgentAvatar: avatars.remove,
}))
vi.mock('../services/room-events.js', () => ({
  broadcastRoomIdentityUpdated: roomEvents.identityUpdated,
}))
vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators(app: ReturnType<typeof Fastify>) {
    app.decorateRequest('userId', '')
    app.decorateRequest('deviceId', '')
    app.decorateRequest('machineId', '')
  },
  async requireUserOrMachineAuth(request: { userId: string; machineId: string }) {
    auth.userOrMachine()
    request.userId = 'user-1'
    request.machineId = 'machine-1'
  },
  async requireAuth(request: { userId: string }) {
    auth.user()
    request.userId = 'user-1'
  },
  requireActivePlan: vi.fn(async () => {}),
}))

import { agentRoutes } from '../routes/agents.js'

describe('Agent routes with user auth', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists and creates Agent workspaces only in the authenticated user scope', async () => {
    services.listAgentWorkspaces.mockResolvedValue([])
    services.createAgentWorkspace.mockResolvedValue({ id: 'agent-1' })
    const app = Fastify()
    await app.register(agentRoutes, { prefix: '/agents' })

    const list = await app.inject({ method: 'GET', url: '/agents' })
    const create = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        displayName: '客服',
        machineId: 'machine-1',
        runtimeAdapter: 'codex',
        workDir: '/code/shennian',
      },
    })

    expect(list.statusCode).toBe(200)
    expect(services.listAgentWorkspaces).toHaveBeenCalledWith('user-1')
    expect(create.statusCode).toBe(200)
    expect(services.createAgentWorkspace).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ machineId: 'machine-1' }),
    )
    expect(auth.user).toHaveBeenCalledTimes(2)
    expect(auth.userOrMachine).not.toHaveBeenCalled()
    await app.close()
  })

  it('lets the service enforce Agent ownership for user-authenticated updates', async () => {
    services.updateAgentWorkspace.mockResolvedValue({ id: 'agent-1' })
    const app = Fastify()
    await app.register(agentRoutes, { prefix: '/agents' })
    const response = await app.inject({
      method: 'PATCH',
      url: '/agents/agent-1',
      payload: { displayName: '客服二号' },
    })

    expect(response.statusCode).toBe(200)
    expect(services.updateAgentWorkspace).toHaveBeenCalledWith(
      'user-1',
      'agent-1',
      { displayName: '客服二号' },
    )
    expect(auth.userOrMachine).not.toHaveBeenCalled()
    await app.close()
  })

  it('keeps global Agent deletion behind user auth', async () => {
    services.deleteAgentWorkspace.mockResolvedValue({ deletedSessionIds: ['session-1'] })
    const app = Fastify()
    await app.register(agentRoutes, { prefix: '/agents' })
    const response = await app.inject({ method: 'DELETE', url: '/agents/agent-1' })

    expect(response.statusCode).toBe(200)
    expect(services.deleteAgentWorkspace).toHaveBeenCalledWith('user-1', 'agent-1')
    await app.close()
  })

  it('invalidates active Room identities after changing or removing an Agent avatar', async () => {
    const avatar = { version: 'v2', smallUrl: '/small', mediumUrl: '/medium', updatedAt: 'now' }
    avatars.update.mockResolvedValue({ avatar })
    avatars.remove.mockResolvedValue({ avatar: null })
    const app = Fastify()
    await app.register(agentRoutes, { prefix: '/agents' })

    const update = await app.inject({
      method: 'PUT', url: '/agents/agent-1/avatar',
      headers: { 'content-type': 'image/jpeg' }, payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    })
    const remove = await app.inject({ method: 'DELETE', url: '/agents/agent-1/avatar' })

    expect(update.statusCode).toBe(200)
    expect(remove.statusCode).toBe(200)
    expect(roomEvents.identityUpdated).toHaveBeenNthCalledWith(1, { agentIdentityId: 'agent-1' })
    expect(roomEvents.identityUpdated).toHaveBeenNthCalledWith(2, { agentIdentityId: 'agent-1' })
    await app.close()
  })
})

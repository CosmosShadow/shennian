// @covers open-source/packages/server/src/routes/agents.ts
// @covers open-source/packages/server/src/middleware/auth.ts

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { signMachineToken } from '../services/jwt.js'

const services = vi.hoisted(() => ({
  listAgentWorkspaces: vi.fn(),
}))

vi.mock('../services/agent-workspaces.js', () => ({
  ...services,
  AgentWorkspaceError: class AgentWorkspaceError extends Error {},
  createAgentWorkspace: vi.fn(),
  createAgentWorkspaceSession: vi.fn(),
  deleteAgentWorkspace: vi.fn(),
  getAgentWorkspace: vi.fn(),
  updateAgentWorkspace: vi.fn(),
}))

import { agentRoutes } from '../routes/agents.js'

describe('Agent API machineToken boundary', () => {
  it('rejects a real machine JWT before any Agent workspace read', async () => {
    const app = Fastify()
    await app.register(agentRoutes, { prefix: '/agents' })

    const response = await app.inject({
      method: 'GET',
      url: '/agents',
      headers: { authorization: `Bearer ${signMachineToken('machine-test')}` },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'Invalid token' })
    expect(services.listAgentWorkspaces).not.toHaveBeenCalled()
    await app.close()
  })
})

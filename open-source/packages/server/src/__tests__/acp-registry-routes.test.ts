// @covers open-source/packages/server/src/routes/acp-registry.ts

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPublicAcpAgentCatalog: vi.fn(),
  getAcpRegistrySnapshot: vi.fn(),
  recordAcpDaemonCatalogRevision: vi.fn(),
}))

vi.mock('../services/acp-registry.js', () => mocks)

import { acpRegistryRoutes } from '../routes/acp-registry.js'

describe('public ACP Registry route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the display-only catalog without authentication', async () => {
    mocks.getPublicAcpAgentCatalog.mockResolvedValue({
      sourceVersion: '1.0.0',
      fetchedAt: '2026-09-09T00:00:00.000Z',
      agents: [{ id: 'agent-one', name: 'Agent One', version: '1.0.0', platforms: ['darwin-aarch64'] }],
    })
    const app = Fastify()
    await app.register(acpRegistryRoutes)

    const response = await app.inject({ method: 'GET', url: '/public/acp-agents' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toContain('stale-while-revalidate')
    expect(response.json()).toMatchObject({ agents: [{ id: 'agent-one', name: 'Agent One' }] })
  })

  it('uses a recoverable unavailable response when no validated snapshot exists', async () => {
    mocks.getPublicAcpAgentCatalog.mockResolvedValue(null)
    const app = Fastify()
    await app.register(acpRegistryRoutes)
    const response = await app.inject({ method: 'GET', url: '/api/public/acp-agents' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'acp_registry_unavailable' })
  })
})

// @covers src/routes/internal-admin.ts

import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { health, maintenance, mockPrisma } = vi.hoisted(() => ({
  health: vi.fn(),
  maintenance: vi.fn(),
  mockPrisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/room-operations.js', () => ({ getRoomOperationsSnapshot: health }))
vi.mock('../jobs/room-attachment-maintenance.js', () => ({ runRoomAttachmentMaintenance: maintenance }))

import { internalAdminRoutes } from '../routes/internal-admin.js'

describe('internal Room operations routes', () => {
  beforeEach(() => {
    process.env.SHENNIAN_ADMIN_TOKEN = 'admin-test-token'
    health.mockResolvedValue({ status: 'ok', alerts: [] })
    maintenance.mockResolvedValue({ expiredTombstoned: 0, orphansReclaimed: 0 })
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.SHENNIAN_ADMIN_TOKEN
  })

  it('rejects health and maintenance without the private admin credential', async () => {
    const app = Fastify()
    await app.register(internalAdminRoutes)

    expect((await app.inject({ method: 'GET', url: '/rooms/health' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/personal-sync/health' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/rooms/maintenance' })).statusCode).toBe(401)
    expect(health).not.toHaveBeenCalled()
    expect(maintenance).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns aggregate health and runs one coalesced maintenance pass for an admin', async () => {
    const app = Fastify()
    await app.register(internalAdminRoutes)
    const headers = { 'x-admin-token': 'admin-test-token' }

    const snapshot = await app.inject({ method: 'GET', url: '/rooms/health', headers })
    const personalSync = await app.inject({ method: 'GET', url: '/personal-sync/health', headers })
    const run = await app.inject({ method: 'POST', url: '/rooms/maintenance', headers })

    expect(snapshot.statusCode).toBe(200)
    expect(snapshot.json()).toEqual({ status: 'ok', alerts: [] })
    expect(personalSync.json()).toMatchObject({
      status: 'ok',
      activeSubscriptions: 0,
      privacy: { containsMessageBody: false, containsToolPayload: false },
    })
    expect(run.statusCode).toBe(200)
    expect(run.json()).toEqual({ report: { expiredTombstoned: 0, orphansReclaimed: 0 } })
    expect(health).toHaveBeenCalledOnce()
    expect(maintenance).toHaveBeenCalledOnce()
    await app.close()
  })
})

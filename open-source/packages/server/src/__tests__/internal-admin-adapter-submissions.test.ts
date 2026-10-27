// @covers src/routes/internal-admin.ts

import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const adapterReview = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}))
vi.mock('../services/room-operations.js', () => ({ getRoomOperationsSnapshot: vi.fn() }))
vi.mock('../jobs/room-attachment-maintenance.js', () => ({ runRoomAttachmentMaintenance: vi.fn() }))
vi.mock('../services/personal-sync-operations.js', () => ({
  getPersonalSyncOperationsSnapshot: vi.fn(() => ({ status: 'ok' })),
}))
vi.mock('../services/adapter-submissions.js', () => ({
  AdapterSubmissionError: class AdapterSubmissionError extends Error {
    constructor(readonly code: string, message: string, readonly statusCode = 400) {
      super(message)
    }
  },
  listAdapterSubmissionsForReview: adapterReview.list,
  getAdapterSubmissionForReview: adapterReview.get,
}))

import { internalAdminRoutes } from '../routes/internal-admin.js'

describe('internal Adapter submission review routes', () => {
  beforeEach(() => {
    process.env.SHENNIAN_ADMIN_TOKEN = 'admin-test-token'
    adapterReview.list.mockResolvedValue([{ id: 'submission-1', status: 'pending' }])
    adapterReview.get.mockResolvedValue({
      id: 'submission-1',
      status: 'pending',
      filename: 'adapter.mjs',
      content: 'export default {}',
      officialAdapterRegistered: false,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.SHENNIAN_ADMIN_TOKEN
  })

  it('keeps both the review queue and source detail behind the private admin credential', async () => {
    const app = Fastify()
    await app.register(internalAdminRoutes)
    expect((await app.inject({ method: 'GET', url: '/adapter-submissions' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/adapter-submissions/submission-1' })).statusCode).toBe(401)

    const headers = { 'x-admin-token': 'admin-test-token' }
    const list = await app.inject({ method: 'GET', url: '/adapter-submissions', headers })
    const detail = await app.inject({
      method: 'GET',
      url: '/adapter-submissions/submission-1',
      headers,
    })
    expect(list.json()).toEqual({ submissions: [{ id: 'submission-1', status: 'pending' }] })
    expect(detail.json()).toEqual({
      submission: expect.objectContaining({
        id: 'submission-1',
        filename: 'adapter.mjs',
        content: 'export default {}',
        officialAdapterRegistered: false,
      }),
    })
    expect(adapterReview.list).toHaveBeenCalledOnce()
    expect(adapterReview.get).toHaveBeenCalledWith('submission-1')
    await app.close()
  })
})

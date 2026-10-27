// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/routes/projects.ts

import Fastify from 'fastify'
import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUserProject: vi.fn(),
  listProjectSessions: vi.fn(),
  pruneOldestProjectSessions: vi.fn(),
  prisma: {
    device: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mocks.prisma }))
vi.mock('../services/jwt.js', () => ({
  verifyToken: vi.fn(() => ({ userId: 'user-1', deviceId: 'device-1' })),
  verifyMachineToken: vi.fn(),
}))
vi.mock('../services/plan-access.js', () => ({
  PlanAccessError: class extends Error {},
  requirePlanAccess: vi.fn(),
}))
vi.mock('../services/projects.js', () => ({
  createProjectForUser: vi.fn(),
  getUserProject: mocks.getUserProject,
  listUserProjects: vi.fn(async () => []),
  removeProjectForUser: vi.fn(),
}))
vi.mock('../services/sessions.js', () => ({
  deleteSessionForUser: vi.fn(),
  listProjectSessions: mocks.listProjectSessions,
}))
vi.mock('../services/project-session-pruning.js', () => ({
  pruneOldestProjectSessions: mocks.pruneOldestProjectSessions,
}))

import { projectRoutes } from '../routes/projects.js'

describe('project session routes', () => {
  const app = Fastify()

  beforeEach(async () => {
    vi.stubEnv('SHENNIAN_REVIEW_ACCOUNT_PHONES', '+8619900000002')
    vi.stubEnv('SHENNIAN_REVIEW_LOGIN_CODE', '654321')
    vi.clearAllMocks()
    mocks.prisma.device.findUnique.mockResolvedValue({
      id: 'device-1',
      tokenExpiry: new Date(Date.now() + 60_000),
    })
    mocks.prisma.user.findUnique.mockResolvedValue({ phone: '+8619900000001' })
    mocks.getUserProject.mockResolvedValue({
      id: 'project-1',
      machineId: 'machine-1',
      workDir: '/code/demo',
    })
    if (!app.hasRoute({ method: 'GET', url: '/projects' })) {
      await app.register(projectRoutes, { prefix: '/projects' })
      await app.ready()
    }
  })

  afterAll(async () => app.close())

  it('returns one project metadata page and an explicit hasMore flag', async () => {
    mocks.listProjectSessions.mockResolvedValue([
      { id: 's1', lastActivityAt: '2026-01-02T00:00:00.000Z' },
      { id: 's2', lastActivityAt: '2026-01-01T00:00:00.000Z' },
    ])

    const response = await app.inject({
      method: 'GET',
      url: '/projects/project-1/sessions?limit=1&before=1767312000000',
      headers: {
        authorization: 'Bearer token',
        'x-shennian-sync-protocol-version': '2',
        'x-shennian-data-epoch': '2',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      sessions: [{ id: 's1', lastActivityAt: '2026-01-02T00:00:00.000Z' }],
      hasMore: true,
    })
    expect(mocks.listProjectSessions).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workDir: '/code/demo',
      userId: 'user-1',
      limit: 2,
      before: new Date(1767312000000),
    })
  })

  it('delegates protected oldest-session pruning to the server service', async () => {
    mocks.pruneOldestProjectSessions.mockResolvedValue({
      deletedSessionIds: ['s-old'],
      protectedCount: 2,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/projects/project-1/sessions/prune-oldest',
      headers: {
        authorization: 'Bearer token',
        'x-shennian-sync-protocol-version': '2',
        'x-shennian-data-epoch': '2',
      },
      payload: { count: 20 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ deletedSessionIds: ['s-old'], protectedCount: 2 })
    expect(mocks.pruneOldestProjectSessions).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workDir: '/code/demo',
      userId: 'user-1',
      count: 20,
    })
  })

  it('rejects review accounts before exposing machine-linked project metadata', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ phone: '+8619900000002' })

    const response = await app.inject({
      method: 'GET',
      url: '/projects/project-1/sessions',
      headers: {
        authorization: 'Bearer token',
        'x-shennian-sync-protocol-version': '2',
        'x-shennian-data-epoch': '2',
      },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'review_account_machine_access_forbidden' })
    expect(mocks.getUserProject).not.toHaveBeenCalled()
  })
})

afterEach(() => vi.unstubAllEnvs())

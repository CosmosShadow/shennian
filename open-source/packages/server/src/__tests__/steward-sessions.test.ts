// @covers open-source/packages/server/src/services/sessions.ts
// @covers open-source/packages/server/src/services/session-projection.ts
// @covers open-source/packages/server/src/services/projects.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    machine: { findMany: vi.fn() },
    nianSession: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn() },
    sessionProject: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/session-activity.js', () => ({
  getSessionActivities: vi.fn(async () => new Map()),
}))

import { buildOrdinarySessionWhere, getManagerAgentSessionIds } from '../services/session-projection.js'
import { listStewardSessions, renameSessionForUser } from '../services/sessions.js'
import { upsertSessionProject } from '../services/projects.js'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.user.findMany.mockResolvedValue([])
})

describe('steward scope stays out of ordinary lists', () => {
  it('excludes steward sessions from every ordinary query variant', () => {
    for (const options of [undefined, { includeProjectWorkers: true }]) {
      const where = buildOrdinarySessionWhere({ machineId: 'machine-1' }, [], {}, options) as {
        NOT: Array<Record<string, unknown>>
      }
      expect(where.NOT).toContainEqual({ sessionScope: 'steward' })
    }
  })

  it('treats steward native ids as internal so imported native copies stay hidden', async () => {
    mockPrisma.nianSession.findMany.mockResolvedValue([{ agentSessionId: 'native-1' }])
    await expect(getManagerAgentSessionIds(['machine-1'])).resolves.toEqual(['native-1'])
    const where = mockPrisma.nianSession.findMany.mock.calls[0]![0].where
    expect(where.OR).toContainEqual({ sessionScope: 'steward' })
  })

  it('never projects a steward workspace as a project', async () => {
    await upsertSessionProject({
      machineId: 'machine-1', workDir: '/Users/me/.shennian-steward',
      agentIdentityId: null, sessionScope: 'steward',
    })
    expect(mockPrisma.sessionProject.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.sessionProject.create).not.toHaveBeenCalled()
  })

  it('still projects an ordinary session workspace', async () => {
    mockPrisma.sessionProject.findUnique.mockResolvedValue(null)
    await upsertSessionProject({
      machineId: 'machine-1', workDir: '/Users/me/code/app',
      agentIdentityId: null, sessionScope: 'personal',
    })
    expect(mockPrisma.sessionProject.create).toHaveBeenCalled()
  })
})

describe('steward history query', () => {
  it('is scoped to the caller, their own machines and steward sessions', async () => {
    mockPrisma.machine.findMany.mockResolvedValue([{ id: 'machine-1', name: 'Mac' }])
    mockPrisma.nianSession.findMany.mockResolvedValue([])
    await listStewardSessions({ userId: 'user-1', limit: 20 })
    expect(mockPrisma.machine.findMany.mock.calls[0]![0].where).toEqual({ userId: 'user-1' })
    expect(mockPrisma.nianSession.findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        machineId: { in: ['machine-1'] }, userId: 'user-1',
        sessionScope: 'steward', deletedAt: null,
      },
      orderBy: { lastActivityAt: 'desc' },
      take: 20,
    })
  })

  it('narrows to one machine and never queries when the caller does not own it', async () => {
    mockPrisma.machine.findMany.mockResolvedValue([])
    await expect(listStewardSessions({ userId: 'user-1', machineId: 'shared-machine', limit: 20 })).resolves.toEqual([])
    expect(mockPrisma.machine.findMany.mock.calls[0]![0].where).toEqual({ userId: 'user-1', id: 'shared-machine' })
    expect(mockPrisma.nianSession.findMany).not.toHaveBeenCalled()
  })

  it('pages by last activity', async () => {
    mockPrisma.machine.findMany.mockResolvedValue([{ id: 'machine-1', name: 'Mac' }])
    mockPrisma.nianSession.findMany.mockResolvedValue([])
    const before = new Date('2026-09-29T00:00:00.000Z')
    await listStewardSessions({ userId: 'user-1', limit: 5, before })
    expect(mockPrisma.nianSession.findMany.mock.calls[0]![0].where.lastActivityAt).toEqual({ lt: before })
  })
})

describe('switching the steward AI tool in place', () => {
  const session = (patch: Record<string, unknown> = {}) => ({
    id: 'sess-1', userId: 'user-1', machineId: 'machine-1', deletedAt: null,
    sessionScope: 'steward', agentType: 'claude', agentIdentity: null, ...patch,
  })

  beforeEach(() => {
    mockPrisma.nianSession.update.mockResolvedValue({
      id: 'sess-1', updatedAt: new Date(), title: '', titleSource: 'agent', titleRevision: 0,
      titleLockedByUser: false, titleOriginEventId: null, modelId: null, modelSource: 'session',
      agentType: 'codex', agentSessionId: null, workDir: '/w',
      managerDefaultWorkerAgentType: null, managerDefaultWorkerModelId: null,
    })
  })

  it('moves a steward conversation to another tool and clears its model', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue(session())
    await renameSessionForUser({ sessionId: 'sess-1', userId: 'user-1', agentType: 'codex', modelId: null })
    expect(mockPrisma.nianSession.update.mock.calls[0]![0].data).toMatchObject({ agentType: 'codex', modelId: null })
  })

  it('refuses to retarget an ordinary conversation, which must fork instead', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue(session({ sessionScope: 'personal' }))
    await expect(renameSessionForUser({ sessionId: 'sess-1', userId: 'user-1', agentType: 'codex' }))
      .rejects.toThrow('Agent switch is unavailable')
    expect(mockPrisma.nianSession.update).not.toHaveBeenCalled()
  })
})

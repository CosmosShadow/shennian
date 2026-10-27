// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/routes/sessions.ts
// @covers open-source/packages/server/src/services/codex-title-sync.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  SESSION_SYNC_REQUIRED_CAPABILITIES,
} from '@shennian/wire'

const SYNC_HEADERS = {
  'x-shennian-sync-protocol-version': String(SESSION_SYNC_PROTOCOL_VERSION),
  'x-shennian-data-epoch': String(SESSION_SYNC_DATA_EPOCH),
}

const SYNC_MACHINE = {
  id: 'm1',
  userId: 'user1',
  name: 'Macbook',
  online: true,
  sessionSyncProtocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
  sessionSyncDataEpoch: SESSION_SYNC_DATA_EPOCH,
  sessionSyncCapabilities: [...SESSION_SYNC_REQUIRED_CAPABILITIES],
  daemonInstallationId: 'daemon-installation-1',
  agents: [
    { type: 'codex', supportsManagerMode: true },
    { type: 'claude', supportsManagerMode: true },
  ],
}

const { mockPrisma, mockConnections, mockPubsub, mockSendServerReqToMachine } = vi.hoisted(() => ({
  mockPrisma: {
    nianSession: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    sessionDeletion: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    sessionProject: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    nativeSourceDeletion: {
      upsert: vi.fn(),
    },
    machine: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    machineGrant: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    device: {
      findUnique: vi.fn(),
    },
    sessionUserState: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    requestLog: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(async (ops: unknown) => {
      if (typeof ops === 'function') {
        return ops(mockPrisma)
      }
      return Promise.all(ops as Promise<unknown>[])
    }),
  },
  mockConnections: {
    broadcastToClients: vi.fn(() => 0),
    broadcastToClientsOfUser: vi.fn(() => 0),
  },
  mockPubsub: {
    publishToClient: vi.fn(),
    publishToUser: vi.fn(),
    isActive: false,
  },
  mockSendServerReqToMachine: vi.fn(async () => ({ type: 'res', id: 'title', ok: true })),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../relay/connections.js', () => ({ connections: mockConnections }))
vi.mock('../relay/pubsub.js', () => ({ pubsub: mockPubsub }))
vi.mock('../relay/server-requests.js', () => ({
  sendServerReqToMachine: mockSendServerReqToMachine,
}))
vi.mock('../services/jwt.js', () => ({
  verifyToken: vi.fn((token: string) => {
    if (token === 'valid-token') return { userId: 'user1', deviceId: 'dev1' }
    return null
  }),
  verifyMachineToken: vi.fn(() => null),
  signToken: vi.fn(),
  signRefreshToken: vi.fn(),
}))

import { sessionRoutes } from '../routes/sessions.js'

describe('Sessions API', () => {
  let app: FastifyInstance
  let rawInject: FastifyInstance['inject']

  beforeEach(async () => {
    vi.clearAllMocks()

    mockPrisma.device.findUnique.mockResolvedValue({
      id: 'dev1',
      tokenExpiry: new Date(Date.now() + 3600000),
    })
    mockPrisma.sessionProject.findUnique.mockResolvedValue(null)
    mockPrisma.sessionProject.create.mockResolvedValue({})
    mockPrisma.nianSession.update.mockResolvedValue({
      id: 's1',
      lastMessagePreview: 'hi there',
      lastActivityAt: new Date('2026-04-07T02:17:00.000Z'),
      updatedAt: new Date('2026-04-07T02:17:00.000Z'),
    })
    mockPrisma.sessionDeletion.findMany.mockResolvedValue([])
    mockPrisma.sessionDeletion.findUnique.mockResolvedValue(null)
    mockPrisma.sessionDeletion.upsert.mockResolvedValue({})
    mockPrisma.requestLog.deleteMany.mockResolvedValue({ count: 0 })
    mockPrisma.machine.findMany.mockResolvedValue([])
    mockPrisma.machine.findUnique.mockResolvedValue(SYNC_MACHINE)
    mockPrisma.machine.update.mockResolvedValue({ deletionRevision: 1 })
    mockPrisma.machineGrant.findMany.mockResolvedValue([])
    mockPrisma.user.findUnique.mockResolvedValue({ accountTier: 'enterprise' })
    mockPrisma.user.findMany.mockResolvedValue([])

    app = Fastify()
    await app.register(sessionRoutes, { prefix: '/sessions' })
    await app.ready()
    rawInject = app.inject.bind(app)
    app.inject = ((options: Parameters<FastifyInstance['inject']>[0]) =>
      rawInject({
        ...options,
        headers: { ...SYNC_HEADERS, ...(options as { headers?: Record<string, string> }).headers },
      })) as FastifyInstance['inject']
  })

  afterEach(async () => {
    await app.close()
  })

  describe('DELETE /:id', () => {
    it('uses the session daemon identity after machine removal and keeps native tombstones', async () => {
      mockPrisma.nianSession.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'user1',
        machineId: 'm1',
        daemonInstallationId: 'daemon-installation-1',
        agentType: 'opencode',
        agentSessionId: 'native-session-1',
        roomNativeSources: [
          {
            agentType: 'opencode',
            sourceSessionKey: 'native-session-1',
          },
        ],
        machine: { daemonInstallationId: null },
        deletedAt: null,
      })

      const res = await app.inject({
        method: 'DELETE',
        url: '/sessions/s1',
        headers: { authorization: 'Bearer valid-token' },
        payload: { nativeCleanupPolicy: 'auto' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, alreadyDeleted: false })
      expect(mockPrisma.sessionDeletion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: 's1' },
          create: expect.objectContaining({
            sessionId: 's1',
            userId: 'user1',
            machineId: 'm1',
            daemonInstallationId: 'daemon-installation-1',
            deletionRevision: 1,
            nativeCleanupPolicy: 'auto',
          }),
        }),
      )
      expect(mockPrisma.nativeSourceDeletion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            daemonInstallationId_agentType_sourceSessionKeyHash: {
              daemonInstallationId: 'daemon-installation-1',
              agentType: 'opencode',
              sourceSessionKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            },
          },
          create: expect.objectContaining({
            accountId: 'user1',
            sessionId: 's1',
            machineId: 'm1',
            daemonInstallationId: 'daemon-installation-1',
            agentType: 'opencode',
            sourceSessionKey: 'native-session-1',
            deletionRevision: 1,
          }),
        }),
      )
      expect(mockPrisma.requestLog.deleteMany).toHaveBeenCalledWith({ where: { sessionId: 's1' } })
      expect(mockPrisma.nianSession.delete).toHaveBeenCalledWith({ where: { id: 's1' } })
      expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
        'user1',
        expect.stringContaining('"session.delete"'),
      )
    })

    it('defaults missing policy to none and rejects unknown future values', async () => {
      mockPrisma.nianSession.findUnique.mockResolvedValue({
        id: 'legacy-policy',
        userId: 'user1',
        machineId: 'm1',
        agentType: 'cursor',
        agentSessionId: 'native-cursor-1',
        roomNativeSources: [],
        machine: { daemonInstallationId: 'daemon-installation-1' },
        deletedAt: null,
      })

      const legacy = await app.inject({
        method: 'DELETE',
        url: '/sessions/legacy-policy',
        headers: { authorization: 'Bearer valid-token' },
      })
      expect(legacy.statusCode).toBe(200)
      expect(mockPrisma.sessionDeletion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ nativeCleanupPolicy: 'none' }),
        }),
      )

      const invalid = await app.inject({
        method: 'DELETE',
        url: '/sessions/legacy-policy',
        headers: { authorization: 'Bearer valid-token' },
        payload: { nativeCleanupPolicy: 'force-delete' },
      })
      expect(invalid.statusCode).toBe(400)
      expect(invalid.json()).toEqual({ error: 'invalid nativeCleanupPolicy' })
    })

    it('deletes a legacy cloud session when neither session nor machine has a daemon identity', async () => {
      mockPrisma.nianSession.findUnique.mockResolvedValue({
        id: 'legacy-no-installation',
        userId: 'user1',
        machineId: 'm1',
        daemonInstallationId: null,
        agentType: 'codex',
        agentSessionId: 'legacy-native-session',
        workDir: '/repo',
        roomNativeSources: [],
        machine: { daemonInstallationId: null },
        deletedAt: null,
      })

      const res = await app.inject({
        method: 'DELETE',
        url: '/sessions/legacy-no-installation',
        headers: { authorization: 'Bearer valid-token' },
        payload: { nativeCleanupPolicy: 'auto' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, alreadyDeleted: false, deletionRevision: 1 })
      expect(mockPrisma.sessionDeletion.upsert).not.toHaveBeenCalled()
      expect(mockPrisma.nativeSourceDeletion.upsert).not.toHaveBeenCalled()
      expect(mockPrisma.requestLog.deleteMany).toHaveBeenCalledWith({
        where: { sessionId: 'legacy-no-installation' },
      })
      expect(mockPrisma.nianSession.delete).toHaveBeenCalledWith({
        where: { id: 'legacy-no-installation' },
      })
    })

    it('treats a repeated delete with an owned tombstone as idempotent success', async () => {
      const deletedAt = new Date('2026-08-29T07:42:00.155Z')
      mockPrisma.nianSession.findUnique.mockResolvedValue(null)
      mockPrisma.sessionDeletion.findUnique.mockResolvedValue({
        userId: 'user1',
        deletedAt,
        deletionRevision: 4,
      })

      const res = await app.inject({
        method: 'DELETE',
        url: '/sessions/s1',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        ok: true,
        alreadyDeleted: true,
        deletedAt: deletedAt.toISOString(),
        deletionRevision: 4,
      })
      expect(mockPrisma.nianSession.delete).not.toHaveBeenCalled()
    })

    it('treats the loser of concurrent DELETE transactions as idempotent success', async () => {
      const deletedAt = new Date('2026-09-02T08:00:00.000Z')
      mockPrisma.nianSession.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'user1',
        machineId: 'm1',
        agentType: 'codex',
        agentSessionId: '123e4567-e89b-42d3-a456-426614174000',
        roomNativeSources: [],
        machine: { daemonInstallationId: 'daemon-installation-1' },
        deletedAt: null,
      })
      mockPrisma.$transaction.mockRejectedValueOnce(new Error('row already deleted'))
      mockPrisma.sessionDeletion.findUnique.mockResolvedValueOnce({
        userId: 'user1',
        deletedAt,
        deletionRevision: 9,
      })

      const res = await app.inject({
        method: 'DELETE',
        url: '/sessions/s1',
        headers: { authorization: 'Bearer valid-token' },
        payload: { nativeCleanupPolicy: 'auto' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        ok: true,
        alreadyDeleted: true,
        deletedAt: deletedAt.toISOString(),
        deletionRevision: 9,
      })
      expect(mockConnections.broadcastToClientsOfUser).not.toHaveBeenCalled()
    })

    it('does not wait for any retired cloud transcript cleanup path', async () => {
      mockPrisma.nianSession.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'user1',
        machineId: 'm1',
        agentType: 'codex',
        agentSessionId: 'native-1',
        roomNativeSources: [],
        machine: { daemonInstallationId: 'daemon-installation-1' },
        deletedAt: null,
      })

      const res = await app.inject({
        method: 'DELETE',
        url: '/sessions/s1',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, alreadyDeleted: false })
    })

    it('returns 403 for a session owned by another user', async () => {
      mockPrisma.nianSession.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'other-user',
        machineId: 'm1',
        dataEpoch: 2,
        deletedAt: null,
      })

      const res = await app.inject({
        method: 'DELETE',
        url: '/sessions/s1',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(403)
      expect(mockPrisma.nianSession.delete).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /:id/user-state', () => {
    it('does not move lastReadAt backwards when an older read watermark arrives late', async () => {
      mockPrisma.nianSession.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'user1',
        machineId: 'm1',
        dataEpoch: 2,
        deletedAt: null,
        bodyRevision: 9,
        visibleMessageCount: 8,
        lastVisibleMessageId: 'm8',
        attentionCount: 2,
        lastAttentionId: 'a2',
      })
      mockPrisma.machine.findUnique.mockResolvedValue({
        id: 'm1',
        userId: 'user1',
      })
      mockPrisma.sessionUserState.findUnique
        .mockResolvedValueOnce({
          userId: 'user1',
          sessionId: 's1',
          pinnedAt: null,
          lastReadAt: new Date('2026-04-10T10:06:00.000Z'),
          manualUnread: false,
          updatedAt: new Date('2026-04-10T10:06:00.000Z'),
        })
        .mockResolvedValueOnce({
          userId: 'user1',
          sessionId: 's1',
          pinnedAt: null,
          lastReadAt: new Date('2026-04-10T10:06:00.000Z'),
          manualUnread: false,
          updatedAt: new Date('2026-04-10T10:06:00.000Z'),
        })
      mockPrisma.sessionUserState.upsert.mockResolvedValue({
        userId: 'user1',
        sessionId: 's1',
        pinnedAt: null,
        lastReadAt: new Date('2026-04-10T10:06:00.000Z'),
        manualUnread: false,
        updatedAt: new Date('2026-04-10T10:06:00.000Z'),
      })

      const res = await app.inject({
        method: 'PATCH',
        url: '/sessions/s1/user-state',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          lastReadAt: '2026-04-10T10:05:00.000Z',
          manualUnread: false,
        },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.sessionUserState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            lastReadAt: new Date('2026-04-10T10:06:00.000Z'),
            manualUnread: false,
          }),
        }),
      )
    })

    it('captures only the attention watermark actually presented by the client', async () => {
      mockPrisma.nianSession.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'user1',
        machineId: 'm1',
        dataEpoch: 2,
        deletedAt: null,
        bodyRevision: 12,
        visibleMessageCount: 10,
        lastVisibleMessageId: 'm10',
        attentionCount: 3,
        lastAttentionId: 'a3',
      })
      mockPrisma.machine.findUnique.mockResolvedValue({ id: 'm1', userId: 'user1' })
      mockPrisma.sessionUserState.findUnique.mockResolvedValue({
        userId: 'user1',
        sessionId: 's1',
        pinnedAt: null,
        lastReadAt: null,
        lastReadBodyRevision: 0,
        lastReadVisibleMessageCount: 0,
        lastReadVisibleMessageId: null,
        lastReadAttentionCount: 0,
        lastReadAttentionId: null,
        manualUnread: false,
        updatedAt: new Date(0),
      })
      mockPrisma.sessionUserState.upsert.mockResolvedValue({
        userId: 'user1',
        sessionId: 's1',
        pinnedAt: null,
        lastReadAt: new Date('2026-09-02T10:00:00.000Z'),
        lastReadBodyRevision: 8,
        lastReadVisibleMessageCount: 7,
        lastReadVisibleMessageId: 'm7',
        lastReadAttentionCount: 1,
        lastReadAttentionId: 'a1',
        manualUnread: false,
        updatedAt: new Date(),
      })

      const res = await app.inject({
        method: 'PATCH',
        url: '/sessions/s1/user-state',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          lastReadAt: '2026-09-02T10:00:00.000Z',
          manualUnread: false,
          readWatermark: {
            bodyRevision: 8,
            visibleMessageCount: 7,
            lastVisibleMessageId: 'm7',
            attentionCount: 1,
            lastAttentionId: 'a1',
          },
        },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.sessionUserState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            lastReadBodyRevision: 8,
            lastReadVisibleMessageCount: 7,
            lastReadVisibleMessageId: 'm7',
            lastReadAttentionCount: 1,
            lastReadAttentionId: 'a1',
          }),
        }),
      )
    })

    it('does not regress a newer attention watermark from another device', async () => {
      mockPrisma.nianSession.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'user1',
        machineId: 'm1',
        dataEpoch: 2,
        deletedAt: null,
        bodyRevision: 12,
        visibleMessageCount: 10,
        lastVisibleMessageId: 'm10',
        attentionCount: 3,
        lastAttentionId: 'a3',
      })
      mockPrisma.machine.findUnique.mockResolvedValue({ id: 'm1', userId: 'user1' })
      mockPrisma.sessionUserState.findUnique.mockResolvedValue({
        userId: 'user1',
        sessionId: 's1',
        pinnedAt: null,
        lastReadAt: new Date('2026-09-02T10:01:00.000Z'),
        lastReadBodyRevision: 10,
        lastReadVisibleMessageCount: 9,
        lastReadVisibleMessageId: 'm9',
        lastReadAttentionCount: 2,
        lastReadAttentionId: 'a2',
        manualUnread: false,
        updatedAt: new Date(),
      })
      mockPrisma.sessionUserState.upsert.mockResolvedValue({
        userId: 'user1',
        sessionId: 's1',
        pinnedAt: null,
        lastReadAt: new Date('2026-09-02T10:01:00.000Z'),
        lastReadBodyRevision: 10,
        lastReadVisibleMessageCount: 9,
        lastReadVisibleMessageId: 'm9',
        lastReadAttentionCount: 2,
        lastReadAttentionId: 'a2',
        manualUnread: false,
        updatedAt: new Date(),
      })

      const res = await app.inject({
        method: 'PATCH',
        url: '/sessions/s1/user-state',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          lastReadAt: '2026-09-02T10:00:00.000Z',
          readWatermark: {
            bodyRevision: 8,
            visibleMessageCount: 7,
            lastVisibleMessageId: 'm7',
            attentionCount: 1,
            lastAttentionId: 'a1',
          },
        },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.sessionUserState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            lastReadBodyRevision: 10,
            lastReadVisibleMessageCount: 9,
            lastReadVisibleMessageId: 'm9',
            lastReadAttentionCount: 2,
            lastReadAttentionId: 'a2',
          }),
        }),
      )
    })
  })
})

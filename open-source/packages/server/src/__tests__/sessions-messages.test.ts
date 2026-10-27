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
import { broadcastAgentRuntimePolicy } from '../services/sessions.js'
import {
  createSessionForUser,
  listProjectSessions,
  listUserSessions,
} from '../services/sessions.js'

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

  describe('personal body HTTP hard cut', () => {
    it.each([
      ['GET', '/sessions', undefined],
      ['POST', '/sessions', { machineId: 'm1', agentType: 'codex', workDir: '/tmp' }],
      ['PATCH', '/sessions/s1', { title: 'legacy mutation' }],
      ['DELETE', '/sessions/s1', undefined],
    ] as const)(
      'rejects old OTA %s %s before it can reach epoch 2',
      async (method, url, payload) => {
        const missing = await rawInject({ method, url, ...(payload ? { payload } : {}) })
        expect(missing.statusCode).toBe(426)
        expect(missing.json()).toMatchObject({
          error: 'upgrade_required',
          rejection: { retryable: false, requiredAction: 'upgrade_client', authoritativeEpoch: 2 },
        })
        expect(mockPrisma.nianSession.create).not.toHaveBeenCalled()
        expect(mockPrisma.nianSession.update).not.toHaveBeenCalled()
        expect(mockPrisma.nianSession.delete).not.toHaveBeenCalled()
      },
    )

    it('rejects a stale personal data epoch before mutation', async () => {
      const stale = await rawInject({
        method: 'POST',
        url: '/sessions',
        headers: {
          'x-shennian-sync-protocol-version': String(SESSION_SYNC_PROTOCOL_VERSION),
          'x-shennian-data-epoch': '1',
        },
        payload: { machineId: 'm1', agentType: 'codex', workDir: '/tmp' },
      })
      expect(stale.statusCode).toBe(409)
      expect(stale.json()).toMatchObject({
        error: 'epoch_mismatch',
        rejection: { retryable: false, requiredAction: 'reset_epoch', authoritativeEpoch: 2 },
      })
      expect(mockPrisma.nianSession.create).not.toHaveBeenCalled()
    })

    it.each([
      ['POST', '/sessions/s1/messages'],
      ['GET', '/sessions/m1/history?sessionId=s1'],
      ['GET', '/messages/since?after=0'],
    ] as const)('does not expose %s %s or mutate the personal index', async (method, url) => {
      const res = await app.inject({
        method,
        url,
        headers: { authorization: 'Bearer valid-token' },
        ...(method === 'POST'
          ? {
              payload: {
                messages: [
                  { id: 'legacy', sessionId: 's1', role: 'user', ts: 1, payload: 'legacy' },
                ],
              },
            }
          : {}),
      })

      expect(res.statusCode).toBe(404)
      expect(mockPrisma.nianSession.create).not.toHaveBeenCalled()
      expect(mockPrisma.nianSession.update).not.toHaveBeenCalled()
      expect(mockConnections.broadcastToClients).not.toHaveBeenCalled()
    })
  })

  it('queries project conversations independently from the global recent window', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue({ id: 'm1', userId: 'user1' })
    mockPrisma.nianSession.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await expect(
      listProjectSessions({
        machineId: 'm1',
        workDir: '/code/demo/',
        userId: 'user1',
        limit: 101,
        before: new Date('2026-01-02T00:00:00.000Z'),
      }),
    ).resolves.toEqual([])

    expect(mockPrisma.nianSession.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          machineId: 'm1',
          workDir: { in: ['/code/demo', '/code/demo/', '/code/demo\\'] },
          lastActivityAt: { lt: new Date('2026-01-02T00:00:00.000Z') },
          deletedAt: null,
          NOT: expect.arrayContaining([
            {
              AND: [
                { nativeSessionVisibility: 'internal' },
                { id: { not: { startsWith: 'sess_worker_' } } },
              ],
            },
          ]),
        }),
        orderBy: { lastActivityAt: 'desc' },
        take: 101,
      }),
    )
    const projectWhere = mockPrisma.nianSession.findMany.mock.calls[1]![0].where
    expect(projectWhere.NOT).not.toContainEqual({ id: { startsWith: 'sess_worker_' } })
  })

  it('does not treat a project Worker own agent session as hidden Manager substrate', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue({ id: 'm1', userId: 'user1' })
    mockPrisma.nianSession.findMany
      .mockResolvedValueOnce([{ agentSessionId: 'worker-agent-session' }])
      .mockResolvedValueOnce([])

    await listProjectSessions({
      machineId: 'm1',
      workDir: '/code/demo',
      userId: 'user1',
      limit: 100,
    })

    expect(mockPrisma.nianSession.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: expect.arrayContaining([
            {
              AND: [
                { agentType: { not: 'manager' } },
                { sessionMode: { not: 'manager' } },
                { id: { not: { startsWith: 'sess_worker_' } } },
              ],
              agentSessionId: { not: null, in: ['worker-agent-session'] },
            },
          ]),
        }),
      }),
    )
  })

  it('queries both Windows separator spellings under the same ownership and page limit', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue({ id: 'm1', userId: 'user1' })
    mockPrisma.nianSession.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await listProjectSessions({
      machineId: 'm1',
      userId: 'user1',
      workDir: 'C:/Users/simpl',
      limit: 101,
    })
    expect(mockPrisma.nianSession.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          machineId: 'm1',
          deletedAt: null,
          workDir: { in: expect.arrayContaining(['C:/Users/simpl', 'C:\\Users\\simpl']) },
        }),
        take: 101,
        orderBy: { lastActivityAt: 'desc' },
      }),
    )
  })

  it('can exclude Room-bound sessions at the database query boundary', async () => {
    mockPrisma.machine.findMany.mockResolvedValue([{ id: 'm1', name: 'Macbook', paired: true }])
    mockPrisma.nianSession.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await expect(
      listUserSessions({ userId: 'user1', limit: 160, excludeRoomBound: true }),
    ).resolves.toEqual([])

    expect(mockPrisma.nianSession.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          agentIdentityId: null,
          roomBinding: { is: null },
          roomNativeSources: { none: { sourceMode: 'room_hook' } },
        }),
      }),
    )
  })

  describe('POST / (create session)', () => {
    it('reports an offline machine as retryable instead of requiring an upgrade', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue({ ...SYNC_MACHINE, online: false })

      const res = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: 'Bearer valid-token' },
        payload: { machineId: 'm1', agentType: 'pi-coding-agent', workDir: '/tmp' },
      })

      expect(res.statusCode).toBe(503)
      expect(res.json()).toMatchObject({
        error: 'machine_offline',
        rejection: {
          code: 'machine_offline',
          retryable: true,
          requiredAction: 'retry',
          authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
        },
      })
      expect(mockPrisma.nianSession.create).not.toHaveBeenCalled()
    })

    it('reserves 426 for an online daemon that cannot satisfy the sync contract', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue({
        ...SYNC_MACHINE,
        sessionSyncProtocolVersion: SESSION_SYNC_PROTOCOL_VERSION - 1,
      })

      const res = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: 'Bearer valid-token' },
        payload: { machineId: 'm1', agentType: 'pi-coding-agent', workDir: '/tmp' },
      })

      expect(res.statusCode).toBe(426)
      expect(res.json()).toMatchObject({
        error: 'upgrade_required',
        rejection: {
          code: 'upgrade_required',
          retryable: false,
          requiredAction: 'upgrade_client',
          authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
        },
      })
      expect(mockPrisma.nianSession.create).not.toHaveBeenCalled()
    })

    it('creates a session and returns full object with dates', async () => {
      const now = new Date()
      mockPrisma.machine.findUnique.mockResolvedValue(SYNC_MACHINE)
      mockPrisma.nianSession.create.mockResolvedValue({
        id: 'new-session-1',
        machineId: 'm1',
        userId: 'user1',
        agentType: 'codex',
        agentSessionId: null,
        modelId: null,
        title: '',
        status: 'active',
        workDir: '/tmp',
        lastMessagePreview: null,
        lastActivityAt: now,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })

      const res = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: 'Bearer valid-token' },
        payload: { machineId: 'm1', agentType: 'codex', workDir: '/tmp' },
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.session.id).toBe('new-session-1')
      expect(body.session.agentType).toBe('codex')
      expect(body.session.userId).toBe('user1')
      expect(body.session.machineName).toBe('Macbook')
      expect(body.session.createdAt).toBe(now.toISOString())
      expect(body.session.lastActivityAt).toBe(now.toISOString())
      expect(body.session.updatedAt).toBe(now.toISOString())
      expect(body.session.workDir).toBe('/tmp')
      expect(body.session.bodyStorageMode).toBe('machine_local')
      expect(body.session).toMatchObject({
        localReady: false,
        bodyRevision: 0,
        indexRevision: 0,
        firstAvailableSeq: null,
        visibleMessageCount: 0,
        lastVisibleMessageId: null,
        lastBodyCommittedAt: null,
      })
      expect(mockPrisma.nianSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bodyStorageMode: 'machine_local',
            daemonInstallationId: 'daemon-installation-1',
          }),
        }),
      )
    })

    it('returns the same persisted Session for a retried creation key', async () => {
      const now = new Date()
      const session = {
        id: 'agent-assignment-session',
        creationKey: 'a'.repeat(64),
        machineId: 'm1',
        userId: 'user1',
        agentType: 'codex',
        agentSessionId: null,
        agentIdentityId: 'agent-1',
        modelId: null,
        managerDefaultWorkerAgentType: null,
        managerDefaultWorkerModelId: null,
        title: '',
        status: 'active',
        workDir: '/repo',
        lastMessagePreview: null,
        lastActivityAt: now,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      mockPrisma.machine.findUnique.mockResolvedValue({ ...SYNC_MACHINE, name: 'Mac' })
      mockPrisma.nianSession.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(session)
      mockPrisma.nianSession.create.mockResolvedValue(session)

      const input = {
        creationKey: 'a'.repeat(64),
        machineId: 'm1',
        userId: 'user1',
        agentType: 'codex',
        workDir: '/repo',
        agentIdentityId: 'agent-1',
      }
      const first = await createSessionForUser(input)
      const retried = await createSessionForUser(input)

      expect(first.id).toBe('agent-assignment-session')
      expect(retried.id).toBe(first.id)
      expect(mockPrisma.nianSession.create).toHaveBeenCalledOnce()
      expect(mockPrisma.sessionProject.findUnique).not.toHaveBeenCalled()
      expect(mockPrisma.sessionProject.create).not.toHaveBeenCalled()
      expect(mockPrisma.sessionProject.update).not.toHaveBeenCalled()
    })

    it('returns 400 when machineId or agentType is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: 'Bearer valid-token' },
        payload: { machineId: 'm1' },
      })

      expect(res.statusCode).toBe(400)
    })

    it('rejects new Nian sessions while keeping historical records readable', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: 'Bearer valid-token' },
        payload: { machineId: 'm1', agentType: 'pi', workDir: '~' },
      })

      expect(res.statusCode).toBe(410)
      expect(res.json()).toMatchObject({ error: 'feature_retired' })
      expect(mockPrisma.nianSession.create).not.toHaveBeenCalled()
    })

    it('normalizes a legacy Manager request into a real Codex Manager session', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ accountTier: 'personal' })

      const res = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: 'Bearer valid-token' },
        payload: { machineId: 'm1', agentType: 'manager', workDir: '~' },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.machine.findUnique).toHaveBeenCalled()
      expect(mockPrisma.nianSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentType: 'codex',
            sessionMode: 'manager',
            userId: 'user1',
          }),
        }),
      )
    })

    it('persists a new Manager session as its real provider plus a mode/config snapshot', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ accountTier: 'personal' })

      const res = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          machineId: 'm1',
          agentType: 'claude',
          sessionMode: 'manager',
          workDir: '/repo',
          modelId: 'claude-opus',
          managerConfig: { defaultWorkerAgentType: 'codex', defaultWorkerModelId: 'gpt-5.6-sol' },
        },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.nianSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentType: 'claude',
            sessionMode: 'manager',
            modelId: 'claude-opus',
            managerConfig: { defaultWorkerAgentType: 'codex', defaultWorkerModelId: 'gpt-5.6-sol' },
          }),
        }),
      )
    })

    it('rejects Manager mode on a provider that has not passed Manager capability validation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          machineId: 'm1',
          agentType: 'workbuddy',
          sessionMode: 'manager',
          workDir: '/repo',
        },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'Manager mode is unavailable for this Agent' })
      expect(mockPrisma.nianSession.create).not.toHaveBeenCalled()
    })

    it('returns 404 when machine does not exist', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      const res = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: 'Bearer valid-token' },
        payload: { machineId: 'no-such', agentType: 'claude', workDir: '~' },
      })

      expect(res.statusCode).toBe(404)
    })

    it('returns 403 when user is neither owner nor grantee', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue({
        id: 'm1',
        userId: 'other-user',
      })
      mockPrisma.machineGrant.findFirst.mockResolvedValue(null)

      const res = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: 'Bearer valid-token' },
        payload: { machineId: 'm1', agentType: 'claude', workDir: '~' },
      })

      expect(res.statusCode).toBe(403)
    })
  })

  describe('Agent runtime policy updates', () => {
    it('broadcasts the latest prompt and model without rewriting session bindings', async () => {
      const updatedAt = new Date('2026-08-27T05:30:00.000Z')
      mockPrisma.nianSession.findMany.mockResolvedValue([
        { id: 'session-agent-1', machineId: 'machine-1', userId: 'user1', updatedAt },
      ])

      await broadcastAgentRuntimePolicy({
        agentIdentityId: 'agent-1',
        modelId: 'gpt-5.6-terra',
        systemPrompt: '下一轮使用新的行为。',
      })

      expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
        'user1',
        expect.stringContaining('"agentDefaultModelId":"gpt-5.6-terra"'),
      )
      expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
        'user1',
        expect.stringContaining('"agentSystemPrompt":"下一轮使用新的行为。"'),
      )
    })

    it('lets an owned Agent conversation switch back to following its Agent model', async () => {
      const now = new Date('2026-08-27T05:35:00.000Z')
      const agentIdentity = {
        ownerUserId: 'user1',
        modelId: 'gpt-5.6-sol',
        systemPrompt: '保持简洁。',
      }
      mockPrisma.nianSession.findUnique.mockResolvedValue({
        id: 'session-agent-1',
        machineId: 'machine-1',
        userId: 'user1',
        deletedAt: null,
        agentIdentity,
      })
      mockPrisma.nianSession.update.mockResolvedValue({
        id: 'session-agent-1',
        agentIdentityId: 'agent-1',
        machineId: 'machine-1',
        userId: 'user1',
        agentType: 'codex',
        agentSessionId: 'thread-1',
        roomNativeSources: [],
        externalBindings: [],
        wechatChannelBindings: [],
        modelId: 'gpt-5.5',
        modelSource: 'agent',
        agentIdentity,
        managerDefaultWorkerAgentType: null,
        managerDefaultWorkerModelId: null,
        title: '客服',
        status: 'active',
        workDir: '/repo',
        lastMessagePreview: null,
        lastActivityAt: now,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })

      const response = await app.inject({
        method: 'PATCH',
        url: '/sessions/session-agent-1',
        headers: { authorization: 'Bearer valid-token' },
        payload: { modelSource: 'agent' },
      })

      expect(response.statusCode).toBe(200)
      expect(mockPrisma.nianSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { modelSource: 'agent' } }),
      )
      expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
        'user1',
        expect.stringContaining('"modelSource":"agent"'),
      )
    })

    it('records an explicit manual title authority and sends it to the daemon', async () => {
      const now = new Date('2026-09-01T10:00:00.000Z')
      mockPrisma.nianSession.findUnique.mockResolvedValue({
        id: 'session-title-1',
        machineId: 'machine-1',
        userId: 'user1',
        agentType: 'codex',
        agentSessionId: 'thread-1',
        workDir: '/repo',
        deletedAt: null,
        agentIdentity: null,
      })
      mockPrisma.nianSession.update.mockResolvedValue({
        id: 'session-title-1',
        agentIdentityId: null,
        machineId: 'machine-1',
        userId: 'user1',
        agentType: 'codex',
        agentSessionId: 'thread-1',
        roomNativeSources: [],
        externalBindings: [],
        wechatChannelBindings: [],
        modelId: null,
        modelSource: 'session',
        agentIdentity: null,
        managerDefaultWorkerAgentType: null,
        managerDefaultWorkerModelId: null,
        title: '手机同步问题',
        titleSource: 'shennian_manual',
        titleRevision: 4,
        titleLockedByUser: true,
        titleOriginEventId: 'shennian-manual:test',
        status: 'active',
        workDir: '/repo',
        lastMessagePreview: null,
        bodyStorageMode: 'machine_local',
        bodyRevision: 3,
        indexRevision: 8,
        firstAvailableSeq: 1,
        visibleMessageCount: 3,
        lastVisibleMessageId: 'm3',
        lastBodyCommittedAt: now,
        deletionRevision: 0,
        lastActivityAt: now,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })

      const response = await app.inject({
        method: 'PATCH',
        url: '/sessions/session-title-1',
        headers: { authorization: 'Bearer valid-token' },
        payload: { title: '手机同步问题' },
      })

      expect(response.statusCode).toBe(200)
      expect(mockPrisma.nianSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: '手机同步问题',
            titleSource: 'shennian_manual',
            titleRevision: { increment: 1 },
            titleLockedByUser: true,
            titleOriginEventId: expect.stringMatching(/^shennian-manual:/),
          }),
        }),
      )
      expect(mockSendServerReqToMachine).toHaveBeenCalledWith(
        'machine-1',
        expect.objectContaining({
          method: 'session.title.set',
          params: expect.objectContaining({
            title: '手机同步问题',
            titleSource: 'shennian_manual',
            titleRevision: 4,
            titleOriginEventId: 'shennian-manual:test',
          }),
        }),
        15_000,
      )
      expect(mockConnections.broadcastToClientsOfUser).toHaveBeenCalledWith(
        'user1',
        expect.stringContaining('"titleSource":"shennian_manual"'),
      )
    })
  })

  describe('GET / (list sessions)', () => {
    it('excludes manager workers and hidden substrate sessions at the server list source', async () => {
      mockPrisma.machine.findMany.mockResolvedValue([{ id: 'm1', name: 'Macbook', paired: true }])
      mockPrisma.nianSession.findMany
        .mockResolvedValueOnce([{ agentSessionId: 'codex-manager-thread' }])
        .mockResolvedValueOnce([
          {
            id: 'normal',
            machineId: 'm1',
            userId: 'user1',
            agentType: 'codex',
            agentSessionId: 'codex-normal-thread',
            agentIdentityId: 'agent-1',
            roomNativeSources: [],
            externalBindings: [
              {
                id: 'binding-1',
                provider: 'wecom',
                allowSend: true,
                systemPrompt: '只回复项目相关内容',
                conversation: { name: '神念test' },
              },
            ],
            modelId: null,
            modelSource: 'agent',
            agentIdentity: {
              ownerUserId: 'user1',
              modelId: 'gpt-5.6-terra',
              systemPrompt: '下一轮使用最新提示词',
            },
            title: 'Normal',
            status: 'active',
            workDir: '/tmp/demo',
            lastMessagePreview: null,
            lastActivityAt: new Date('2026-05-08T07:00:00.000Z'),
            deletedAt: null,
            createdAt: new Date('2026-05-08T07:00:00.000Z'),
            updatedAt: new Date('2026-05-08T07:00:00.000Z'),
            userStates: [],
          },
        ])

      const res = await app.inject({
        method: 'GET',
        url: '/sessions?limit=20',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.nianSession.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            NOT: expect.arrayContaining([
              { id: { startsWith: 'sess_worker_' } },
              {
                AND: [{ agentType: { not: 'manager' } }, { sessionMode: { not: 'manager' } }],
                agentSessionId: { not: null, in: ['codex-manager-thread'] },
              },
            ]),
          }),
        }),
      )
      const body = JSON.parse(res.payload)
      expect(body.sessions.map((session: { id: string }) => session.id)).toEqual(['normal'])
      expect(body.sessions[0].externalChannel).toMatchObject({
        connected: true,
        configured: true,
        type: 'wecom',
        channelId: 'binding-1',
        name: '神念test',
        canReply: true,
        systemPrompt: '只回复项目相关内容',
      })
      expect(body.sessions[0]).toMatchObject({
        modelSource: 'agent',
        agentDefaultModelId: 'gpt-5.6-terra',
        agentSystemPrompt: '下一轮使用最新提示词',
      })
    })

    it('projects wechat-rpa binding into externalChannel when no wecom/feishu binding', async () => {
      mockPrisma.machine.findMany.mockResolvedValue([{ id: 'm1', name: 'Macbook', paired: true }])
      mockPrisma.nianSession.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'wechat-sess',
          machineId: 'm1',
          userId: 'user1',
          agentType: 'codex',
          agentSessionId: 'codex-thread',
          roomNativeSources: [],
          externalBindings: [],
          wechatChannelBindings: [
            {
              id: 'wx-binding-1',
              machineId: 'm1',
              conversationDisplayName: '文件传输助手',
              allowReply: true,
              downloadMedia: true,
            },
          ],
          modelId: null,
          title: 'WeChat',
          status: 'active',
          workDir: '/tmp/demo',
          lastMessagePreview: null,
          lastActivityAt: new Date('2026-05-08T07:00:00.000Z'),
          deletedAt: null,
          createdAt: new Date('2026-05-08T07:00:00.000Z'),
          updatedAt: new Date('2026-05-08T07:00:00.000Z'),
          userStates: [],
        },
      ])

      const res = await app.inject({
        method: 'GET',
        url: '/sessions?limit=20',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.sessions[0].externalChannel).toMatchObject({
        connected: true,
        configured: true,
        type: 'wechat-rpa',
        channelId: 'wx-binding-1',
        machineId: 'm1',
        name: '文件传输助手',
        canReply: true,
        wechatRpaSource: 'wechat-channel',
        wechatRpaGroups: [{ name: '文件传输助手' }],
        downloadAttachments: true,
      })
    })

    it('returns hard-delete tombstones in updatedAfter sync', async () => {
      const deletedAt = new Date('2026-05-08T07:00:00.000Z')
      mockPrisma.machine.findMany.mockResolvedValue([{ id: 'm1', name: 'Macbook', paired: true }])
      mockPrisma.nianSession.findMany
        .mockResolvedValueOnce([{ agentSessionId: 'codex-manager-thread' }])
        .mockResolvedValueOnce([])
      mockPrisma.sessionDeletion.findMany.mockResolvedValue([
        {
          sessionId: 's-deleted',
          machineId: 'm1',
          userId: 'user1',
          deletedAt,
          createdAt: deletedAt,
        },
      ])

      const res = await app.inject({
        method: 'GET',
        url: '/sessions?updatedAfter=1778240000000',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.nianSession.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            updatedAt: { gt: new Date(1778240000000) },
            NOT: expect.arrayContaining([
              { id: { startsWith: 'sess_worker_' } },
              {
                AND: [{ agentType: { not: 'manager' } }, { sessionMode: { not: 'manager' } }],
                agentSessionId: { not: null, in: ['codex-manager-thread'] },
              },
            ]),
          }),
        }),
      )
      const body = JSON.parse(res.payload)
      expect(body.sessions).toHaveLength(1)
      expect(body.sessions[0]).toMatchObject({
        id: 's-deleted',
        machineId: 'm1',
        userId: 'user1',
        deletedAt: deletedAt.toISOString(),
        updatedAt: deletedAt.toISOString(),
      })
    })

    it('marks shared-machine sessions as read-only and includes the maintainer display name', async () => {
      mockPrisma.machine.findMany.mockResolvedValue([])
      mockPrisma.machineGrant.findMany.mockResolvedValue([
        {
          machine: {
            id: 'm-shared',
            name: 'Team Mac',
            paired: true,
          },
          permission: 'use',
        },
      ])
      mockPrisma.nianSession.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 's-shared',
          machineId: 'm-shared',
          userId: 'owner-user',
          agentType: 'codex',
          agentSessionId: null,
          roomNativeSources: [],
          externalBindings: [],
          modelId: null,
          title: 'Shared work',
          status: 'active',
          workDir: '/repo',
          lastMessagePreview: null,
          lastActivityAt: new Date('2026-05-08T07:00:00.000Z'),
          deletedAt: null,
          createdAt: new Date('2026-05-08T07:00:00.000Z'),
          updatedAt: new Date('2026-05-08T07:00:00.000Z'),
          userStates: [],
        },
      ])
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'owner-user', name: 'Owner Nick', phone: '15200000000', email: null },
      ])

      const res = await app.inject({
        method: 'GET',
        url: '/sessions?limit=20',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.sessions[0]).toMatchObject({
        id: 's-shared',
        machineName: 'Team Mac',
        ownerName: 'Owner Nick',
        canManage: false,
        sharedMachineSession: true,
      })
    })
  })
})

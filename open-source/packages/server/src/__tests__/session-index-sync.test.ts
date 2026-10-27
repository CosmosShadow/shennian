// @covers src/services/session-index-sync.ts

import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  SESSION_SYNC_REQUIRED_CAPABILITIES,
  type SessionIndexUpdate,
} from '@shennian/wire'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    nianSession: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    machine: {
      findUnique: vi.fn(),
    },
    sessionTerminalNotification: {
      upsert: vi.fn(),
    },
    sessionDeletion: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))

import { applySessionIndexUpdate } from '../services/session-index-sync.js'

function makeUpdate(indexRevision = 1): SessionIndexUpdate {
  return {
    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId: 'install-1',
    session: {
      id: 'session-1',
      agentType: 'codex',
      sessionMode: 'standard',
      managerConfig: null,
      agentSessionId: 'native-1',
      modelId: 'gpt-5.6-sol',
      title: 'Agent native title',
      titleSource: 'agent_native',
      titleRevision: 1,
      titleLockedByUser: false,
      titleOriginEventId: null,
      status: 'active',
      workDir: '/workspace',
      lastMessagePreview: 'latest local message',
      lastMessagePreviewMessageId: 'message-3',
      lastMessagePreviewAt: '2026-09-01T09:00:00.000Z',
      lastVisibleEventAt: '2026-09-01T09:01:00.000Z',
      bodyStorageMode: 'machine_local',
      localReady: true,
      firstUserBoundary: {
        role: 'user',
        messageId: 'message-1',
        bodyRevision: 1,
      },
      bodyRevision: 3,
      indexRevision,
      firstAvailableSeq: 1,
      visibleMessageCount: 3,
      lastVisibleMessageId: 'message-3',
      attentionCount: 0,
      lastAttentionId: null,
      lastBodyCommittedAt: '2026-09-01T09:00:00.000Z',
      deletionRevision: 0,
      lastActivityAt: '2026-09-01T09:01:00.000Z',
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: '2026-09-01T09:00:00.000Z',
      deletedAt: null,
    },
  }
}

describe('personal session lightweight index sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.nianSession.findUnique.mockResolvedValue(null)
    mockPrisma.nianSession.create.mockResolvedValue({ id: 'session-1' })
    mockPrisma.nianSession.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.sessionTerminalNotification.upsert.mockResolvedValue({ id: 'notification-1' })
    mockPrisma.sessionDeletion.findUnique.mockResolvedValue(null)
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => (
      callback(mockPrisma)
    ))
    mockPrisma.machine.findUnique.mockResolvedValue({
      userId: 'user-1',
      online: true,
      sessionSyncProtocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
      sessionSyncDataEpoch: SESSION_SYNC_DATA_EPOCH,
      sessionSyncCapabilities: [...SESSION_SYNC_REQUIRED_CAPABILITIES],
      daemonInstallationId: 'install-1',
    })
  })

  it('creates only lightweight metadata with server-owned identity', async () => {
    await expect(applySessionIndexUpdate('machine-1', 'user-1', makeUpdate())).resolves.toMatchObject({
      sessionId: 'session-1', indexRevision: 1, applied: true,
      sessionPatch: {
        id: 'session-1', machineId: 'machine-1', userId: 'user-1',
        localReady: true, bodyRevision: 3, indexRevision: 1,
        visibleMessageCount: 3, lastMessagePreview: 'latest local message',
        lastMessagePreviewMessageId: 'message-3',
        lastMessagePreviewAt: '2026-09-01T09:00:00.000Z',
        lastVisibleEventAt: '2026-09-01T09:01:00.000Z',
      },
    })
    const data = mockPrisma.nianSession.create.mock.calls[0]![0].data
    expect(data).toMatchObject({
      id: 'session-1', machineId: 'machine-1', userId: 'user-1',
      bodyStorageMode: 'machine_local', bodyRevision: 3, indexRevision: 1,
      firstUserMessageId: 'message-1', firstUserBodyRevision: 1,
      lastMessagePreviewMessageId: 'message-3',
      lastVisibleEventAt: new Date('2026-09-01T09:01:00.000Z'),
    })
    expect(data).not.toHaveProperty('messages')
    expect(data).not.toHaveProperty('transcriptObjectKey')
    expect(data).not.toHaveProperty('transcriptChunks')
  })

  it('truncates an oversized legacy title instead of rejecting the whole index', async () => {
    const update = makeUpdate()
    update.session.title = '标'.repeat(121)

    const result = await applySessionIndexUpdate('machine-1', 'user-1', update)

    expect(result.sessionPatch?.title).toBe('标'.repeat(120))
    expect(mockPrisma.nianSession.create.mock.calls[0]![0].data.title).toBe('标'.repeat(120))
  })

  it('rejects pre-user or forged boundary projections before creating a Session', async () => {
    const notReady = makeUpdate()
    ;(notReady.session as typeof notReady.session & { localReady: boolean }).localReady = false
    await expect(applySessionIndexUpdate('machine-1', 'user-1', notReady))
      .rejects.toThrow('missing_user_boundary')

    const agentOnly = makeUpdate()
    agentOnly.session.firstUserBoundary = {
      role: 'user',
      messageId: 'forged-user',
      bodyRevision: agentOnly.session.bodyRevision + 1,
    }
    await expect(applySessionIndexUpdate('machine-1', 'user-1', agentOnly))
      .rejects.toThrow('missing_user_boundary')
    expect(mockPrisma.nianSession.create).not.toHaveBeenCalled()
  })

  it('rejects a preview whose text, identity and canonical time are not complete', async () => {
    const missingTime = makeUpdate()
    missingTime.session.lastMessagePreviewAt = null
    await expect(applySessionIndexUpdate('machine-1', 'user-1', missingTime))
      .rejects.toThrow('lastMessagePreview requires message identity and canonical timestamp')

    const emptyWithIdentity = makeUpdate()
    emptyWithIdentity.session.lastMessagePreview = null
    await expect(applySessionIndexUpdate('machine-1', 'user-1', emptyWithIdentity))
      .rejects.toThrow('empty lastMessagePreview cannot carry preview identity or timestamp')
  })

  it('commits a terminal index and its frozen attention notification in one transaction', async () => {
    const update = makeUpdate()
    update.session.status = 'completed'
    update.session.attentionCount = 1
    update.session.lastAttentionId = 'terminal:run-1'

    await applySessionIndexUpdate('machine-1', 'user-1', update)

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockPrisma.nianSession.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.sessionTerminalNotification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId_terminalAttentionId: {
            sessionId: 'session-1',
            terminalAttentionId: 'terminal:run-1',
          },
        },
        create: expect.objectContaining({
          sessionId: 'session-1',
          terminalBodyRevision: 3,
          terminalAttentionId: 'terminal:run-1',
          terminalAttentionCount: 1,
          terminalState: 'final',
          notificationTitle: 'Agent native title',
          notificationBody: 'latest local message',
          notificationPreviewMessageId: 'message-3',
          notificationPreviewAt: new Date('2026-09-01T09:00:00.000Z'),
          availableAt: expect.any(Date),
        }),
        update: {},
      }),
    )
  })

  it('does not enqueue a notification for active-turn process text', async () => {
    const update = makeUpdate()
    update.session.lastMessagePreview = '正在继续调用工具'

    await applySessionIndexUpdate('machine-1', 'user-1', update)

    expect(mockPrisma.sessionTerminalNotification.upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['managed Worker', { id: 'sess_worker_internal', sessionMode: 'standard' as const }],
    ['Manager orchestration', { id: 'manager-session', sessionMode: 'manager' as const }],
  ])('does not enqueue terminal Push for %s', async (_label, identity) => {
    const update = makeUpdate()
    Object.assign(update.session, identity, {
      status: 'completed',
      attentionCount: 1,
      lastAttentionId: 'terminal:internal-run',
    })

    await applySessionIndexUpdate('machine-1', 'user-1', update)

    expect(mockPrisma.sessionTerminalNotification.upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['tool JSON', JSON.stringify({ v: 1, type: 'tool_result', content: 'private result' })],
    ['base64', `data:image/png;base64,${'A'.repeat(120)}`],
    ['system context', '<environment_context>private</environment_context>'],
    ['non-canonical whitespace', 'line one\nline two'],
  ])('rejects unsafe %s before writing the server index', async (_label, preview) => {
    const update = makeUpdate()
    update.session.lastMessagePreview = preview

    await expect(applySessionIndexUpdate('machine-1', 'user-1', update))
      .rejects.toThrow('lastMessagePreview')
    expect(mockPrisma.nianSession.create).not.toHaveBeenCalled()
  })

  it('treats the same or older revision as an idempotent no-op', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      machineId: 'machine-1', userId: 'user-1', daemonInstallationId: 'install-1',
      indexRevision: 5, roomBinding: null,
      title: 'Agent native title', titleSource: 'agent_native', titleRevision: 1,
      titleLockedByUser: false, titleOriginEventId: null,
    })
    await expect(applySessionIndexUpdate('machine-1', 'user-1', makeUpdate(5))).resolves.toEqual({
      sessionId: 'session-1', indexRevision: 5, applied: false,
    })
    expect(mockPrisma.nianSession.updateMany).not.toHaveBeenCalled()
  })

  it('does not enqueue a second terminal Push when a terminal index revision is replayed', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      machineId: 'machine-1', userId: 'user-1', daemonInstallationId: 'install-1',
      indexRevision: 5, roomBinding: null,
      title: 'Agent native title', titleSource: 'agent_native', titleRevision: 1,
      titleLockedByUser: false, titleOriginEventId: null,
      localReadyAt: new Date(), firstUserMessageId: 'message-1', firstUserBodyRevision: 1,
    })
    const replay = makeUpdate(5)
    replay.session.status = 'completed'
    replay.session.attentionCount = 1
    replay.session.lastAttentionId = 'terminal:run-1'

    await expect(applySessionIndexUpdate('machine-1', 'user-1', replay)).resolves.toMatchObject({
      applied: false,
    })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockPrisma.sessionTerminalNotification.upsert).not.toHaveBeenCalled()
  })

  it('keeps the first user boundary immutable after local-ready is established', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      machineId: 'machine-1', userId: 'user-1', daemonInstallationId: 'install-1',
      indexRevision: 1, roomBinding: null,
      title: 'Agent native title', titleSource: 'agent_native', titleRevision: 1,
      titleLockedByUser: false, titleOriginEventId: null,
      localReadyAt: new Date(), firstUserMessageId: 'message-1', firstUserBodyRevision: 1,
    })
    const forged = makeUpdate(2)
    forged.session.firstUserBoundary.messageId = 'replacement-user'

    await expect(applySessionIndexUpdate('machine-1', 'user-1', forged))
      .rejects.toThrow('first user boundary identity conflict')
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  describe('steward scope', () => {
    const existingRow = (sessionScope: string) => ({
      machineId: 'machine-1', userId: 'user-1', daemonInstallationId: 'install-1',
      indexRevision: 1, roomBinding: null, sessionScope,
      title: 'Agent native title', titleSource: 'agent_native', titleRevision: 1,
      titleLockedByUser: false, titleOriginEventId: null,
      localReadyAt: new Date(), firstUserMessageId: 'message-1', firstUserBodyRevision: 1,
    })

    it('stores a new steward projection as hidden steward scope', async () => {
      const update = makeUpdate()
      update.session.sessionScope = 'steward'
      await applySessionIndexUpdate('machine-1', 'user-1', update)
      expect(mockPrisma.nianSession.create.mock.calls[0]![0].data).toMatchObject({
        sessionScope: 'steward', nativeSessionVisibility: 'internal',
      })
    })

    it('keeps an existing steward session steward when a stale projection omits the scope', async () => {
      mockPrisma.nianSession.findUnique.mockResolvedValue(existingRow('steward'))
      const result = await applySessionIndexUpdate('machine-1', 'user-1', makeUpdate(2))
      expect(result.sessionPatch).toMatchObject({ sessionScope: 'steward', nativeSessionVisibility: 'internal' })
      expect(mockPrisma.nianSession.updateMany.mock.calls[0]![0].data).toMatchObject({ sessionScope: 'steward' })
    })

    it('never turns an existing personal session into a steward session', async () => {
      mockPrisma.nianSession.findUnique.mockResolvedValue(existingRow('personal'))
      const update = makeUpdate(2)
      update.session.sessionScope = 'steward'
      await expect(applySessionIndexUpdate('machine-1', 'user-1', update)).rejects.toMatchObject({ rejection: { code: 'invalid_identity' } })
      expect(mockPrisma.nianSession.updateMany).not.toHaveBeenCalled()
    })

    it('rejects an unknown scope value', async () => {
      const update = makeUpdate()
      ;(update.session as { sessionScope?: string }).sessionScope = 'admin'
      await expect(applySessionIndexUpdate('machine-1', 'user-1', update)).rejects.toThrow('invalid session scope')
    })

    it('does not enqueue a terminal notification for a steward turn', async () => {
      const update = makeUpdate()
      update.session.sessionScope = 'steward'
      update.session.status = 'completed'
      update.session.attentionCount = 1
      update.session.lastAttentionId = 'attention-1'
      await applySessionIndexUpdate('machine-1', 'user-1', update)
      expect(mockPrisma.sessionTerminalNotification.upsert).not.toHaveBeenCalled()
    })
  })

  it('updates only when the stored revision is older', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      machineId: 'machine-1', userId: 'user-1', daemonInstallationId: 'install-1',
      indexRevision: 1, roomBinding: null,
      title: 'Agent native title', titleSource: 'agent_native', titleRevision: 1,
      titleLockedByUser: false, titleOriginEventId: null,
    })
    await applySessionIndexUpdate('machine-1', 'user-1', makeUpdate(2))
    expect(mockPrisma.nianSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ indexRevision: { lt: 2 } }),
    }))
    const data = mockPrisma.nianSession.updateMany.mock.calls[0]![0].data
    expect(data).not.toHaveProperty('machineId')
    expect(data).not.toHaveProperty('userId')
    expect(data).not.toHaveProperty('daemonInstallationId')
    expect(data).not.toHaveProperty('roomBinding')
  })

  it('keeps the stored visible-event projection when an older daemon omits the field', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      machineId: 'machine-1', userId: 'user-1', daemonInstallationId: 'install-1',
      indexRevision: 1, roomBinding: null,
      title: 'Agent native title', titleSource: 'agent_native', titleRevision: 1,
      titleLockedByUser: false, titleOriginEventId: null,
    })
    const legacyUpdate = makeUpdate(2)
    delete legacyUpdate.session.lastVisibleEventAt

    await applySessionIndexUpdate('machine-1', 'user-1', legacyUpdate)

    const data = mockPrisma.nianSession.updateMany.mock.calls[0]![0].data
    expect(data).not.toHaveProperty('lastVisibleEventAt')
  })

  it('preserves a manual title against higher-revision native updates', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      machineId: 'machine-1', userId: 'user-1', daemonInstallationId: 'install-1',
      indexRevision: 1, roomBinding: null,
      title: '我的标题', titleSource: 'shennian_manual', titleRevision: 2,
      titleLockedByUser: true, titleOriginEventId: 'shennian-manual:1',
    })
    const update = makeUpdate(2)
    update.session.title = '后到的原生标题'
    update.session.titleRevision = 99

    await applySessionIndexUpdate('machine-1', 'user-1', update)

    expect(mockPrisma.nianSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: '我的标题', titleSource: 'shennian_manual', titleRevision: 2,
        titleLockedByUser: true, titleOriginEventId: 'shennian-manual:1',
      }),
    }))
  })

  it('lets a native title replace a same-revision fallback', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      machineId: 'machine-1', userId: 'user-1', daemonInstallationId: 'install-1',
      indexRevision: 1, roomBinding: null,
      title: 'Temporary prompt title', titleSource: 'first_user_fallback', titleRevision: 1,
      titleLockedByUser: false, titleOriginEventId: 'user-1',
    })

    await applySessionIndexUpdate('machine-1', 'user-1', makeUpdate(2))

    expect(mockPrisma.nianSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: 'Agent native title', titleSource: 'agent_native', titleRevision: 1,
      }),
    }))
  })

  it('treats an unchanged same-revision title with a later native observation as idempotent', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      machineId: 'machine-1', userId: 'user-1', daemonInstallationId: 'install-1',
      indexRevision: 1, roomBinding: null,
      title: 'Agent native title', titleSource: 'agent_native', titleRevision: 1,
      titleLockedByUser: false, titleOriginEventId: 'agent-native:first-observation',
    })
    const update = makeUpdate(2)
    update.session.titleOriginEventId = 'agent-native:later-source-event'

    await applySessionIndexUpdate('machine-1', 'user-1', update)

    expect(mockPrisma.nianSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: 'Agent native title', titleSource: 'agent_native', titleRevision: 1,
        titleOriginEventId: 'agent-native:first-observation',
      }),
    }))
  })

  it('still rejects different same-authority titles at the same revision', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      machineId: 'machine-1', userId: 'user-1', daemonInstallationId: 'install-1',
      indexRevision: 1, roomBinding: null,
      title: 'Earlier native title', titleSource: 'agent_native', titleRevision: 1,
      titleLockedByUser: false, titleOriginEventId: 'agent-native:first-observation',
    })

    await expect(applySessionIndexUpdate('machine-1', 'user-1', makeUpdate(2)))
      .rejects.toThrow('title revision conflict')
  })

  it('rejects implicit or inconsistent title authority', async () => {
    const missingSource = makeUpdate() as SessionIndexUpdate & {
      session: { titleSource?: unknown }
    }
    delete missingSource.session.titleSource
    await expect(applySessionIndexUpdate('machine-1', 'user-1', missingSource))
      .rejects.toThrow('explicit titleSource')

    const forgedLock = makeUpdate()
    forgedLock.session.titleLockedByUser = true
    await expect(applySessionIndexUpdate('machine-1', 'user-1', forgedLock))
      .rejects.toThrow('title lock conflicts')
  })

  it('rejects ownership, daemon identity, Room and server-owned field conflicts', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      machineId: 'machine-2', userId: 'user-1', daemonInstallationId: 'install-1',
      indexRevision: 1, roomBinding: null,
      title: 'Agent native title', titleSource: 'agent_native', titleRevision: 1,
      titleLockedByUser: false, titleOriginEventId: null,
    })
    await expect(applySessionIndexUpdate('machine-1', 'user-1', makeUpdate(2)))
      .rejects.toThrow('ownership_transferred')

    const forged = makeUpdate() as SessionIndexUpdate & { session: { userId: string } }
    forged.session.userId = 'forged-user'
    await expect(applySessionIndexUpdate('machine-1', 'user-1', forged))
      .rejects.toThrow('server-owned field')
  })

  it('rejects index publication from a stale or differently identified daemon', async () => {
    mockPrisma.machine.findUnique.mockResolvedValueOnce({
      userId: 'user-1',
      online: true,
      sessionSyncProtocolVersion: 1,
      sessionSyncCapabilities: [...SESSION_SYNC_REQUIRED_CAPABILITIES],
      daemonInstallationId: 'other-installation',
    })
    await expect(applySessionIndexUpdate('machine-1', 'user-1', makeUpdate()))
      .rejects.toThrow('invalid_identity')

    mockPrisma.machine.findUnique.mockResolvedValueOnce({
      userId: 'other-user',
      online: true,
      sessionSyncProtocolVersion: 1,
      sessionSyncCapabilities: [...SESSION_SYNC_REQUIRED_CAPABILITIES],
      daemonInstallationId: 'install-1',
    })
    await expect(applySessionIndexUpdate('machine-1', 'user-1', makeUpdate()))
      .rejects.toThrow('ownership_transferred')
  })
  it.each([undefined, 'user'] as const)('keeps internal ownership sticky against older daemon visibility %s', async (visibility) => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      machineId: 'machine-1', userId: 'user-1', daemonInstallationId: 'install-1',
      indexRevision: 1, roomBinding: null, nativeSessionVisibility: 'internal',
      title: 'Agent native title', titleSource: 'agent_native', titleRevision: 1, titleLockedByUser: false,
    })
    const update = makeUpdate(2)
    update.session.nativeSessionVisibility = visibility
    update.session.status = 'completed'
    update.session.attentionCount = 1
    update.session.lastAttentionId = 'terminal:internal'
    const result = await applySessionIndexUpdate('machine-1', 'user-1', update)
    expect(result.sessionPatch?.nativeSessionVisibility).toBe('internal')
    expect(mockPrisma.nianSession.updateMany.mock.calls[0]![0].data.nativeSessionVisibility).toBe('internal')
    expect(mockPrisma.sessionTerminalNotification.upsert).not.toHaveBeenCalled()
  })

})

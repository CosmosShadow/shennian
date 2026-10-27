// Shared mocks and fixtures for the focused SessionManager behavior suites.

import { vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import type { AgentEvent } from '../agents/adapter.js'
import type { PreparedManagedRoomTurn } from '../session/queue.js'
import type { ManagedRoomExecutor } from '../room/managed-room-ipc.js'
import { CODEX_DESKTOP_SEND_UNAVAILABLE } from '@shennian/wire'
import { markTrustedManagerEvent } from '../session/manager-event-authority.js'

const TEST_ATTACHMENT_SHA256 = 'a'.repeat(64)

function preparedManagedRoomTurn(
  systemPrompt: string,
  tokenCharacter = 'a',
): PreparedManagedRoomTurn {
  const permissionPolicy = {
    version: 1,
    fileAccess: 'workspace-write' as const,
    externalCapabilities: {
      commandNetwork: false,
      webSearch: false,
      browser: false,
      computerUse: false,
      mcp: false,
    },
  }
  const enforcement = {
    level: 'hard' as const,
    effectivePolicy: permissionPolicy,
    unsupportedCapabilities: [],
    runtimeVersion: '0.152.1',
    platform: 'darwin',
  }
  return {
    agentType: 'codex',
    workDir: '/tmp',
    agentSessionId: 'managed-native-session',
    systemPrompt,
    sessionMode: 'standard',
    managerConfig: null,
    managerDefaultWorkerAgentType: null,
    managerDefaultWorkerModelId: null,
    roomContextRegistryKey: 'a'.repeat(64),
    managedRoomContextToken: `mrc_${tokenCharacter.repeat(43)}`,
    managedAgentPolicy: {
      requestedPolicy: permissionPolicy,
      enforcement,
      adapterPolicy: {
        version: 1,
        workDir: '/tmp',
        fileAccess: 'workspace-write',
        externalCapabilities: permissionPolicy.externalCapabilities,
        denySensitiveFiles: true,
        failClosed: true,
      },
      environmentPolicy: {
        inheritDaemonEnv: false,
        loadLoginShell: false,
        providerEnvKeys: ['OPENAI_API_KEY'],
        sessionEnvKeys: ['SHENNIAN_MANAGED_ROOM_CONTEXT', 'SHENNIAN_MANAGED_ROOM_IPC_ROOT'],
        shellSubprocess: {
          inherit: 'none',
          allowedEnvKeys: [
            'PATH',
            'SHENNIAN_MANAGED_ROOM_CONTEXT',
            'SHENNIAN_MANAGED_ROOM_IPC_ROOT',
          ],
          deniedEnvKeys: ['OPENAI_API_KEY'],
        },
      },
    },
    managedRoomPromptSnapshot: {
      providerBaseVersion: 'provider-owned',
      managedRoomPolicyVersion: 'managed-room-surface-v9',
      sessionModeInstructionsHash: null,
      agentSystemPromptHash: null,
      runtimePermissionPolicyHash: createHash('sha256')
        .update(JSON.stringify({ requestedPolicy: permissionPolicy, enforcement }))
        .digest('hex'),
      resolvedWorkDirHash: createHash('sha256').update('/tmp').digest('hex'),
      enforcementLevel: 'hard',
      trustedRoomContextHash: 'd'.repeat(64),
      allowedRoomOperations: ['shennian_room_status'],
    },
  }
}

const { mockFiles, mockSessionMessages, mockSessionRecords, mockDeliveryStates, mockToolDetails } =
  vi.hoisted(() => ({
    mockFiles: new Map<string, Buffer>(),
    mockSessionMessages: new Map<
      string,
      Array<{
        id: string
        sessionId: string
        role: 'user' | 'agent'
        ts: number
        payload: string
      }>
    >(),
    mockSessionRecords: new Map<string, Record<string, unknown>>(),
    mockDeliveryStates: new Map<string, string>(),
    mockToolDetails: new Map<string, Array<Record<string, unknown>>>(),
  }))

const {
  deletionOrder,
  mockRecordSessionTombstone,
  mockRecordSourceTombstone,
  mockFindSourceTombstone,
  mockCollectLocalNativeSources,
  mockReadDeletionRevision,
  mockWriteDeletionRevision,
  mockPurgeCanonicalSession,
  mockPurgeSessionRecord,
  mockPurgeToolDetails,
} = vi.hoisted(() => ({
  deletionOrder: [] as string[],
  mockRecordSessionTombstone: vi.fn(() => {
    deletionOrder.push('tombstone-session')
  }),
  mockRecordSourceTombstone: vi.fn(() => {
    deletionOrder.push('tombstone-source')
  }),
  mockFindSourceTombstone: vi.fn(
    () =>
      null as {
        sessionId: string
        deletionRevision: number
      } | null,
  ),
  mockCollectLocalNativeSources: vi.fn(
    () => [] as Array<{ agentType: string; sourceSessionKey: string }>,
  ),
  mockReadDeletionRevision: vi.fn(() => 0),
  mockWriteDeletionRevision: vi.fn(() => {
    deletionOrder.push('revision')
  }),
  mockPurgeCanonicalSession: vi.fn(() => {
    deletionOrder.push('canonical')
  }),
  mockPurgeSessionRecord: vi.fn(() => {
    deletionOrder.push('index')
  }),
  mockPurgeToolDetails: vi.fn(() => {
    deletionOrder.push('detail')
  }),
}))

const { mockRecordDeletionSyncFailure } = vi.hoisted(() => ({
  mockRecordDeletionSyncFailure: vi.fn(),
}))

const {
  mockNativeCleanupEnqueue,
  mockNativeCleanupKick,
  mockNativeCleanupStart,
  mockNativeCleanupStop,
} = vi.hoisted(() => ({
  mockNativeCleanupEnqueue: vi.fn(() => {
    deletionOrder.push('outbox')
  }),
  mockNativeCleanupKick: vi.fn(),
  mockNativeCleanupStart: vi.fn(),
  mockNativeCleanupStop: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const mocked = {
    ...actual,
    statSync: vi.fn((_p: string) => ({ size: 1024 * 100 })), // default: 100 KB
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    renameSync: vi.fn((from: string, to: string) => {
      if (mockFiles.has(from)) {
        mockFiles.set(to, mockFiles.get(from)!)
        mockFiles.delete(from)
      }
    }),
    writeFileSync: vi.fn((p: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
      if (typeof p === 'string') {
        mockFiles.set(p, Buffer.isBuffer(data) ? data : Buffer.from(String(data)))
      }
    }),
    appendFileSync: vi.fn((p: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
      if (typeof p === 'string') {
        const prev = mockFiles.get(p) ?? Buffer.from('')
        const next = Buffer.isBuffer(data) ? data : Buffer.from(String(data))
        mockFiles.set(p, Buffer.concat([prev, next]))
      }
    }),
    readFileSync: vi.fn((p: fs.PathOrFileDescriptor, options?: BufferEncoding | null) => {
      if (typeof p === 'string' && mockFiles.has(p)) {
        const buffer = mockFiles.get(p)!
        return typeof options === 'string' ? buffer.toString(options) : buffer
      }
      throw new Error(`ENOENT: no such file, open '${String(p)}'`)
    }),
    readdirSync: vi.fn(() => []),
    openSync: vi.fn(),
    readSync: vi.fn(),
    closeSync: vi.fn(),
  }
  return {
    ...mocked,
    default: mocked,
  }
})

const mockAdapter = (type: AgentEvent['source'] = 'claude') => {
  const adapter = Object.assign(new EventEmitter(), {
    type,
    start: vi.fn(async () => {}),
    prepareSend: vi.fn(async () => {}),
    send: vi.fn(async (_text: string, _modelId?: string, _reasoningEffort?: string) => {}),
    resume: vi.fn(async () => {}),
    recoverInterruptedRun: vi.fn(async () => ({ result: 'continued' as const })),
    stop: vi.fn(async () => {}),
    configure: vi.fn(),
  })
  return adapter
}

function activeSessionFixture(agentType: 'codex' | 'claude', agentSessionId: string) {
  return {
    adapter: mockAdapter(agentType),
    workDir: '/code/shennian',
    agentType,
    sessionMode: 'standard' as const,
    agentSessionId,
    lastActiveAt: Date.now(),
    currentRunId: null,
    currentRunPhase: null,
    nextEventSeq: 0,
    heartbeatSeq: 0,
    heartbeatTimer: null,
    pendingTextEvent: null,
  }
}

const { mockCreateAgent } = vi.hoisted(() => ({
  mockCreateAgent: vi.fn(),
}))

const { mockLookupClaudeTranscriptCwd } = vi.hoisted(() => ({
  mockLookupClaudeTranscriptCwd: vi.fn(),
}))

const { mockMergeProjectedSessions } = vi.hoisted(() => ({
  mockMergeProjectedSessions: vi.fn(),
}))

const { mockIsCodexThreadTailInterrupted } = vi.hoisted(() => ({
  mockIsCodexThreadTailInterrupted: vi.fn(() => false),
}))

vi.mock('../agents/adapter.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../agents/adapter.js')>()
  return { ...orig, createAgent: mockCreateAgent }
})

vi.mock('../session/attachment-transfer-store.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../session/attachment-transfer-store.js')>()
  return {
    ...original,
    assertFinishedAttachmentReferences: vi.fn(),
    markAttachmentReferences: vi.fn(),
    sweepAttachmentTransfers: vi.fn(() => ({ stagingRemoved: 0, orphanRemoved: 0 })),
  }
})

const { mockManagerModeConstructed } = vi.hoisted(() => ({
  mockManagerModeConstructed: vi.fn(),
}))

vi.mock('../agents/manager.js', () => ({
  ManagerModeAdapter: function ManagerModeAdapter(inner: unknown, substrate: unknown) {
    mockManagerModeConstructed(inner, substrate)
    return inner
  },
}))
vi.mock('../agents/claude.js', () => ({}))
vi.mock('../agents/codex.js', () => ({}))
vi.mock('../agents/gemini.js', () => ({}))
vi.mock('../agents/cursor.js', () => ({}))
vi.mock('../agents/openclaw.js', () => ({}))
vi.mock('../agents/opencode.js', () => ({}))
vi.mock('../agents/pi.js', () => ({
  formatNianHostedModelError: (message: string) => {
    if (message.includes('entitlement_required'))
      return '当前账号尚未开通 Nian 托管模型。请前往神念「套餐与支付」开通 Pro 或 Team，获得积分后重试。'
    if (message.includes('insufficient_credits'))
      return '积分不足，Nian 暂时无法回复。请前往神念「套餐与支付」购买积分包后重试。'
    if (message.includes('429') || message.includes('nian_quota_exceeded'))
      return 'Nian 今日额度已用完，次日自动恢复。'
    return message
  },
}))
vi.mock('../native-fusion/parsers.js', () => ({
  lookupClaudeTranscriptCwd: mockLookupClaudeTranscriptCwd,
}))
vi.mock('../native-fusion/codex-files.js', () => ({
  isCodexThreadTailInterrupted: mockIsCodexThreadTailInterrupted,
}))
vi.mock('../session/projection.js', () => ({
  mergeProjectedSessions: mockMergeProjectedSessions,
}))
vi.mock('../session/history-subscriptions.js', () => ({
  PersonalHistorySubscriptions: class {
    handleOpen = vi.fn()
    handleSync = vi.fn()
    handlePage = vi.fn()
    handleClose = vi.fn()
    closeAll = vi.fn()
    closeSession = vi.fn(() => {
      deletionOrder.push('subscription')
    })
  },
}))
vi.mock('../session/tool-detail-store.js', () => ({
  writeToolDetail: vi.fn((detail: Record<string, unknown> & { sessionId: string }) => {
    const items = mockToolDetails.get(detail.sessionId) ?? []
    items.push({ schemaVersion: 1, ...detail })
    mockToolDetails.set(detail.sessionId, items)
  }),
  readToolDetail: vi.fn(
    (sessionId: string, toolCallId: string) =>
      (mockToolDetails.get(sessionId) ?? []).find((detail) => detail.toolCallId === toolCallId) ??
      null,
  ),
  purgeToolDetails: mockPurgeToolDetails,
}))

vi.mock('../native-fusion/native-source-deletions.js', () => ({
  NativeSourceDeletionStore: class {
    hasSession = () => false
    recordSession = mockRecordSessionTombstone
    record = mockRecordSourceTombstone
    find = mockFindSourceTombstone
  },
}))

vi.mock('../native-fusion/session-native-sources.js', () => ({
  collectLocalNativeSources: mockCollectLocalNativeSources,
}))

vi.mock('../session/deletion-sync-state.js', () => ({
  DeletionSyncRetryWaitError: class DeletionSyncRetryWaitError extends Error {},
  DeletionSyncTerminalError: class DeletionSyncTerminalError extends Error {},
  readDeletionSyncRevision: mockReadDeletionRevision,
  writeDeletionSyncRevision: mockWriteDeletionRevision,
  assertDeletionSyncRunnable: vi.fn(),
  clearDeletionSyncFailure: vi.fn(),
  recordDeletionSyncFailure: mockRecordDeletionSyncFailure,
}))

vi.mock('../session/native-cleanup-outbox.js', () => ({
  NativeSessionCleanupOutbox: class {
    start = mockNativeCleanupStart
    stop = mockNativeCleanupStop
    enqueue = mockNativeCleanupEnqueue
    kick = mockNativeCleanupKick
  },
}))

// SessionManager tests exercise dispatch and event semantics. The durable
// canonical store has fault/recovery coverage in session-store.test.ts.
vi.mock('../session/store.js', () => ({
  getDaemonInstallationId: vi.fn(() => 'daemon-installation-1'),
  recordSession: vi.fn((input: Record<string, unknown> & { sessionId: string }) => {
    const existing = mockSessionRecords.get(input.sessionId) ?? {}
    const record = { ...existing, ...input }
    mockSessionRecords.set(input.sessionId, record)
    return record
  }),
  listSessionRecords: vi.fn(() => [...mockSessionRecords.values()]),
  appendMessage: vi.fn(
    (
      sessionId: string,
      envelope: {
        id: string
        sessionId: string
        role: 'user' | 'agent'
        ts: number
        payload: string
      },
      deliveryState?: string,
    ) => {
      const messages = mockSessionMessages.get(sessionId) ?? []
      const existing = messages.findIndex((message) => message.id === envelope.id)
      if (existing >= 0) messages[existing] = envelope
      else messages.push(envelope)
      mockSessionMessages.set(sessionId, messages)
      if (deliveryState) mockDeliveryStates.set(`${sessionId}:${envelope.id}`, deliveryState)
      return messages.length
    },
  ),
  upsertMessage: vi.fn(
    (
      sessionId: string,
      envelope: {
        id: string
        sessionId: string
        role: 'user' | 'agent'
        ts: number
        payload: string
      },
      deliveryState?: string,
    ) => {
      const messages = mockSessionMessages.get(sessionId) ?? []
      const existing = messages.findIndex((message) => message.id === envelope.id)
      if (existing >= 0) messages[existing] = envelope
      else messages.push(envelope)
      mockSessionMessages.set(sessionId, messages)
      if (deliveryState) mockDeliveryStates.set(`${sessionId}:${envelope.id}`, deliveryState)
      return messages.length + 1
    },
  ),
  tombstoneMessage: vi.fn((sessionId: string, messageId: string) => {
    const messages = mockSessionMessages.get(sessionId) ?? []
    mockSessionMessages.set(
      sessionId,
      messages.filter((message) => message.id !== messageId),
    )
    mockDeliveryStates.set(`${sessionId}:${messageId}`, 'deleted')
  }),
  getMessageDeliveryStatus: vi.fn((sessionId: string, clientMessageId: string) => {
    const state = mockDeliveryStates.get(`${sessionId}:${clientMessageId}`)
    return state
      ? {
          state,
          sessionId,
          clientMessageId,
          messageId: clientMessageId,
          deliveryState: state,
          bodyRevision: 1,
          committedAt: new Date(0).toISOString(),
        }
      : { state: 'not_found', sessionId, clientMessageId }
  }),
  listPendingSessionIndexUpdates: vi.fn(() => []),
  acknowledgeSessionIndexUpdate: vi.fn(),
  recordSessionIndexRejection: vi.fn(),
  claimSessionTitleGenerationCandidates: vi.fn(() => []),
  applyGeneratedSessionTitle: vi.fn(),
  purgeCanonicalSession: mockPurgeCanonicalSession,
  purgeSessionRecord: mockPurgeSessionRecord,
  readMessages: vi.fn((sessionId: string, options?: { limit?: number; before?: number }) => {
    let messages = [...(mockSessionMessages.get(sessionId) ?? [])].sort(
      (left, right) => right.ts - left.ts,
    )
    if (options?.before !== undefined) {
      messages = messages.filter((message) => message.ts < options.before!)
    }
    return options?.limit ? messages.slice(0, options.limit) : messages
  }),
}))

vi.mock('../personal-sync/identity.js', () => ({
  getDaemonInstallationId: vi.fn(() => 'daemon-installation-1'),
}))

import { SessionManager, upgradeRecoveryVisibleMessage } from '../session/manager.js'
import { recoverJournaledRun } from '../session/handlers/chat-recovery.js'
import * as sessionStore from '../session/store.js'

function createTestSessionManager(
  client: never,
  nativeFusion?: never,
  revokeManagedRoomContextToken?: (token: string) => void,
  managedRoomExecutor?: ManagedRoomExecutor,
): SessionManager {
  const records = new Map<string, Record<string, unknown>>()
  const pendingRecords = () =>
    [...records.values()].filter(
      (record) =>
        record.phase === 'dispatching' ||
        record.phase === 'running' ||
        record.phase === 'waiting_approval' ||
        record.phase === 'recovering' ||
        record.phase === 'interrupted_by_upgrade' ||
        record.phase === 'recovery_failed' ||
        record.phase === 'aborted',
    )
  const runJournal = {
    loadRecoverable: vi.fn(() => ({
      records: pendingRecords().filter(
        (record) =>
          record.phase === 'dispatching' ||
          record.phase === 'running' ||
          record.phase === 'waiting_approval' ||
          record.phase === 'recovering',
      ),
      quarantined: [],
    })),
    loadPendingReconciliation: vi.fn(() => ({ records: pendingRecords(), quarantined: [] })),
    begin: vi.fn((input: Record<string, unknown>) => {
      const record = {
        ...input,
        schemaVersion: 1,
        lastObservedEventSeq: -1,
        phase: 'dispatching',
        upgradeJobId: null,
        interruptionReason: null,
        continueDispatchState: 'none',
        recoveryAttempts: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      records.set(`${input.sessionId}:${input.runId}`, record)
      return record
    }),
    get: vi.fn((sessionId: string, runId: string) => records.get(`${sessionId}:${runId}`) ?? null),
    update: vi.fn((sessionId: string, runId: string, patch: Record<string, unknown>) => {
      const key = `${sessionId}:${runId}`
      const current = records.get(key)
      if (!current) return null
      const next = { ...current, ...patch }
      records.set(key, next)
      return next
    }),
    remove: vi.fn((sessionId: string, runId: string) => records.delete(`${sessionId}:${runId}`)),
    markAborted: vi.fn(),
    markSessionAborted: vi.fn(() => 0),
    markPlannedUpgrade: vi.fn((upgradeJobId: string) => {
      const recoverable = pendingRecords().filter(
        (record) =>
          record.phase === 'dispatching' ||
          record.phase === 'running' ||
          record.phase === 'waiting_approval' ||
          record.phase === 'recovering',
      )
      for (const record of recoverable) {
        record.upgradeJobId = upgradeJobId
        record.interruptionReason = 'planned_upgrade'
      }
      return recoverable.length
    }),
    sync: vi.fn(),
  }
  const manager = new SessionManager(
    client,
    nativeFusion,
    undefined,
    null,
    null,
    null,
    revokeManagedRoomContextToken ?? null,
    managedRoomExecutor ?? null,
    runJournal as never,
  )
  const dispatch = manager.handleReq.bind(manager)
  const personalMethods = new Set([
    'chat.send',
    'chat.enqueue',
    'chat.queue.get',
    'chat.queue.edit',
    'chat.queue.delete',
    'chat.abort',
    'session.refresh',
    'session.history.open',
    'session.history.sync',
    'session.history.page',
    'session.history.close',
    'session.message.status',
    'session.tool.detail',
    'voice.session.body.window',
    'session.title.set',
    'fs.transfer.start',
    'fs.transfer.chunk',
    'fs.transfer.finish',
    'fs.transfer.abort',
  ])
  manager.handleReq = (req, options) =>
    dispatch(
      personalMethods.has(req.method)
        ? {
            ...req,
            params: {
              protocolVersion: 2,
              dataEpoch: 2,
              daemonInstallationId: 'daemon-installation-1',
              ...req.params,
            },
          }
        : req,
      options,
    )
  return manager
}

function createMockClient() {
  return {
    sendRes: vi.fn(),
    sendEvent: vi.fn(),
    sendAgentEvent: vi.fn(),
    sendBufferedEvent: vi.fn(async () => {}),
    getState: vi.fn(() => 'connected'),
    sendReq: vi.fn(),
  }
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function mockPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

export const importedTestDependencies = {
  CODEX_DESKTOP_SEND_UNAVAILABLE,
  EventEmitter,
  SessionManager,
  fs,
  markTrustedManagerEvent,
  os,
  recoverJournaledRun,
  sessionStore,
  upgradeRecoveryVisibleMessage,
}

export {
  AgentEvent,
  CODEX_DESKTOP_SEND_UNAVAILABLE,
  EventEmitter,
  ManagedRoomExecutor,
  PreparedManagedRoomTurn,
  SessionManager,
  TEST_ATTACHMENT_SHA256,
  activeSessionFixture,
  createHash,
  createMockClient,
  createTestSessionManager,
  deletionOrder,
  fs,
  markTrustedManagerEvent,
  mockAdapter,
  mockCreateAgent,
  mockDeliveryStates,
  mockFiles,
  mockFindSourceTombstone,
  mockCollectLocalNativeSources,
  mockIsCodexThreadTailInterrupted,
  mockLookupClaudeTranscriptCwd,
  mockManagerModeConstructed,
  mockMergeProjectedSessions,
  mockNativeCleanupEnqueue,
  mockNativeCleanupKick,
  mockNativeCleanupStart,
  mockNativeCleanupStop,
  mockPlatform,
  mockPurgeCanonicalSession,
  mockPurgeSessionRecord,
  mockPurgeToolDetails,
  mockReadDeletionRevision,
  mockRecordDeletionSyncFailure,
  mockRecordSessionTombstone,
  mockRecordSourceTombstone,
  mockSessionMessages,
  mockSessionRecords,
  mockToolDetails,
  mockWriteDeletionRevision,
  originalPlatform,
  os,
  preparedManagedRoomTurn,
  recoverJournaledRun,
  sessionStore,
  upgradeRecoveryVisibleMessage,
}

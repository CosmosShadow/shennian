// @covers src/native-fusion/service.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockLoadState,
  mockSaveState,
  mockListClaudeFiles,
  mockListCodexFiles,
  mockListOpenCodeFiles,
  mockListNativeRoots,
  mockParseClaudeChunk,
  mockParseCodexChunk,
  mockParseOpenCodeFile,
  mockInspectNativeSessionFile,
  mockCommitEvents,
  mockObserveNativeTitle,
  mockListSourceBindings,
  mockIsSourceDeleted,
  mockLookupCodexThreadName,
  mockListPendingIndexUpdates,
  mockAcknowledgeIndexUpdate,
  mockApplyGeneratedSessionTitle,
  mockClaimSessionTitleGenerationCandidates,
  mockDeferSessionTitleGeneration,
  mockListSessionRecords,
  mockPurgeCanonicalSession,
  mockPurgeSessionRecord,
  mockRecordSessionIndexRejection,
  managedClaims,
  managedSuppressions,
  mockListManagedClaims,
  mockListManagedSuppressions,
  mockUpsertManagedClaim,
  mockUpdateManagedClaimSource,
  mockRemoveManagedClaim,
  mockCompleteManagedClaim,
  mockRemoveManagedSuppression,
  mockUpdateMessageDeliveryState,
} = vi.hoisted(() => ({
  mockLoadState: vi.fn(),
  mockSaveState: vi.fn(),
  mockListClaudeFiles: vi.fn(),
  mockListCodexFiles: vi.fn(),
  mockListOpenCodeFiles: vi.fn(),
  mockListNativeRoots: vi.fn(),
  mockParseClaudeChunk: vi.fn(),
  mockParseCodexChunk: vi.fn(),
  mockParseOpenCodeFile: vi.fn(),
  mockInspectNativeSessionFile: vi.fn(
    (
      _filePath: string,
    ):
      | { status: 'pending' }
      | {
          status: 'ready'
          createdAtMs: number
          sources: Array<{
            agentType: 'codex' | 'claude' | 'opencode'
            sourceSessionKey: string
          }>
        } => ({
      status: 'ready',
      createdAtMs: Date.parse('2026-06-04T10:00:10.000Z'),
      sources: [],
    }),
  ),
  mockCommitEvents: vi.fn(),
  mockObserveNativeTitle: vi.fn(() => false),
  mockListSourceBindings: vi.fn(() => []),
  mockIsSourceDeleted: vi.fn((_agentType: string, _sourceSessionKey: string) => false),
  mockLookupCodexThreadName: vi.fn(() => null),
  mockListPendingIndexUpdates: vi.fn(() => []),
  mockAcknowledgeIndexUpdate: vi.fn(),
  mockApplyGeneratedSessionTitle: vi.fn(() => false),
  mockClaimSessionTitleGenerationCandidates: vi.fn(() => []),
  mockDeferSessionTitleGeneration: vi.fn(() => null),
  mockListSessionRecords: vi.fn(() => []),
  mockPurgeCanonicalSession: vi.fn(),
  mockPurgeSessionRecord: vi.fn(),
  mockRecordSessionIndexRejection: vi.fn(),
  managedClaims: new Map<string, Record<string, unknown>>(),
  managedSuppressions: new Map<string, Record<string, unknown>>(),
  mockListManagedClaims: vi.fn(),
  mockListManagedSuppressions: vi.fn(),
  mockUpsertManagedClaim: vi.fn(),
  mockUpdateManagedClaimSource: vi.fn(),
  mockRemoveManagedClaim: vi.fn(),
  mockCompleteManagedClaim: vi.fn(),
  mockRemoveManagedSuppression: vi.fn(),
  mockUpdateMessageDeliveryState: vi.fn(),
}))

vi.mock('../native-fusion/local-repository.js', () => ({
  NativeEventIdentityConflictError: class NativeEventIdentityConflictError extends Error {
    readonly code = 'native_event_identity_conflict'
    constructor(readonly sourceEventKey: string) {
      super(`native event identity conflict: ${sourceEventKey}`)
      this.name = 'NativeEventIdentityConflictError'
    }
  },
  NativeFusionLocalRepository: class {
    commitEvents = mockCommitEvents
    observeNativeTitle = mockObserveNativeTitle
    listSourceBindings = mockListSourceBindings
    isSourceDeleted = mockIsSourceDeleted
    listManagedClaims = mockListManagedClaims
    listManagedSuppressions = mockListManagedSuppressions
    upsertManagedClaim = mockUpsertManagedClaim
    updateManagedClaimSource = mockUpdateManagedClaimSource
    removeManagedClaim = mockRemoveManagedClaim
    completeManagedClaim = mockCompleteManagedClaim
    removeManagedSuppression = mockRemoveManagedSuppression
    updateMessageDeliveryState = mockUpdateMessageDeliveryState
  },
}))

vi.mock('../session/store.js', () => ({
  listPendingSessionIndexUpdates: mockListPendingIndexUpdates,
  acknowledgeSessionIndexUpdate: mockAcknowledgeIndexUpdate,
  applyGeneratedSessionTitle: mockApplyGeneratedSessionTitle,
  claimSessionTitleGenerationCandidates: mockClaimSessionTitleGenerationCandidates,
  deferSessionTitleGeneration: mockDeferSessionTitleGeneration,
  listSessionRecords: mockListSessionRecords,
  purgeCanonicalSession: mockPurgeCanonicalSession,
  purgeSessionRecord: mockPurgeSessionRecord,
  recordSessionIndexRejection: mockRecordSessionIndexRejection,
}))

vi.mock('../native-fusion/state.js', () => ({
  loadNativeScannerState: mockLoadState,
  saveNativeScannerState: mockSaveState,
}))

vi.mock('../native-fusion/parsers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../native-fusion/parsers.js')>()
  return {
    ...actual,
    listClaudeTranscriptFiles: mockListClaudeFiles,
    listCodexRolloutFiles: mockListCodexFiles,
    listOpenCodeSessionFiles: mockListOpenCodeFiles,
    listNativeTranscriptRoots: mockListNativeRoots,
    parseClaudeTranscriptChunkCooperatively: mockParseClaudeChunk,
    parseCodexRolloutChunkCooperatively: mockParseCodexChunk,
    parseOpenCodeSessionFile: mockParseOpenCodeFile,
    inspectNativeSessionFile: mockInspectNativeSessionFile,
    lookupCodexThreadName: mockLookupCodexThreadName,
  }
})

import { NativeSessionFusionService } from '../native-fusion/service.js'

function createClient() {
  return {
    getState: vi.fn(() => 'connected'),
    sendBufferedEvent: vi.fn(async () => {}),
    sendAgentEvent: vi.fn(),
  }
}

function createTranscriptFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-fusion-'))
  const filePath = path.join(dir, 'claude-session.jsonl')
  fs.writeFileSync(filePath, '')
  return filePath
}

function mockKnownNativeFile(filePath: string): void {
  const stat = fs.statSync(filePath)
  mockLoadState.mockReturnValue({
    schemaVersion: 1,
    fusionEpochMs: Date.parse('2026-01-01T00:00:00.000Z'),
    daemonInstallationId: 'daemon-test',
    files: {
      [filePath]: {
        daemonInstallationId: 'daemon-test',
        offset: 0,
        mtimeMs: stat.mtimeMs,
        classification: 'live',
        awaitingUserBoundary: false,
      },
    },
    codexAppContextWrapperFixed: true,
  })
}

describe('NativeSessionFusionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    managedClaims.clear()
    managedSuppressions.clear()
    mockListManagedClaims.mockImplementation(() => [...managedClaims.values()])
    mockListManagedSuppressions.mockImplementation(() => [...managedSuppressions.values()])
    mockUpsertManagedClaim.mockImplementation((claim: Record<string, unknown>) => {
      managedClaims.set(String(claim.canonicalMessageId), { ...claim })
    })
    mockUpdateManagedClaimSource.mockImplementation(
      (sessionId: string, agentType: string, sourceSessionKey: string) => {
        for (const claim of managedClaims.values()) {
          if (claim.sessionId === sessionId && claim.sourceAgentType === agentType) {
            claim.sourceSessionKey = sourceSessionKey
          }
        }
      },
    )
    mockRemoveManagedClaim.mockImplementation((canonicalMessageId: string) => {
      managedClaims.delete(canonicalMessageId)
    })
    mockCompleteManagedClaim.mockImplementation(
      (canonicalMessageId: string, suppression?: Record<string, unknown>) => {
        managedClaims.delete(canonicalMessageId)
        if (suppression) {
          managedSuppressions.set(
            `${String(suppression.agentType)}:${String(suppression.sourceSessionKey)}`,
            { ...suppression },
          )
        }
      },
    )
    mockRemoveManagedSuppression.mockImplementation(
      (agentType: string, sourceSessionKey: string) => {
        managedSuppressions.delete(`${agentType}:${sourceSessionKey}`)
      },
    )
    mockLoadState.mockReturnValue({
      schemaVersion: 1,
      fusionEpochMs: Date.parse('2026-01-01T00:00:00.000Z'),
      daemonInstallationId: 'daemon-test',
      files: {},
    })
    mockListCodexFiles.mockReturnValue([])
    mockListClaudeFiles.mockReturnValue([])
    mockListOpenCodeFiles.mockReturnValue([])
    mockListNativeRoots.mockReturnValue([])
    mockParseClaudeChunk.mockReturnValue({ nextOffset: 0, events: [] })
    mockParseCodexChunk.mockReturnValue({ nextOffset: 0, events: [] })
    mockParseOpenCodeFile.mockReturnValue({ nextOffset: 0, events: [] })
    mockInspectNativeSessionFile.mockReturnValue({
      status: 'ready',
      createdAtMs: Date.parse('2026-06-04T10:00:10.000Z'),
      sources: [],
    })
    mockListPendingIndexUpdates.mockReturnValue([])
    mockListSourceBindings.mockReturnValue([])
    mockIsSourceDeleted.mockReturnValue(false)
    mockLookupCodexThreadName.mockReturnValue(null)
  })

  it('imports a live file created between 60-second scans from offset zero', async () => {
    const epoch = Date.parse('2026-06-04T10:00:00.000Z')
    mockLoadState.mockReturnValue({
      schemaVersion: 1,
      fusionEpochMs: epoch,
      daemonInstallationId: 'daemon-test',
      files: {},
    })
    const client = createClient()
    const service = new NativeSessionFusionService(client as never)
    const filePath = createTranscriptFile()
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({
        type: 'user',
        timestamp: '2026-06-04T10:00:10.000Z',
        message: { content: 'created after daemon start' },
      })}\n`,
    )
    mockListClaudeFiles.mockReturnValue([filePath])
    mockParseClaudeChunk.mockReturnValue({
      nextOffset: fs.statSync(filePath).size,
      events: [
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'live-source',
          sourceEventKey: 'live-user',
          role: 'user',
          ts: epoch + 10_000,
          payload: 'created after daemon start',
        },
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'live-source',
          sourceEventKey: 'live-agent',
          role: 'agent',
          ts: epoch + 11_000,
          payload: 'reply already present at first discovery',
        },
      ],
    })

    await service.scanNow()

    expect(mockParseClaudeChunk).toHaveBeenCalledWith(filePath, 0)
    expect(mockCommitEvents).toHaveBeenCalledWith([
      expect.objectContaining({ role: 'user', payload: 'created after daemon start' }),
      expect.objectContaining({
        role: 'agent',
        payload: 'reply already present at first discovery',
      }),
    ])
    expect(mockSaveState).toHaveBeenCalledWith(
      expect.objectContaining({
        files: {
          [filePath]: expect.objectContaining({
            classification: 'live',
            awaitingUserBoundary: false,
          }),
        },
      }),
    )
  })
  it('actively rescans a new live file until its first user boundary appears', async () => {
    vi.useFakeTimers()
    try {
      const epoch = Date.parse('2026-06-04T10:00:00.000Z')
      const state = {
        schemaVersion: 1,
        fusionEpochMs: epoch,
        daemonInstallationId: 'daemon-test',
        files: {},
      }
      mockLoadState.mockReturnValue(state)
      const client = createClient()
      const service = new NativeSessionFusionService(client as never)
      const filePath = createTranscriptFile()
      mockInspectNativeSessionFile.mockReturnValue({
        status: 'ready',
        createdAtMs: epoch + 10_000,
        sources: [],
      })
      mockListClaudeFiles.mockReturnValue([filePath])
      mockParseClaudeChunk.mockReturnValueOnce({ nextOffset: 0, events: [] })

      await service.scanNow()
      expect(mockCommitEvents).toHaveBeenLastCalledWith([])

      fs.writeFileSync(filePath, '{"type":"user"}\n')
      mockParseClaudeChunk.mockReturnValue({
        nextOffset: fs.statSync(filePath).size,
        events: [
          {
            agentType: 'claude',
            sourceMode: 'claude_transcript_import',
            sourceSessionKey: 'live-source',
            sourceEventKey: 'live-user',
            role: 'user',
            ts: epoch + 12_000,
            payload: 'created after initial file event',
          },
        ],
      })

      await vi.advanceTimersByTimeAsync(2_000)

      expect(mockCommitEvents).toHaveBeenLastCalledWith([
        expect.objectContaining({ role: 'user', payload: 'created after initial file event' }),
      ])
      expect(mockSaveState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          files: { [filePath]: expect.objectContaining({ awaitingUserBoundary: false }) },
        }),
      )
      service.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('advances past but never imports events from a durably deleted native source', async () => {
    const epoch = Date.parse('2026-06-04T10:00:00.000Z')
    const client = createClient()
    const service = new NativeSessionFusionService(client as never)
    const filePath = createTranscriptFile()
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({
        type: 'user',
        timestamp: '2026-06-04T10:00:10.000Z',
        message: { content: 'late append' },
      })}\n`,
    )
    mockLoadState.mockReturnValue({
      schemaVersion: 1,
      fusionEpochMs: epoch,
      daemonInstallationId: 'daemon-test',
      files: {},
    })
    mockListClaudeFiles.mockReturnValue([filePath])
    mockParseClaudeChunk.mockReturnValue({
      nextOffset: fs.statSync(filePath).size,
      events: [
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'deleted-source',
          sourceEventKey: 'late-user',
          role: 'user',
          ts: epoch + 10_000,
          payload: 'late append',
        },
      ],
    })
    mockIsSourceDeleted.mockImplementation(
      (_agentType, sourceSessionKey) => sourceSessionKey === 'deleted-source',
    )
    mockInspectNativeSessionFile.mockReturnValue({
      status: 'ready',
      createdAtMs: epoch + 10_000,
      sources: [{ agentType: 'claude', sourceSessionKey: 'deleted-source' }],
    })

    await service.scanNow()

    expect(mockCommitEvents).toHaveBeenCalledWith([])
    expect(mockSaveState).toHaveBeenCalledWith(
      expect.objectContaining({
        files: {
          [filePath]: expect.objectContaining({
            daemonInstallationId: 'daemon-test',
            offset: fs.statSync(filePath).size,
          }),
        },
      }),
    )
  })

  it('keeps an incomplete unknown file pending without creating an EOF cursor', async () => {
    const client = createClient()
    const service = new NativeSessionFusionService(client as never)
    const filePath = createTranscriptFile()
    fs.writeFileSync(filePath, '{"type":"user"')
    mockInspectNativeSessionFile.mockReturnValue({ status: 'pending' })
    mockListClaudeFiles.mockReturnValue([filePath])

    await service.scanNow()

    expect(mockParseClaudeChunk).not.toHaveBeenCalled()
    expect(mockSaveState).toHaveBeenCalledWith(expect.objectContaining({ files: {} }))
  })

  it('does not advance a historical cursor through an agent-only tail', async () => {
    const client = createClient()
    const service = new NativeSessionFusionService(client as never)
    const filePath = createTranscriptFile()
    fs.writeFileSync(filePath, 'baseline\nagent tail\n')
    const baselineOffset = Buffer.byteLength('baseline\n')
    mockLoadState.mockReturnValue({
      schemaVersion: 1,
      fusionEpochMs: Date.parse('2026-06-04T10:00:00.000Z'),
      daemonInstallationId: 'daemon-test',
      files: {
        [filePath]: {
          offset: baselineOffset,
          mtimeMs: 1,
          classification: 'historical',
          awaitingUserBoundary: true,
        },
      },
    })
    mockListClaudeFiles.mockReturnValue([filePath])
    mockParseClaudeChunk.mockReturnValue({
      nextOffset: fs.statSync(filePath).size,
      events: [
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'old-source',
          sourceEventKey: 'agent-tail',
          role: 'agent',
          ts: Date.parse('2026-06-04T10:01:00.000Z'),
          payload: 'tail without a new user boundary',
        },
      ],
    })

    await service.scanNow()

    expect(client.sendBufferedEvent).not.toHaveBeenCalled()
    expect(mockSaveState).toHaveBeenCalledWith(
      expect.objectContaining({
        files: {
          [filePath]: expect.objectContaining({
            offset: baselineOffset,
            awaitingUserBoundary: true,
          }),
        },
      }),
    )
  })

  it('continues importing incrementally after a new native file has been baselined', async () => {
    const client = createClient()
    const service = new NativeSessionFusionService(client as never)
    const filePath = createTranscriptFile()
    fs.writeFileSync(filePath, 'old native history\n')
    const baseline = fs.statSync(filePath)
    mockLoadState.mockReturnValue({
      schemaVersion: 1,
      fusionEpochMs: Date.parse('2026-06-04T10:00:00.000Z'),
      daemonInstallationId: 'daemon-test',
      files: {
        [filePath]: {
          offset: baseline.size,
          mtimeMs: baseline.mtimeMs,
          classification: 'historical',
          awaitingUserBoundary: true,
        },
      },
      codexAppContextWrapperFixed: true,
    })
    mockListClaudeFiles.mockReturnValue([filePath])
    fs.appendFileSync(filePath, 'new turn\n')
    fs.utimesSync(filePath, new Date(baseline.mtimeMs + 5_000), new Date(baseline.mtimeMs + 5_000))
    mockParseClaudeChunk.mockReturnValue({
      nextOffset: baseline.size + 100,
      events: [
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'claude-native-1',
          sourceEventKey: 'evt-new',
          cursor: `${filePath}:${baseline.size}`,
          role: 'user',
          ts: Date.parse('2026-06-04T10:00:00.000Z'),
          payload: 'new turn',
          title: 'new turn',
          workDir: '/tmp/project',
        },
      ],
    })

    await service.scanNow()

    expect(mockParseClaudeChunk).toHaveBeenCalledWith(filePath, baseline.size)
    expect(mockCommitEvents).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
    )
    expect(mockSaveState).toHaveBeenCalledWith(
      expect.objectContaining({
        files: {
          [filePath]: expect.objectContaining({
            classification: 'historical',
            awaitingUserBoundary: false,
          }),
        },
      }),
    )
  })

  it('does not claim a native claude user message before sourceSessionKey is known', async () => {
    const now = Date.parse('2026-04-23T13:09:17.785Z')
    vi.setSystemTime(now)
    const client = createClient()
    const service = new NativeSessionFusionService(client as never)
    const filePath = createTranscriptFile()
    mockKnownNativeFile(filePath)
    mockListClaudeFiles.mockReturnValue([filePath])

    service.registerManagedSend({
      sessionId: 'sess-1',
      agentType: 'claude',
      canonicalMessageId: 'msg-user-1',
      text: 'hello',
    })

    mockParseClaudeChunk.mockReturnValue({
      nextOffset: 200,
      events: [
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'claude-native-1',
          sourceEventKey: 'evt-user',
          cursor: `${filePath}:1`,
          role: 'user',
          ts: now,
          payload: 'hello',
          title: 'hello',
          workDir: 'Users/lichen/Documents/code/projects/shennian',
        },
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'claude-native-1',
          sourceEventKey: 'evt-assistant',
          cursor: `${filePath}:2`,
          role: 'agent',
          ts: now + 4000,
          payload: 'Hey! What are you working on?',
          title: 'hello',
          modelId: 'claude-sonnet-4-6',
          workDir: 'Users/lichen/Documents/code/projects/shennian',
        },
      ],
    })

    await service.scanNow()

    const sent = mockCommitEvents.mock.calls.at(-1)?.[0] as unknown[]
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({
      sourceMode: 'claude_transcript_import',
      role: 'user',
      payload: 'hello',
    })
    expect(sent[1]).toMatchObject({
      sourceMode: 'claude_transcript_import',
      role: 'agent',
      payload: 'Hey! What are you working on?',
    })
  })

  it('claims a managed echo once sourceSessionKey is known and suppresses the immediate assistant echo', async () => {
    const now = Date.parse('2026-04-23T13:09:17.785Z')
    vi.setSystemTime(now)
    const client = createClient()
    const service = new NativeSessionFusionService(client as never)
    const filePath = createTranscriptFile()
    mockKnownNativeFile(filePath)
    mockListClaudeFiles.mockReturnValue([filePath])

    service.registerManagedSend({
      sessionId: 'sess-1',
      agentType: 'claude',
      canonicalMessageId: 'msg-user-1',
      sourceSessionKey: 'claude-native-1',
      text: 'hello',
    })

    mockParseClaudeChunk.mockReturnValue({
      nextOffset: 200,
      events: [
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'claude-native-1',
          sourceEventKey: 'evt-user',
          cursor: `${filePath}:1`,
          role: 'user',
          ts: now,
          payload: 'hello',
          title: 'hello',
          workDir: 'Users/lichen/Documents/code/projects/shennian',
        },
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'claude-native-1',
          sourceEventKey: 'evt-assistant',
          cursor: `${filePath}:2`,
          role: 'agent',
          ts: now + 4000,
          payload: 'Hey! What are you working on?',
          title: 'hello',
          modelId: 'claude-sonnet-4-6',
          workDir: 'Users/lichen/Documents/code/projects/shennian',
        },
      ],
    })

    await service.scanNow()

    const sent = mockCommitEvents.mock.calls.at(-1)?.[0] as unknown[]
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({
      sourceMode: 'managed_echo_claim',
      role: 'user',
      claimCanonicalMessageId: 'msg-user-1',
    })
    expect(sent[1]).toMatchObject({
      sourceEventKey: 'evt-assistant',
      localDisposition: 'managed_echo_suppressed',
      claimSessionId: 'sess-1',
    })
  })

  it('claims a manager session against its underlying codex source session', async () => {
    const now = Date.parse('2026-04-23T13:09:17.785Z')
    vi.setSystemTime(now)
    const client = createClient()
    const service = new NativeSessionFusionService(client as never)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-fusion-codex-'))
    const filePath = path.join(dir, '.codex', 'sessions', 'rollout.jsonl')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, '')
    mockKnownNativeFile(filePath)
    mockListCodexFiles.mockReturnValue([filePath])

    service.registerManagedSend({
      sessionId: 'sess-manager-1',
      agentType: 'manager',
      sourceAgentType: 'codex',
      canonicalMessageId: 'msg-user-manager',
      sourceSessionKey: 'codex-native-manager-1',
      text: '给我介绍一下本项目',
    })

    mockParseCodexChunk.mockReturnValue({
      nextOffset: 200,
      events: [
        {
          agentType: 'codex',
          sourceMode: 'codex_rollout_import',
          sourceSessionKey: 'codex-native-manager-1',
          sourceEventKey: 'evt-user-manager',
          cursor: `${filePath}:1`,
          role: 'user',
          ts: now,
          payload: '给我介绍一下本项目',
          title: '神念项目介绍',
          workDir: '/Users/example/Documents/code/projects/shennian',
        },
        {
          agentType: 'codex',
          sourceMode: 'codex_rollout_import',
          sourceSessionKey: 'codex-native-manager-1',
          sourceEventKey: 'evt-agent-manager',
          cursor: `${filePath}:2`,
          role: 'agent',
          ts: now + 4000,
          payload: 'manager native echo',
          title: '神念项目介绍',
          modelId: 'codex',
          workDir: '/Users/example/Documents/code/projects/shennian',
        },
      ],
    })

    await service.scanNow()

    const sent = mockCommitEvents.mock.calls.at(-1)?.[0] as unknown[]
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({
      agentType: 'codex',
      sourceMode: 'managed_echo_claim',
      role: 'user',
      claimCanonicalMessageId: 'msg-user-manager',
    })
    expect(sent[1]).toMatchObject({
      sourceEventKey: 'evt-agent-manager',
      localDisposition: 'managed_echo_suppressed',
      claimSessionId: 'sess-manager-1',
    })
  })
})

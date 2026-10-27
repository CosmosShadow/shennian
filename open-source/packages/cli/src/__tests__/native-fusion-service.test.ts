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

import { NativeEventIdentityConflictError } from '../native-fusion/local-repository.js'
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

function pendingIndexUpdate(indexRevision = 2) {
  return {
    protocolVersion: 1,
    daemonInstallationId: 'daemon-test',
    session: { id: 'session-local-1', indexRevision },
  } as never
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

function withPlatform(value: NodeJS.Platform, run: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value })
  return run().finally(() => {
    if (original) {
      Object.defineProperty(process, 'platform', original)
    }
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

  it('durably ignores internal native sources before they reach personal session storage', async () => {
    let scannerState = {
      schemaVersion: 1 as const,
      fusionEpochMs: Date.parse('2026-01-01T00:00:00.000Z'),
      daemonInstallationId: 'daemon-test',
      files: {},
      ignoredSources: {} as Record<string, true>,
    }
    mockLoadState.mockImplementation(() => structuredClone(scannerState))
    mockSaveState.mockImplementation((next) => {
      scannerState = structuredClone(next)
    })
    const filePath = createTranscriptFile()
    fs.writeFileSync(filePath, '{}\n')
    mockListCodexFiles.mockReturnValue([filePath])
    mockInspectNativeSessionFile.mockReturnValue({
      status: 'ready',
      createdAtMs: Date.parse('2026-06-04T10:00:10.000Z'),
      sources: [{ agentType: 'codex', sourceSessionKey: 'validation-thread' }],
    })
    mockParseCodexChunk.mockReturnValue({
      nextOffset: fs.statSync(filePath).size,
      events: [
        {
          agentType: 'codex',
          sourceMode: 'codex_rollout_import',
          sourceSessionKey: 'validation-thread',
          sourceEventKey: 'codex:validation-thread:1:user',
          cursor: `${filePath}:1`,
          role: 'user',
          payload: '请回复 hello，用于确认你已准备好。',
          ts: Date.parse('2026-06-04T10:00:11.000Z'),
          workDir: '/workspace',
          modelId: null,
          title: '',
        },
      ],
    })
    const service = new NativeSessionFusionService(createClient() as never)

    service.ignoreNativeSource('codex', 'validation-thread')
    const restartedService = new NativeSessionFusionService(createClient() as never)
    await restartedService.scanNow()

    expect(mockCommitEvents.mock.calls.every(([events]) => events.length === 0)).toBe(true)
    expect(mockSaveState).toHaveBeenCalledWith(
      expect.objectContaining({
        ignoredSources: { 'codex:validation-thread': true },
      }),
    )
  })

  it('observes a bound Codex thread name even when no rollout body changed', async () => {
    const client = createClient()
    mockListSourceBindings.mockReturnValue([
      { agentType: 'codex', sourceSessionKey: 'thread-1', sessionId: 'session-1' },
    ] as never)
    mockLookupCodexThreadName.mockReturnValue('Codex 原生标题' as never)
    const service = new NativeSessionFusionService(client as never)

    await service.scanNow()

    expect(mockLookupCodexThreadName).toHaveBeenCalledWith('thread-1')
    expect(mockObserveNativeTitle).toHaveBeenCalledWith('codex', 'thread-1', 'Codex 原生标题')
  })

  it('targets active observations after their native source file is known', () => {
    const service = new NativeSessionFusionService(createClient() as never)
    const internals = service as unknown as {
      externalObservations: Map<string, unknown[]>
      pendingBoundaryFiles: Set<string>
      sourceFiles: Map<string, string>
      activeScanTargets(): string[] | undefined
    }
    internals.externalObservations.set('codex:thread-1', [{}])
    internals.pendingBoundaryFiles.add('/tmp/pending.jsonl')

    expect(internals.activeScanTargets()).toBeUndefined()

    internals.sourceFiles.set('codex:thread-1', '/tmp/thread-1.jsonl')
    expect(internals.activeScanTargets()).toEqual(['/tmp/pending.jsonl', '/tmp/thread-1.jsonl'])
  })

  it('yields to websocket timers during a large reconciliation scan', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-fusion-yield-'))
    const files = Array.from({ length: 33 }, (_, index) => {
      const filePath = path.join(directory, `session-${index}.jsonl`)
      fs.writeFileSync(filePath, '')
      return filePath
    })
    mockListClaudeFiles.mockReturnValue(files)
    let timerObserved = false
    setImmediate(() => {
      timerObserved = true
    })

    await new NativeSessionFusionService(createClient() as never).scanNow()

    expect(timerObserved).toBe(true)
  })

  it('reconciles the newest native transcripts before older backlogs', async () => {
    const olderFile = createTranscriptFile()
    const newerFile = createTranscriptFile()
    const nowSeconds = Date.now() / 1_000
    fs.utimesSync(olderFile, nowSeconds - 60, nowSeconds - 60)
    fs.utimesSync(newerFile, nowSeconds, nowSeconds)
    mockListClaudeFiles.mockReturnValue([olderFile, newerFile])
    const parsedOrder: string[] = []
    mockParseClaudeChunk.mockImplementation(async (filePath: string) => {
      parsedOrder.push(filePath)
      return { nextOffset: fs.statSync(filePath).size, events: [] }
    })

    await new NativeSessionFusionService(createClient() as never).scanNow()

    expect(parsedOrder).toEqual([newerFile, olderFile])
  })

  it('interleaves watched active tails with the remaining full-scan backlog', async () => {
    const newestBacklog = createTranscriptFile()
    const olderBacklog = createTranscriptFile()
    const activeTail = createTranscriptFile()
    const nowSeconds = Date.now() / 1_000
    fs.utimesSync(olderBacklog, nowSeconds - 120, nowSeconds - 120)
    fs.utimesSync(newestBacklog, nowSeconds - 60, nowSeconds - 60)
    fs.utimesSync(activeTail, nowSeconds, nowSeconds)
    mockListClaudeFiles.mockReturnValue([olderBacklog, newestBacklog])
    const parsedOrder: string[] = []
    const service = new NativeSessionFusionService(createClient() as never)
    mockParseClaudeChunk.mockImplementation(async (filePath: string) => {
      parsedOrder.push(filePath)
      if (filePath === newestBacklog) void service.scanNow([activeTail])
      return { nextOffset: fs.statSync(filePath).size, events: [] }
    })

    await service.scanNow()

    expect(parsedOrder).toEqual([newestBacklog, activeTail, olderBacklog])
  })

  it('drains a large native backlog to its fixed EOF in one cooperative scan', async () => {
    const filePath = createTranscriptFile()
    fs.writeFileSync(filePath, Buffer.alloc(3 * 1024 * 1024))
    let state: any = {
      schemaVersion: 1 as const,
      fusionEpochMs: Date.parse('2026-01-01T00:00:00.000Z'),
      daemonInstallationId: 'daemon-test',
      files: {},
    }
    mockLoadState.mockImplementation(() => state)
    mockSaveState.mockImplementation((next) => {
      state = next
    })
    mockListClaudeFiles.mockReturnValue([filePath])
    mockParseClaudeChunk.mockReturnValue({
      nextOffset: fs.statSync(filePath).size,
      events: [],
    })

    await new NativeSessionFusionService(createClient() as never).scanNow()

    expect(mockParseClaudeChunk.mock.calls.map((call) => call[1])).toEqual([0])
    expect(state.files[filePath].offset).toBe(fs.statSync(filePath).size)
  })

  it('publishes dirty session indexes after a backlog drains', async () => {
    const filePath = createTranscriptFile()
    fs.writeFileSync(filePath, Buffer.alloc(3 * 1024 * 1024))
    let state: any = {
      schemaVersion: 1 as const,
      fusionEpochMs: Date.parse('2026-01-01T00:00:00.000Z'),
      daemonInstallationId: 'daemon-test',
      files: {},
    }
    mockLoadState.mockImplementation(() => state)
    mockSaveState.mockImplementation((next) => {
      state = next
    })
    mockListClaudeFiles.mockReturnValue([filePath])
    mockParseClaudeChunk.mockReturnValue({
      nextOffset: fs.statSync(filePath).size,
      events: [],
    })
    mockListPendingIndexUpdates.mockReturnValue([pendingIndexUpdate()])
    const client = createClient()

    await new NativeSessionFusionService(client as never).scanNow()

    expect(client.sendBufferedEvent).toHaveBeenCalledTimes(1)
    expect(mockAcknowledgeIndexUpdate).toHaveBeenCalledTimes(1)
  })

  it('continues scanning other files when one target parser fails', async () => {
    const failedFile = createTranscriptFile()
    const healthyFile = createTranscriptFile()
    fs.writeFileSync(failedFile, '{"type":"broken"}\n')
    fs.writeFileSync(healthyFile, '{"type":"healthy"}\n')
    const nowSeconds = Date.now() / 1_000
    fs.utimesSync(healthyFile, nowSeconds - 60, nowSeconds - 60)
    fs.utimesSync(failedFile, nowSeconds, nowSeconds)
    let state: any = {
      schemaVersion: 1 as const,
      fusionEpochMs: Date.parse('2026-01-01T00:00:00.000Z'),
      daemonInstallationId: 'daemon-test',
      files: {},
    }
    mockLoadState.mockImplementation(() => state)
    mockSaveState.mockImplementation((next) => {
      state = next
    })
    mockListClaudeFiles.mockReturnValue([failedFile, healthyFile])
    mockParseClaudeChunk
      .mockRejectedValueOnce(new Error('malformed native source'))
      .mockResolvedValueOnce({
        nextOffset: fs.statSync(healthyFile).size,
        events: [],
      })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await new NativeSessionFusionService(createClient() as never).scanNow()

    expect(mockParseClaudeChunk).toHaveBeenCalledTimes(2)
    expect(state.files[failedFile]).toBeUndefined()
    expect(state.files[healthyFile].offset).toBe(fs.statSync(healthyFile).size)
    expect(error).toHaveBeenCalledWith(
      '[native-fusion] target file scan failed; isolated for retry',
      expect.any(Error),
    )
  })

  it('commits and checkpoints each file before parsing the next backlog', async () => {
    const firstFile = createTranscriptFile()
    const secondFile = createTranscriptFile()
    fs.writeFileSync(firstFile, '{"type":"first"}\n')
    fs.writeFileSync(secondFile, '{"type":"second"}\n')
    const nowSeconds = Date.now() / 1_000
    fs.utimesSync(firstFile, nowSeconds - 60, nowSeconds - 60)
    fs.utimesSync(secondFile, nowSeconds, nowSeconds)
    let state: any = {
      schemaVersion: 1 as const,
      fusionEpochMs: Date.parse('2026-01-01T00:00:00.000Z'),
      daemonInstallationId: 'daemon-test',
      files: {},
    }
    mockLoadState.mockImplementation(() => state)
    mockSaveState.mockImplementation((next) => {
      state = next
    })
    mockListClaudeFiles.mockReturnValue([firstFile, secondFile])
    const event = (sourceEventKey: string, cursor: string): Record<string, unknown> => ({
      agentType: 'claude',
      sourceMode: 'claude_transcript_import',
      sourceSessionKey: `source-${sourceEventKey}`,
      sourceEventKey,
      cursor,
      role: 'user',
      ts: Date.parse('2026-09-07T06:00:00.000Z'),
      payload: sourceEventKey,
      title: sourceEventKey,
      workDir: '/repo',
    })
    mockParseClaudeChunk.mockImplementation(async (filePath: string) => {
      const isFirst = filePath === firstFile
      return {
        nextOffset: fs.statSync(filePath).size,
        events: [event(isFirst ? 'first-event' : 'second-event', `${filePath}:0`)],
      }
    })

    await new NativeSessionFusionService(createClient() as never).scanNow()

    expect(
      mockCommitEvents.mock.calls.map((call) =>
        (call[0] as Array<{ sourceEventKey: string }>).map((item) => item.sourceEventKey),
      ),
    ).toEqual([['second-event'], ['first-event']])
    expect(mockSaveState).toHaveBeenCalledWith(
      expect.objectContaining({
        files: expect.objectContaining({
          [firstFile]: expect.objectContaining({ offset: fs.statSync(firstFile).size }),
          [secondFile]: expect.objectContaining({ offset: fs.statSync(secondFile).size }),
        }),
      }),
    )
  })

  it('quarantines an identity conflict and still advances the scanner cursor', async () => {
    const filePath = createTranscriptFile()
    fs.writeFileSync(filePath, '{"type":"user"}\n')
    mockKnownNativeFile(filePath)
    mockListClaudeFiles.mockReturnValue([filePath])
    mockParseClaudeChunk.mockReturnValue({
      nextOffset: fs.statSync(filePath).size,
      events: [
        {
          agentType: 'codex',
          sourceMode: 'codex_rollout_import',
          sourceSessionKey: 'thread-conflict',
          sourceEventKey: 'event-conflict',
          role: 'user',
          ts: Date.parse('2026-09-05T12:00:00.000Z'),
          payload: 'new payload for an existing physical event',
        },
      ],
    })
    mockCommitEvents.mockImplementation((events: Array<{ sourceEventKey?: string }>) => {
      if (events[0]?.sourceEventKey === 'event-conflict') {
        throw new NativeEventIdentityConflictError('event-conflict')
      }
      return []
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      new NativeSessionFusionService(createClient() as never).scanNow(),
    ).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(
      '[native-fusion] quarantined conflicting native event event-conflict',
    )
    expect(mockSaveState).toHaveBeenCalledWith(
      expect.objectContaining({
        files: {
          [filePath]: expect.objectContaining({ offset: fs.statSync(filePath).size }),
        },
      }),
    )
  })

  it('uses cursor metadata without reopening unchanged native contents', async () => {
    const filePath = createTranscriptFile()
    fs.writeFileSync(filePath, '{"type":"user"}\n')
    const stat = fs.statSync(filePath)
    mockListClaudeFiles.mockReturnValue([filePath])
    mockLoadState.mockReturnValue({
      schemaVersion: 1,
      fusionEpochMs: Date.parse('2026-01-01T00:00:00.000Z'),
      daemonInstallationId: 'daemon-test',
      files: {
        [filePath]: {
          daemonInstallationId: 'daemon-test',
          offset: stat.size,
          mtimeMs: stat.mtimeMs,
          fileIdentity: `${String(stat.dev)}:${String(stat.ino)}:${String(stat.birthtimeMs)}`,
          classification: 'live',
          awaitingUserBoundary: false,
          sources: [{ agentType: 'claude', sourceSessionKey: 'thread-known' }],
        },
      },
    })

    await new NativeSessionFusionService(createClient() as never).scanNow()

    expect(mockInspectNativeSessionFile).not.toHaveBeenCalled()
    expect(mockParseClaudeChunk).not.toHaveBeenCalled()
    expect(mockCommitEvents).toHaveBeenCalledWith([])
  })

  it('keeps a legacy cursor when the volume device number changes across reboot', async () => {
    const filePath = createTranscriptFile()
    fs.writeFileSync(filePath, '{"type":"user"}\n')
    const stat = fs.statSync(filePath)
    mockListClaudeFiles.mockReturnValue([filePath])
    mockLoadState.mockReturnValue({
      schemaVersion: 1,
      fusionEpochMs: Date.parse('2026-01-01T00:00:00.000Z'),
      daemonInstallationId: 'daemon-test',
      files: {
        [filePath]: {
          daemonInstallationId: 'daemon-test',
          offset: stat.size,
          mtimeMs: stat.mtimeMs,
          fileIdentity: `${String(stat.dev + 4)}:${String(stat.ino)}:${String(stat.birthtimeMs)}`,
          classification: 'live',
          awaitingUserBoundary: false,
          sources: [{ agentType: 'claude', sourceSessionKey: 'thread-known' }],
        },
      },
    })

    await new NativeSessionFusionService(createClient() as never).scanNow()

    expect(mockInspectNativeSessionFile).not.toHaveBeenCalled()
    expect(mockParseClaudeChunk).not.toHaveBeenCalled()
    expect(mockCommitEvents).toHaveBeenCalledWith([])
  })

  it('keeps the original claim timestamp across policy updates and removes failed sends', () => {
    const now = Date.parse('2026-09-02T00:00:00.000Z')
    vi.setSystemTime(now)
    const service = new NativeSessionFusionService(createClient() as never)

    service.registerManagedSend({
      sessionId: 'session-policy-update',
      agentType: 'codex',
      canonicalMessageId: 'message-policy-update',
      sourceSessionKey: 'thread-policy-update',
      text: 'continue',
    })
    vi.setSystemTime(now + 180_000)
    service.registerManagedSend({
      sessionId: 'session-policy-update',
      agentType: 'codex',
      canonicalMessageId: 'message-policy-update',
      sourceSessionKey: 'thread-policy-update',
      text: 'continue',
      managedEchoPolicy: 'import_following',
      externalRunId: 'external-policy-update',
    })

    expect(managedClaims.get('message-policy-update')).toMatchObject({
      createdAt: now,
      managedEchoPolicy: 'import_following',
      externalRunId: 'external-policy-update',
    })

    service.cancelManagedSend('message-policy-update')
    expect(managedClaims.has('message-policy-update')).toBe(false)
  })

  it('ACKs a lightweight index only after the relay confirms persistence', async () => {
    const client = createClient()
    mockListPendingIndexUpdates.mockReturnValue([pendingIndexUpdate()])
    const service = new NativeSessionFusionService(client as never)

    await service.scanNow()

    expect(client.sendBufferedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'session.index.updated',
        id: 'session-index-daemon-test-session-local-1-2',
      }),
      60_000,
    )
    expect(mockAcknowledgeIndexUpdate).toHaveBeenCalledWith('session-local-1', 2)
    expect(JSON.stringify(client.sendBufferedEvent.mock.calls)).not.toContain(
      'native.session.events',
    )
  })

  it('retains a dirty index for the next scan when relay ACK fails', async () => {
    const client = createClient()
    client.sendBufferedEvent.mockRejectedValueOnce(new Error('offline'))
    mockListPendingIndexUpdates.mockReturnValue([pendingIndexUpdate(3)])
    const service = new NativeSessionFusionService(client as never)

    await service.scanNow()
    expect(mockAcknowledgeIndexUpdate).not.toHaveBeenCalled()

    await service.scanNow()
    expect(client.sendBufferedEvent).toHaveBeenCalledTimes(2)
    expect(mockAcknowledgeIndexUpdate).toHaveBeenCalledWith('session-local-1', 3)
  })

  it('projects queued, running, and terminal activity for a Codex Desktop-owned turn', async () => {
    const now = Date.parse('2026-08-31T02:00:00.000Z')
    vi.setSystemTime(now)
    const client = createClient()
    const service = new NativeSessionFusionService(client as never)
    const filePath = createTranscriptFile()
    mockKnownNativeFile(filePath)
    mockListClaudeFiles.mockReturnValue([filePath])

    service.registerManagedSend({
      sessionId: 'sess-1',
      agentType: 'codex',
      canonicalMessageId: 'user-1',
      sourceSessionKey: 'thread-1',
      text: 'continue this task',
      managedEchoPolicy: 'import_following',
      externalRunId: 'codex-external-submit-1',
    })

    await vi.waitFor(() => expect(mockSaveState).toHaveBeenCalled())

    expect(client.sendAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          state: 'start',
          lifecycle: 'queued',
          canStop: false,
        }),
      }),
    )

    mockParseClaudeChunk.mockReturnValue({
      nextOffset: 300,
      events: [
        {
          agentType: 'codex',
          sourceMode: 'codex_rollout_import',
          sourceSessionKey: 'thread-1',
          sourceEventKey: 'evt-user',
          role: 'user',
          ts: now,
          payload: 'continue this task',
        },
        {
          agentType: 'codex',
          sourceMode: 'codex_rollout_import',
          sourceSessionKey: 'thread-1',
          sourceEventKey: 'evt-agent',
          role: 'agent',
          ts: now + 1_000,
          payload: 'done',
          terminal: true,
        },
      ],
    })

    await service.scanNow()

    expect(client.sendAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ state: 'heartbeat', lifecycle: 'running' }),
      }),
    )
    expect(client.sendAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ state: 'final' }) }),
    )
    expect(mockUpdateMessageDeliveryState.mock.calls).toEqual([
      ['sess-1', 'user-1', 'executing'],
      ['sess-1', 'user-1', 'completed'],
    ])
    service.stop()
  })

  it('restores a running external observation after daemon restart and closes on native terminal', async () => {
    const now = Date.parse('2026-09-09T06:29:00.000Z')
    vi.setSystemTime(now)
    const client = createClient()
    const service = new NativeSessionFusionService(client as never)
    const onExternalTerminal = vi.fn()
    const onExternalClaim = vi.fn()
    service.setExternalTerminalHandler(onExternalTerminal)
    service.setExternalClaimHandler(onExternalClaim)
    const filePath = createTranscriptFile()
    mockKnownNativeFile(filePath)
    mockListClaudeFiles.mockReturnValue([filePath])
    mockParseClaudeChunk.mockReturnValue({
      nextOffset: 300,
      events: [
        {
          agentType: 'codex',
          sourceMode: 'codex_rollout_import',
          sourceSessionKey: 'thread-restored',
          sourceEventKey: 'evt-agent-restored-terminal',
          role: 'agent',
          ts: now + 1_000,
          payload: 'done before Shennian reconnected',
          terminal: true,
        },
      ],
    })

    expect(
      service.restoreExternalObservation({
        sessionId: 'sess-restored',
        sourceSessionKey: 'thread-restored',
        runId: 'codex-external-restored',
        canonicalMessageId: 'user-restored',
        createdAt: now - 10_000,
      }),
    ).toBe(true)
    expect(service.getActiveRuns()).toEqual([{ sessionId: 'sess-restored', runId: 'codex-external-restored' }])
    expect(onExternalClaim).toHaveBeenCalledWith('sess-restored', 'user-restored')
    await service.scanNow()

    expect(client.sendAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ state: 'final' }) }),
    )
    expect(onExternalTerminal).toHaveBeenCalledWith('sess-restored', 'final')
    expect(service.getActiveRuns()).toEqual([])
    service.stop()
  })

  it('clears an external Codex observation with aborted instead of renewing its heartbeat', async () => {
    const now = Date.parse('2026-09-03T08:10:00.000Z')
    vi.setSystemTime(now)
    const client = createClient()
    const service = new NativeSessionFusionService(client as never)
    const onExternalTerminal = vi.fn()
    service.setExternalTerminalHandler(onExternalTerminal)
    const filePath = createTranscriptFile()
    mockKnownNativeFile(filePath)
    mockListClaudeFiles.mockReturnValue([filePath])

    mockParseClaudeChunk.mockReturnValue({
      nextOffset: 300,
      events: [
        {
          agentType: 'codex',
          sourceMode: 'codex_rollout_import',
          sourceSessionKey: 'thread-aborted',
          sourceEventKey: 'evt-user-aborted',
          role: 'user',
          ts: now,
          payload: 'continue this task',
        },
        {
          agentType: 'codex',
          sourceMode: 'codex_rollout_import',
          sourceSessionKey: 'thread-aborted',
          sourceEventKey: 'evt-agent-aborted',
          role: 'agent',
          ts: now + 1_000,
          payload: 'partial reply before stop',
          terminal: true,
          terminalState: 'aborted',
        },
      ],
    })

    service.registerManagedSend({
      sessionId: 'sess-aborted',
      agentType: 'codex',
      canonicalMessageId: 'user-aborted',
      sourceSessionKey: 'thread-aborted',
      text: 'continue this task',
      managedEchoPolicy: 'import_following',
      externalRunId: 'codex-external-aborted',
    })

    await service.scanNow()

    expect(client.sendAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ state: 'aborted' }) }),
    )
    expect(mockUpdateMessageDeliveryState.mock.calls).toEqual([
      ['sess-aborted', 'user-aborted', 'executing'],
      ['sess-aborted', 'user-aborted', 'cancelled'],
    ])
    expect(onExternalTerminal).toHaveBeenCalledWith('sess-aborted', 'aborted')
    const internals = service as unknown as {
      externalObservations: Map<string, unknown[]>
    }
    expect(internals.externalObservations.has('codex:thread-aborted')).toBe(false)
    service.stop()
  })

  it('continues Windows Codex rollout paths from the stored cursor', async () => {
    await withPlatform('win32', async () => {
      const client = createClient()
      const service = new NativeSessionFusionService(client as never)
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-fusion-codex-'))
      const windowsFilePath = path.join(
        dir,
        'C:\\Users\\lichen\\.codex\\sessions\\2026\\04\\30\\rollout.jsonl',
      )
      fs.writeFileSync(windowsFilePath, Buffer.alloc(1_000))
      mockLoadState.mockReturnValue({
        schemaVersion: 1,
        fusionEpochMs: Date.parse('2026-01-01T00:00:00.000Z'),
        daemonInstallationId: 'daemon-test',
        files: {
          [windowsFilePath]: {
            offset: 500,
            mtimeMs: 1,
            classification: 'live',
            awaitingUserBoundary: false,
          },
        },
      })
      mockListCodexFiles.mockReturnValue([windowsFilePath])
      mockParseCodexChunk.mockReturnValue({ nextOffset: 1000, events: [] })

      await service.scanNow()

      expect(mockParseCodexChunk).toHaveBeenCalledWith(windowsFilePath, 500)
      expect(mockParseClaudeChunk).not.toHaveBeenCalled()
      expect(mockSaveState).toHaveBeenCalledWith(
        expect.objectContaining({
          files: { [windowsFilePath]: expect.objectContaining({ offset: 1000 }) },
        }),
      )
    })
  })

  it('runs an initial scan as soon as the relay connects', async () => {
    const client = createClient()
    const service = new NativeSessionFusionService(client as never)

    service.handleConnected()
    await vi.waitFor(() => {
      expect(mockSaveState).toHaveBeenCalledWith(expect.objectContaining({ files: {} }))
    })
    service.stop()
  })

  it('baselines newly discovered native files without importing existing history', async () => {
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
        timestamp: '2026-06-04T09:00:00.000Z',
        message: { content: 'old native history' },
      })}\n`,
    )
    mockInspectNativeSessionFile.mockReturnValue({
      status: 'ready',
      createdAtMs: Date.parse('2026-06-04T09:00:00.000Z'),
      sources: [],
    })
    mockListClaudeFiles.mockReturnValue([filePath])
    mockParseClaudeChunk.mockReturnValue({ nextOffset: fs.statSync(filePath).size, events: [] })

    await service.scanNow()

    expect(mockParseClaudeChunk).toHaveBeenCalledWith(filePath, 0)
    expect(client.sendBufferedEvent).not.toHaveBeenCalled()
    expect(mockSaveState).toHaveBeenCalledWith(
      expect.objectContaining({
        files: {
          [filePath]: expect.objectContaining({
            offset: fs.statSync(filePath).size,
            classification: 'historical',
            awaitingUserBoundary: true,
          }),
        },
      }),
    )
  })
})

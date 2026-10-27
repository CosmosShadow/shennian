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

  it('imports the assistant reply after an external Codex owner accepts the managed message', async () => {
    const now = Date.parse('2026-08-28T03:22:41.722Z')
    vi.setSystemTime(now)
    const client = createClient()
    const service = new NativeSessionFusionService(client as never)
    const externalClaimHandler = vi.fn()
    service.setExternalClaimHandler(externalClaimHandler)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-fusion-codex-owner-'))
    const filePath = path.join(dir, '.codex', 'sessions', 'rollout.jsonl')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, '')
    mockKnownNativeFile(filePath)
    mockListCodexFiles.mockReturnValue([filePath])

    service.registerManagedSend({
      sessionId: 'sess-external-owner',
      agentType: 'codex',
      canonicalMessageId: 'msg-user-external-owner',
      sourceSessionKey: 'codex-external-owner',
      text: 'hello',
      managedEchoPolicy: 'import_following',
      externalRunId: 'external-run-1',
    })

    mockParseCodexChunk.mockReturnValue({
      nextOffset: 300,
      events: [
        {
          agentType: 'codex',
          sourceMode: 'codex_rollout_import',
          sourceSessionKey: 'codex-external-owner',
          sourceEventKey: 'evt-user-external-owner',
          cursor: `${filePath}:1`,
          role: 'user',
          ts: now,
          payload: 'hello',
          title: 'external owner',
          workDir: '/tmp',
        },
        {
          agentType: 'codex',
          sourceMode: 'codex_rollout_import',
          sourceSessionKey: 'codex-external-owner',
          sourceEventKey: 'evt-agent-external-owner',
          cursor: `${filePath}:2`,
          role: 'agent',
          ts: now + 3_000,
          payload: 'Hello from the active Codex owner',
          title: 'external owner',
          workDir: '/tmp',
          terminal: true,
        },
      ],
    })

    await service.scanNow()

    expect(externalClaimHandler).toHaveBeenCalledWith(
      'sess-external-owner',
      'msg-user-external-owner',
    )

    expect(mockCommitEvents.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({
        sourceMode: 'managed_echo_claim',
        role: 'user',
        claimCanonicalMessageId: 'msg-user-external-owner',
        managedEchoPolicy: 'import_following',
      }),
      expect.objectContaining({
        sourceMode: 'codex_rollout_import',
        role: 'agent',
        payload: 'Hello from the active Codex owner',
        terminal: true,
      }),
    ])
  })

  it('keeps a managed echo claim alive until the next periodic scan', async () => {
    const now = Date.parse('2026-04-23T13:09:17.785Z')
    vi.setSystemTime(now + 60_000)
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
      ],
    })

    await service.scanNow()

    const sent = mockCommitEvents.mock.calls.at(-1)?.[0] as unknown[]
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      sourceMode: 'managed_echo_claim',
      role: 'user',
      claimCanonicalMessageId: 'msg-user-1',
    })
  })

  it('isolates a failed file commit and recovers its durable claim after restart', async () => {
    const now = Date.parse('2026-04-23T13:09:17.785Z')
    vi.setSystemTime(now)
    const client = createClient()
    const filePath = createTranscriptFile()
    mockKnownNativeFile(filePath)
    mockListClaudeFiles.mockReturnValue([filePath])
    mockParseClaudeChunk.mockReturnValue({
      nextOffset: 200,
      events: [
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'claude-native-restart',
          sourceEventKey: 'evt-user-restart',
          cursor: `${filePath}:1`,
          role: 'user',
          ts: now,
          payload: 'survive restart',
          title: 'restart',
          workDir: '/repo',
        },
      ],
    })

    const first = new NativeSessionFusionService(client as never)
    first.registerManagedSend({
      sessionId: 'sess-restart',
      agentType: 'claude',
      canonicalMessageId: 'msg-restart',
      sourceSessionKey: 'claude-native-restart',
      text: 'survive restart',
    })
    mockCommitEvents.mockImplementationOnce(() => {
      throw new Error('simulated canonical commit interruption')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(first.scanNow()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(
      '[native-fusion] target file commit failed; isolated for retry',
      expect.any(Error),
    )
    expect(managedClaims.has('msg-restart')).toBe(true)

    const restarted = new NativeSessionFusionService(client as never)
    await restarted.scanNow()

    expect(mockCommitEvents.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({
        sourceMode: 'managed_echo_claim',
        claimCanonicalMessageId: 'msg-restart',
        claimSessionId: 'sess-restart',
      }),
    ])
    expect(managedClaims.has('msg-restart')).toBe(false)
    expect(managedSuppressions.has('claude:claude-native-restart')).toBe(true)

    mockParseClaudeChunk.mockReturnValue({
      nextOffset: 300,
      events: [
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'claude-native-restart',
          sourceEventKey: 'evt-user-restart',
          cursor: `${filePath}:1`,
          role: 'user',
          ts: now,
          payload: 'survive restart',
        },
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'claude-native-restart',
          sourceEventKey: 'evt-agent-after-restart',
          cursor: `${filePath}:2`,
          role: 'agent',
          ts: now + 1_000,
          payload: 'managed output after restart',
        },
      ],
    })

    const afterCursorRollback = new NativeSessionFusionService(client as never)
    await afterCursorRollback.scanNow()

    const replayed = mockCommitEvents.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>
    expect(replayed[0]).toMatchObject({ sourceEventKey: 'evt-user-restart' })
    expect(replayed[1]).toMatchObject({
      sourceEventKey: 'evt-agent-after-restart',
      localDisposition: 'managed_echo_suppressed',
      claimSessionId: 'sess-restart',
    })
    expect(managedSuppressions.has('claude:claude-native-restart')).toBe(true)
  })

  it('keeps suppressing managed agent output after the old short window', async () => {
    const now = Date.parse('2026-04-23T13:09:17.785Z')
    vi.setSystemTime(now + 60_000)
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
          sourceEventKey: 'evt-assistant-late',
          cursor: `${filePath}:2`,
          role: 'agent',
          ts: now + 70_000,
          payload: 'managed output',
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
      sourceEventKey: 'evt-assistant-late',
      localDisposition: 'managed_echo_suppressed',
    })
  })

  it('stops managed suppression when an unclaimed native user message appears', async () => {
    const now = Date.parse('2026-04-23T13:09:17.785Z')
    vi.setSystemTime(now + 60_000)
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
      nextOffset: 300,
      events: [
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'claude-native-1',
          sourceEventKey: 'evt-user-managed',
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
          sourceEventKey: 'evt-assistant-managed',
          cursor: `${filePath}:2`,
          role: 'agent',
          ts: now + 2_000,
          payload: 'managed output',
          title: 'hello',
          modelId: 'claude-sonnet-4-6',
          workDir: 'Users/lichen/Documents/code/projects/shennian',
        },
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'claude-native-1',
          sourceEventKey: 'evt-user-native',
          cursor: `${filePath}:3`,
          role: 'user',
          ts: now + 80_000,
          payload: 'terminal follow up',
          title: 'hello',
          workDir: 'Users/lichen/Documents/code/projects/shennian',
        },
        {
          agentType: 'claude',
          sourceMode: 'claude_transcript_import',
          sourceSessionKey: 'claude-native-1',
          sourceEventKey: 'evt-assistant-native',
          cursor: `${filePath}:4`,
          role: 'agent',
          ts: now + 85_000,
          payload: 'native output',
          title: 'hello',
          modelId: 'claude-sonnet-4-6',
          workDir: 'Users/lichen/Documents/code/projects/shennian',
        },
      ],
    })

    await service.scanNow()

    const sent = mockCommitEvents.mock.calls.at(-1)?.[0] as unknown[]
    expect(sent).toHaveLength(4)
    expect(sent[0]).toMatchObject({ sourceMode: 'managed_echo_claim', role: 'user' })
    expect(sent[1]).toMatchObject({
      sourceEventKey: 'evt-assistant-managed',
      localDisposition: 'managed_echo_suppressed',
    })
    expect(sent[2]).toMatchObject({
      sourceMode: 'claude_transcript_import',
      role: 'user',
      payload: 'terminal follow up',
    })
    expect(sent[3]).toMatchObject({
      sourceMode: 'claude_transcript_import',
      role: 'agent',
      payload: 'native output',
    })
  })
})

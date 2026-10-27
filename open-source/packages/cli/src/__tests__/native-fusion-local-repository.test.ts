// @arch open-source/docs/cli-runtime.md
// @covers src/native-fusion/local-repository.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MissingUserBoundaryError,
  NativeFusionLocalRepository,
} from '../native-fusion/local-repository.js'
import type { ParsedNativeEvent } from '../native-fusion/types.js'
import { CanonicalSessionStore } from '../session/canonical-store.js'
import { isNativeTestWorkspace, nativeTestWorkspaceRoot } from '../native-fusion/test-workspace.js'

let tempDir: string
let canonical: CanonicalSessionStore
type RepositoryOptions = NonNullable<ConstructorParameters<typeof NativeFusionLocalRepository>[0]>
let recordLocalSession: NonNullable<RepositoryOptions['recordLocalSession']>
let writeLocalToolDetail: NonNullable<RepositoryOptions['writeLocalToolDetail']>
let readLocalToolDetail: NonNullable<RepositoryOptions['readLocalToolDetail']>
let repository: NativeFusionLocalRepository

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-local-repository-'))
  canonical = new CanonicalSessionStore(path.join(tempDir, 'canonical'), 'daemon-installation-test')
  recordLocalSession = vi.fn<NonNullable<RepositoryOptions['recordLocalSession']>>()
  writeLocalToolDetail = vi.fn<NonNullable<RepositoryOptions['writeLocalToolDetail']>>()
  readLocalToolDetail = vi.fn<NonNullable<RepositoryOptions['readLocalToolDetail']>>(() => null)
  repository = new NativeFusionLocalRepository({
    rootDir: path.join(tempDir, 'native-fusion'),
    daemonInstallationId: 'daemon-installation-test',
    canonicalStore: canonical,
    recordLocalSession,
    writeLocalToolDetail,
    readLocalToolDetail,
  })
})

afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }))

function event(overrides: Partial<ParsedNativeEvent> = {}): ParsedNativeEvent {
  return {
    agentType: 'codex',
    sourceMode: 'codex_rollout_import',
    sourceSessionKey: 'thread-1',
    sourceEventKey: 'event-user-1',
    cursor: '/rollout.jsonl:100',
    role: 'user',
    ts: 1_000,
    payload: 'hello',
    title: 'Native title',
    workDir: '/repo',
    ...overrides,
  }
}

describe('NativeFusionLocalRepository', () => {
  it('does not import probe sessions from the reserved test workspace', () => {
    const workDir = path.join(nativeTestWorkspaceRoot(), 'codex-run', 'visitor-a')
    expect(isNativeTestWorkspace(workDir)).toBe(true)
    expect(isNativeTestWorkspace(`${nativeTestWorkspaceRoot()}-real-project`)).toBe(false)
    expect(isNativeTestWorkspace(path.join(os.homedir(), 'Documents', 'shennian'))).toBe(false)
    expect(repository.commitEvents([event({ workDir })])).toEqual([])
    expect(recordLocalSession).not.toHaveBeenCalled()
    expect(repository.listSourceBindings()).toEqual([])
    expect(canonical.listSessionIds()).toEqual([])
    expect(() => repository.commitEvent(event({ workDir }))).toThrow('internal native source')
  })

  it('rejects a new source that starts with an agent event', () => {
    expect(() => repository.commitEvent(event({ role: 'agent' })))
      .toThrow(MissingUserBoundaryError)
    expect(repository.listSourceBindings()).toEqual([])
    expect(canonical.listSessionIds()).toEqual([])
  })

  it('commits source events locally and replays them idempotently', () => {
    const first = repository.commitEvent(event())
    const second = repository.commitEvent(event({
      sourceEventKey: 'event-agent-1',
      cursor: '/rollout.jsonl:200',
      role: 'agent',
      ts: 2_000,
      payload: 'world',
      terminal: true,
    }))
    const replay = repository.commitEvent(event())

    expect(first.sessionId).toBe(second.sessionId)
    expect(first.messageId).toMatch(/^native-/)
    expect(second).toMatchObject({ bodyRevision: 2, duplicate: false })
    expect(replay).toMatchObject({
      sessionId: first.sessionId,
      messageId: first.messageId,
      bodyRevision: 2,
      duplicate: true,
    })
    expect(canonical.readRecent(first.sessionId, 10).messages.map((message) => message.payload))
      .toEqual(['hello', 'world'])
    expect(repository.listSourceBindings()[0]).toMatchObject({
      daemonInstallationId: 'daemon-installation-test',
      lastCursor: '/rollout.jsonl:200',
      bodyRevision: 2,
    })
    expect(recordLocalSession).toHaveBeenCalledTimes(2)
    expect(recordLocalSession).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sessionId: first.sessionId,
      localReady: true,
      firstUserMessageId: first.messageId,
      firstUserBodyRevision: 1,
      lastMessagePreview: 'hello',
      lastMessagePreviewMessageId: first.messageId,
      lastMessagePreviewAt: new Date(1_000).toISOString(),
    }))
    expect(recordLocalSession).toHaveBeenNthCalledWith(2, expect.not.objectContaining({
      firstUserMessageId: expect.anything(),
    }))
    expect(recordLocalSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
      lastMessagePreview: 'world',
      lastMessagePreviewMessageId: second.messageId,
      lastMessagePreviewAt: new Date(2_000).toISOString(),
    }))
  })

  it('keeps the session project stable when later native events report another cwd', () => {
    let indexed = null as Record<string, unknown> | null
    const stableRepository = new NativeFusionLocalRepository({
      rootDir: path.join(tempDir, 'native-fusion-stable-workdir'),
      daemonInstallationId: 'daemon-installation-test',
      canonicalStore: canonical,
      recordLocalSession: (input) => { indexed = { ...(indexed ?? {}), ...input } },
      listLocalSessions: () => indexed ? [indexed as never] : [],
    })

    stableRepository.commitEvent(event({ workDir: '/省电' }))
    stableRepository.commitEvent(event({
      sourceEventKey: 'event-agent-other-cwd',
      cursor: '/rollout.jsonl:200',
      role: 'agent',
      ts: 2_000,
      payload: 'visited another directory',
      workDir: '/Users/example/Documents/code/projects/shennian/packages',
      terminal: true,
    }))

    expect(indexed?.workDir).toBe('/省电')
  })

  it('projects a replayed terminal without duplicating the final message', () => {
    const sessionId = 'managed-split-terminal'
    const strandedMessage = {
      id: 'mobile-user-stranded', sessionId, role: 'user' as const, ts: 500, payload: 'old',
    }
    const userMessage = {
      id: 'mobile-user-1', sessionId, role: 'user' as const, ts: 1_000, payload: 'hello',
    }
    canonical.append(sessionId, strandedMessage, 'executing')
    canonical.append(sessionId, userMessage, 'executing')
    repository.commitEvent(event({
      sourceMode: 'managed_echo_claim',
      claimCanonicalMessageId: userMessage.id,
      claimSessionId: sessionId,
    }))
    const finalEvent = event({
      sourceEventKey: 'event-split-final', cursor: '/rollout.jsonl:200',
      role: 'agent', ts: 2_000, payload: 'done',
    })
    const initial = repository.commitEvent(finalEvent)
    const terminal = repository.commitEvent({ ...finalEvent, terminal: true })

    expect(initial).toMatchObject({ bodyRevision: 3, duplicate: false })
    expect(terminal).toMatchObject({ bodyRevision: 5, duplicate: true })
    expect(canonical.readRecent(sessionId, 10).messages.map((message) => message.payload))
      .toEqual(['old', 'hello', 'done'])
    expect(canonical.getMessageState(sessionId, userMessage.id)).toMatchObject({
      lastRevision: 4,
      deliveryState: 'completed',
    })
    expect(canonical.getMessageState(sessionId, strandedMessage.id)).toMatchObject({
      lastRevision: 5,
      deliveryState: 'completed',
    })
    expect(recordLocalSession).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId,
      status: 'completed',
      lastMessagePreview: 'done',
    }))
  })

  it('projects an aborted native turn as failed instead of active', () => {
    const first = repository.commitEvent(event())
    repository.commitEvent(event({
      sourceEventKey: 'event-agent-aborted',
      cursor: '/rollout.jsonl:200',
      role: 'agent',
      ts: 2_000,
      payload: 'partial reply before stop',
      terminal: true,
      terminalState: 'aborted',
    }))

    expect(recordLocalSession).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: first.sessionId,
      status: 'failed',
    }))
  })

  it('advances visible activity without clearing the frozen preview for a tool event', () => {
    repository.commitEvent(event())
    vi.mocked(recordLocalSession).mockClear()

    repository.commitEvent(event({
      sourceEventKey: 'event-internal-agent-context',
      cursor: '/rollout.jsonl:200',
      role: 'agent',
      ts: 2_000,
      payload: JSON.stringify({
        v: 1,
        type: 'tool',
        name: 'exec',
        toolCallId: 'tool-1',
        detailRevision: 1,
        status: 'completed',
      }),
    }))

    const indexInput = vi.mocked(recordLocalSession).mock.calls[0]?.[0]
    expect(indexInput).not.toHaveProperty('lastMessagePreview')
    expect(indexInput).not.toHaveProperty('lastMessagePreviewMessageId')
    expect(indexInput).not.toHaveProperty('lastMessagePreviewAt')
    expect(indexInput).toMatchObject({ lastVisibleEventAt: '1970-01-01T00:00:02.000Z' })
  })

  it('repairs a canonical user boundary that was committed before its index record', () => {
    const committed = repository.commitEvent(event())
    vi.mocked(recordLocalSession).mockClear()
    const repairRepository = new NativeFusionLocalRepository({
      rootDir: path.join(tempDir, 'native-fusion'),
      daemonInstallationId: 'daemon-installation-test',
      canonicalStore: canonical,
      recordLocalSession,
      listLocalSessions: vi.fn(() => [{
        sessionId: committed.sessionId,
        agentType: 'codex',
        workDir: '/repo',
        agentSessionId: 'thread-1',
        localReady: false,
        firstUserMessageId: null,
        firstUserBodyRevision: null,
        lastActivityAt: new Date(1_000).toISOString(),
      }] as never),
    })

    expect(repairRepository.repairMissingUserBoundaries()).toBe(1)
    expect(recordLocalSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: committed.sessionId,
      localReady: true,
      firstUserMessageId: committed.messageId,
      firstUserBodyRevision: 1,
    }))
  })

  it('treats observed Codex name changes as native and ignores manual-title echoes', () => {
    const committed = repository.commitEvent(event())
    vi.mocked(recordLocalSession).mockClear()
    const manualRepository = new NativeFusionLocalRepository({
      rootDir: path.join(tempDir, 'native-fusion'),
      daemonInstallationId: 'daemon-installation-test',
      canonicalStore: canonical,
      recordLocalSession,
      listLocalSessions: vi.fn(() => [{
        sessionId: committed.sessionId,
        title: '用户手工标题',
        titleSource: 'shennian_manual',
        titleLockedByUser: true,
        workDir: '/repo',
      }] as never),
    })
    expect(manualRepository.observeNativeTitle('codex', 'thread-1', '用户手工标题')).toBe(false)
    expect(recordLocalSession).not.toHaveBeenCalled()

    const generatedRepository = new NativeFusionLocalRepository({
      rootDir: path.join(tempDir, 'native-fusion'),
      daemonInstallationId: 'daemon-installation-test',
      canonicalStore: canonical,
      recordLocalSession,
      listLocalSessions: vi.fn(() => [{
        sessionId: committed.sessionId,
        title: '临时标题',
        titleSource: 'shennian_generated',
        titleLockedByUser: false,
        workDir: '/repo',
      }] as never),
    })
    expect(generatedRepository.observeNativeTitle('codex', 'thread-1', 'Codex 新名称')).toBe(true)
    expect(recordLocalSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: committed.sessionId,
      title: 'Codex 新名称',
      titleSource: 'agent_native',
      titleOriginEventId: expect.stringMatching(/^agent-native:/),
    }))
  })

  it('persists managed echo claims and suppression windows without duplicating message text', () => {
    repository.upsertManagedClaim({
      sessionId: 'managed-session-1',
      agentType: 'claude',
      sourceAgentType: 'claude',
      canonicalMessageId: 'managed-user-1',
      textHash: '8'.repeat(64),
      createdAt: 1_000,
      sourceSessionKey: null,
      managedEchoPolicy: 'suppress_following',
      externalRunId: null,
    })
    repository.updateManagedClaimSource('managed-session-1', 'claude', 'claude-native-1')

    const restarted = new NativeFusionLocalRepository({
      rootDir: path.join(tempDir, 'native-fusion'),
      daemonInstallationId: 'daemon-installation-test',
      canonicalStore: canonical,
      recordLocalSession,
    })
    expect(restarted.listManagedClaims()).toEqual([
      expect.objectContaining({
        canonicalMessageId: 'managed-user-1',
        sourceSessionKey: 'claude-native-1',
        textHash: '8'.repeat(64),
      }),
    ])
    expect(fs.readFileSync(path.join(tempDir, 'native-fusion', 'managed-echo-state.json'), 'utf8'))
      .not.toContain('managed message text')

    restarted.removeManagedClaim('managed-user-1')
    expect(restarted.listManagedClaims()).toEqual([])
    restarted.upsertManagedClaim({
      sessionId: 'managed-session-1',
      agentType: 'claude',
      sourceAgentType: 'claude',
      canonicalMessageId: 'managed-user-1',
      textHash: '8'.repeat(64),
      createdAt: 1_000,
      sourceSessionKey: 'claude-native-1',
      managedEchoPolicy: 'suppress_following',
      externalRunId: null,
    })

    restarted.completeManagedClaim('managed-user-1', {
      sessionId: 'managed-session-1',
      agentType: 'claude',
      sourceSessionKey: 'claude-native-1',
      claimSourceEventKey: 'managed-source-user-1',
      startedAt: 1_000,
      endsAt: 2_000,
    })
    expect(restarted.listManagedClaims()).toEqual([])
    expect(restarted.listManagedSuppressions()).toEqual([
      expect.objectContaining({ sessionId: 'managed-session-1', sourceSessionKey: 'claude-native-1' }),
    ])

    restarted.removeManagedSuppression('claude', 'claude-native-1')
    expect(restarted.listManagedSuppressions()).toEqual([])
  })

  it('ledgers suppressed managed output without adding it to canonical history', () => {
    const user = repository.commitEvent(event())
    const suppressed = repository.commitEvent(event({
      sourceEventKey: 'event-managed-assistant',
      cursor: '/rollout.jsonl:200',
      role: 'agent',
      ts: 2_000,
      payload: 'managed assistant echo',
      claimSessionId: user.sessionId,
      localDisposition: 'managed_echo_suppressed',
    }))
    const replay = repository.commitEvent(event({
      sourceEventKey: 'event-managed-assistant',
      cursor: '/rollout.jsonl:200',
      role: 'agent',
      ts: 2_000,
      payload: 'managed assistant echo',
    }))

    expect(suppressed).toMatchObject({
      sessionId: user.sessionId,
      messageId: null,
      bodyRevision: 1,
      suppressed: true,
      duplicate: false,
    })
    expect(replay).toMatchObject({
      sessionId: user.sessionId,
      messageId: null,
      bodyRevision: 1,
      suppressed: true,
      duplicate: true,
    })
    expect(canonical.readRecent(user.sessionId, 10).messages.map((message) => message.payload))
      .toEqual(['hello'])
    expect(repository.listSourceBindings()[0]).toMatchObject({
      lastCursor: '/rollout.jsonl:200',
      bodyRevision: 1,
    })
  })

  it('persists imported raw tool data only in the local detail store', () => {
    const first = repository.commitEvent(event())
    const tool = repository.commitEvent(event({
      sourceEventKey: 'event-tool-1',
      cursor: '/rollout.jsonl:200',
      role: 'agent',
      ts: 2_000,
      payload: JSON.stringify({
        v: 1,
        type: 'tool',
        name: 'shell_command',
        toolCallId: 'native:tool-1',
        detailRevision: 1,
        status: 'completed',
        detailAvailable: true,
        resultOmitted: true,
      }),
      localToolDetail: {
        toolCallId: 'native:tool-1',
        detailRevision: 1,
        name: 'shell_command',
        args: { command: 'private command' },
        result: 'private result',
        status: 'completed',
      },
    }))

    const canonicalTool = canonical.readRecent(first.sessionId, 10).messages[1]
    expect(canonicalTool?.id).toBe(tool.messageId)
    expect(canonicalTool?.payload).not.toContain('private command')
    expect(canonicalTool?.payload).not.toContain('private result')
    expect(writeLocalToolDetail).toHaveBeenCalledOnce()
    expect(writeLocalToolDetail).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: first.sessionId,
      toolCallId: 'native:tool-1',
      args: { command: 'private command' },
      result: 'private result',
      detailRef: { toolIndex: 0 },
    }))

    repository.commitEvent(event({
      sourceEventKey: 'event-tool-1',
      cursor: '/rollout.jsonl:200',
      role: 'agent',
      ts: 2_000,
      payload: canonicalTool!.payload,
      localToolDetail: {
        toolCallId: 'native:tool-1',
        detailRevision: 1,
        name: 'shell_command',
        args: { command: 'private command' },
        result: 'private result',
        status: 'completed',
      },
    }))
    expect(writeLocalToolDetail).toHaveBeenCalledOnce()
  })

  it('upserts a completed native tool call into one canonical message', () => {
    const user = repository.commitEvent(event())
    const toolCallId = 'native:tool:logical-1'
    const running = repository.commitEvent(event({
      sourceEventKey: 'event-tool-call',
      canonicalMessageKey: 'tool:logical-1',
      canonicalMutation: 'append',
      cursor: '/rollout.jsonl:200',
      role: 'agent',
      ts: 2_000,
      payload: JSON.stringify({
        v: 1, type: 'tool', name: 'exec', toolCallId, detailRevision: 1,
        status: 'running', detailAvailable: true, resultOmitted: true,
      }),
      localToolDetail: {
        toolCallId, detailRevision: 1, name: 'exec',
        args: { input: 'private command' }, status: 'running',
      },
    }))
    vi.mocked(readLocalToolDetail).mockReturnValue({
      schemaVersion: 1,
      sessionId: user.sessionId,
      toolCallId,
      detailRevision: 1,
      ts: 2_000,
      name: 'exec',
      args: { input: 'private command' },
      status: 'running',
      detailRef: { toolIndex: 0 },
    })
    const completed = repository.commitEvent(event({
      sourceEventKey: 'event-tool-output',
      canonicalMessageKey: 'tool:logical-1',
      canonicalMutation: 'upsert',
      cursor: '/rollout.jsonl:300',
      role: 'agent',
      ts: 3_000,
      payload: JSON.stringify({
        v: 1, type: 'tool', name: 'custom_tool_call_output', toolCallId, detailRevision: 2,
        status: 'completed', detailAvailable: true, resultOmitted: true,
      }),
      localToolDetail: {
        toolCallId, detailRevision: 2, name: 'custom_tool_call_output',
        result: 'private result', status: 'completed',
      },
    }))

    expect(completed.messageId).toBe(running.messageId)
    const messages = canonical.readRecent(user.sessionId, 10).messages
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ id: running.messageId, ts: 2_000 })
    expect(JSON.parse(messages[1]!.payload)).toMatchObject({
      name: 'exec', toolCallId, detailRevision: 2, status: 'completed',
    })
    expect(writeLocalToolDetail).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'exec',
      args: { input: 'private command' },
      result: 'private result',
      status: 'completed',
      detailRevision: 2,
    }))
  })

  it('recovers when a replayed physical tool event targets an existing logical message', () => {
    const user = repository.commitEvent(event())
    const toolCallId = 'native:tool:logical-replay'
    const runningPayload = JSON.stringify({
      v: 1, type: 'tool', name: 'exec', toolCallId, detailRevision: 1,
      status: 'running', detailAvailable: true, resultOmitted: true,
    })
    const first = repository.commitEvent(event({
      sourceEventKey: 'event-tool-call-first',
      canonicalMessageKey: 'tool:logical-replay',
      canonicalMutation: 'append',
      role: 'agent',
      ts: 2_000,
      payload: runningPayload,
    }))

    const replay = repository.commitEvent(event({
      sourceEventKey: 'event-tool-call-replayed-line',
      canonicalMessageKey: 'tool:logical-replay',
      canonicalMutation: 'append',
      role: 'agent',
      ts: 2_100,
      payload: runningPayload,
    }))

    expect(replay).toMatchObject({
      sessionId: user.sessionId,
      messageId: first.messageId,
    })
    expect(canonical.readRecent(user.sessionId, 10).messages).toHaveLength(2)
  })

  it('detects source event identity conflicts instead of overwriting canonical history', () => {
    repository.commitEvent(event())
    expect(() => repository.commitEvent(event({ payload: 'changed replay' })))
      .toThrow('native event identity conflict')
  })

  it('does not write ledger or source cursor when local index commit fails', () => {
    vi.mocked(recordLocalSession).mockImplementationOnce(() => {
      throw new Error('simulated local index failure')
    })
    expect(() => repository.commitEvent(event())).toThrow('local index failure')
    const [sessionId] = canonical.listSessionIds()
    expect(canonical.getManifest(sessionId!)).toMatchObject({ bodyRevision: 1 })
    expect(repository.listSourceBindings()).toEqual([])

    const recovered = repository.commitEvent(event())
    expect(recovered).toMatchObject({ bodyRevision: 1, duplicate: true })
    expect(repository.listSourceBindings()).toHaveLength(1)
  })

  it('recovers a source binding write interrupted after the durable ledger commit', () => {
    const originalRename = fs.renameSync.bind(fs)
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to).endsWith('sources.json')) throw new Error('simulated source rename failure')
      return originalRename(from, to)
    })
    expect(() => repository.commitEvent(event())).toThrow('source rename failure')
    renameSpy.mockRestore()

    const recovered = repository.commitEvent(event())
    expect(recovered).toMatchObject({ bodyRevision: 1, duplicate: true })
    expect(repository.listSourceBindings()[0]).toMatchObject({
      sessionId: recovered.sessionId,
      lastCursor: '/rollout.jsonl:100',
    })
  })

  it('maps a managed echo to its existing session without duplicating the user message', () => {
    const managedSessionId = 'managed-session-1'
    canonical.append(managedSessionId, {
      id: 'managed-user-1',
      sessionId: managedSessionId,
      role: 'user',
      ts: 1_000,
      payload: 'hello',
    })
    const claimed = repository.commitEvent(event({
      sourceMode: 'managed_echo_claim',
      claimCanonicalMessageId: 'managed-user-1',
      claimSessionId: managedSessionId,
    }))
    const agent = repository.commitEvent(event({
      sourceMode: 'codex_rollout_import',
      sourceEventKey: 'event-agent-after-claim',
      role: 'agent',
      ts: 2_000,
      payload: 'done',
    }))

    expect(claimed).toMatchObject({
      sessionId: managedSessionId,
      messageId: 'managed-user-1',
      bodyRevision: 1,
      claimed: true,
    })
    expect(agent).toMatchObject({ sessionId: managedSessionId, bodyRevision: 2 })
    expect(canonical.readRecent(managedSessionId, 10).messages.map((message) => message.id))
      .toEqual(['managed-user-1', agent.messageId])
  })

  it('durably marks only the claimed queued input started before replaying a terminal', () => {
    const sessionId = 'external-queued-restart'
    for (const id of ['claimed', 'still-pending']) {
      canonical.append(sessionId, {
        id, sessionId, role: 'user', ts: 1_000, payload: id,
      }, 'queued')
    }
    repository.commitEvent(event({
      sourceMode: 'managed_echo_claim',
      claimCanonicalMessageId: 'claimed', claimSessionId: sessionId,
    }))
    expect(canonical.getMessageState(sessionId, 'claimed')?.deliveryState).toBe('executing')
    // A new repository has no in-memory external-owner observations.
    const restarted = new NativeFusionLocalRepository({
      rootDir: path.join(tempDir, 'native-fusion'),
      daemonInstallationId: 'daemon-installation-test',
      canonicalStore: canonical, recordLocalSession,
    })
    restarted.commitEvent(event({
      sourceEventKey: 'terminal-after-restart', role: 'agent', ts: 2_000,
      payload: 'done', terminal: true,
    }))
    expect(canonical.getMessageState(sessionId, 'claimed')?.deliveryState).toBe('completed')
    expect(canonical.getMessageState(sessionId, 'still-pending')?.deliveryState).toBe('queued')
  })

  it('rejects a managed echo claim whose canonical user message is not durable', () => {
    expect(() => repository.commitEvent(event({
      sourceMode: 'managed_echo_claim',
      claimCanonicalMessageId: 'missing-user',
      claimSessionId: 'managed-session-missing',
    }))).toThrow('claim target is not durable')
    expect(repository.listSourceBindings()).toEqual([])
  })

  it('derives the same local session identity without any machineId input', () => {
    const first = repository.commitEvent(event()).sessionId
    const secondRoot = path.join(tempDir, 'second-native-fusion')
    const secondCanonical = new CanonicalSessionStore(
      path.join(tempDir, 'second-canonical'),
      'daemon-installation-test',
    )
    const secondRepository = new NativeFusionLocalRepository({
      rootDir: secondRoot,
      daemonInstallationId: 'daemon-installation-test',
      canonicalStore: secondCanonical,
      recordLocalSession: vi.fn(),
    })
    expect(secondRepository.commitEvent(event()).sessionId).toBe(first)
  })
  it('fences internal sources before canonical writes even after archive moves or ledger replay', () => {
    const prior = repository.commitEvent(event())
    fs.writeFileSync(path.join(tempDir, 'native-fusion-state.json'), JSON.stringify({
      schemaVersion: 1, fusionEpochMs: 1, daemonInstallationId: 'daemon-installation-test', files: {},
      internalSourceOwners: { 'codex:thread-1': { sessionId: 'manager', registeredAt: new Date().toISOString() } },
    }))
    expect(() => repository.commitEvent(event({ cursor: '/archived_sessions/rollout.jsonl:100' })))
      .toThrow('internal native source')
    expect(repository.commitEvents([event(), event({ sourceSessionKey: 'normal', sourceEventKey: 'normal-user' })]))
      .toHaveLength(1)
    expect(repository.observeNativeTitle('codex', 'thread-1', 'new title')).toBe(false)
    expect(canonical.readRecent(prior.sessionId, 10).messages).toHaveLength(1)
  })

})

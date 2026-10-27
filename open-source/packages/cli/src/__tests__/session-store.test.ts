// @arch open-source/docs/cli-runtime.md
// @covers src/session/canonical-store.ts
// @covers src/session/store.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Envelope } from '@shennian/wire'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CanonicalSessionStore,
  CanonicalStoreConflictError,
  CanonicalStoreCorruptionError,
} from '../session/canonical-store.js'

let tmpDir: string
let store: CanonicalSessionStore

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-canonical-test-'))
  store = new CanonicalSessionStore(
    path.join(tmpDir, 'personal-sync-v1', 'canonical'),
    'daemon-installation-test',
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const makeEnvelope = (overrides: Partial<Envelope> = {}): Envelope => ({
  id: 'msg-1',
  sessionId: 'sess-1',
  role: 'user',
  ts: 1_000,
  payload: 'hello',
  ...overrides,
})

describe('CanonicalSessionStore', () => {
  it('durably appends with monotonic revisions and stable sequences', () => {
    const first = store.append('sess-1', makeEnvelope())
    const second = store.append('sess-1', makeEnvelope({ id: 'msg-2', role: 'agent', ts: 2_000 }))
    expect(first).toMatchObject({ bodyRevision: 1, sequence: 1, duplicate: false })
    expect(second).toMatchObject({ bodyRevision: 2, sequence: 2, duplicate: false })
    expect(store.getManifest('sess-1')).toMatchObject({
      schemaVersion: 1,
      daemonInstallationId: 'daemon-installation-test',
      bodyRevision: 2,
      nextSequence: 3,
      mutationCount: 2,
    })
  })

  it('deduplicates an identical deterministic append without advancing revision', () => {
    const message = makeEnvelope()
    const first = store.append('sess-1', message)
    const duplicate = store.append('sess-1', message)
    expect(duplicate).toMatchObject({ bodyRevision: 1, sequence: 1, duplicate: true })
    expect(duplicate.mutation.mutationId).toBe(first.mutation.mutationId)
    expect(store.readDeltas('sess-1', 0, 10)).toHaveLength(1)
  })

  it('persists dispatch time across reopen without changing the sync identity', () => {
    store.append('sess-1', makeEnvelope({ id: 'a', ts: 100 }), 'completed')
    const queued = store.append('sess-1', makeEnvelope({ id: 'b', ts: 110 }), 'queued')
    store.append('sess-1', makeEnvelope({ id: 'reply-a', role: 'agent', ts: 200 }))
    const dispatched = store.upsert('sess-1', makeEnvelope({ id: 'b', ts: 210 }), 'executing')
    expect(dispatched.sequence).toBe(queued.sequence)
    const reopened = new CanonicalSessionStore(
      path.join(tmpDir, 'personal-sync-v1', 'canonical'), 'daemon-installation-test',
    )
    expect(reopened.getMessageState('sess-1', 'b')?.message?.ts).toBe(210)
    expect(reopened.readRecent('sess-1', 10).messages.sort((a, b) => a.ts - b.ts).map(m => m.id))
      .toEqual(['a', 'reply-a', 'b'])
    expect(reopened.readDeltas('sess-1', queued.bodyRevision, 10).at(-1)?.message?.ts).toBe(210)
  })

  it('requires upsert for a changed logical message and preserves its sequence', () => {
    store.append('sess-1', makeEnvelope({ payload: 'tool running' }))
    expect(() => store.append('sess-1', makeEnvelope({ payload: 'tool completed' })))
      .toThrow(CanonicalStoreConflictError)
    const updated = store.upsert('sess-1', makeEnvelope({ payload: 'tool completed' }))
    expect(updated).toMatchObject({ bodyRevision: 2, sequence: 1 })
    expect(store.readRecent('sess-1', 10).messages).toEqual([
      makeEnvelope({ payload: 'tool completed' }),
    ])
  })

  it('keeps the newest visible message when an older delivery state changes', () => {
    store.append('sess-1', makeEnvelope(), 'executing')
    store.append('sess-1', makeEnvelope({ id: 'msg-2', role: 'agent', ts: 2_000 }))

    const updated = store.updateMessageDeliveryState('sess-1', 'msg-1', 'completed')

    expect(updated).toMatchObject({ bodyRevision: 3, sequence: 1 })
    expect(store.getManifest('sess-1')?.lastVisibleMessageId).toBe('msg-2')
    expect(store.getMessageState('sess-1', 'msg-1')?.deliveryState).toBe('completed')
  })

  it('never completes pending user messages when a previous turn terminates', () => {
    store.append('sess-1', makeEnvelope({ id: 'old', ts: 1_000 }), 'executing')
    store.append('sess-1', makeEnvelope({ id: 'current', ts: 2_000 }), 'queued')
    store.append('sess-1', makeEnvelope({ id: 'future', ts: 4_000 }), 'queued')

    store.completeStartedUserMessages('sess-1', 3_000)

    expect(store.getMessageState('sess-1', 'old')?.deliveryState).toBe('completed')
    expect(store.getMessageState('sess-1', 'current')?.deliveryState).toBe('queued')
    expect(store.getMessageState('sess-1', 'future')?.deliveryState).toBe('queued')
    expect(store.getManifest('sess-1')?.lastVisibleMessageId).toBe('future')
  })

  it('uses a distinct deterministic mutation identity when state changes away and back', () => {
    const first = store.append('sess-1', makeEnvelope({ payload: 'A' }))
    store.upsert('sess-1', makeEnvelope({ payload: 'B' }))
    const backToA = store.upsert('sess-1', makeEnvelope({ payload: 'A' }))

    expect(backToA.mutation.mutationId).not.toBe(first.mutation.mutationId)
    expect(backToA).toMatchObject({ bodyRevision: 3, sequence: 1 })
  })

  it('applies tombstones without creating a duplicate visible message', () => {
    store.append('sess-1', makeEnvelope())
    const removed = store.tombstone('sess-1', 'msg-1')
    expect(removed).toMatchObject({ bodyRevision: 2, sequence: 1 })
    expect(store.readRecent('sess-1', 10).messages).toEqual([])
    expect(store.readDeltas('sess-1', 0, 10).map((item) => item.mutation))
      .toEqual(['append', 'tombstone'])
  })

  it('reads recent windows and older pages by sequence in canonical order', () => {
    for (let sequence = 1; sequence <= 6; sequence += 1) {
      store.append('sess-1', makeEnvelope({
        id: `msg-${sequence}`, ts: sequence * 1_000, payload: `message ${sequence}`,
      }))
    }
    const recent = store.readRecent('sess-1', 2)
    expect(recent.messages.map((message) => message.id)).toEqual(['msg-5', 'msg-6'])
    expect(recent.hasOlder).toBe(true)
    const older = store.readPage('sess-1', { beforeSequence: 5, limit: 2 })
    expect(older.messages.map((message) => message.id)).toEqual(['msg-3', 'msg-4'])
    expect(older.hasOlder).toBe(true)
  })

  it('uses sparse offsets to read bounded revision deltas', () => {
    // This case exercises byte offsets, not disk durability. Seventy durable
    // commits can exceed Vitest's default timeout when the full suite contends
    // for fsync, while syncing does not affect the bytes or offsets under test.
    const fsyncSpy = vi.spyOn(fs, 'fsyncSync').mockImplementation(() => {})
    try {
      for (let revision = 1; revision <= 70; revision += 1) {
        store.append('sess-1', makeEnvelope({ id: `msg-${revision}`, ts: revision }))
      }
      expect(store.readDeltas('sess-1', 66, 2).map((item) => item.revision)).toEqual([67, 68])
    } finally {
      fsyncSpy.mockRestore()
    }
  }, 10_000)

  it('truncates a half-written tail and rebuilds manifest and projections', () => {
    store.append('sess-1', makeEnvelope())
    const sessionDir = findOnlySessionDir(store.rootDir)
    fs.appendFileSync(path.join(sessionDir, 'mutations-000001.jsonl'), '{"partial":')
    fs.rmSync(path.join(sessionDir, 'manifest.json'))
    expect(store.rebuild('sess-1')).toMatchObject({ bodyRevision: 1, mutationCount: 1 })
    expect(store.readRecent('sess-1', 10).messages).toEqual([makeEnvelope()])
    expect(fs.readFileSync(path.join(sessionDir, 'mutations-000001.jsonl'), 'utf8').endsWith('\n')).toBe(true)
  })

  it('rebuilds missing manifest, sparse index and message state from the log', () => {
    store.append('sess-1', makeEnvelope())
    store.upsert('sess-1', makeEnvelope({ payload: 'updated' }))
    const sessionDir = findOnlySessionDir(store.rootDir)
    fs.rmSync(path.join(sessionDir, 'manifest.json'))
    fs.rmSync(path.join(sessionDir, 'sparse-index.json'))
    fs.rmSync(path.join(sessionDir, 'messages'), { recursive: true })
    expect(store.rebuild('sess-1')).toMatchObject({ bodyRevision: 2, nextSequence: 2 })
    expect(store.readRecent('sess-1', 10).messages[0]?.payload).toBe('updated')
  })

  it('rebuilds a malformed manifest instead of returning empty history', () => {
    store.append('sess-1', makeEnvelope())
    const sessionDir = findOnlySessionDir(store.rootDir)
    fs.writeFileSync(path.join(sessionDir, 'manifest.json'), 'not-json')

    expect(store.readRecent('sess-1', 10).messages).toEqual([makeEnvelope()])
    expect(store.getManifest('sess-1')).toMatchObject({ bodyRevision: 1 })
  })

  it('serves history from message projections without reading the mutation segment', () => {
    store.append('sess-1', makeEnvelope())
    const readSpy = vi.spyOn(fs, 'readFileSync')

    expect(store.readRecent('sess-1', 10).messages).toEqual([makeEnvelope()])
    expect(readSpy.mock.calls.some(([file]) => String(file).endsWith('.jsonl'))).toBe(false)
  })

  it('quarantines a corrupt completed segment and keeps returning a diagnostic error', () => {
    store.append('sess-1', makeEnvelope())
    const sessionDir = findOnlySessionDir(store.rootDir)
    fs.appendFileSync(path.join(sessionDir, 'mutations-000001.jsonl'), 'not-json\n')
    fs.rmSync(path.join(sessionDir, 'manifest.json'))
    expect(() => store.rebuild('sess-1')).toThrow(CanonicalStoreCorruptionError)
    expect(fs.existsSync(path.join(sessionDir, 'CORRUPT.json'))).toBe(true)
    expect(fs.readdirSync(path.join(store.rootDir, 'quarantine'))).toHaveLength(1)
    expect(() => store.readRecent('sess-1', 10)).toThrow(CanonicalStoreCorruptionError)
  })

  it('propagates filesystem write failures', () => {
    const blockedRoot = path.join(tmpDir, 'blocked-root')
    fs.writeFileSync(blockedRoot, 'not a directory')
    const blockedStore = new CanonicalSessionStore(blockedRoot, 'daemon-installation-test')
    expect(() => blockedStore.append('sess-1', makeEnvelope())).toThrow()
  })

  it('recovers an appended mutation after atomic projection rename is interrupted', () => {
    store.append('sess-1', makeEnvelope())
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('simulated rename interruption'), { code: 'EIO' })
    })
    expect(() => store.append('sess-1', makeEnvelope({ id: 'msg-2', ts: 2_000 }))).toThrow('rename')
    renameSpy.mockRestore()

    const recovered = store.append('sess-1', makeEnvelope({ id: 'msg-2', ts: 2_000 }))
    expect(recovered).toMatchObject({ bodyRevision: 2, sequence: 2, duplicate: true })
    expect(store.readRecent('sess-1', 10).messages.map((message) => message.id))
      .toEqual(['msg-1', 'msg-2'])
  })

  it('propagates a simulated disk-full append without advancing revision', () => {
    store.append('sess-1', makeEnvelope())
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
    })
    expect(() => store.append('sess-1', makeEnvelope({ id: 'msg-2' }))).toThrow('no space')
    writeSpy.mockRestore()
    expect(store.getManifest('sess-1')).toMatchObject({ bodyRevision: 1 })
  })

  it('refuses to adopt canonical data owned by another daemon installation', () => {
    store.append('sess-1', makeEnvelope())
    const foreign = new CanonicalSessionStore(store.rootDir, 'different-installation')
    expect(() => foreign.readRecent('sess-1', 10)).toThrow(CanonicalStoreConflictError)
  })

  it('does not discover or migrate legacy session JSONL files', () => {
    const legacyDir = path.join(tmpDir, 'sessions')
    fs.mkdirSync(legacyDir)
    fs.writeFileSync(path.join(legacyDir, 'legacy.jsonl'), `${JSON.stringify(makeEnvelope())}\n`)
    expect(store.listSessionIds()).toEqual([])
    expect(store.readRecent('legacy', 10).messages).toEqual([])
    expect(fs.existsSync(path.join(legacyDir, 'legacy.jsonl'))).toBe(true)
  })
})

describe('default store wrappers', () => {
  it('assigns the first-user fallback once and enforces title source priority', async () => {
    vi.stubEnv('SHENNIAN_HOME', tmpDir)
    const sessionStore = await import('../session/store.js')
    sessionStore.recordSession({ sessionId: 'title-1', agentType: 'codex', workDir: tmpDir })
    sessionStore.appendMessage('title-1', makeEnvelope({
      id: 'first-user', sessionId: 'title-1', payload: '修复手机同步缺消息',
    }))
    expect(sessionStore.listSessionRecords()[0]).toMatchObject({
      title: '修复手机同步缺消息',
      titleSource: 'first_user_fallback',
      titleRevision: 1,
      titleOriginEventId: 'first-user',
    })
    sessionStore.recordSession({
      sessionId: 'title-1', agentType: 'codex', workDir: tmpDir,
      title: '后续用户消息不能替换首句', titleSource: 'first_user_fallback',
      titleOriginEventId: 'second-user',
    })
    expect(sessionStore.listSessionRecords()[0]).toMatchObject({
      title: '修复手机同步缺消息', titleRevision: 1, titleOriginEventId: 'first-user',
    })

    sessionStore.recordSession({
      sessionId: 'title-1', agentType: 'codex', workDir: tmpDir,
      title: '同步问题修复', titleSource: 'agent_native', titleOriginEventId: 'native-1',
    })
    sessionStore.recordSession({
      sessionId: 'title-1', agentType: 'codex', workDir: tmpDir,
      title: '较低优先级回退', titleSource: 'first_user_fallback', titleRevision: 99,
    })
    sessionStore.recordSession({
      sessionId: 'title-1', agentType: 'codex', workDir: tmpDir,
      title: '我的手工标题', titleSource: 'shennian_manual', titleRevision: 3,
      titleLockedByUser: true, titleOriginEventId: 'shennian-manual:1',
    })
    sessionStore.recordSession({
      sessionId: 'title-1', agentType: 'codex', workDir: tmpDir,
      title: '后到的原生标题', titleSource: 'agent_native', titleRevision: 100,
    })
    expect(sessionStore.listSessionRecords()[0]).toMatchObject({
      title: '我的手工标题',
      titleSource: 'shennian_manual',
      titleRevision: 3,
      titleLockedByUser: true,
      titleOriginEventId: 'shennian-manual:1',
    })

    sessionStore.recordSession({
      sessionId: 'title-generated', agentType: 'codex', workDir: tmpDir,
      title: '神念生成标题', titleSource: 'shennian_generated', titleRevision: 1,
    })
    sessionStore.recordSession({
      sessionId: 'title-generated', agentType: 'codex', workDir: tmpDir,
      title: 'Codex 原生标题', titleSource: 'agent_native', titleRevision: 2,
      titleOriginEventId: 'agent-native:2',
    })
    expect(sessionStore.listSessionRecords().find((record) => record.sessionId === 'title-generated'))
      .toMatchObject({
        title: 'Codex 原生标题', titleSource: 'agent_native', titleRevision: 2,
        titleLockedByUser: false,
      })

    sessionStore.recordSession({
      sessionId: 'title-generated', agentType: 'codex', workDir: tmpDir,
      title: 'Codex 原生标题', titleSource: 'agent_native',
      titleOriginEventId: 'later-source-event-with-the-same-title',
    })
    expect(sessionStore.listSessionRecords().find((record) => record.sessionId === 'title-generated'))
      .toMatchObject({
        title: 'Codex 原生标题', titleSource: 'agent_native', titleRevision: 2,
        titleOriginEventId: 'agent-native:2',
      })
  })

  it('persists durable delivery state for timeout recovery by clientMessageId', async () => {
    vi.stubEnv('SHENNIAN_HOME', tmpDir)
    const sessionStore = await import('../session/store.js')
    sessionStore.recordSession({ sessionId: 'delivery-1', agentType: 'codex', workDir: tmpDir })
    const envelope = { ...makeEnvelope(), id: 'client-message-1', sessionId: 'delivery-1' }
    expect(sessionStore.appendMessage('delivery-1', envelope, 'queued')).toBe(1)
    expect(sessionStore.getMessageDeliveryStatus('delivery-1', 'client-message-1')).toMatchObject({
      state: 'queued', clientMessageId: 'client-message-1', bodyRevision: 1,
    })
    expect(sessionStore.upsertMessage('delivery-1', envelope, 'executing')).toBe(2)
    expect(sessionStore.getMessageDeliveryStatus('delivery-1', 'client-message-1')).toMatchObject({
      state: 'executing', deliveryState: 'executing', bodyRevision: 2,
    })
    expect(sessionStore.getMessageDeliveryStatus('delivery-1', 'missing')).toEqual(expect.objectContaining({
      state: 'not_found', sessionId: 'delivery-1', clientMessageId: 'missing',
    }))
  })

  it('publishes and rolls back the preview text, identity and time as one tuple', async () => {
    vi.stubEnv('SHENNIAN_HOME', tmpDir)
    const sessionStore = await import('../session/store.js')
    sessionStore.recordSession({ sessionId: 'preview-1', agentType: 'codex', workDir: tmpDir })
    sessionStore.appendMessage('preview-1', makeEnvelope({
      id: 'preview-user', sessionId: 'preview-1', ts: 1_000, payload: '第一条消息',
    }))
    sessionStore.appendMessage('preview-1', makeEnvelope({
      id: 'preview-agent', sessionId: 'preview-1', role: 'agent', ts: 2_000,
      payload: '第二条回复',
    }))

    expect(sessionStore.listSessionRecords()[0]).toMatchObject({
      lastMessagePreview: '第二条回复',
      lastMessagePreviewMessageId: 'preview-agent',
      lastMessagePreviewAt: '1970-01-01T00:00:02.000Z',
      lastVisibleEventAt: '1970-01-01T00:00:02.000Z',
    })

    sessionStore.appendMessage('preview-1', makeEnvelope({
      id: 'tool-result', sessionId: 'preview-1', role: 'agent', ts: 3_000,
      payload: JSON.stringify({ v: 1, type: 'tool_result', toolCallId: 'tool-1' }),
    }))
    expect(sessionStore.listSessionRecords()[0]).toMatchObject({
      lastMessagePreview: '第二条回复',
      lastMessagePreviewAt: '1970-01-01T00:00:02.000Z',
      lastVisibleEventAt: '1970-01-01T00:00:03.000Z',
    })

    sessionStore.recordSession({
      sessionId: 'preview-1', agentType: 'codex', workDir: tmpDir,
      lastMessagePreview: '不能单独覆盖元组',
    })
    expect(sessionStore.listSessionRecords()[0]).toMatchObject({
      lastMessagePreview: '第二条回复',
      lastMessagePreviewMessageId: 'preview-agent',
      lastMessagePreviewAt: '1970-01-01T00:00:02.000Z',
    })

    sessionStore.tombstoneMessage('preview-1', 'preview-agent')
    expect(sessionStore.listSessionRecords()[0]).toMatchObject({
      lastMessagePreview: '第一条消息',
      lastMessagePreviewMessageId: 'preview-user',
      lastMessagePreviewAt: '1970-01-01T00:00:01.000Z',
      lastVisibleEventAt: '1970-01-01T00:00:03.000Z',
    })
  })

  it('bounds first-message fallback titles and repairs an oversized quarantined index', async () => {
    vi.stubEnv('SHENNIAN_HOME', tmpDir)
    const sessionStore = await import('../session/store.js')
    sessionStore.recordSession({ sessionId: 'long-title', agentType: 'codex', workDir: tmpDir })
    sessionStore.appendMessage('long-title', makeEnvelope({
      id: 'long-user', sessionId: 'long-title', payload: '长'.repeat(200),
    }))
    expect(sessionStore.listSessionRecords()[0]?.title.length).toBe(120)

    const indexFile = findFileNamed(tmpDir, 'session-index.json')!
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8')) as Record<string, Record<string, unknown>>
    index['long-title']!.title = '旧'.repeat(121)
    index['long-title']!.indexSyncState = 'quarantined'
    index['long-title']!.indexSyncErrorCode = 'invalid_payload'
    index['long-title']!.indexQuarantineCode = 'invalid_payload'
    const rejectedRevision = index['long-title']!.indexRevision as number
    fs.writeFileSync(indexFile, JSON.stringify(index))

    const pending = sessionStore.listPendingSessionIndexUpdates()[0]!
    expect(pending.session.title).toBe('旧'.repeat(120))
    expect(pending.session.indexRevision).toBe(rejectedRevision + 1)
    expect(sessionStore.listSessionRecords()[0]).toMatchObject({
      indexSyncState: 'pending', indexSyncErrorCode: null, indexQuarantineCode: null,
    })
  })

  it('migrates legacy local indexes by deriving the tuple from canonical messages', async () => {
    vi.stubEnv('SHENNIAN_HOME', tmpDir)
    const sessionStore = await import('../session/store.js')
    sessionStore.recordSession({ sessionId: 'legacy-preview', agentType: 'codex', workDir: tmpDir })
    sessionStore.appendMessage('legacy-preview', makeEnvelope({
      id: 'legacy-message', sessionId: 'legacy-preview', ts: 3_000, payload: '迁移后的摘要',
    }))
    const indexFile = findFileNamed(tmpDir, 'session-index.json')!
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8')) as Record<string, Record<string, unknown>>
    delete index['legacy-preview']!.lastMessagePreviewMessageId
    delete index['legacy-preview']!.lastMessagePreviewAt
    fs.writeFileSync(indexFile, JSON.stringify(index))

    expect(sessionStore.listPendingSessionIndexUpdates()).toEqual([
      expect.objectContaining({ session: expect.objectContaining({
        id: 'legacy-preview',
        lastMessagePreview: '迁移后的摘要',
        lastMessagePreviewMessageId: 'legacy-message',
        lastMessagePreviewAt: '1970-01-01T00:00:03.000Z',
      }) }),
    ])
  })

  it('claims a bounded title seed at most once without persisting the seed', async () => {
    vi.stubEnv('SHENNIAN_HOME', tmpDir)
    const sessionStore = await import('../session/store.js')
    sessionStore.recordSession({ sessionId: 'title-seed-1', agentType: 'claude', workDir: tmpDir })
    sessionStore.appendMessage('title-seed-1', makeEnvelope({
      id: 'seed-user', sessionId: 'title-seed-1', payload: '分析同步标题来源',
    }))
    sessionStore.appendMessage('title-seed-1', makeEnvelope({
      id: 'seed-agent', sessionId: 'title-seed-1', role: 'agent', ts: 2_000,
      payload: '我会检查标题同步链路。',
    }))

    expect(sessionStore.claimSessionTitleGenerationCandidates()).toEqual([])
    const pending = sessionStore.listPendingSessionIndexUpdates()[0]!
    sessionStore.acknowledgeSessionIndexUpdate('title-seed-1', pending.session.indexRevision)
    const claimed = sessionStore.claimSessionTitleGenerationCandidates()
    expect(claimed).toEqual([expect.objectContaining({
      sessionId: 'title-seed-1', titleSeed: '分析同步标题来源',
      baseTitleRevision: 1, eligibility: 'agent_native_unavailable',
    })])
    expect(sessionStore.claimSessionTitleGenerationCandidates()).toEqual([])
    const indexFile = findFileNamed(tmpDir, 'session-index.json')
    expect(indexFile).not.toBeNull()
    const stored = fs.readFileSync(indexFile!, 'utf8')
    expect(stored).toContain('titleGenerationAttemptedAt')
    expect(stored).not.toContain('titleSeed')

    expect(sessionStore.deferSessionTitleGeneration('title-seed-1', 10_000))
      .toBe('1970-01-01T00:00:40.000Z')
    expect(sessionStore.claimSessionTitleGenerationCandidates(39_999)).toEqual([])
    expect(sessionStore.claimSessionTitleGenerationCandidates(40_000)).toEqual([
      expect.objectContaining({ sessionId: 'title-seed-1' }),
    ])

    expect(sessionStore.applyGeneratedSessionTitle('title-seed-1', {
      generated: true,
      title: '标题同步来源分析',
      titleSource: 'shennian_generated',
      titleRevision: 2,
      titleOriginEventId: `shennian-generated:${claimed[0]!.requestId}`,
    })).toBe(true)
    expect(sessionStore.listSessionRecords()[0]).toMatchObject({
      title: '标题同步来源分析', titleSource: 'shennian_generated', titleRevision: 2,
    })
  })

  it('waits for terminal or grace before claiming seeds from native-title agents', async () => {
    vi.stubEnv('SHENNIAN_HOME', tmpDir)
    const sessionStore = await import('../session/store.js')
    sessionStore.recordSession({ sessionId: 'codex-seed-1', agentType: 'codex', workDir: tmpDir })
    sessionStore.appendMessage('codex-seed-1', makeEnvelope({
      id: 'codex-user', sessionId: 'codex-seed-1', payload: '等待 Codex 原生标题',
    }))
    sessionStore.appendMessage('codex-seed-1', makeEnvelope({
      id: 'codex-agent', sessionId: 'codex-seed-1', role: 'agent', ts: 2_000,
      payload: '处理中',
    }))
    expect(sessionStore.claimSessionTitleGenerationCandidates(Date.now(), 60_000)).toEqual([])
    sessionStore.recordSession({
      sessionId: 'codex-seed-1', agentType: 'codex', workDir: tmpDir, status: 'completed',
    })
    const pending = sessionStore.listPendingSessionIndexUpdates()[0]!
    sessionStore.acknowledgeSessionIndexUpdate('codex-seed-1', pending.session.indexRevision)
    expect(sessionStore.claimSessionTitleGenerationCandidates()).toEqual([
      expect.objectContaining({ eligibility: 'terminal', titleSeed: '等待 Codex 原生标题' }),
    ])
  })

  it('advances attention once per stable terminal identity, not per body message or replay', async () => {
    vi.stubEnv('SHENNIAN_HOME', tmpDir)
    const sessionStore = await import('../session/store.js')
    sessionStore.recordSession({ sessionId: 'attention-1', agentType: 'codex', workDir: tmpDir })
    for (let index = 0; index < 3; index += 1) {
      sessionStore.appendMessage('attention-1', makeEnvelope({
        id: `attention-user-${index}`, sessionId: 'attention-1', role: 'user',
        ts: 1_000 + index, payload: `清理测试会话 ${index}`,
      }))
    }
    for (let index = 0; index < 62; index += 1) {
      sessionStore.appendMessage('attention-1', makeEnvelope({
        id: `tool-${index}`,
        sessionId: 'attention-1',
        role: 'agent',
        ts: 2_000 + index,
        payload: JSON.stringify({ v: 1, type: 'tool', name: 'exec', toolCallId: `tool-${index}` }),
      }))
    }
    for (let index = 0; index < 17; index += 1) {
      sessionStore.appendMessage('attention-1', makeEnvelope({
        id: `process-${index}`,
        sessionId: 'attention-1',
        role: 'agent',
        ts: 3_000 + index,
        payload: JSON.stringify({ v: 1, type: 'event', data: { kind: 'process', index } }),
      }))
    }
    sessionStore.recordSession({
      sessionId: 'attention-1', agentType: 'codex', workDir: tmpDir,
      status: 'completed', attentionId: 'terminal:cleanup-run',
    })
    expect(sessionStore.listSessionRecords()[0]).toMatchObject({
      visibleMessageCount: 82,
      attentionCount: 1,
      lastAttentionId: 'terminal:cleanup-run',
    })
    sessionStore.recordSession({
      sessionId: 'attention-1', agentType: 'codex', workDir: tmpDir,
      status: 'completed', attentionId: 'terminal:cleanup-run',
    })
    sessionStore.recordSession({
      sessionId: 'attention-1', agentType: 'codex', workDir: tmpDir,
      status: 'completed', attentionId: 'terminal:next-run',
    })
    sessionStore.recordSession({
      sessionId: 'attention-1', agentType: 'codex', workDir: tmpDir,
      status: 'completed', attentionId: 'terminal:cleanup-run',
    })

    expect(sessionStore.listSessionRecords()[0]).toMatchObject({
      visibleMessageCount: 82,
      attentionCount: 2,
      lastAttentionId: 'terminal:next-run',
      seenAttentionIds: ['terminal:cleanup-run', 'terminal:next-run'],
    })
    expect(sessionStore.listPendingSessionIndexUpdates()[0]?.session).not.toHaveProperty('seenAttentionIds')
  }, 15_000)

  it('persists a stable daemon installation identity and propagates index writes', async () => {
    vi.stubEnv('SHENNIAN_HOME', tmpDir)
    const sessionStore = await import('../session/store.js')
    const firstIdentity = sessionStore.getDaemonInstallationId()
    vi.resetModules()
    const reloaded = await import('../session/store.js')
    expect(reloaded.getDaemonInstallationId()).toBe(firstIdentity)
    reloaded.recordSession({ sessionId: 'sess-1', agentType: 'codex', workDir: tmpDir })
    expect(reloaded.listPendingSessionIndexUpdates()).toEqual([])
    reloaded.appendMessage('sess-1', makeEnvelope({
      id: 'pre-user-agent', role: 'agent', payload: 'must remain local',
    }))
    expect(reloaded.listPendingSessionIndexUpdates()).toEqual([])
    expect(reloaded.appendMessage('sess-1', makeEnvelope())).toBe(2)
    expect(reloaded.listSessionRecords()[0]).toMatchObject({
      daemonInstallationId: firstIdentity, sessionId: 'sess-1', bodyRevision: 2, indexRevision: 3,
      localReady: true, firstUserMessageId: 'msg-1', firstUserBodyRevision: 2,
    })
    expect(reloaded.listPendingSessionIndexUpdates()).toEqual([
      expect.objectContaining({
        daemonInstallationId: firstIdentity,
        session: expect.objectContaining({
          id: 'sess-1', bodyStorageMode: 'machine_local', bodyRevision: 2,
          indexRevision: 3, visibleMessageCount: 2, lastVisibleMessageId: 'msg-1',
          lastMessagePreview: 'hello', lastMessagePreviewMessageId: 'msg-1',
          lastMessagePreviewAt: '1970-01-01T00:00:01.000Z',
          localReady: true,
          firstUserBoundary: { role: 'user', messageId: 'msg-1', bodyRevision: 2 },
        }),
      }),
    ])
    reloaded.acknowledgeSessionIndexUpdate('sess-1', 3)
    expect(reloaded.listPendingSessionIndexUpdates()).toEqual([])
    expect(reloaded.markAllSessionIndexesForRepublish()).toBe(1)
    expect(reloaded.listPendingSessionIndexUpdates()).toEqual([
      expect.objectContaining({
        session: expect.objectContaining({ id: 'sess-1', indexRevision: 4 }),
      }),
    ])
    expect(reloaded.readMessages('sess-1').map((message) => message.id))
      .toEqual(['pre-user-agent', 'msg-1'])

    const originalRename = fs.renameSync.bind(fs)
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to).endsWith('session-index.json')) {
        throw Object.assign(new Error('simulated index rename failure'), { code: 'EIO' })
      }
      return originalRename(from, to)
    })
    expect(() => reloaded.recordSession({
      sessionId: 'sess-1', agentType: 'codex', workDir: tmpDir, status: 'completed',
    })).toThrow('index rename failure')
    renameSpy.mockRestore()
    expect(reloaded.listSessionRecords()[0]).toMatchObject({
      status: 'active', indexRevision: 4, syncedIndexRevision: 3,
    })
  })

  it('rejects all late canonical and index writes after a durable session tombstone', async () => {
    vi.stubEnv('SHENNIAN_HOME', tmpDir)
    const sessionStore = await import('../session/store.js')
    const { NativeSourceDeletionStore } = await import('../native-fusion/native-source-deletions.js')
    const { parseCodexRolloutChunk } = await import('../native-fusion/parsers.js')
    sessionStore.recordSession({ sessionId: 'deleted-1', agentType: 'codex', workDir: tmpDir })
    sessionStore.appendMessage('deleted-1', { ...makeEnvelope(), sessionId: 'deleted-1' })
    new NativeSourceDeletionStore({
      daemonInstallationId: sessionStore.getDaemonInstallationId(),
    }).recordSession({ sessionId: 'deleted-1', deletionRevision: 1 })

    const archivedFile = path.join(tmpDir, '.codex', 'archived_sessions', 'deleted-1.jsonl')
    fs.mkdirSync(path.dirname(archivedFile), { recursive: true })
    fs.writeFileSync(archivedFile, [
      JSON.stringify({
        timestamp: '2026-09-03T02:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'deleted-1', cwd: tmpDir, model_provider: 'openai' },
      }),
      JSON.stringify({
        timestamp: '2026-09-03T02:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'late archived fixture event' },
      }),
      '',
    ].join('\n'))
    const lateArchived = parseCodexRolloutChunk(archivedFile, 0).events[0]!

    expect(() => sessionStore.recordSession({
      sessionId: 'deleted-1', agentType: 'codex', workDir: tmpDir,
    })).toThrow('session_deleted')
    expect(() => sessionStore.appendMessage(
      'deleted-1', {
        ...makeEnvelope(),
        id: lateArchived.sourceEventKey,
        payload: lateArchived.payload,
        sessionId: 'deleted-1',
      },
    )).toThrow('session_deleted')

    sessionStore.purgeCanonicalSession('deleted-1')
    sessionStore.purgeSessionRecord('deleted-1')
    expect(sessionStore.listSessionRecords()).toEqual([])
    expect(sessionStore.readMessages('deleted-1')).toEqual([])
  })

  it('persists quarantined and bounded-retry dirty states across reloads', async () => {
    vi.stubEnv('SHENNIAN_HOME', tmpDir)
    const sessionStore = await import('../session/store.js')
    sessionStore.recordSession({ sessionId: 'bad-index', agentType: 'codex', workDir: tmpDir })
    sessionStore.appendMessage('bad-index', {
      ...makeEnvelope(), id: 'bad-user', sessionId: 'bad-index',
    })
    const revision = sessionStore.listSessionRecords()[0]!.indexRevision
    expect(sessionStore.recordSessionIndexRejection({
      sessionId: 'bad-index', indexRevision: revision,
      code: 'invalid_identity', disposition: 'quarantined',
    })).toBe('quarantined')
    expect(sessionStore.listPendingSessionIndexUpdates()).toEqual([])

    vi.resetModules()
    const reloaded = await import('../session/store.js')
    expect(reloaded.listSessionRecords()[0]).toMatchObject({
      indexSyncState: 'quarantined', indexQuarantineCode: 'invalid_identity',
    })
    expect(reloaded.listPendingSessionIndexUpdates()).toEqual([])
    reloaded.recordSession({ sessionId: 'bad-index', agentType: 'codex', workDir: tmpDir })
    expect(reloaded.listSessionRecords()[0]).toMatchObject({
      indexSyncState: 'pending', indexQuarantineCode: null,
    })
    expect(reloaded.listPendingSessionIndexUpdates()).toHaveLength(1)

    reloaded.recordSession({ sessionId: 'retry-index', agentType: 'codex', workDir: tmpDir })
    reloaded.appendMessage('retry-index', {
      ...makeEnvelope(), id: 'retry-user', sessionId: 'retry-index',
    })
    const retryRevision = reloaded.listSessionRecords()
      .find((record) => record.sessionId === 'retry-index')!.indexRevision
    expect(reloaded.recordSessionIndexRejection({
      sessionId: 'retry-index', indexRevision: retryRevision,
      code: 'temporary_unavailable', disposition: 'retry', maxAttempts: 1,
    })).toBe('terminal')
    expect(reloaded.listPendingSessionIndexUpdates()
      .some((update) => update.session.id === 'retry-index')).toBe(false)
  })
  it('persists internal ownership and excludes all rotated provider IDs even after a legacy update', async () => {
    vi.stubEnv('SHENNIAN_HOME', tmpDir)
    const { recordSession, listSessionRecords } = await import('../session/store.js')
    const { isInternalNativeSource } = await import('../native-fusion/source-visibility.js')
    recordSession({ sessionId: 'managed-session', agentType: 'codex', workDir: '/repo',
      nativeSessionVisibility: 'internal', agentSessionId: 'first' })
    recordSession({ sessionId: 'managed-session', agentType: 'codex', workDir: '/repo',
      nativeSessionVisibility: 'user', agentSessionId: 'replacement' })
    expect(listSessionRecords().find(r => r.sessionId === 'managed-session'))
      .toMatchObject({ nativeSessionVisibility: 'internal' })
    expect(isInternalNativeSource('codex', 'first')).toBe(true)
    expect(isInternalNativeSource('codex', 'replacement')).toBe(true)
    recordSession({ sessionId: 'normal', agentType: 'codex', workDir: '/repo', title: 'Manager Worker', titleSource: 'first_user_fallback', agentSessionId: 'normal' })
    expect(isInternalNativeSource('codex', 'normal')).toBe(false)
  })

})

function findOnlySessionDir(rootDir: string): string {
  const sessionsRoot = path.join(rootDir, 'sessions')
  const entries = fs.readdirSync(sessionsRoot)
  expect(entries).toHaveLength(1)
  return path.join(sessionsRoot, entries[0])
}

function findFileNamed(rootDir: string, name: string): string | null {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const candidate = path.join(rootDir, entry.name)
    if (entry.isFile() && entry.name === name) return candidate
    if (entry.isDirectory()) {
      const nested = findFileNamed(candidate, name)
      if (nested) return nested
    }
  }
  return null
}

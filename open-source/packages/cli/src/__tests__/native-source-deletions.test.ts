// @covers src/native-fusion/native-source-deletions.ts
// @covers src/native-fusion/local-repository.ts
// @covers src/native-fusion/session-native-sources.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanonicalSessionStore } from '../session/canonical-store.js'
import {
  NativeFusionLocalRepository,
  NativeSourceDeletedError,
} from '../native-fusion/local-repository.js'
import { NativeSourceDeletionStore } from '../native-fusion/native-source-deletions.js'
import { collectLocalNativeSources } from '../native-fusion/session-native-sources.js'
import type { ParsedNativeEvent } from '../native-fusion/types.js'

let rootDir: string

describe('native source deletion tombstones', () => {
  beforeEach(() => { rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-source-deletion-')) })
  afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }))

  it('persists an installation-scoped idempotent barrier outside canonical sessions', () => {
    const store = new NativeSourceDeletionStore({ rootDir, daemonInstallationId: 'install-1' })
    const first = store.record({
      sessionId: 'session-1', agentType: 'codex', sourceSessionKey: 'thread-1', deletionRevision: 7,
    })
    const repeated = store.record({
      sessionId: 'session-1', agentType: 'codex', sourceSessionKey: 'thread-1', deletionRevision: 7,
    })
    expect(repeated).toEqual(first)
    expect(store.has('codex', 'thread-1')).toBe(true)
    expect(store.hasSession('session-1')).toBe(true)
    expect(store.list()).toEqual([expect.objectContaining({
      daemonInstallationId: 'install-1', deletionRevision: 7, sessionId: 'session-1',
    })])
    expect(fs.existsSync(path.join(rootDir, 'native-source-deletions.json'))).toBe(true)
    expect(fs.existsSync(path.join(rootDir, 'canonical'))).toBe(false)
    const restartedAfterPackageReinstall = new NativeSourceDeletionStore({
      rootDir,
      daemonInstallationId: 'install-1',
    })
    expect(restartedAfterPackageReinstall.has('codex', 'thread-1')).toBe(true)
  })

  it('rejects a tombstone file from another daemon installation', () => {
    new NativeSourceDeletionStore({ rootDir, daemonInstallationId: 'install-1' }).record({
      sessionId: 'session-1', agentType: 'codex', sourceSessionKey: 'thread-1', deletionRevision: 1,
    })
    expect(() => new NativeSourceDeletionStore({
      rootDir, daemonInstallationId: 'install-2',
    }).list()).toThrow('invalid native source deletion store')
  })

  it('blocks canonical import and title observation after the source is tombstoned', () => {
    const deletionStore = new NativeSourceDeletionStore({ rootDir, daemonInstallationId: 'install-1' })
    deletionStore.record({
      sessionId: 'session-1', agentType: 'codex', sourceSessionKey: 'thread-1', deletionRevision: 1,
    })
    const recordLocalSession = vi.fn()
    const repository = new NativeFusionLocalRepository({
      rootDir: path.join(rootDir, 'native-fusion'),
      daemonInstallationId: 'install-1',
      canonicalStore: new CanonicalSessionStore(path.join(rootDir, 'canonical'), 'install-1'),
      recordLocalSession,
      listLocalSessions: () => [],
      deletionStore,
    })
    const event: ParsedNativeEvent = {
      agentType: 'codex', sourceSessionKey: 'thread-1', sourceEventKey: 'event-1',
      sourceMode: 'codex_rollout_import', role: 'user', ts: 1, payload: 'must stay deleted',
      title: 'must stay deleted', workDir: '/repo', cursor: 'cursor-1', terminal: true,
    }
    expect(() => repository.commitEvent(event)).toThrow(NativeSourceDeletedError)
    expect(repository.observeNativeTitle('codex', 'thread-1', 'revived')).toBe(false)
    expect(recordLocalSession).not.toHaveBeenCalled()
  })

  it('collects locally owned native sources for deletion without taking another owner', () => {
    const sources = collectLocalNativeSources('room-session', {
      records: [
        { sessionId: 'room-session', agentType: 'manager', modelId: 'codex', agentSessionId: 'thread-current' },
        { sessionId: 'other-session', agentType: 'codex', agentSessionId: 'thread-other' },
      ],
      sourceOwners: [
        { agentType: 'codex', sourceSessionKey: 'thread-echo', sessionId: 'room-session' },
        { agentType: 'codex', sourceSessionKey: 'thread-current', sessionId: 'room-session' },
        { agentType: 'codex', sourceSessionKey: 'thread-other', sessionId: 'other-session' },
      ],
      scannerState: {
        internalSourceOwners: {
          'codex:thread-rotated': { sessionId: 'room-session', registeredAt: '2026-09-08T00:00:00.000Z' },
          'claude:thread-worker': { sessionId: 'worker-session', registeredAt: '2026-09-08T00:00:00.000Z' },
        },
      },
    })

    expect(sources).toEqual(expect.arrayContaining([
      { agentType: 'codex', sourceSessionKey: 'thread-current' },
      { agentType: 'codex', sourceSessionKey: 'thread-echo' },
      { agentType: 'codex', sourceSessionKey: 'thread-rotated' },
    ]))
    expect(sources).toHaveLength(3)
  })

  it('reads managed-echo source bindings from the local repository', () => {
    const repository = new NativeFusionLocalRepository({
      rootDir: path.join(rootDir, 'native-fusion'),
      daemonInstallationId: 'install-1',
      canonicalStore: new CanonicalSessionStore(path.join(rootDir, 'canonical'), 'install-1'),
      recordLocalSession: vi.fn(),
      listLocalSessions: () => [],
      deletionStore: { has: () => false },
    })
    repository.commitEvent({
      agentType: 'codex', sourceSessionKey: 'thread-echo', sourceEventKey: 'event-echo',
      sourceMode: 'codex_rollout_import', role: 'user', ts: 1, payload: '[群消息] hi',
      workDir: '/repo', cursor: 'cursor-1',
      claimSessionId: 'room-session', localDisposition: 'managed_echo_suppressed',
    })

    expect(repository.listSourceOwners()).toEqual([
      { agentType: 'codex', sourceSessionKey: 'thread-echo', sessionId: 'room-session' },
    ])
  })
})

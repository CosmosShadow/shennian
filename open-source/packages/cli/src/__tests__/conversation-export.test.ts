// @arch open-source/docs/cli-runtime.md
// @covers src/session/conversation-export.ts

import fs from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Envelope } from '@shennian/wire'
import { CanonicalSessionStore } from '../session/canonical-store.js'
import {
  assertConversationCutoverFence,
  beginConversationExport,
  CONVERSATION_EXPORT_GENESIS_HASH,
  readConversationExportPage,
} from '../session/conversation-export.js'

let root: string
let store: CanonicalSessionStore
const message = (id: string, payload: string): Envelope => ({
  id, sessionId: 'session-1', role: 'agent', ts: 100, payload,
})

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-conversation-export-'))
  store = new CanonicalSessionStore(path.join(root, 'canonical'), 'daemon-1')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('offline conversation export candidate', () => {
  it('exports a fixed snapshot, then catches up an active session without changing IDs', () => {
    store.append('session-1', message('user-1', 'first'))
    store.append('session-1', message('native-tool-1', JSON.stringify({
      v: 1, type: 'tool', toolCallId: 'native:tool:1', status: 'running',
    })))
    const start = beginConversationExport(store, 'session-1')
    expect(start).toMatchObject({ snapshotRevision: 2, auditHash: CONVERSATION_EXPORT_GENESIS_HASH })
    store.upsert('session-1', message('native-tool-1', JSON.stringify({
      v: 1, type: 'tool', toolCallId: 'native:tool:1', status: 'completed',
    })))
    store.tombstone('session-1', 'user-1')

    const first = readConversationExportPage(store, start, 1)
    expect(first.batch).toMatchObject({ sessionId: 'session-1', fromRevision: 0 })
    expect(first.items.map((item) => item.revision)).toEqual([1])
    expect(readConversationExportPage(store, start, 1)).toEqual(first) // lost receipt retry
    const second = readConversationExportPage(store, first.nextCursor, 1)
    expect(second.items.map((item) => item.revision)).toEqual([2])
    expect(second.nextCursor.phase).toBe('catchup')
    const reopened = new CanonicalSessionStore(path.join(root, 'canonical'), 'daemon-1')
    const caught = readConversationExportPage(reopened, second.nextCursor, 10)
    expect(caught.items.map((item) => [item.revision, item.sequence, item.mutation.mutation]))
      .toEqual([[3, 2, 'upsert'], [4, 1, 'tombstone']])
    expect(caught.nextCursor.auditHash).toMatch(/^[a-f0-9]{64}$/)
    let expectedAuditHash = CONVERSATION_EXPORT_GENESIS_HASH
    for (const item of [...first.items, ...second.items, ...caught.items]) {
      expectedAuditHash = createHash('sha256').update(
        `${expectedAuditHash}\0${item.mutationId}\0${item.contentHash}`,
      ).digest('hex')
    }
    expect(caught.nextCursor.auditHash).toBe(expectedAuditHash)
    expect(() => assertConversationCutoverFence(store, caught.nextCursor, 4, false)).toThrow()
    expect(assertConversationCutoverFence(store, caught.nextCursor, 4, true))
      .toMatchObject({ revision: 4, lastMutationHash: caught.items[1]?.mutationHash })
    store.append('session-1', message('new', 'after fence'))
    expect(() => assertConversationCutoverFence(store, caught.nextCursor, 4, true))
      .toThrow('cutover revision changed')
  })

  it('rejects a corrupted mutation and a cursor from another daemon', () => {
    store.append('session-1', message('m1', 'body'))
    const cursor = beginConversationExport(store, 'session-1')
    expect(() => readConversationExportPage(store, { ...cursor, daemonInstallationId: 'other' }, 10))
      .toThrow('invalid export cursor')
    const corrupt = {
      daemonInstallationId: store.daemonInstallationId,
      getManifest: store.getManifest.bind(store),
      readDeltas: () => [{ ...store.readDeltas('session-1', 0, 1)[0]!, contentHash: 'bad' }],
    }
    expect(() => readConversationExportPage(corrupt, cursor, 10))
      .toThrow('content hash mismatch')
  })

  it('preserves a tombstoned snapshot and catches a later commit', () => {
    store.append('session-1', message('m1', 'body'))
    store.tombstone('session-1', 'm1')
    const cursor = beginConversationExport(store, 'session-1')
    const snapshot = readConversationExportPage(store, cursor, 50)
    expect(snapshot.nextCursor.phase).toBe('catchup')
    expect(readConversationExportPage(store, snapshot.nextCursor, 50).items).toEqual([])
    store.append('session-1', message('m2', 'later'))
    expect(readConversationExportPage(store, snapshot.nextCursor, 50).items.map((item) => item.revision))
      .toEqual([3])
  })
})

// @covers src/session/history-subscriptions.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanonicalSessionStore, type CanonicalMutation } from '../session/canonical-store.js'
import {
  PERSONAL_HISTORY_DELTA_BATCH_MAX_MUTATIONS,
  PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS,
  PersonalHistorySubscriptions,
} from '../session/history-subscriptions.js'
import { getPersonalSyncIdentity } from '../personal-sync/epoch.js'
import { SESSION_HISTORY_LIMITS } from '@shennian/wire'

let rootDir: string
let store: CanonicalSessionStore
let client: { sendRes: ReturnType<typeof vi.fn>; sendEvent: ReturnType<typeof vi.fn> }

function message(id: string, ts: number, payload = id) {
  return { id, sessionId: 'session-1', role: 'user' as const, ts, payload }
}
function request(id: string, method: 'session.history.open' | 'session.history.sync' | 'session.history.page' | 'session.history.close' | 'session.body.replica.subscribe' | 'session.body.replica.unsubscribe', params: Record<string, unknown>) {
  return { type: 'req' as const, id, method, params: { ...getPersonalSyncIdentity(), ...params } }
}

describe('personal canonical history subscriptions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-subscription-'))
    store = new CanonicalSessionStore(rootDir, 'daemon-test')
    client = { sendRes: vi.fn(), sendEvent: vi.fn() }
  })
  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(rootDir, { recursive: true, force: true })
  })

  it('rejects stale server metadata when no local canonical session exists', () => {
    const history = new PersonalHistorySubscriptions(client as never, store, () => false)

    expect(() => history.handleOpen(request('open-stale', 'session.history.open', {
      sessionId: 'stale-server-only', subscriptionId: 'subscription-stale', limit: 100,
    }))).toThrow('history_unavailable')
    expect(client.sendRes).not.toHaveBeenCalled()
    history.closeAll()
  })

  it('allows a locally known new session to open before its first message', () => {
    const history = new PersonalHistorySubscriptions(client as never, store, (sessionId) =>
      sessionId === 'new-empty-session')

    history.handleOpen(request('open-empty', 'session.history.open', {
      sessionId: 'new-empty-session', subscriptionId: 'subscription-empty', limit: 100,
    }))
    expect(client.sendRes).toHaveBeenCalledWith(expect.objectContaining({
      id: 'open-empty', ok: true,
      payload: expect.objectContaining({ snapshotRevision: 0, messages: [] }),
    }))
    history.closeAll()
  })

  it('serves resumable one-shot mutation pages without creating a subscription', () => {
    for (let index = 1; index <= 5; index++) {
      store.append('session-1', message(`message-${index}`, index))
    }
    const history = new PersonalHistorySubscriptions(client as never, store, () => true)

    history.handleSync(request('sync-1', 'session.history.sync', {
      sessionId: 'session-1', syncId: 'replica-1', afterRevision: 0, limit: 2,
    }))
    expect(client.sendRes).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'sync-1', ok: true,
      payload: expect.objectContaining({
        syncId: 'replica-1', fromRevision: 0, toRevision: 2,
        targetRevision: 5, hasMore: true,
        mutations: [
          expect.objectContaining({ revision: 1, subscriptionId: 'replica-1' }),
          expect.objectContaining({ revision: 2, subscriptionId: 'replica-1' }),
        ],
      }),
    }))

    history.handleSync(request('sync-2', 'session.history.sync', {
      sessionId: 'session-1', syncId: 'replica-2', afterRevision: 2, limit: 3,
    }))
    expect(client.sendRes).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'sync-2', ok: true,
      payload: expect.objectContaining({
        fromRevision: 2, toRevision: 5, targetRevision: 5, hasMore: false,
      }),
    }))
    expect(client.sendEvent).not.toHaveBeenCalled()
    history.closeAll()
  })

  it('returns an empty completed page for an empty or already-current session', () => {
    const history = new PersonalHistorySubscriptions(client as never, store, (sessionId) =>
      sessionId === 'new-empty-session')

    history.handleSync(request('sync-empty', 'session.history.sync', {
      sessionId: 'new-empty-session', syncId: 'replica-empty', afterRevision: 0,
    }))
    expect(client.sendRes).toHaveBeenLastCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        fromRevision: 0, toRevision: 0, targetRevision: 0,
        hasMore: false, mutations: [],
      }),
    }))

    expect(() => history.handleSync(request('sync-ahead', 'session.history.sync', {
      sessionId: 'new-empty-session', syncId: 'replica-ahead', afterRevision: 1,
    }))).toThrow('revision_gap')
    history.closeAll()
  })

  it('subscribes once for the daemon and batches commits from every session', () => {
    store.append('session-1', message('message-1', 1))
    store.append('session-2', { ...message('message-2', 2), sessionId: 'session-2' })
    const history = new PersonalHistorySubscriptions(client as never, store, () => true)

    history.handleReplicaSubscribe(request('subscribe-replica', 'session.body.replica.subscribe', {
      appInstallationId: 'installation-1', streamId: 'installation-1:machine-1', generation: 1,
    }))
    expect(client.sendRes).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'subscribe-replica', ok: true,
      payload: expect.objectContaining({
        streamId: 'installation-1:machine-1', generation: 1,
        appInstallationId: 'installation-1',
        highWatermarks: [
          { sessionId: 'session-1', bodyRevision: 1 },
          { sessionId: 'session-2', bodyRevision: 1 },
        ],
      }),
    }))

    store.append('session-1', message('message-3', 3))
    store.append('session-2', { ...message('message-4', 4), sessionId: 'session-2' })
    vi.advanceTimersByTime(PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS)
    expect(client.sendEvent).toHaveBeenCalledOnce()
    expect(client.sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'session.body.replica.delta',
      payload: expect.objectContaining({
        streamId: 'installation-1:machine-1', generation: 1,
        batches: [
          expect.objectContaining({ sessionId: 'session-1', fromRevision: 1, toRevision: 2 }),
          expect.objectContaining({ sessionId: 'session-2', fromRevision: 1, toRevision: 2 }),
        ],
      }),
    }))

    history.handleReplicaUnsubscribe(request(
      'unsubscribe-replica', 'session.body.replica.unsubscribe',
      { appInstallationId: 'installation-1', streamId: 'installation-1:machine-1', generation: 1 },
    ))
    client.sendEvent.mockClear()
    store.append('session-1', message('message-5', 5))
    vi.advanceTimersByTime(PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS)
    expect(client.sendEvent).not.toHaveBeenCalled()
    history.closeAll()
  })

  it('ignores a late unsubscribe from the coordinator generation it replaced', () => {
    store.append('session-1', message('message-1', 1))
    const history = new PersonalHistorySubscriptions(client as never, store, () => true)
    const base = {
      appInstallationId: 'installation-1', streamId: 'installation-1:machine-1',
    }
    history.handleReplicaSubscribe(request(
      'subscribe-old', 'session.body.replica.subscribe', { ...base, generation: 100 },
    ))
    history.handleReplicaSubscribe(request(
      'subscribe-new', 'session.body.replica.subscribe', { ...base, generation: 101 },
    ))

    history.handleReplicaUnsubscribe(request(
      'unsubscribe-old', 'session.body.replica.unsubscribe', { ...base, generation: 100 },
    ))
    client.sendEvent.mockClear()
    store.append('session-1', message('message-2', 2))
    vi.advanceTimersByTime(PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS)

    expect(client.sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'session.body.replica.delta',
      payload: expect.objectContaining({ generation: 101 }),
    }))
    history.closeAll()
  })

  it('registers the machine replica stream before capturing all high-water marks', () => {
    const listeners = new Set<(mutation: CanonicalMutation) => void>()
    const mutation = {
      ...getPersonalSyncIdentity('daemon-test'),
      schemaVersion: 1, mutationId: 'replica-race-3', sessionId: 'session-1', revision: 3,
      mutation: 'append', messageId: 'message-3', sequence: 3, message: message('message-3', 3),
      committedAt: new Date(3).toISOString(), contentHash: 'hash-3',
    } satisfies CanonicalMutation
    const raceStore = {
      daemonInstallationId: 'daemon-test',
      subscribe: (listener: (value: CanonicalMutation) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      listSessionIds: () => {
        for (const listener of listeners) listener(mutation)
        return ['session-1']
      },
      getManifest: () => ({ bodyRevision: 2 }),
    }
    const history = new PersonalHistorySubscriptions(client as never, raceStore as never, () => true)

    history.handleReplicaSubscribe(request('subscribe-race', 'session.body.replica.subscribe', {
      appInstallationId: 'installation-1', streamId: 'installation-1:machine-1', generation: 1,
    }))
    vi.advanceTimersByTime(PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS)

    expect(client.sendRes.mock.invocationCallOrder[0]).toBeLessThan(client.sendEvent.mock.invocationCallOrder[0]!)
    expect(client.sendRes).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        highWatermarks: [{ sessionId: 'session-1', bodyRevision: 2 }],
      }),
    }))
    expect(client.sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'session.body.replica.delta',
      payload: expect.objectContaining({
        batches: [expect.objectContaining({ sessionId: 'session-1', fromRevision: 2, toRevision: 3 })],
      }),
    }))
    history.closeAll()
  })

  it('returns a bounded snapshot then emits only newer canonical revisions', () => {
    store.append('session-1', message('message-1', 1))
    store.append('session-1', message('message-2', 2))
    const history = new PersonalHistorySubscriptions(client as never, store, () => true)

    history.handleOpen(request('open-1', 'session.history.open', {
      sessionId: 'session-1', subscriptionId: 'subscription-1', limit: 100,
    }))
    expect(client.sendRes).toHaveBeenCalledWith(expect.objectContaining({
      id: 'open-1', ok: true,
      payload: expect.objectContaining({ snapshotRevision: 2, messages: [
        expect.objectContaining({ sequence: 1, message: expect.objectContaining({ id: 'message-1' }) }),
        expect.objectContaining({ sequence: 2, message: expect.objectContaining({ id: 'message-2' }) }),
      ] }),
    }))

    store.append('session-1', message('message-3', 3))
    vi.advanceTimersByTime(PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS)
    expect(client.sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'session.body.delta',
      payload: expect.objectContaining({
        subscriptionId: 'subscription-1', fromRevision: 2, toRevision: 3,
        mutations: [expect.objectContaining({ messageId: 'message-3', revision: 3 })],
      }),
    }))

    history.handleClose(request('close-1', 'session.history.close', {
      sessionId: 'session-1', subscriptionId: 'subscription-1',
    }))
    history.handleClose(request('close-duplicate', 'session.history.close', {
      sessionId: 'session-1', subscriptionId: 'subscription-1',
    }))
    expect(client.sendRes).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'close-duplicate', ok: true,
    }))
    client.sendEvent.mockClear()
    store.append('session-1', message('message-4', 4))
    expect(client.sendEvent).not.toHaveBeenCalled()
    history.closeAll()
  })

  it('returns a structured retryable rejection when one session reaches its subscription limit', () => {
    store.append('session-1', message('message-1', 1))
    const history = new PersonalHistorySubscriptions(client as never, store, () => true)
    for (let index = 0; index < SESSION_HISTORY_LIMITS.maxSubscriptionsPerSession; index++) {
      history.handleOpen(request(`open-${index}`, 'session.history.open', {
        sessionId: 'session-1', subscriptionId: `subscription-${index}`, limit: 100,
      }))
    }
    client.sendRes.mockClear()

    history.handleOpen(request('open-over-limit', 'session.history.open', {
      sessionId: 'session-1', subscriptionId: 'subscription-over-limit', limit: 100,
    }))

    expect(client.sendRes).toHaveBeenCalledOnce()
    expect(client.sendRes).toHaveBeenCalledWith(expect.objectContaining({
      id: 'open-over-limit',
      ok: false,
      error: 'subscription_limit_exceeded',
      rejection: {
        code: 'subscription_limit_exceeded',
        retryable: true,
        requiredAction: 'retry',
      },
    }))
    history.closeAll()
  })

  it('projects queued and executing as revisions of one message in one subscription', () => {
    const userMessage = message('client-message-1', 1, 'queued prompt')
    store.commit({
      sessionId: 'session-1', mutation: 'append', messageId: userMessage.id,
      message: userMessage, deliveryState: 'queued',
    })
    const history = new PersonalHistorySubscriptions(client as never, store, () => true)

    history.handleOpen(request('open-queued', 'session.history.open', {
      sessionId: 'session-1', subscriptionId: 'subscription-queued', limit: 100,
    }))
    expect(client.sendRes).toHaveBeenLastCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        snapshotRevision: 1,
        messages: [expect.objectContaining({
          sequence: 1, revision: 1, deliveryState: 'queued',
          message: expect.objectContaining({ id: 'client-message-1' }),
        })],
      }),
    }))

    client.sendEvent.mockClear()
    store.commit({
      sessionId: 'session-1', mutation: 'upsert', messageId: userMessage.id,
      message: userMessage, deliveryState: 'executing',
    })
    vi.advanceTimersByTime(PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS)
    expect(client.sendEvent).toHaveBeenCalledOnce()
    expect(client.sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'session.body.delta',
      payload: expect.objectContaining({
        fromRevision: 1,
        toRevision: 2,
        mutations: [expect.objectContaining({
          mutation: 'upsert',
          messageId: 'client-message-1',
          sequence: 1,
          deliveryState: 'executing',
        })],
      }),
    }))
    expect(store.readPage('session-1', { limit: 100 }).entries).toEqual([
      expect.objectContaining({
        sequence: 1,
        revision: 2,
        deliveryState: 'executing',
        message: expect.objectContaining({ id: 'client-message-1' }),
      }),
    ])
    history.closeAll()
  })

  it('registers before reading the snapshot and filters buffered revisions at its high-water mark', () => {
    const listeners = new Set<(mutation: CanonicalMutation) => void>()
    const mutation = {
      ...getPersonalSyncIdentity(),
      schemaVersion: 1, mutationId: 'mutation-3', sessionId: 'session-1', revision: 3,
      mutation: 'append', messageId: 'message-3', sequence: 3, message: message('message-3', 3),
      committedAt: new Date(3).toISOString(), contentHash: 'hash-3',
    } satisfies CanonicalMutation
    const raceStore = {
      subscribe: (listener: (value: CanonicalMutation) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      readPage: () => {
        for (const listener of listeners) listener(mutation)
        return {
          bodyRevision: 2, firstAvailableSeq: 1, lastAvailableSeq: 2,
          hasOlder: false, messages: [message('message-2', 2)],
          entries: [{ sequence: 2, revision: 2, message: message('message-2', 2) }],
        }
      },
    }
    const history = new PersonalHistorySubscriptions(client as never, raceStore as never, () => true)
    history.handleOpen(request('open-race', 'session.history.open', {
      sessionId: 'session-1', subscriptionId: 'subscription-race',
    }))
    vi.advanceTimersByTime(PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS)

    expect(client.sendRes.mock.invocationCallOrder[0]).toBeLessThan(client.sendEvent.mock.invocationCallOrder[0]!)
    expect(client.sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ fromRevision: 2, toRevision: 3 }),
    }))
    history.closeAll()
  })

  it('drains a burst committed during snapshot capture without a revision gap', () => {
    const listeners = new Set<(mutation: CanonicalMutation) => void>()
    const burst = Array.from({ length: 128 }, (_, offset) => {
      const revision = offset + 3
      return {
        ...getPersonalSyncIdentity(),
        schemaVersion: 1, mutationId: `mutation-${revision}`, sessionId: 'session-1', revision,
        mutation: 'append', messageId: `message-${revision}`, sequence: revision,
        message: message(`message-${revision}`, revision),
        committedAt: new Date(revision).toISOString(), contentHash: `hash-${revision}`,
      } satisfies CanonicalMutation
    })
    const raceStore = {
      subscribe: (listener: (value: CanonicalMutation) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      readPage: () => {
        for (const mutation of burst) {
          for (const listener of listeners) listener(mutation)
        }
        return {
          bodyRevision: 2, firstAvailableSeq: 1, lastAvailableSeq: 2,
          hasOlder: false, messages: [message('message-2', 2)],
          entries: [{ sequence: 2, revision: 2, message: message('message-2', 2) }],
        }
      },
    }
    const history = new PersonalHistorySubscriptions(client as never, raceStore as never, () => true)
    history.handleOpen(request('open-burst', 'session.history.open', {
      sessionId: 'session-1', subscriptionId: 'subscription-burst',
    }))
    vi.advanceTimersByTime(PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS)

    const ranges = client.sendEvent.mock.calls.map(([frame]) => {
      const payload = frame.payload as { fromRevision: number; toRevision: number }
      return [payload.fromRevision, payload.toRevision]
    })
    expect(ranges).toEqual([[2, 130]])
    expect((client.sendEvent.mock.calls[0]![0].payload as { mutations: unknown[] }).mutations)
      .toHaveLength(128)
    history.closeAll()
  })

  it('pages older messages only for an existing matching subscription', () => {
    for (let index = 1; index <= 4; index++) store.append('session-1', message(`message-${index}`, index))
    const history = new PersonalHistorySubscriptions(client as never, store, () => true)
    history.handleOpen(request('open-page', 'session.history.open', {
      sessionId: 'session-1', subscriptionId: 'subscription-page', limit: 2,
    }))
    store.tombstone('session-1', 'message-2')
    history.handlePage(request('page-1', 'session.history.page', {
      sessionId: 'session-1', subscriptionId: 'subscription-page', beforeSequence: 3, limit: 2,
    }))
    expect(client.sendRes).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'page-1', ok: true,
      payload: expect.objectContaining({ snapshotRevision: 4, messages: [
        expect.objectContaining({ sequence: 1, message: expect.objectContaining({ id: 'message-1' }) }),
        expect.objectContaining({ sequence: 2, message: expect.objectContaining({ id: 'message-2' }) }),
      ] }),
    }))
    expect(() => history.handlePage(request('wrong', 'session.history.page', {
      sessionId: 'other-session', subscriptionId: 'subscription-page', beforeSequence: 3,
    }))).toThrow('subscription_not_found')
    history.closeAll()
  })

  it('fans one canonical commit to independent subscribers without coupling their lifecycle', () => {
    const history = new PersonalHistorySubscriptions(client as never, store, () => true)
    history.handleOpen(request('open-a', 'session.history.open', {
      sessionId: 'session-1', subscriptionId: 'subscription-a',
    }))
    history.handleOpen(request('open-b', 'session.history.open', {
      sessionId: 'session-1', subscriptionId: 'subscription-b',
    }))
    client.sendEvent.mockClear()

    store.append('session-1', message('shared-message', 1))
    vi.advanceTimersByTime(PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS)
    expect(client.sendEvent).toHaveBeenCalledTimes(2)
    expect(client.sendEvent.mock.calls.map(([frame]) => frame.payload.subscriptionId).sort())
      .toEqual(['subscription-a', 'subscription-b'])

    history.handleClose(request('close-a', 'session.history.close', {
      sessionId: 'session-1', subscriptionId: 'subscription-a',
    }))
    client.sendEvent.mockClear()
    store.append('session-1', message('still-live', 2))
    vi.advanceTimersByTime(PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS)
    expect(client.sendEvent).toHaveBeenCalledOnce()
    expect(client.sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ subscriptionId: 'subscription-b' }),
    }))
    history.closeAll()
  })

  it('flushes at the wire mutation capacity without waiting for the timer', () => {
    const seed = store.append('session-1', message('seed', 0)).mutation
    const history = new PersonalHistorySubscriptions(client as never, store, () => true)
    history.handleOpen(request('open-capacity', 'session.history.open', {
      sessionId: 'session-1', subscriptionId: 'subscription-capacity',
    }))
    client.sendEvent.mockClear()

    const receiveMutation = (history as unknown as {
      handleMutation: (mutation: CanonicalMutation) => void
    }).handleMutation.bind(history)
    for (let index = 1; index <= PERSONAL_HISTORY_DELTA_BATCH_MAX_MUTATIONS; index++) {
      receiveMutation({
        ...seed,
        revision: index + 1,
        sequence: index + 1,
        messageId: `capacity-${index}`,
        mutationId: `capacity-mutation-${index}`,
        message: message(`capacity-${index}`, index),
      })
    }

    expect(client.sendEvent).toHaveBeenCalledOnce()
    expect(client.sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        fromRevision: 1,
        toRevision: PERSONAL_HISTORY_DELTA_BATCH_MAX_MUTATIONS + 1,
      }),
    }))
    expect((client.sendEvent.mock.calls[0]![0].payload as { mutations: unknown[] }).mutations)
      .toHaveLength(PERSONAL_HISTORY_DELTA_BATCH_MAX_MUTATIONS)
    history.closeAll()
  })

  it('flushes a pending short batch before closing the subscription', () => {
    const history = new PersonalHistorySubscriptions(client as never, store, () => true)
    history.handleOpen(request('open-close-flush', 'session.history.open', {
      sessionId: 'session-1', subscriptionId: 'subscription-close-flush',
    }))
    client.sendEvent.mockClear()
    store.append('session-1', message('before-close', 1))

    history.handleClose(request('close-flush', 'session.history.close', {
      sessionId: 'session-1', subscriptionId: 'subscription-close-flush',
    }))

    expect(client.sendEvent).toHaveBeenCalledOnce()
    expect(client.sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ fromRevision: 0, toRevision: 1 }),
    }))
    history.closeAll()
  })

  it('flushes before a batch can exceed the Relay frame byte limit', () => {
    const seed = store.append('session-1', message('seed', 0)).mutation
    const history = new PersonalHistorySubscriptions(client as never, store, () => true)
    history.handleOpen(request('open-byte-limit', 'session.history.open', {
      sessionId: 'session-1', subscriptionId: 'subscription-byte-limit',
    }))
    client.sendEvent.mockClear()
    const receiveMutation = (history as unknown as {
      handleMutation: (mutation: CanonicalMutation) => void
    }).handleMutation.bind(history)
    const payload = 'x'.repeat(130 * 1024)

    for (const revision of [2, 3]) {
      receiveMutation({
        ...seed,
        revision,
        sequence: revision,
        messageId: `large-${revision}`,
        mutationId: `large-mutation-${revision}`,
        message: message(`large-${revision}`, revision, payload),
      })
    }

    expect(client.sendEvent).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS)
    expect(client.sendEvent.mock.calls.map(([frame]) => [
      frame.payload.fromRevision,
      frame.payload.toRevision,
    ])).toEqual([[1, 2], [2, 3]])
    history.closeAll()
  })
})

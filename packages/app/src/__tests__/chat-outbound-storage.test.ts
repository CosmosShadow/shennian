// @arch docs/architecture/app/chat-draft-storage.md#4.-待确认消息（outbound）
// @covers packages/app/src/features/chat/utils/outboundStorage.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'shennian:chatOutboundMessages:v2'
const ACCOUNT_ID = 'account-a'

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function importWebStorage() {
  const values = new Map<string, string>()
  vi.doMock('react-native', () => ({ Platform: { OS: 'web' } }))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
  return {
    module: await import('../features/chat/utils/outboundStorage'),
    values,
  }
}

describe('chat outbound storage', () => {
  it('publishes list preview updates and returns the latest sending message', async () => {
    const { module } = await importWebStorage()
    const listener = vi.fn()
    const unsubscribe = module.subscribeChatOutboundMessages(listener)
    const now = Date.now()

    module.saveChatOutboundMessage(ACCOUNT_ID, 'session-1', {
      id: 'user-1',
      role: 'user',
      ts: now,
      content: 'first',
      status: 'sending',
    })
    module.saveChatOutboundMessage(ACCOUNT_ID, 'session-1', {
      id: 'user-2',
      role: 'user',
      ts: now + 1,
      content: 'second',
      status: 'sending',
    })

    expect(module.getLatestSendingChatOutboundPreview(ACCOUNT_ID, 'session-1')).toBe('second')
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('persists a pending message across module reloads', async () => {
    const first = await importWebStorage()
    const message = {
      id: 'user-1',
      role: 'user' as const,
      ts: Date.now(),
      content: 'do not disappear',
      status: 'sending' as const,
      attachments: [
        {
          path: '/tmp/.uploads/shot.png',
          name: 'shot.png',
          mimeType: 'image/png',
          kind: 'image' as const,
          byteSize: 123,
          sha256: 'a'.repeat(64),
          previewData: 'large-preview-must-not-be-persisted',
        },
      ],
    }
    first.module.saveChatOutboundMessage(ACCOUNT_ID, 'session-1', message)

    expect(JSON.parse(first.values.get(STORAGE_KEY) ?? '{}')).toMatchObject({
      [ACCOUNT_ID]: {
        'session-1': [{ id: 'user-1', content: 'do not disappear', status: 'sending' }],
      },
    })
    expect(first.values.get(STORAGE_KEY)).not.toContain('large-preview-must-not-be-persisted')

    expect(first.module.getChatOutboundMessages(ACCOUNT_ID, 'session-1')).toEqual([
      {
        ...message,
        clientMessageId: 'user-1',
        messageId: null,
        deliveryState: 'sending',
        bodyRevision: null,
        lastAttemptAt: new Date(message.ts).toISOString(),
        attachments: [
          {
            path: '/tmp/.uploads/shot.png',
            name: 'shot.png',
            mimeType: 'image/png',
            kind: 'image',
            byteSize: 123,
            sha256: 'a'.repeat(64),
          },
        ],
      },
    ])
  })

  it('keeps a disconnected send as a distinct local pending delivery', async () => {
    const { module } = await importWebStorage()
    module.saveChatOutboundMessage(ACCOUNT_ID, 'session-1', {
      id: 'local-1',
      role: 'user',
      ts: Date.now(),
      content: 'send after reconnecting',
      status: 'sending',
    }, { deliveryState: 'local_pending' })

    expect(module.getChatOutboundMessages(ACCOUNT_ID, 'session-1')).toEqual([
      expect.objectContaining({
        id: 'local-1',
        deliveryState: 'local_pending',
        clientMessageId: 'local-1',
        messageId: null,
      }),
    ])
  })

  it('persists the daemon ACK fields required for restart recovery', async () => {
    const { module } = await importWebStorage()
    const message = {
      id: 'client-1', role: 'user' as const, ts: Date.now(), content: 'queued',
      status: 'sending' as const,
    }
    module.saveChatOutboundMessage(ACCOUNT_ID, 'session-1', message)
    module.saveChatOutboundAck(ACCOUNT_ID, 'session-1', message, {
      protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
      sessionId: 'session-1', clientMessageId: 'client-1', messageId: 'message-1',
      deliveryState: 'queued', bodyRevision: 9,
      committedAt: '2026-09-01T12:00:00.000Z',
    })

    expect(module.getChatOutboundMessages(ACCOUNT_ID, 'session-1')).toEqual([
      expect.objectContaining({
        clientMessageId: 'client-1', messageId: 'message-1',
        deliveryState: 'queued', bodyRevision: 9,
        lastAttemptAt: expect.any(String),
      }),
    ])
  })

  it('removes only messages confirmed by transcript ids', async () => {
    const { module } = await importWebStorage()
    const now = Date.now()
    module.saveChatOutboundMessage(ACCOUNT_ID, 'session-1', {
      id: 'user-1',
      role: 'user',
      ts: now,
      content: 'confirmed',
      status: 'sent',
    })
    module.saveChatOutboundMessage(ACCOUNT_ID, 'session-1', {
      id: 'user-2',
      role: 'user',
      ts: now + 1,
      content: 'still pending',
      status: 'uncertain',
    })

    module.removeConfirmedChatOutboundMessages(ACCOUNT_ID, 'session-1', ['user-1'])

    expect(module.getChatOutboundMessages(ACCOUNT_ID, 'session-1').map((message) => message.id)).toEqual([
      'user-2',
    ])
  })

  it('isolates equal session ids by account and clears only one account', async () => {
    const { module } = await importWebStorage()
    const message = (id: string, content: string) => ({
      id, role: 'user' as const, ts: Date.now(), content, status: 'sending' as const,
    })
    module.saveChatOutboundMessage('account-a', 'same-session', message('a', 'A'))
    module.saveChatOutboundMessage('account-b', 'same-session', message('b', 'B'))

    expect(module.getChatOutboundMessages('account-a', 'same-session')[0]?.content).toBe('A')
    expect(module.getChatOutboundMessages('account-b', 'same-session')[0]?.content).toBe('B')

    module.clearChatOutboundAccount('account-a')
    expect(module.getChatOutboundMessages('account-a', 'same-session')).toEqual([])
    expect(module.getChatOutboundMessages('account-b', 'same-session')[0]?.content).toBe('B')
  })

  it('rejects a late durable ACK after the session deletion barrier is installed', async () => {
    const { module } = await importWebStorage()
    const message = {
      id: 'client-late', role: 'user' as const, ts: Date.now(), content: 'late',
      status: 'sending' as const,
    }
    module.saveChatOutboundMessage(ACCOUNT_ID, 'deleted-session', message)
    module.removeChatOutboundSession(ACCOUNT_ID, 'deleted-session')
    module.markChatOutboundSessionDeleted('deleted-session')

    module.saveChatOutboundAck(ACCOUNT_ID, 'deleted-session', message, {
      protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
      sessionId: 'deleted-session', clientMessageId: 'client-late', messageId: 'message-late',
      deliveryState: 'queued', bodyRevision: 3,
      committedAt: '2026-09-03T00:00:00.000Z',
    })

    expect(module.getChatOutboundMessages(ACCOUNT_ID, 'deleted-session')).toEqual([])
  })
})

// @covers src/features/chat/services/chatOutboundReconciler.ts
async function recoveryFixture() {
  const { module } = await importWebStorage()
  const { ChatOutboundReconciler } = await import('../features/chat/services/chatOutboundReconciler')
  const committed = new Map<string, string[]>()
  const listeners = new Map<string, () => void>()
  const queryStatus = vi.fn(async (sessionId: string, message: { clientMessageId: string }) => ({
    protocolVersion: 2 as const, dataEpoch: 2 as const, daemonInstallationId: 'daemon-1',
    sessionId, clientMessageId: message.clientMessageId, messageId: message.clientMessageId,
    state: 'queued' as const, deliveryState: 'queued' as const, bodyRevision: 9,
    committedAt: new Date().toISOString(),
  }))
  const getMessages = vi.fn(async (_account: string, sessionId: string, options?: { messageIds?: string[] }) =>
    (committed.get(sessionId) ?? []).filter((id) => options?.messageIds?.includes(id)).map((id) => ({
      id, sessionId, role: 'user' as const, ts: Date.now(), payload: 'canonical',
    })),
  )
  const save = (id = 'user-1', sessionId = 'session-1') => {
    const message = { id, role: 'user' as const, ts: Date.now(), content: id, status: 'sending' as const }
    module.saveChatOutboundMessage(ACCOUNT_ID, sessionId, message)
    return message
  }
  let active = true
  const start = () => new ChatOutboundReconciler({
    accountId: ACCOUNT_ID, queryStatus, isActive: () => active,
    store: { getMessages, subscribe: (_account, id, listener) => {
      listeners.set(id, () => listener({} as never))
      return () => { listeners.delete(id) }
    } },
  })
  return { module, committed, listeners, queryStatus, getMessages, save, start, deactivate: () => { active = false } }
}

describe('App-owned outbound reconciliation without a mounted chat', () => {
  it('recovers queued ACKs offscreen, then removes the record on canonical commit', async () => {
    const f = await recoveryFixture()
    f.save()
    const recovery = f.start()
    try {
      await recovery.request()
      expect(f.module.getLatestSendingChatOutboundPreview(ACCOUNT_ID, 'session-1')).toBe('')
      expect(f.module.getChatOutboundMessages(ACCOUNT_ID, 'session-1')[0].deliveryState).toBe('queued')
      f.committed.set('session-1', ['user-1'])
      f.listeners.get('session-1')?.()
      await vi.waitFor(() => expect(f.module.getChatOutboundMessages(ACCOUNT_ID, 'session-1')).toEqual([]))
    } finally { recovery.stop() }
  })

  it('repairs persisted stale records on startup and keeps other messages/accounts', async () => {
    const f = await recoveryFixture()
    const message = f.save()
    f.save('user-2')
    f.module.saveChatOutboundMessage('other-account', 'session-1', message)
    f.committed.set('session-1', ['user-1'])
    const recovery = f.start()
    try {
      await recovery.request()
      expect(f.module.getChatOutboundMessages(ACCOUNT_ID, 'session-1').map((m) => m.id)).toEqual(['user-2'])
      expect(f.module.getChatOutboundMessages('other-account', 'session-1')).toHaveLength(1)
      expect(f.queryStatus).toHaveBeenCalledTimes(1)
      expect(f.getMessages).toHaveBeenCalledWith(ACCOUNT_ID, 'session-1', { messageIds: ['user-1', 'user-2'] })
    } finally { recovery.stop() }
  })

  it('does not resurrect a canonical record from a delayed status response or send ACK', async () => {
    const f = await recoveryFixture()
    const message = f.save()
    const ack = await f.queryStatus('session-1', { clientMessageId: 'user-1' })
    let resolve!: (value: typeof ack) => void
    f.queryStatus.mockImplementation(() => new Promise((done) => { resolve = done }))
    const recovery = f.start()
    try {
      const pending = recovery.request()
      await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
      f.committed.set('session-1', ['user-1'])
      f.listeners.get('session-1')?.()
      await vi.waitFor(() => expect(f.module.getChatOutboundMessages(ACCOUNT_ID, 'session-1')).toEqual([]))
      resolve(ack)
      await pending
      f.module.saveChatOutboundAck(ACCOUNT_ID, 'session-1', message, ack)
      expect(f.module.getChatOutboundMessages(ACCOUNT_ID, 'session-1')).toEqual([])
    } finally { recovery.stop() }
  })

  it('matches authoritative message IDs even when different from client IDs', async () => {
    const f = await recoveryFixture()
    const message = f.save()
    const ack = await f.queryStatus('session-1', { clientMessageId: 'user-1' })
    f.module.saveChatOutboundAck(ACCOUNT_ID, 'session-1', message, { ...ack, messageId: 'canonical-1' })
    f.committed.set('session-1', ['canonical-1'])
    const recovery = f.start()
    try {
      await recovery.request()
      expect(f.module.getChatOutboundMessages(ACCOUNT_ID, 'session-1')).toEqual([])
    } finally { recovery.stop() }
  })

  it('backs off failed queries, retains pending messages and never submits local-only sends', async () => {
    vi.useFakeTimers()
    const f = await recoveryFixture()
    f.save()
    const local = f.save('local-1', 'session-2')
    f.module.saveChatOutboundMessage(ACCOUNT_ID, 'session-2', local, { deliveryState: 'local_pending' })
    f.queryStatus.mockRejectedValue(new Error('offline'))
    const recovery = f.start()
    try {
      await recovery.request()
      await recovery.request()
      expect(f.queryStatus).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(f.queryStatus).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(f.queryStatus).toHaveBeenCalledTimes(2)
      expect(f.module.getLatestSendingChatOutboundPreview(ACCOUNT_ID, 'session-1')).toBe('user-1')
      expect(f.module.getLatestSendingChatOutboundPreview(ACCOUNT_ID, 'session-2')).toBe('local-1')
      f.deactivate()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(f.queryStatus).toHaveBeenCalledTimes(2)
    } finally { recovery.stop() }
  })
})


describe('outbound recovery failure boundaries', () => {
  it('keeps not-found results uncertain rather than declaring success or dropping content', async () => {
    const f = await recoveryFixture()
    f.save()
    f.queryStatus.mockResolvedValue({
      state: 'not_found', sessionId: 'session-1', clientMessageId: 'user-1',
      protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
    } as never)
    const recovery = f.start()
    try {
      await recovery.request()
      expect(f.module.getChatOutboundMessages(ACCOUNT_ID, 'session-1')[0]).toMatchObject({
        status: 'uncertain', deliveryState: 'unconfirmed', content: 'user-1',
      })
      expect(f.module.getLatestSendingChatOutboundPreview(ACCOUNT_ID, 'session-1')).toBe('user-1')
    } finally { recovery.stop() }
  })

  it('ignores a response after account deactivation and releases commit listeners', async () => {
    const f = await recoveryFixture()
    f.save()
    const ack = await f.queryStatus('session-1', { clientMessageId: 'user-1' })
    let resolve!: (value: typeof ack) => void
    f.queryStatus.mockImplementation(() => new Promise((done) => { resolve = done }))
    const recovery = f.start()
    const pending = recovery.request()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    f.deactivate()
    recovery.stop()
    resolve(ack)
    await pending
    expect(f.listeners.size).toBe(0)
    expect(f.module.getChatOutboundMessages(ACCOUNT_ID, 'session-1')[0].deliveryState).toBe('sending')
  })

  it('does not downgrade a newer ACK with an older queued ACK', async () => {
    const f = await recoveryFixture()
    const message = f.save()
    const ack = await f.queryStatus('session-1', { clientMessageId: 'user-1' })
    f.module.saveChatOutboundAck(ACCOUNT_ID, 'session-1', { ...message, status: 'sent' }, {
      ...ack, deliveryState: 'executing', bodyRevision: 10,
    })
    f.module.saveChatOutboundAck(ACCOUNT_ID, 'session-1', message, ack)
    expect(f.module.getChatOutboundMessages(ACCOUNT_ID, 'session-1')[0]).toMatchObject({
      status: 'sent', deliveryState: 'executing', bodyRevision: 10,
    })
    expect(f.module.getLatestSendingChatOutboundPreview(ACCOUNT_ID, 'session-1')).toBe('')
  })
})

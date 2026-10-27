// @covers open-source/packages/shared/src/stores/sessions.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionsStore } from '../stores/sessions'
import type { NianSession } from '@shennian/wire'

const baseSession: NianSession = {
  id: 's1',
  machineId: 'm1',
  userId: 'u1',
  agentType: 'codex',
  agentSessionId: null,
  modelId: null,
  title: 'Test',
  status: 'active',
  workDir: '',
  lastMessagePreview: 'old preview',
  lastMessagePreviewMessageId: 'message-old',
  lastMessagePreviewAt: '2026-04-07T02:14:00.000Z',
  lastActivityAt: '2026-04-07T02:14:00.000Z',
  createdAt: '2026-04-07T02:00:00.000Z',
  updatedAt: '2026-04-07T02:14:00.000Z',
}

describe('sessions store', () => {
  beforeEach(() => {
    useSessionsStore.setState({
      sessions: [{ ...baseSession }],
      loading: false,
      previews: {},
      previewTimestamps: {},
    })
  })

  it('moves only on accepted user sends and retains the watermark through stale echoes', () => {
    const a = { ...baseSession, id: 'a', lastUserMessageAt: '2026-04-07T02:10:00.000Z' }
    const b = { ...baseSession, id: 'b', lastUserMessageAt: '2026-04-07T02:11:00.000Z' }
    const store = useSessionsStore.getState()
    store.setSessions([a, b])
    store.applyActivity('a', '2026-04-07T02:20:00.000Z', 'AI reply')
    expect(useSessionsStore.getState().sessions.map(x => x.id)).toEqual(['b', 'a'])
    store.applyActivity('a', '2026-04-07T02:19:00.000Z', 'user follow-up', {
      userMessageAt: '2026-04-07T02:19:00.000Z',
    })
    expect(useSessionsStore.getState().sessions.map(x => x.id)).toEqual(['a', 'b'])
    store.upsertSession({ ...a, updatedAt: '2026-04-07T02:21:00.000Z' })
    store.applyActivity('b', '2026-04-07T02:30:00.000Z', 'completed', { lastReadAt: '2026-04-07T02:30:00.000Z' })
    expect(useSessionsStore.getState().sessions.map(x => x.id)).toEqual(['a', 'b'])
    expect(useSessionsStore.getState().sessions[0].lastUserMessageAt).toBe('2026-04-07T02:19:00.000Z')
  })

  it('keeps optimistic preview separate until the canonical tuple arrives', () => {
    useSessionsStore.getState().touchSession('s1', '2026-04-07T02:17:00.000Z', 'latest answer')

    const state = useSessionsStore.getState()
    expect(state.sessions[0]).toMatchObject({
      id: 's1',
      lastActivityAt: '2026-04-07T02:17:00.000Z',
      lastMessagePreview: 'old preview',
    })
    expect(state.previews.s1).toBe('latest answer')
    expect(state.previewTimestamps.s1).toBe('2026-04-07T02:17:00.000Z')
  })

  it('keeps a newer activity timestamp while still allowing a fresher preview body', () => {
    useSessionsStore.setState((s) => ({
      ...s,
      sessions: [{ ...baseSession, lastActivityAt: '2026-04-07T02:20:00.000Z' }],
      previews: { s1: 'old preview' },
      previewTimestamps: { s1: '2026-04-07T02:14:00.000Z' },
    }))

    useSessionsStore
      .getState()
      .touchSession('s1', '2026-04-07T02:17:00.000Z', 'latest readable answer')

    const state = useSessionsStore.getState()
    expect(state.sessions[0].lastActivityAt).toBe('2026-04-07T02:20:00.000Z')
    expect(state.sessions[0].lastMessagePreview).toBe('old preview')
    expect(state.previews.s1).toBe('latest readable answer')
  })

  it('repairs a stale render preview from the authoritative session snapshot at the same timestamp', () => {
    useSessionsStore.setState((state) => ({
      ...state,
      sessions: [{ ...baseSession, lastMessagePreview: '搞定了。' }],
      previews: { s1: '搞定了吗？' },
      previewTimestamps: { s1: baseSession.lastActivityAt },
    }))

    useSessionsStore.getState().upsertSession({
      ...baseSession,
      lastMessagePreview: '搞定了。',
    })

    expect(useSessionsStore.getState().previews.s1).toBe('搞定了。')
  })

  it('projects batch session previews atomically into the render cache', () => {
    useSessionsStore.getState().upsertSessions([
      {
        ...baseSession,
        lastMessagePreview: 'latest agent answer',
        lastMessagePreviewMessageId: 'message-new',
        lastMessagePreviewAt: baseSession.lastActivityAt,
      },
    ])

    const state = useSessionsStore.getState()
    expect(state.sessions[0].lastMessagePreview).toBe('latest agent answer')
    expect(state.previews.s1).toBe('latest agent answer')
    expect(state.previewTimestamps.s1).toBe(baseSession.lastActivityAt)
  })

  it('does not assign activity time to an incomplete legacy preview tuple', () => {
    useSessionsStore.setState({
      sessions: [],
      loading: false,
      previews: {},
      previewTimestamps: {},
    })

    useSessionsStore.getState().setSessions([{
      ...baseSession,
      lastMessagePreview: 'legacy preview without identity',
      lastMessagePreviewMessageId: undefined,
      lastMessagePreviewAt: undefined,
      lastActivityAt: '2026-04-07T02:30:00.000Z',
    }])

    const state = useSessionsStore.getState()
    expect(state.sessions[0]?.lastMessagePreview).toBe('legacy preview without identity')
    expect(state.previews.s1).toBeUndefined()
    expect(state.previewTimestamps.s1).toBeUndefined()
  })

  it('does not move the read watermark backwards when activity arrives out of order', () => {
    useSessionsStore.setState((s) => ({
      ...s,
      sessions: [
        {
          ...baseSession,
          userState: {
            userId: 'u1',
            sessionId: 's1',
            pinnedAt: null,
            lastReadAt: '2026-04-07T02:20:00.000Z',
            manualUnread: false,
            updatedAt: '2026-04-07T02:20:00.000Z',
          },
        },
      ],
    }))

    useSessionsStore.getState().applyActivity('s1', '2026-04-07T02:18:00.000Z', 'older echo', {
      lastReadAt: '2026-04-07T02:18:00.000Z',
    })

    const state = useSessionsStore.getState()
    expect(state.sessions[0].userState?.lastReadAt).toBe('2026-04-07T02:20:00.000Z')
    expect(state.sessions[0].userState?.manualUnread).toBe(false)
  })

  it('retains manager worker sessions for project lists through live upserts', () => {
    useSessionsStore.getState().upsertSession({
      ...baseSession,
      id: 'sess_worker_123',
      agentType: 'codex',
      title: 'Worker',
      nativeSessionVisibility: 'internal',
    })

    expect(useSessionsStore.getState().sessions.map((session) => session.id)).toEqual([
      's1',
      'sess_worker_123',
    ])
  })

  it('updates a cached manager worker without exposing unrelated internal sessions', () => {
    useSessionsStore.setState((s) => ({
      ...s,
      sessions: [
        { ...baseSession },
        {
          ...baseSession,
          id: 'sess_worker_cached',
          title: 'Cached worker',
          nativeSessionVisibility: 'internal',
        },
      ],
    }))

    useSessionsStore.getState().upsertSession({
      ...baseSession,
      id: 'sess_worker_cached',
      title: 'Cached worker update',
      nativeSessionVisibility: 'internal',
    })
    useSessionsStore.getState().upsertSession({
      ...baseSession,
      id: 'native-session-internal',
      title: 'Internal substrate',
      nativeSessionVisibility: 'internal',
    })

    expect(useSessionsStore.getState().sessions.map((session) => session.id)).toEqual([
      's1',
      'sess_worker_cached',
    ])
    expect(useSessionsStore.getState().sessions[1]?.title).toBe('Cached worker update')
  })

  it('commits a multi-session batch with one store notification', () => {
    useSessionsStore.setState((state) => ({
      ...state,
      sessions: [
        { ...baseSession },
        { ...baseSession, id: 's2', lastActivityAt: '2026-04-07T02:13:00.000Z' },
      ],
    }))
    let notifications = 0
    const unsubscribe = useSessionsStore.subscribe(() => {
      notifications += 1
    })

    useSessionsStore.getState().upsertSessions([
      {
        ...baseSession,
        lastMessagePreview: 'batch one',
        lastMessagePreviewMessageId: 'batch-message-one',
        lastMessagePreviewAt: baseSession.lastActivityAt,
      },
      {
        ...baseSession,
        id: 's2',
        lastMessagePreview: 'batch two',
        lastMessagePreviewMessageId: 'batch-message-two',
        lastMessagePreviewAt: '2026-04-07T02:13:00.000Z',
      },
    ])
    unsubscribe()

    expect(notifications).toBe(1)
    expect(useSessionsStore.getState().sessions.map((session) => session.lastMessagePreview)).toEqual([
      'batch one',
      'batch two',
    ])
  })

  it('keeps 45 of 50 session row identities stable when five sessions update', () => {
    const sessions = Array.from({ length: 50 }, (_, index) => ({
      ...baseSession,
      id: `session-${index}`,
      lastActivityAt: new Date(Date.parse(baseSession.lastActivityAt) - index * 1_000).toISOString(),
    }))
    useSessionsStore.setState((state) => ({ ...state, sessions }))
    const previousById = new Map(sessions.map((session) => [session.id, session]))
    let notifications = 0
    const unsubscribe = useSessionsStore.subscribe(() => {
      notifications += 1
    })

    useSessionsStore.getState().upsertSessions(
      sessions.slice(0, 5).map((session, index) => ({
        ...session,
        lastMessagePreview: `updated-${index}`,
      })),
    )
    unsubscribe()

    const next = useSessionsStore.getState().sessions
    expect(notifications).toBe(1)
    expect(
      next.filter((session) => previousById.get(session.id) === session),
    ).toHaveLength(45)
  })

  it('does not notify when activity freshness is semantically unchanged', () => {
    let notifications = 0
    const unsubscribe = useSessionsStore.subscribe(() => {
      notifications += 1
    })
    useSessionsStore.getState().updateSessionActivity('s1', null)
    unsubscribe()
    expect(notifications).toBe(0)
  })

  it('keeps one canonical attention result when the same projection is replayed after reconnect', () => {
    const attention = {
      ...baseSession,
      bodyRevision: 8,
      visibleMessageCount: 4,
      lastVisibleMessageId: 'message-4',
      attentionCount: 1,
      lastAttentionId: 'terminal:run-1',
    }
    useSessionsStore.getState().upsertSession(attention)
    useSessionsStore.getState().upsertSession({ ...attention })

    expect(useSessionsStore.getState().sessions).toHaveLength(1)
    expect(useSessionsStore.getState().sessions[0]).toMatchObject({
      attentionCount: 1,
      lastAttentionId: 'terminal:run-1',
    })
  })
})

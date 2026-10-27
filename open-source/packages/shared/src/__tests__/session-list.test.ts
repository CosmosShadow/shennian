// @covers ../lib/session-list.ts
import type { NianSession } from '@shennian/wire'
import { describe, expect, it } from 'vitest'
import {
  SESSION_ACTIVITY_STALE_MS,
  filterManagerSubstrateSessions,
  getLiveSessionActivitySnapshot,
  getSessionListMetaLabel,
  getSessionListSummary,
  getSessionLiveActivity,
  getSessionSortActivityAt,
  hasSessionExternalChannel,
  hasSessionUnread,
  isOrdinaryVisibleSession,
  sortSessions,
} from '../lib/session-list'

function makeSession(overrides: Partial<NianSession> = {}): NianSession {
  return {
    id: 's1',
    machineId: 'm1',
    userId: 'u1',
    agentType: 'codex',
    agentSessionId: 'a1',
    modelId: 'gpt-5.4',
    title: 'Session',
    status: 'active',
    workDir: '/tmp',
    lastMessagePreview: null,
    lastActivityAt: '2026-04-10T10:00:00.000Z',
    createdAt: '2026-04-10T09:00:00.000Z',
    updatedAt: '2026-04-10T10:00:00.000Z',
    userState: null,
    activity: null,
    ...overrides,
  }
}

describe('session list summary helpers', () => {
  it('shows a sending message ahead of the stale session preview without treating it as a draft', () => {
    const summary = getSessionListSummary(makeSession({ lastMessagePreview: '上一条回复' }), {
      draft: '',
      sendingPreview: '刚刚发送的消息',
    })

    expect(summary).toMatchObject({
      text: '刚刚发送的消息',
      isDraft: false,
      isSending: true,
      useActiveColor: true,
    })
  })

  it('keeps a genuinely new draft ahead of an older sending message', () => {
    const summary = getSessionListSummary(makeSession(), {
      draft: '尚未发送的新内容',
      sendingPreview: '正在发送的上一条内容',
    })

    expect(summary).toMatchObject({
      text: '尚未发送的新内容',
      isDraft: true,
      isSending: false,
    })
  })

  it('does not label an empty newly-created session as a draft', () => {
    const summary = getSessionListSummary(
      makeSession({ localCreationState: 'draft' }),
      { draft: '' },
    )

    expect(summary).toMatchObject({
      text: '',
      isDraft: false,
      isSending: false,
    })
  })

  it('keeps the latest real message visible while Codex Desktop owns the active turn', () => {
    const baseActivity = {
      sessionId: 's1', runId: 'external-1', runPhase: 'thinking' as const,
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), owner: 'external' as const,
    }
    const queued = getSessionListSummary(makeSession({
      activity: { ...baseActivity, lifecycle: 'queued' }, lastMessagePreview: '旧回复',
    }))
    const running = getSessionListSummary(makeSession({
      activity: { ...baseActivity, lifecycle: 'running' }, lastMessagePreview: '旧回复',
    }))

    expect(queued).toMatchObject({ text: '旧回复', showPulse: true, useActiveColor: true })
    expect(running).toMatchObject({ text: '旧回复', showPulse: true, useActiveColor: true })
  })
  it('shows text instead of attachment refs and uses localized counts for image-only previews', () => {
    const labels = {
      imageLabel: '图片',
      imagesLabel: (count: number) => `${count} 张图片`,
      fileLabel: '文件',
      filesLabel: (count: number) => `${count} 个文件`,
    }

    expect(
      getSessionListSummary(
        makeSession({
          lastMessagePreview:
            '![IMG_8552.png](</Users/test/.uploads/IMG_8552.png>)\n\n修改未读计数逻辑',
        }),
        labels,
      ).text,
    ).toBe('修改未读计数逻辑')

    expect(
      getSessionListSummary(makeSession({ lastMessagePreview: '[3 Images]' }), labels).text,
    ).toBe('3 张图片')
  })

  it('shows the tool-running state ahead of the latest message preview', () => {
    const session = makeSession({
      lastMessagePreview: '我先把 PRD.md 改成中文',
      activity: {
        sessionId: 's1',
        runId: 'run-1',
        runPhase: 'tool_running',
        startedAt: '2026-04-10T10:00:00.000Z',
        updatedAt: '2026-04-10T10:01:00.000Z',
        toolCallCount: 21,
      },
    })

    const summary = getSessionListSummary(session, {
      now: new Date('2026-04-10T10:02:00.000Z').getTime(),
      workingLabel: '工作中…',
      toolRunningLabel: '工具调用中…',
      toolRunningCountLabel: '已调用 21 个工具…',
    })

    expect(summary.text).toBe('已调用 21 个工具…')
    expect(summary.showPulse).toBe(true)
    expect(summary.useActiveColor).toBe(true)
  })

  it('falls back to the generic tool-running label for activity without a count', () => {
    const session = makeSession({
      activity: {
        sessionId: 's1',
        runId: 'run-1',
        runPhase: 'tool_running',
        startedAt: '2026-04-10T10:00:00.000Z',
        updatedAt: '2026-04-10T10:01:00.000Z',
      },
    })

    const summary = getSessionListSummary(session, {
      now: new Date('2026-04-10T10:02:00.000Z').getTime(),
      workingLabel: '工作中…',
      toolRunningLabel: '工具调用中…',
      toolRunningCountLabel: '已调用 0 个工具…',
    })

    expect(summary.text).toBe('工具调用中…')
  })

  it('falls back to the working label when running without any readable preview', () => {
    const session = makeSession({
      activity: {
        sessionId: 's1',
        runId: 'run-1',
        runPhase: 'thinking',
        startedAt: '2026-04-10T10:00:00.000Z',
        updatedAt: '2026-04-10T10:01:00.000Z',
      },
    })

    const summary = getSessionListSummary(session, {
      now: new Date('2026-04-10T10:02:00.000Z').getTime(),
      workingLabel: '工作中…',
    })

    expect(summary.text).toBe('工作中…')
    expect(summary.isDraft).toBe(false)
    expect(summary.showPulse).toBe(true)
  })

  it('ignores stale activity snapshots for list presentation', () => {
    const session = makeSession({
      lastMessagePreview: '最新文本',
      activity: {
        sessionId: 's1',
        runId: 'run-1',
        runPhase: 'thinking',
        startedAt: '2026-04-10T10:00:00.000Z',
        updatedAt: '2026-04-10T10:01:00.000Z',
      },
    })

    const now = new Date('2026-04-10T10:01:00.000Z').getTime() + SESSION_ACTIVITY_STALE_MS + 1
    const summary = getSessionListSummary(session, { now, workingLabel: '工作中…' })

    expect(getSessionLiveActivity(session, { now })).toBeNull()
    expect(summary.text).toBe('最新文本')
    expect(summary.showPulse).toBe(false)
    expect(summary.useActiveColor).toBe(false)
  })

  it('applies the same staleness rule to raw activity snapshots', () => {
    const activity = {
      sessionId: 's1',
      runId: 'run-1',
      runPhase: 'thinking',
      startedAt: '2026-04-10T10:00:00.000Z',
      updatedAt: '2026-04-10T10:01:00.000Z',
    } as const

    const now = new Date('2026-04-10T10:01:00.000Z').getTime() + SESSION_ACTIVITY_STALE_MS + 1

    expect(getLiveSessionActivitySnapshot(activity, { now })).toBeNull()
  })

  it('treats typing as a running state even before an activity snapshot lands', () => {
    const session = makeSession({
      lastMessagePreview: '我先整理一下结构',
    })

    const summary = getSessionListSummary(session, {
      isTyping: true,
      workingLabel: '工作中…',
    })

    expect(summary.text).toBe('我先整理一下结构')
    expect(summary.isDraft).toBe(false)
    expect(summary.showPulse).toBe(true)
    expect(summary.useActiveColor).toBe(true)
    expect(summary.liveActivity).toBeNull()
  })

  it('filters hidden manager substrate sessions by agent session id', () => {
    const manager = makeSession({
      id: 'manager-1',
      agentType: 'manager',
      agentSessionId: 'codex-thread-1',
      title: 'Manager',
    })
    const substrate = makeSession({
      id: 'codex-substrate',
      agentType: 'codex',
      agentSessionId: 'codex-thread-1',
      title: 'Hidden Codex substrate',
    })
    const normal = makeSession({
      id: 'codex-normal',
      agentType: 'codex',
      agentSessionId: 'codex-thread-2',
      title: 'Normal Codex session',
    })

    expect(filterManagerSubstrateSessions([substrate, normal, manager]).map((session) => session.id)).toEqual([
      'codex-normal',
    ])
  })

  it('filters manager-created worker sessions from ordinary session lists', () => {
    const worker = makeSession({
      id: 'sess_worker_123',
      agentType: 'codex',
      agentSessionId: 'codex-worker-thread',
      title: 'Worker',
    })
    const normal = makeSession({
      id: 'sess_normal_123',
      agentType: 'codex',
      agentSessionId: 'codex-normal-thread',
      title: 'Normal',
    })

    expect(filterManagerSubstrateSessions([worker, normal]).map((session) => session.id)).toEqual([
      'sess_normal_123',
    ])
  })

  it('keeps ordinary newly-created sessions when filtering manager internals', () => {
    const ordinaryNewSession = makeSession({
      id: 'sess_ordinary_new_123',
      agentType: 'claude',
      agentSessionId: null,
      title: 'New Claude session',
    })
    const ordinaryCodexSession = makeSession({
      id: 'sess_codex_new_123',
      agentType: 'codex',
      agentSessionId: 'codex-normal-thread',
      title: 'New Codex session',
    })

    expect(filterManagerSubstrateSessions([ordinaryNewSession, ordinaryCodexSession]).map((session) => session.id)).toEqual([
      'sess_ordinary_new_123',
      'sess_codex_new_123',
    ])
  })

  it('prefers a local draft over the synced preview while keeping the live pulse', () => {
    const session = makeSession({
      lastMessagePreview: '已经同步的旧摘要',
      activity: {
        sessionId: 's1',
        runId: 'run-1',
        runPhase: 'thinking',
        startedAt: '2026-04-10T10:00:00.000Z',
        updatedAt: '2026-04-10T10:01:00.000Z',
      },
    })

    const summary = getSessionListSummary(session, {
      draft: '我先补一句还没发送的话',
      now: new Date('2026-04-10T10:02:00.000Z').getTime(),
      workingLabel: '工作中…',
    })

    expect(summary.text).toBe('我先补一句还没发送的话')
    expect(summary.isDraft).toBe(true)
    expect(summary.showPulse).toBe(true)
    expect(summary.useActiveColor).toBe(false)
  })

  it('does not treat a fresher activity heartbeat as unread by itself', () => {
    const session = makeSession({
      userState: {
        userId: 'u1',
        sessionId: 's1',
        pinnedAt: null,
        lastReadAt: '2026-04-10T10:05:00.000Z',
        lastReadBodyRevision: 5,
        lastReadVisibleMessageCount: 2,
        lastReadVisibleMessageId: 'm2',
        manualUnread: false,
        updatedAt: '2026-04-10T10:05:00.000Z',
      },
      lastActivityAt: '2026-04-10T10:05:00.000Z',
      activity: {
        sessionId: 's1',
        runId: 'run-1',
        runPhase: 'thinking',
        startedAt: '2026-04-10T10:05:00.000Z',
        updatedAt: '2026-04-10T10:06:00.000Z',
      },
    })

    expect(hasSessionUnread(session)).toBe(false)
  })

  it('marks the session unread when a newer attention result lands', () => {
    const session = makeSession({
      userState: {
        userId: 'u1',
        sessionId: 's1',
        pinnedAt: null,
        lastReadAt: '2026-04-10T10:05:00.000Z',
        manualUnread: false,
        lastReadAttentionCount: 0,
        lastReadAttentionId: null,
        updatedAt: '2026-04-10T10:05:00.000Z',
      },
      bodyRevision: 6,
      visibleMessageCount: 3,
      lastVisibleMessageId: 'm3',
      attentionCount: 1,
      lastAttentionId: 'terminal:run-1',
      lastActivityAt: '2026-04-10T10:06:00.000Z',
    })

    expect(hasSessionUnread(session)).toBe(true)
  })

  it('does not mark a session unread for a tool-only body revision', () => {
    const session = makeSession({
      userState: {
        userId: 'u1',
        sessionId: 's1',
        lastReadAt: '2026-04-10T10:05:00.000Z',
        lastReadBodyRevision: 5,
        lastReadVisibleMessageCount: 2,
        lastReadVisibleMessageId: 'm2',
        manualUnread: false,
        updatedAt: '2026-04-10T10:05:00.000Z',
      },
      bodyRevision: 8,
      visibleMessageCount: 2,
      lastVisibleMessageId: 'm2',
      lastActivityAt: '2026-04-10T10:06:00.000Z',
    })

    expect(hasSessionUnread(session)).toBe(false)
  })

  it('does not let activity heartbeats reshuffle the session list', () => {
    const olderButRunning = makeSession({
      id: 's-older',
      title: 'Older',
      lastUserMessageAt: '2026-04-10T10:05:00.000Z',
      lastActivityAt: '2026-04-10T10:05:00.000Z',
      updatedAt: '2026-04-10T10:05:00.000Z',
      activity: {
        sessionId: 's-older',
        runId: 'run-1',
        runPhase: 'thinking',
        startedAt: '2026-04-10T10:00:00.000Z',
        updatedAt: '2026-04-10T10:20:00.000Z',
      },
    })
    const newerIdle = makeSession({
      id: 's-newer',
      title: 'Newer',
      lastUserMessageAt: '2026-04-10T10:10:00.000Z',
      lastActivityAt: '2026-04-10T10:10:00.000Z',
      updatedAt: '2026-04-10T10:10:00.000Z',
    })

    expect(getSessionSortActivityAt(olderButRunning)).toBe(
      new Date('2026-04-10T10:05:00.000Z').getTime(),
    )
    expect(sortSessions([olderButRunning, newerIdle]).map((session) => session.id)).toEqual([
      's-newer',
      's-older',
    ])
  })

  it('sorts by user messages, ignoring newer AI text and tools', () => {
    const newerActivityWithOlderPreview = makeSession({
      id: 's-tool-active',
      lastUserMessageAt: '2026-04-10T10:00:00.000Z',
      lastMessagePreview: '较早的真实消息',
      lastMessagePreviewMessageId: 'm-old',
      lastMessagePreviewAt: '2026-04-10T10:05:00.000Z',
      lastVisibleEventAt: '2026-04-10T10:30:00.000Z',
      lastActivityAt: '2026-04-10T10:30:00.000Z',
    })
    const newerPreview = makeSession({
      id: 's-new-message',
      lastUserMessageAt: '2026-04-10T10:10:00.000Z',
      lastMessagePreview: '较新的真实消息',
      lastMessagePreviewMessageId: 'm-new',
      lastMessagePreviewAt: '2026-04-10T10:10:00.000Z',
      lastActivityAt: '2026-04-10T10:10:00.000Z',
    })

    expect(sortSessions([newerActivityWithOlderPreview, newerPreview]).map(({ id }) => id))
      .toEqual(['s-new-message', 's-tool-active'])
  })

  it('keeps ties deterministic across metadata updates and snapshot order', () => {
    const a = makeSession({ id: 'a', lastUserMessageAt: '2026-04-10T10:00:00Z' })
    const b = makeSession({ ...a, id: 'b', updatedAt: '2099-01-01T00:00:00Z' })
    expect(sortSessions([b, a]).map(({ id }) => id)).toEqual(['a', 'b'])
    expect(sortSessions([{ ...a, updatedAt: b.updatedAt }, b]).map(({ id }) => id)).toEqual(['a', 'b'])
  })

  it('falls back to creation time only and preserves the pinned group', () => {
    const old = makeSession({ id: 'old', createdAt: '2026-01-01', lastActivityAt: '2099-01-01' })
    const fresh = makeSession({ id: 'new', createdAt: '2026-02-01' })
    expect(sortSessions([old, fresh]).map(({ id }) => id)).toEqual(['new', 'old'])
    const pinned = { ...old, userState: { sessionId: old.id, userId: old.userId, updatedAt: old.updatedAt, pinnedAt: old.createdAt } }
    expect(sortSessions([fresh, pinned]).map(({ id }) => id)).toEqual(['old', 'new'])
  })

  it('builds the secondary meta label as machine name followed by agent', () => {
    expect(getSessionListMetaLabel({ machineName: '我的工作机', agentLabel: 'Codex' })).toBe(
      '我的工作机 · Codex',
    )
  })

  it('omits empty machine or agent values when building the secondary meta label', () => {
    expect(getSessionListMetaLabel({ machineName: 'MacBook Pro', agentLabel: '' })).toBe(
      'MacBook Pro',
    )
    expect(getSessionListMetaLabel({ machineName: '   ', agentLabel: 'Nian' })).toBe('Nian')
  })

  it('marks external channels for normal supported agent sessions', () => {
    expect(hasSessionExternalChannel(makeSession({
      agentType: 'codex',
      externalChannel: {
        connected: true,
        configured: true,
        type: 'wecom',
      },
    }))).toBe(true)
    expect(hasSessionExternalChannel(makeSession({
      agentType: 'opencode',
      externalChannel: {
        connected: true,
        configured: true,
        type: 'wecom',
      },
    }))).toBe(true)
    expect(hasSessionExternalChannel(makeSession({
      agentType: 'unsupported-agent',
      externalChannel: {
        connected: true,
        configured: true,
        type: 'wecom',
      },
    }))).toBe(false)
    expect(hasSessionExternalChannel(makeSession({
      agentType: 'codex',
      externalChannel: {
        connected: true,
        configured: true,
        type: 'wechat-rpa',
      },
    }))).toBe(true)
  })

  it('accepts both pi and nian aliases for the built-in Nian agent external channel', () => {
    expect(hasSessionExternalChannel(makeSession({
      agentType: 'pi',
      externalChannel: {
        connected: true,
        configured: true,
        type: 'wecom',
      },
    }))).toBe(true)
    expect(hasSessionExternalChannel(makeSession({
      agentType: 'nian',
      externalChannel: {
        connected: true,
        configured: true,
        type: 'wecom',
      },
    }))).toBe(true)
  })
  it('hides explicit internal ownership, not Worker titles or normal native IDs', () => {
    const ordinary = makeSession({ id: 'native-session-user', agentSessionId: 'user-thread', title: 'Worker completion analysis' })
    const internal = makeSession({ id: 'native-session-internal', nativeSessionVisibility: 'internal' })
    const manager = makeSession({ id: 'manager', agentType: 'codex', sessionMode: 'manager' })
    expect(filterManagerSubstrateSessions([ordinary, internal, manager]).map((s) => s.id)).toEqual([ordinary.id])
    expect(hasSessionUnread(internal)).toBe(false)
  })

})

describe('steward sessions in ordinary lists', () => {
  it('are not ordinary visible and never raise the ordinary unread state', () => {
    const steward = { id: 'sess_steward', sessionScope: 'steward' as const, userState: { manualUnread: true } }
    expect(isOrdinaryVisibleSession(steward)).toBe(false)
    expect(hasSessionUnread(steward as never)).toBe(false)
    expect(isOrdinaryVisibleSession({ id: 'sess_plain' })).toBe(true)
    expect(isOrdinaryVisibleSession({ id: 'sess_personal', sessionScope: 'personal' })).toBe(true)
  })
})

describe('steward messages in the chat store', () => {
  it('projects a steward_say envelope as an agent message marked with its source', async () => {
    const { envelopeToChatMessage } = await import('../stores/chat')
    const { buildStewardSayPayload } = await import('@shennian/wire')
    const say = envelopeToChatMessage({ id: 'a', sessionId: 's', role: 'agent', ts: 1, payload: buildStewardSayPayload('收到') })
    const fallback = envelopeToChatMessage({ id: 'b', sessionId: 's', role: 'agent', ts: 2, payload: buildStewardSayPayload('最后输出', 'fallback') })
    const plain = envelopeToChatMessage({ id: 'c', sessionId: 's', role: 'agent', ts: 3, payload: '内部文字' })
    expect(say).toMatchObject({ role: 'agent', content: '收到', steward: 'say' })
    expect(fallback).toMatchObject({ content: '最后输出', steward: 'fallback' })
    expect(plain).not.toHaveProperty('steward')
  })
})

// @covers src/lib/session-unread-count-cache.ts

import { describe, expect, it } from 'vitest'
import type { NianSession } from '@shennian/wire'

import {
  getSessionUnreadCountSnapshot,
  refreshSessionUnreadCounts,
  subscribeSessionUnreadCounts,
} from '../lib/session-unread-count-cache'

function session(id: string): NianSession {
  return {
    id,
    machineId: 'machine-1',
    userId: 'user-1',
    agentType: 'codex',
    agentSessionId: `native-${id}`,
    modelId: null,
    title: id,
    status: 'active',
    workDir: '/repo',
    lastMessagePreview: 'activity',
    bodyRevision: 4,
    visibleMessageCount: 2,
    lastVisibleMessageId: 'm2',
    attentionCount: 2,
    lastAttentionId: 'a2',
    lastActivityAt: '2026-08-29T10:02:00.000Z',
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:02:00.000Z',
    userState: {
      userId: 'user-1',
      sessionId: id,
      manualUnread: false,
      pinnedAt: null,
      lastReadAt: '2026-08-29T10:01:00.000Z',
      lastReadBodyRevision: 2,
      lastReadVisibleMessageCount: 0,
      lastReadVisibleMessageId: null,
      lastReadAttentionCount: 0,
      lastReadAttentionId: null,
      updatedAt: '2026-08-29T10:01:00.000Z',
    },
    activity: null,
  }
}

describe('session unread count cache', () => {
  it('counts attention deltas instead of body messages or generic activity', async () => {
    const visible = session('visible')
    const activityOnly = {
      ...session('activity-only'),
      bodyRevision: 9,
      visibleMessageCount: 0,
      lastVisibleMessageId: null,
      attentionCount: 0,
      lastAttentionId: null,
    }

    await refreshSessionUnreadCounts([visible, activityOnly])

    expect(getSessionUnreadCountSnapshot()).toEqual({ visible: 2, 'activity-only': 0 })
  })

  it('keeps unchanged per-session values stable when a different row changes', async () => {
    const first = session('first')
    const second = session('second')
    await refreshSessionUnreadCounts([first, second])
    const before = getSessionUnreadCountSnapshot()['first']
    let publications = 0
    const unsubscribe = subscribeSessionUnreadCounts(() => { publications += 1 })

    await refreshSessionUnreadCounts([
      first,
      {
        ...second,
        attentionCount: 3,
      },
    ])

    unsubscribe()
    expect(publications).toBe(1)
    expect(getSessionUnreadCountSnapshot()['first']).toBe(before)
    expect(getSessionUnreadCountSnapshot()['second']).toBe(3)
  })
})

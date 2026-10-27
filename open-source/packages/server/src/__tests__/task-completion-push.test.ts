// @covers open-source/packages/server/src/services/task-completion-push.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  findOutboxMock,
  updateOutboxMock,
  findSessionMock,
  sendPushMock,
  writeLogMock,
  countUnreadMock,
} = vi.hoisted(() => ({
  findOutboxMock: vi.fn(),
  updateOutboxMock: vi.fn(),
  findSessionMock: vi.fn(),
  sendPushMock: vi.fn(),
  writeLogMock: vi.fn(),
  countUnreadMock: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    sessionTerminalNotification: {
      findMany: findOutboxMock,
      updateMany: updateOutboxMock,
    },
    nianSession: { findUnique: findSessionMock },
  },
}))
vi.mock('../services/push.js', () => ({ sendPushNotification: sendPushMock }))
vi.mock('../services/log.js', () => ({ writeLog: writeLogMock }))
vi.mock('../services/unread-badge.js', () => ({ countUnreadVisibleMessages: countUnreadMock }))

import {
  buildTerminalNotificationSnapshot,
  processPendingTaskCompletionPushes,
} from '../services/task-completion-push.js'

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outbox-1',
    sessionId: 'session-1',
    userId: 'user-1',
    terminalBodyRevision: 7,
    terminalAttentionId: 'terminal:run-7',
    terminalAttentionCount: 1,
    terminalState: 'final',
    notificationTitle: 'Codex 修复',
    notificationBody: '完成 测试 通过',
    notificationPreviewMessageId: 'message-7',
    notificationPreviewAt: new Date('2026-09-01T08:00:00.000Z'),
    attempts: 0,
    ...overrides,
  }
}

describe('task completion Push outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findOutboxMock.mockResolvedValue([candidate()])
    updateOutboxMock.mockResolvedValue({ count: 1 })
    findSessionMock.mockResolvedValue({
      deletedAt: null,
      status: 'completed',
      sessionMode: 'standard',
      bodyRevision: 7,
      attentionCount: 1,
      lastMessagePreview: 'next turn mutable commentary must be ignored',
      userStates: [{ lastReadAttentionCount: 0, lastReadAttentionId: null }],
    })
    countUnreadMock.mockResolvedValue(1)
    sendPushMock.mockResolvedValue(undefined)
  })

  it('sends the terminal snapshot without reading a mutable later session preview', async () => {
    await expect(processPendingTaskCompletionPushes()).resolves.toEqual({
      claimed: 1, sent: 1, failed: 0, skipped: 0,
    })

    expect(sendPushMock).toHaveBeenCalledWith(
      'user-1',
      'Codex 修复',
      '完成 测试 通过',
      {
        sessionId: 'session-1',
        terminalBodyRevision: 7,
        notificationKey: 'session-1:terminal:run-7',
        preview: '完成 测试 通过',
        previewAt: '2026-09-01T08:00:00.000Z',
      },
      expect.objectContaining({ audience: 'mobile', badge: 1 }),
    )
    expect(updateOutboxMock).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'outbox-1', status: 'processing' },
      data: expect.objectContaining({ status: 'sent', leaseUntil: null }),
    }))
    expect(findOutboxMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: expect.arrayContaining([
        expect.objectContaining({ status: 'pending' }),
        expect.objectContaining({ status: 'processing' }),
      ]) },
    }))
  })

  it('uses terminal-state fallback copy when no safe preview exists', async () => {
    findOutboxMock.mockResolvedValue([candidate({
      terminalState: 'error',
      notificationBody: 'Codex 修复 出错了',
      notificationPreviewMessageId: null,
    })])

    await processPendingTaskCompletionPushes()

    expect(sendPushMock).toHaveBeenCalledWith(
      'user-1', 'Codex 修复', 'Codex 修复 出错了',
      expect.objectContaining({ notificationKey: 'session-1:terminal:run-7' }),
      expect.objectContaining({ audience: 'mobile' }),
    )
  })

  it('uses the beginning of the last visible message and adds an ellipsis when needed', async () => {
    const message = '这是一条需要在系统通知里截断的任务完成消息。'.repeat(8)
    findOutboxMock.mockResolvedValue([candidate({
      notificationBody: `${message.slice(0, 100)}…`,
    })])

    await processPendingTaskCompletionPushes()

    expect(sendPushMock).toHaveBeenCalledWith(
      'user-1', 'Codex 修复', `${message.slice(0, 100)}…`,
      expect.objectContaining({ preview: `${message.slice(0, 100)}…` }),
      expect.objectContaining({ audience: 'mobile' }),
    )
  })

  it('freezes a safe fallback instead of an unsafe terminal preview', () => {
    expect(buildTerminalNotificationSnapshot({
      title: 'Codex 修复',
      preview: `data:image/png;base64,${'A'.repeat(120)}`,
      previewMessageId: 'unsafe-message',
      previewAt: new Date('2026-09-01T07:59:00.000Z'),
      terminalAt: new Date('2026-09-01T08:00:00.000Z'),
      terminalState: 'final',
    })).toEqual({
      notificationTitle: 'Codex 修复',
      notificationBody: 'Codex 修复 已完成',
      notificationPreviewMessageId: null,
      notificationPreviewAt: new Date('2026-09-01T08:00:00.000Z'),
    })
  })

  it('skips a delayed terminal notification after the next turn has started', async () => {
    findSessionMock.mockResolvedValue({
      deletedAt: null,
      status: 'active',
      bodyRevision: 9,
      attentionCount: 1,
      userStates: [{ lastReadAttentionCount: 0, lastReadAttentionId: null }],
    })

    await expect(processPendingTaskCompletionPushes()).resolves.toEqual({
      claimed: 1, sent: 0, failed: 0, skipped: 1,
    })
    expect(sendPushMock).not.toHaveBeenCalled()
  })

  it('skips a terminal notification that the user already read', async () => {
    findSessionMock.mockResolvedValue({
      deletedAt: null,
      status: 'completed',
      bodyRevision: 7,
      attentionCount: 1,
      userStates: [{
        lastReadAttentionCount: 1,
        lastReadAttentionId: 'terminal:run-7',
      }],
    })

    await expect(processPendingTaskCompletionPushes()).resolves.toEqual({
      claimed: 1, sent: 0, failed: 0, skipped: 1,
    })
    expect(sendPushMock).not.toHaveBeenCalled()
  })

  it('skips legacy pending rows that do not have a frozen terminal snapshot', async () => {
    findOutboxMock.mockResolvedValue([candidate({ notificationBody: null })])

    await expect(processPendingTaskCompletionPushes()).resolves.toEqual({
      claimed: 1, sent: 0, failed: 0, skipped: 1,
    })
    expect(findSessionMock).not.toHaveBeenCalled()
    expect(sendPushMock).not.toHaveBeenCalled()
  })

  it('returns a deleted session outbox row to a terminal sent state without Push', async () => {
    findSessionMock.mockResolvedValue(null)

    await expect(processPendingTaskCompletionPushes()).resolves.toEqual({
      claimed: 1, sent: 0, failed: 0, skipped: 1,
    })
    expect(sendPushMock).not.toHaveBeenCalled()
    expect(updateOutboxMock).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'sent' }),
    }))
  })

  it('skips legacy outbox rows for managed Workers before reading the Session', async () => {
    findOutboxMock.mockResolvedValue([candidate({ sessionId: 'sess_worker_internal' })])

    await expect(processPendingTaskCompletionPushes()).resolves.toEqual({
      claimed: 1, sent: 0, failed: 0, skipped: 1,
    })
    expect(findSessionMock).not.toHaveBeenCalled()
    expect(sendPushMock).not.toHaveBeenCalled()
  })

  it('skips legacy outbox rows for Manager orchestration turns', async () => {
    findSessionMock.mockResolvedValue({
      deletedAt: null,
      status: 'completed',
      sessionMode: 'manager',
      bodyRevision: 7,
      attentionCount: 1,
      userStates: [{ lastReadAttentionCount: 0, lastReadAttentionId: null }],
    })

    await expect(processPendingTaskCompletionPushes()).resolves.toEqual({
      claimed: 1, sent: 0, failed: 0, skipped: 1,
    })
    expect(sendPushMock).not.toHaveBeenCalled()
  })

  it('releases a failed delivery with bounded retry metadata and no content', async () => {
    sendPushMock.mockRejectedValue(new TypeError('provider included private body'))

    await expect(processPendingTaskCompletionPushes()).resolves.toEqual({
      claimed: 1, sent: 0, failed: 1, skipped: 0,
    })
    const retry = updateOutboxMock.mock.calls.at(-1)?.[0]
    expect(retry.data).toMatchObject({
      status: 'pending', leaseUntil: null, lastErrorCode: 'TypeError',
    })
    expect(retry.data.availableAt).toBeInstanceOf(Date)
    expect(JSON.stringify(retry)).not.toContain('private body')
  })
})

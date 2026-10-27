// @arch docs/architecture/data-sync.md#一、SyncEngine详细设计
// @covers src/features/session-list/display.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NianSession } from '@shennian/wire'
import { buildSessionDisplay } from '../features/session-list/display'

// Projection chooses an instant; the UI renders it in the user's local zone.
// CI may run in UTC, not the +08:00 zone encoded in these wire fixtures.
function expectedLocalClock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('session list display projection', () => {
  it('never exposes a transport namespace in the Agent label', () => {
    const session: NianSession = {
      id: 'acp-session',
      machineId: 'machine-1',
      userId: 'user-1',
      agentType: 'acp:qwen-code',
      agentSessionId: 'thread-acp',
      title: '测试',
      status: 'active',
      workDir: '/repo',
      lastActivityAt: '2026-09-02T14:00:00+08:00',
      createdAt: '2026-09-02T14:00:00+08:00',
      updatedAt: '2026-09-02T14:00:00+08:00',
    }
    const display = buildSessionDisplay({
      session,
      isTyping: false,
      workingLabel: '工作中',
      toolRunningLabel: '调用工具中',
      toolRunningCountLabel: '调用工具中',
      imageLabel: '图片',
      imagesLabel: (count) => `${count} 张图片`,
      fileLabel: '文件',
      filesLabel: (count) => `${count} 个文件`,
    })

    expect(display.metaLabel).toBe('Qwen Code')
    expect(display.metaLabel).not.toContain('acp:')
  })

  it('renders the latest visible tool activity time while keeping the readable text preview', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T14:30:00+08:00'))
    const session: NianSession = {
      id: 'session-1',
      machineId: 'machine-1',
      userId: 'user-1',
      agentType: 'codex',
      agentSessionId: 'thread-1',
      title: '同步刷新',
      status: 'active',
      workDir: '/repo',
      lastMessagePreview: '与时间对应的消息',
      lastMessagePreviewMessageId: 'message-1',
      lastMessagePreviewAt: '2026-09-02T14:19:00+08:00',
      lastVisibleEventAt: '2026-09-02T14:25:00+08:00',
      lastActivityAt: '2026-09-02T14:27:00+08:00',
      createdAt: '2026-09-02T14:00:00+08:00',
      updatedAt: '2026-09-02T14:25:00+08:00',
    }

    const display = buildSessionDisplay({
      session,
      isTyping: false,
      workingLabel: '工作中',
      toolRunningLabel: '调用工具中',
      toolRunningCountLabel: '调用工具中',
      imageLabel: '图片',
      imagesLabel: (count) => `${count} 张图片`,
      fileLabel: '文件',
      filesLabel: (count) => `${count} 个文件`,
    })

    expect(display.summary.text).toBe('与时间对应的消息')
    expect(display.timeStr).toBe(expectedLocalClock('2026-09-02T14:25:00+08:00'))
  })

  it('uses the matching optimistic preview timestamp until canonical projection arrives', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T14:30:00+08:00'))
    const session: NianSession = {
      id: 'session-2',
      machineId: 'machine-1',
      userId: 'user-1',
      agentType: 'codex',
      agentSessionId: 'thread-2',
      title: '同步刷新',
      status: 'active',
      workDir: '/repo',
      lastMessagePreview: '旧消息',
      lastMessagePreviewMessageId: 'old-message',
      lastMessagePreviewAt: '2026-09-02T14:19:00+08:00',
      lastActivityAt: '2026-09-02T14:21:00+08:00',
      createdAt: '2026-09-02T14:00:00+08:00',
      updatedAt: '2026-09-02T14:21:00+08:00',
    }
    const display = buildSessionDisplay({
      session,
      preview: '刚发送的消息',
      previewAt: '2026-09-02T14:21:00+08:00',
      isTyping: false,
      workingLabel: '工作中',
      toolRunningLabel: '调用工具中',
      toolRunningCountLabel: '调用工具中',
      imageLabel: '图片',
      imagesLabel: (count) => `${count} 张图片`,
      fileLabel: '文件',
      filesLabel: (count) => `${count} 个文件`,
    })

    expect(display.summary.text).toBe('刚发送的消息')
    expect(display.timeStr).toBe(expectedLocalClock('2026-09-02T14:21:00+08:00'))
  })

  it('does not pair a legacy preview with an unrelated activity or creation time', () => {
    const session: NianSession = {
      id: 'legacy',
      machineId: 'machine-1',
      userId: 'user-1',
      agentType: 'codex',
      agentSessionId: 'legacy-thread',
      title: '旧索引',
      status: 'active',
      workDir: '/repo',
      lastMessagePreview: '尚未迁移身份和时间的旧摘要',
      lastActivityAt: '2026-09-02T14:25:00+08:00',
      createdAt: '2026-09-02T13:00:00+08:00',
      updatedAt: '2026-09-02T14:25:00+08:00',
    }
    const display = buildSessionDisplay({
      session,
      isTyping: false,
      workingLabel: '工作中',
      toolRunningLabel: '调用工具中',
      toolRunningCountLabel: '调用工具中',
      imageLabel: '图片',
      imagesLabel: (count) => `${count} 张图片`,
      fileLabel: '文件',
      filesLabel: (count) => `${count} 个文件`,
    })

    expect(display.summary.text).toBe('尚未迁移身份和时间的旧摘要')
    expect(display.timeStr).toBe('')
  })

  it('treats an explicitly empty local projection as authoritative over cloud preview', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T14:30:00+08:00'))
    const session: NianSession = {
      id: 'local-empty',
      machineId: 'machine-1',
      userId: 'user-1',
      agentType: 'codex',
      agentSessionId: 'thread-empty',
      title: '空会话',
      status: 'active',
      workDir: '/repo',
      lastMessagePreview: '云端旧摘要',
      lastMessagePreviewMessageId: 'old-message',
      lastMessagePreviewAt: '2026-09-02T14:19:00+08:00',
      lastActivityAt: '2026-09-02T14:25:00+08:00',
      createdAt: '2026-09-02T13:00:00+08:00',
      updatedAt: '2026-09-02T14:25:00+08:00',
    }
    const display = buildSessionDisplay({
      session,
      preview: '',
      previewAt: session.createdAt,
      isTyping: false,
      workingLabel: '工作中',
      toolRunningLabel: '调用工具中',
      toolRunningCountLabel: '调用工具中',
      imageLabel: '图片',
      imagesLabel: (count) => `${count} 张图片`,
      fileLabel: '文件',
      filesLabel: (count) => `${count} 个文件`,
    })

    expect(display.summary.text).toBe('')
    expect(display.timeStr).toBe(expectedLocalClock('2026-09-02T13:00:00+08:00'))
  })
})

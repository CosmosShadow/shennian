// @arch docs/features/network-rooms/local-first-persistence.md
// @covers packages/app/src/features/rooms/roomMessagePreview.ts
import { describe, expect, it, vi } from 'vitest'
import type { RoomMessageView } from '@shennian/wire'
import {
  formatRoomListPreview,
  isRoomPreviewMessage,
  resolveRoomMessagePreview,
} from '../features/rooms/roomMessagePreview'

const message = (sequence: string, overrides: Partial<RoomMessageView> = {}): RoomMessageView => ({
  id: sequence,
  roomId: 'room',
  sequence,
  kind: 'text',
  text: '正文',
  attachments: [],
  author: {
    membershipId: 'member',
    principalType: 'human',
    ownerUserId: 'user',
    displayName: '作者',
  },
  createdAt: '2026-09-11T00:00:00Z',
  ...overrides,
})

describe('Room body preview', () => {
  it('shows the latest join notice instead of an empty preview when there is no body', () => {
    const t = (key: string, options?: Record<string, unknown>) => {
      if (key === 'spaces_system_member_joined') return `${options?.name} 已加入群聊。`
      if (key === 'spaces_latest_message_empty') return '暂无消息'
      return key
    }
    expect(formatRoomListPreview(message('2', { kind: 'system', text: '用户 8D0EADB344 已加入群聊。' }), t))
      .toBe('用户 8D0EADB344 已加入群聊。')
    expect(formatRoomListPreview(message('2', { kind: 'system', text: '用户 8D0EADB344 已加入群聊。', deletedAt: '2026-09-11T00:00:00Z' }), t))
      .toBe('暂无消息')
    expect(formatRoomListPreview(null, t)).toBe('暂无消息')
  })
  it('uses the latest human or agent body without loading history', async () => {
    const read = vi.fn()
    for (const principalType of ['human', 'agent'] as const) {
      const body = message('9', { author: { ...message('9').author, principalType } })
      expect(await resolveRoomMessagePreview(body, read)).toBe(body)
    }
    expect(read).not.toHaveBeenCalled()
  })

  it('skips system notices, system sources, deleted and blank messages across pages', async () => {
    const body = message('9007199254740993')
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [message('9007199254740997', { kind: 'system' })],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        messages: [
          body,
          message('9007199254740994', { source: 'system' }),
          message('9007199254740995', { deletedAt: '2026-09-11T00:00:00Z' }),
          message('9007199254740996', { text: '  ' }),
        ],
        hasMore: false,
      })
    expect(
      await resolveRoomMessagePreview(message('9007199254740998', { kind: 'system' }), read),
    ).toBe(body)
    expect(read.mock.calls).toEqual([['9007199254740998'], ['9007199254740997']])
  })

  it('returns empty for rooms with only system events and guards non-progressing pages', async () => {
    const system = message('2', { kind: 'system' })
    expect(
      await resolveRoomMessagePreview(system, async () => ({ messages: [system], hasMore: true })),
    ).toBeNull()
    expect(
      await resolveRoomMessagePreview(system, async () => ({ messages: [], hasMore: false })),
    ).toBeNull()
    expect(await resolveRoomMessagePreview(null, vi.fn())).toBeNull()
  })

  it('keeps attachment-only user content eligible and selects the newest body', async () => {
    const attachment = message('3', {
      kind: 'attachment',
      text: null,
      attachments: [{ attachmentId: 'file', mediaKind: 'image', name: 'photo.png', mimeType: 'image/png', byteSize: '10', sha256: 'hash', status: 'ready', downloadRef: 'file' }],
    })
    expect(isRoomPreviewMessage(attachment)).toBe(true)
    expect(
      await resolveRoomMessagePreview(message('4', { kind: 'system' }), async () => ({
        messages: [attachment, message('1')],
        hasMore: false,
      })),
    ).toBe(attachment)
  })
})

// @covers packages/app/src/features/rooms/roomShare.ts
// @covers packages/app/src/features/rooms/components/RoomShareContent.tsx
import { describe, expect, it } from 'vitest'
import {
  ROOM_INVITE_INSTALL_URL,
  resolveRoomShare,
  roomShareCopyValue,
} from '../features/rooms/roomShare'

const groupUrl = 'https://app.shennian.net/spaces/test-room'
const inviteUrl = groupUrl + '?invite=test-invite'

describe('Room share presentation', () => {
  it('copies one complete invitation for App, Desktop, Web and system sharing', () => {
    expect(roomShareCopyValue({
      title: '邀请你加入神念群聊「八仙」。',
      instruction: '直接点击，或把本消息发给你的 AI，让它安装神念、完成配对并加入群聊。',
      url: inviteUrl,
      urlLabel: '邀请',
      installLabel: '安装',
    })).toBe([
      '邀请你加入神念群聊「八仙」。',
      '直接点击，或把本消息发给你的 AI，让它安装神念、完成配对并加入群聊。',
      '邀请：' + inviteUrl,
      '安装：' + ROOM_INVITE_INSTALL_URL,
    ].join('\n'))
  })

  it('uses the complete invitation URL for open and approval Rooms', () => {
    expect(resolveRoomShare(groupUrl, inviteUrl, 'open')).toEqual({
      url: inviteUrl, purpose: 'invite', hintKey: 'spaces_share_join_hint',
    })
    expect(resolveRoomShare(groupUrl, inviteUrl, 'approval')).toEqual({
      url: inviteUrl, purpose: 'invite', hintKey: 'spaces_share_approval_hint',
    })
  })
  it('drops the invitation capability immediately when invitations close, even with a cached invite', () => {
    expect(resolveRoomShare(groupUrl, inviteUrl, 'closed')).toEqual({
      url: groupUrl, purpose: 'open', hintKey: 'spaces_share_closed_hint',
    })
    expect(resolveRoomShare(groupUrl, '', 'closed')?.url).toBe(groupUrl)
  })
  it('does not misrepresent a failed invitation load as a shareable group invitation', () => {
    expect(resolveRoomShare(groupUrl, '', 'open')).toBeNull()
    expect(resolveRoomShare(groupUrl, '', 'approval')).toBeNull()
  })
  it('uses the fresh invitation after reset or reopening', () => {
    const fresh = groupUrl + '?invite=reset-invite'
    expect(resolveRoomShare(groupUrl, fresh, 'open')?.url).toBe(fresh)
    expect(resolveRoomShare(groupUrl, '', 'closed')?.purpose).toBe('open')
    expect(resolveRoomShare(groupUrl, fresh, 'approval')?.purpose).toBe('invite')
  })
})

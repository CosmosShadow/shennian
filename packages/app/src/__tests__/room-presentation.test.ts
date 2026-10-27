// @covers packages/app/src/features/rooms/roomPresentation.ts

import { describe, expect, it } from 'vitest'
import {
  avatarFromSnapshot,
  groupRoomMembers,
  isOwnRoomAuthor,
  isRoomImageOnlyMessage,
  linkedAgentSessionId,
  roomAttachmentExpiryKind,
  isRoomVideoAttachment,
  splitAttachmentName,
  roomMessageAvatars,
} from '../features/rooms/roomPresentation'
import type { RoomMemberView } from '../features/rooms/types'

function member(
  input: Partial<RoomMemberView> &
    Pick<RoomMemberView, 'id' | 'principalType' | 'ownerUserId' | 'displayAlias'>,
): RoomMemberView {
  return {
    parentHumanMembershipId: null,
    role: 'member',
    joinedAt: '2026-08-23T00:00:00.000Z',
    avatar: null,
    ownerAvatar: null,
    ...input,
  }
}

describe('Room member and message presentation', () => {
  it('removes the surrounding bubble only from non-empty image-only messages', () => {
    const image = { mediaKind: 'image' }
    expect(isRoomImageOnlyMessage({ attachments: [image], text: '', deletedAt: null })).toBe(true)
    expect(isRoomImageOnlyMessage({ attachments: [image], text: '说明', deletedAt: null })).toBe(false)
    expect(isRoomImageOnlyMessage({ attachments: [image, { mediaKind: 'file' }], text: '' })).toBe(false)
    expect(isRoomImageOnlyMessage({ attachments: [], text: '' })).toBe(false)
    expect(isRoomImageOnlyMessage({ attachments: [image], text: '', deletedAt: 'now' })).toBe(false)
  })

  it('keeps the extension separate so long names can ellipsize without losing it', () => {
    expect(splitAttachmentName('ScreenRecording_09-19-2026 14-07-33_1.mov'))
      .toEqual({ stem: 'ScreenRecording_09-19-2026 14-07-33_1', ext: '.mov' })
    expect(splitAttachmentName('archive.tar.gz')).toEqual({ stem: 'archive.tar', ext: '.gz' })
    expect(splitAttachmentName('README')).toEqual({ stem: 'README', ext: '' })
    expect(splitAttachmentName('.env')).toEqual({ stem: '.env', ext: '' })
    expect(splitAttachmentName('trailing.')).toEqual({ stem: 'trailing.', ext: '' })
  })

  it('treats video by media kind or mime type so legacy file-kind uploads still preview', () => {
    expect(isRoomVideoAttachment({ mediaKind: 'file', mimeType: 'video/quicktime' })).toBe(true)
    expect(isRoomVideoAttachment({ mediaKind: 'video', mimeType: '' })).toBe(true)
    expect(isRoomVideoAttachment({ mediaKind: 'file', mimeType: 'application/pdf' })).toBe(false)
  })

  it('separates expired images and files from retryable attachment failures', () => {
    const now = Date.parse('2026-09-17T00:00:00.000Z')
    expect(roomAttachmentExpiryKind({
      mediaKind: 'image', status: 'expired', expiresAt: null,
    }, now)).toBe('image')
    expect(roomAttachmentExpiryKind({
      mediaKind: 'file', status: 'ready', expiresAt: '2026-09-16T23:59:59.000Z',
    }, now)).toBe('attachment')
    expect(roomAttachmentExpiryKind({
      mediaKind: 'image', status: 'ready', expiresAt: '2026-09-18T00:00:00.000Z',
    }, now)).toBeNull()
    expect(roomAttachmentExpiryKind({
      mediaKind: 'audio', status: 'ready', expiresAt: undefined,
    }, now)).toBeNull()
  })

  it('pins the current human first and nests every Agent under its owner', () => {
    const alice = member({
      id: 'alice-human',
      principalType: 'human',
      ownerUserId: 'alice',
      displayAlias: 'Alice',
      joinedAt: '2026-08-23T00:00:02.000Z',
    })
    const bob = member({
      id: 'bob-human',
      principalType: 'human',
      ownerUserId: 'bob',
      displayAlias: 'Bob',
    })
    const agent = member({
      id: 'alice-agent',
      principalType: 'agent',
      ownerUserId: 'alice',
      parentHumanMembershipId: alice.id,
      displayAlias: 'Backend',
    })
    const groups = groupRoomMembers([bob, agent, alice], 'alice')
    expect(groups.map((group) => group.human.id)).toEqual(['alice-human', 'bob-human'])
    expect(groups[0]?.agents.map((item) => item.id)).toEqual(['alice-agent'])
    expect(groups[0]?.isSelf).toBe(true)
  })

  it('uses owner identity for own Agent messages and rejects malformed avatars', () => {
    expect(
      isOwnRoomAuthor(
        { membershipId: 'm', principalType: 'agent', ownerUserId: 'alice', displayName: 'Backend' },
        'alice',
      ),
    ).toBe(true)
    expect(avatarFromSnapshot({ smallUrl: '/small', mediumUrl: '/medium' })).toEqual({
      smallUrl: '/small',
      mediumUrl: '/medium',
    })
    expect(avatarFromSnapshot({ smallUrl: '/small' })).toBeNull()
  })

  it('replaces cached message avatars with the active member identity', () => {
    const snapshot = { smallUrl: '/old-small', mediumUrl: '/old-medium' }
    const currentHuman = member({
      id: 'alice-human', principalType: 'human', ownerUserId: 'alice', displayAlias: 'Alice',
      avatar: { version: 'v2', smallUrl: '/new-small', mediumUrl: '/new-medium', updatedAt: 'now' },
    })
    const currentAgent = member({
      id: 'alice-agent', principalType: 'agent', ownerUserId: 'alice', displayAlias: 'Agent',
      avatar: null, ownerAvatar: currentHuman.avatar,
    })

    expect(roomMessageAvatars(snapshot, currentHuman, false)).toEqual({
      avatar: currentHuman.avatar, ownerAvatar: null,
    })
    expect(roomMessageAvatars(snapshot, currentAgent, true)).toEqual({
      avatar: null, ownerAvatar: currentHuman.avatar,
    })
    expect(roomMessageAvatars(snapshot, { ...currentHuman, avatar: null }, false).avatar).toBeNull()
    expect(roomMessageAvatars(snapshot, undefined, true)).toEqual({
      avatar: snapshot, ownerAvatar: snapshot,
    })
  })

  it('opens only an exact active or paused own Agent Session binding', () => {
    const ownAgent = member({
      id: 'alice-agent',
      principalType: 'agent',
      ownerUserId: 'alice',
      displayAlias: 'Backend',
      ownBinding: {
        agentMembershipId: 'alice-agent',
        nianSessionId: 'nian_1',
        status: 'active',
        activationMode: 'auto_follow',
        lastMessagePreview: '最新回复',
      },
    })
    expect(linkedAgentSessionId(ownAgent, 'alice')).toBe('nian_1')
    expect(
      linkedAgentSessionId(
        {
          ...ownAgent,
          ownBinding: { ...ownAgent.ownBinding!, status: 'paused' },
        },
        'alice',
      ),
    ).toBe('nian_1')
    expect(linkedAgentSessionId(ownAgent, 'bob')).toBeNull()
    expect(
      linkedAgentSessionId(
        {
          ...ownAgent,
          ownBinding: { ...ownAgent.ownBinding!, status: 'detached' },
        },
        'alice',
      ),
    ).toBeNull()
    expect(
      linkedAgentSessionId(
        {
          ...ownAgent,
          ownBinding: { ...ownAgent.ownBinding!, nianSessionId: null },
        },
        'alice',
      ),
    ).toBeNull()
  })
})

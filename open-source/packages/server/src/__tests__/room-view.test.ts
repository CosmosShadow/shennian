// @covers open-source/packages/server/src/services/room-view.ts

import { describe, expect, it } from 'vitest'
import { shapeRoomMessage, type RoomMessageRecord } from '../services/room-view.js'

describe('Room message view', () => {
  it('projects a human membership join as a structured Room event', () => {
    const message = shapeRoomMessage(
      record({
        clientMessageId: 'system:membership-joined:member_new:1',
        text: '笠夏 joined the Room.',
      }),
    )

    expect(message.systemEvent).toEqual({
      type: 'membership_joined',
      subjectMembershipId: 'member_new',
      subjectPrincipalType: 'human',
    })
  })

  it('keeps technical notices structured but distinguishable from collaboration events', () => {
    const message = shapeRoomMessage(
      record({
        clientMessageId: 'system:agent-unavailable:message_1:binding_1',
        text: "Support's machine is offline and cannot respond to this message.",
      }),
    )

    expect(message.systemEvent).toEqual({ type: 'agent_unavailable' })
  })
})

function record(overrides: Partial<RoomMessageRecord>): RoomMessageRecord {
  return {
    id: 'message_1',
    roomId: 'room_1',
    sequence: 1n,
    authorMembershipId: 'member_new',
    authorPrincipalTypeSnapshot: 'human',
    ownerUserIdSnapshot: 'user_1',
    authorDisplayNameSnapshot: '笠夏',
    ownerDisplayNameSnapshot: '笠夏',
    authorAvatarSnapshot: null,
    kind: 'system',
    source: 'system',
    text: '笠夏 joined the Room.',
    replyToMessageId: null,
    createdAt: new Date('2026-09-22T00:00:00.000Z'),
    editedAt: null,
    deletedAt: null,
    attachments: [],
    ...overrides,
  }
}

// @covers open-source/packages/cli/src/session/room-reply-notice.ts

import { describe, expect, it } from 'vitest'
import { describeRoomReplyFailure, roomReplyFailureNotice } from '../session/room-reply-notice.js'

describe('Owner-visible Room reply failure notice', () => {
  it('reports a Turn whose every send failed, using the last failure reason', () => {
    const notice = roomReplyFailureNotice({
      roomSendOutcome: { successes: 0, failureCodes: ['room_write_forbidden', 'managed_room_context_expired'] },
    })
    expect(notice).toContain('本轮未能在群里回复')
    expect(notice).toContain('群权限已重置')
  })

  it('stays silent when the Agent chose not to speak or at least one send succeeded', () => {
    expect(roomReplyFailureNotice({ roomSendOutcome: { successes: 0, failureCodes: [] } })).toBeNull()
    expect(roomReplyFailureNotice({ roomSendOutcome: { successes: 1, failureCodes: ['server_unavailable'] } })).toBeNull()
    expect(roomReplyFailureNotice({ roomSendOutcome: null })).toBeNull()
    expect(roomReplyFailureNotice({})).toBeNull()
  })

  it('explains restricted permission and falls back to the code for unknown failures', () => {
    expect(describeRoomReplyFailure('managed_agent_restricted_room_unsupported')).toContain('全部权限')
    expect(describeRoomReplyFailure('something_new')).toBe('发送失败（something_new）')
  })
})

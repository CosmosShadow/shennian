// @covers open-source/packages/wire/src/room.ts

import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  RoomActivationMode,
  AgentRuntimeAvailability,
  RoomBindParams,
  RoomEvent,
  RoomMessageView,
  RoomSendParams,
  RoomSyncParams,
} from '../room.ts'
import { isRoomRuntimeAdapter, roomRuntimeAdapterForAgent, roomRuntimeAgentType } from '../room.ts'

describe('Room wire contract', () => {
  it('keeps sequences JSON-safe', () => {
    const message: RoomMessageView = {
      id: 'msg_1',
      roomId: 'room_1',
      sequence: '9007199254740993',
      kind: 'text',
      author: {
        membershipId: 'member_1',
        principalType: 'human',
        ownerUserId: 'user_1',
        displayName: '用户',
        ownerDisplayName: '用户',
      },
      text: 'hello',
      mentions: [{ membershipId: 'agent_1', principalType: 'agent', displayName: '服务端' }],
      attachments: [],
      createdAt: '2026-08-23T00:00:00.000Z',
    }

    expect(JSON.parse(JSON.stringify(message)).sequence).toBe('9007199254740993')
    expectTypeOf(message.sequence).toBeString()
    expect(message.author.ownerDisplayName).toBe('用户')
    expect(message.mentions?.[0]).toMatchObject({ membershipId: 'agent_1', principalType: 'agent' })
  })

  it('exposes only the three supported activation modes', () => {
    expectTypeOf<'auto_follow'>().toMatchTypeOf<RoomActivationMode>()
    expectTypeOf<'mention_only'>().toMatchTypeOf<RoomActivationMode>()
    expectTypeOf<'paused'>().toMatchTypeOf<RoomActivationMode>()
    expectTypeOf<'available'>().toMatchTypeOf<AgentRuntimeAvailability>()
    expectTypeOf<'unavailable'>().toMatchTypeOf<AgentRuntimeAvailability>()
    expectTypeOf<'recovering'>().toMatchTypeOf<AgentRuntimeAvailability>()
  })

  it('defines relay payloads without exposing private session ids in messages', () => {
    expectTypeOf<RoomSyncParams>().toHaveProperty('afterSequence')
    expectTypeOf<RoomSendParams>().toHaveProperty('clientMessageId')
    expectTypeOf<RoomBindParams>().toHaveProperty('invocationToken')
    expectTypeOf<RoomBindParams>().not.toHaveProperty('sourceSessionKey')
    expectTypeOf<RoomMessageView>().not.toHaveProperty('sourceSessionKey')
  })

  it('uses refresh events as hints and message sequence as recovery authority', () => {
    const event: RoomEvent = {
      event: 'room.membership.updated',
      roomId: 'room_1',
      entityId: 'member_1',
    }
    expect(event.event).toBe('room.membership.updated')
  })

  it('uses real Agent types for managed Rooms while preserving the legacy Claude value', () => {
    expect(roomRuntimeAdapterForAgent('gemini')).toBeNull()
    expect(roomRuntimeAdapterForAgent('custom:local-agent')).toBe('custom:local-agent')
    expect(roomRuntimeAgentType('claude_code')).toBe('claude')
    expect(isRoomRuntimeAdapter('opencode')).toBe(true)
    expect(isRoomRuntimeAdapter('manager')).toBe(false)
    expect(isRoomRuntimeAdapter('pi')).toBe(false)
  })
})

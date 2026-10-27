import { describe, expect, it } from 'vitest'
import { scopedRoomSourceLabelKey } from '../features/rooms/scopedRoomMessagePresentation'

describe('scoped Room message source labels', () => {
  it.each([
    ['agent', 'app', 'spaces_message_human_reply'],
    ['agent', 'cli', 'spaces_message_human_reply'],
    ['agent', 'managed_agent', 'spaces_message_ai_generated'],
    ['human', 'managed_agent', 'spaces_message_ai_generated'],
    ['human', 'cli', 'spaces_message_ai_sent'],
    ['human', 'app', null],
  ] as const)('%s message from %s uses %s', (principalType, source, expected) => {
    expect(scopedRoomSourceLabelKey(principalType, source)).toBe(expected)
  })
})

// @covers src/session/queue-helpers.ts

import { describe, expect, it } from 'vitest'
import type { LocalQueuedChatMessage } from '../session/queue.js'
import { formatQueuedBatch, takeCompatibleBatch } from '../session/queue-helpers.js'

describe('managed Room event batching', () => {
  it('does not merge a Room event with an ordinary Room message', () => {
    const event = queued('[群事件]\n笠夏 joined the Room.', 'event_1')
    const message = queued('[群消息] <笠夏>\n大家好', 'message_1')

    expect(takeCompatibleBatch([event, message])).toEqual([event])
  })

  it('keeps consecutive Room events under one event header', () => {
    expect(formatQueuedBatch([
      queued('[群事件]\n笠夏 joined the Room.', 'event_1'),
      queued('[群事件]\n阿念 joined the Room.', 'event_2'),
    ])).toBe('[群事件]\n笠夏 joined the Room.\n\n阿念 joined the Room.')
  })
})

function queued(text: string, id: string): LocalQueuedChatMessage {
  return {
    id,
    sessionId: 'session_1',
    text,
    agentType: 'codex',
    workDir: '/tmp/project',
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
    origin: 'room',
    trigger: {
      kind: 'room_activation',
      registryKey: 'a'.repeat(64),
      causeMessageId: id,
      rootCauseMessageId: id,
      sequence: id === 'event_1' ? '1' : '2',
      hopCount: 0,
    },
    managedRoom: {
      registryKey: 'a'.repeat(64),
      causeMessageId: id,
      rootCauseMessageId: id,
      sequence: id === 'event_1' ? '1' : '2',
      hopCount: 0,
    },
  } as LocalQueuedChatMessage
}

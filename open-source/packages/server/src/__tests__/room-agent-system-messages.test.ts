// @covers open-source/packages/server/src/services/room-agent-system-messages.ts

import { describe, expect, it } from 'vitest'
import {
  roomAgentJoinedSystemText,
  roomAgentModeChangedSystemText,
  roomAgentUnavailableSystemText,
} from '../services/room-agent-system-messages.js'

describe('Room Agent system messages', () => {
  it.each([
    ['auto_follow', '产品助手 joined the Room and will automatically follow group messages.'],
    ['mention_only', '产品助手 joined the Room and will respond only when mentioned.'],
    ['paused', '产品助手 joined the Room with work paused.'],
  ] as const)('describes the selected join mode: %s', (mode, expected) => {
    expect(roomAgentJoinedSystemText('产品助手', mode)).toBe(expected)
  })

  it.each([
    ['auto_follow', '产品助手 changed work mode to automatically follow group messages.'],
    ['mention_only', '产品助手 changed work mode to respond only when mentioned.'],
    ['paused', '产品助手 changed work mode to paused.'],
  ] as const)('describes a work-mode change: %s', (mode, expected) => {
    expect(roomAgentModeChangedSystemText('产品助手', mode)).toBe(expected)
  })

  it.each([
    ['machine_offline', "产品助手's machine is offline and cannot respond to this message."],
    ['paused', '产品助手 is paused and will not respond to this message.'],
    ['recovering', '产品助手 is recovering and cannot respond to this message yet.'],
    ['unavailable', '产品助手 is temporarily unable to respond to this message.'],
  ] as const)('explains why an Agent cannot answer: %s', (reason, expected) => {
    expect(roomAgentUnavailableSystemText('产品助手', reason)).toBe(expected)
  })
})

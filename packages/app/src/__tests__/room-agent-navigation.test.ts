// @covers packages/app/src/features/rooms/roomAgentNavigation.ts

import { describe, expect, it } from 'vitest'
import {
  getRoomWorkspaceHeaderDetailsTarget,
  getRoomWorkspacePageIndex,
  getRoomWorkspaceSessionIdAtPage,
  usesInlineRoomDetails,
} from '../features/rooms/roomAgentNavigation'

describe('Room Agent navigation transitions', () => {
  it('keeps compact Room details in the native navigation stack', () => {
    expect(usesInlineRoomDetails(820)).toBe(false)
  })

  it('keeps inline Room details on the wide layout breakpoint', () => {
    expect(usesInlineRoomDetails(1024)).toBe(true)
  })

  it('keeps the wide Room header separate from the dedicated Agent settings button', () => {
    expect(getRoomWorkspaceHeaderDetailsTarget(true, 'agent-one')).toBe('room')
    expect(getRoomWorkspaceHeaderDetailsTarget(true, null)).toBe('room')
    expect(getRoomWorkspaceHeaderDetailsTarget(false, 'agent-one')).toBe('agent')
    expect(getRoomWorkspaceHeaderDetailsTarget(false, null)).toBe('room')
  })

  it('maps every Agent to its own page after the group conversation', () => {
    const sessions = ['agent-one', 'agent-two', 'agent-three']
    expect(getRoomWorkspacePageIndex(sessions, null)).toBe(0)
    expect(getRoomWorkspacePageIndex(sessions, 'agent-two')).toBe(2)
    expect(getRoomWorkspaceSessionIdAtPage(sessions, 0)).toBeNull()
    expect(getRoomWorkspaceSessionIdAtPage(sessions, 1)).toBe('agent-one')
    expect(getRoomWorkspaceSessionIdAtPage(sessions, 2)).toBe('agent-two')
    expect(getRoomWorkspaceSessionIdAtPage(sessions, 3)).toBe('agent-three')
  })

  it('round-trips one narrow-screen pane through an exact Agent and back to the same Room', () => {
    const viewportWidth = 390
    const sessions = ['agent-one', 'agent-two', 'agent-three']
    let activeSessionId: string | null = null

    expect(usesInlineRoomDetails(viewportWidth)).toBe(false)
    expect(getRoomWorkspacePageIndex(sessions, activeSessionId)).toBe(0)

    activeSessionId = 'agent-two'
    const agentPage = getRoomWorkspacePageIndex(sessions, activeSessionId)
    expect(agentPage).toBe(2)
    expect(getRoomWorkspaceSessionIdAtPage(sessions, agentPage)).toBe('agent-two')

    activeSessionId = getRoomWorkspaceSessionIdAtPage(sessions, 0)
    expect(activeSessionId).toBeNull()
    expect(getRoomWorkspacePageIndex(sessions, activeSessionId)).toBe(0)
  })

  it('falls back safely when a removed Agent or stale page is selected', () => {
    expect(getRoomWorkspacePageIndex(['agent-one'], 'removed-agent')).toBe(0)
    expect(getRoomWorkspaceSessionIdAtPage(['agent-one'], 99)).toBe('agent-one')
    expect(getRoomWorkspaceSessionIdAtPage([], 1)).toBeNull()
  })
})

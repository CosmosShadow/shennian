// @covers src/features/unread/unreadNavigation.ts

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NianSession, RoomSummary } from '@shennian/wire'
import { getOtherProjectsUnreadCount, getUnreadNavigationSummary } from '../features/unread/unreadNavigation'

function session(id: string, overrides: Partial<NianSession> = {}): NianSession {
  return {
    id,
    machineId: 'machine-1',
    userId: 'user-1',
    agentType: 'codex',
    agentSessionId: `native-${id}`,
    modelId: null,
    title: id,
    status: 'active',
    workDir: '/repo',
    lastMessagePreview: 'reply',
    lastActivityAt: '2026-08-29T10:01:00.000Z',
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:01:00.000Z',
    userState: {
      userId: 'user-1',
      sessionId: id,
      manualUnread: true,
      pinnedAt: null,
      lastReadAt: null,
      updatedAt: '2026-08-29T10:01:00.000Z',
    },
    activity: null,
    ...overrides,
  }
}

describe('unread navigation summary', () => {
  it('derives Room unread totals from the shared Room list projection', () => {
    const hook = readFileSync(resolve(__dirname, '../features/unread/useUnreadNavigation.ts'), 'utf8')
    expect(hook).toContain('subscribeRoomListSnapshots')
    expect(hook).not.toMatch(/roomAccountClient|authApi|fetch\s*\(|subscribeRoomEvents/)
  })
  it('keeps visitor unread on agents instead of silently losing it or counting it as a project', () => {
    expect(getUnreadNavigationSummary([], [], {}, { 'agent-1': 3, 'agent-2': 2 }).tabs)
      .toEqual({ rooms: 0, projects: 0, agents: 5 })
  })
  it('counts unread Rooms once regardless of their historical message count', () => {
    const normal = session('normal')
    const roomAgent = session('room-agent', { agentIdentityId: 'agent-1' })
    const standaloneAgent = session('standalone-agent', { agentIdentityId: 'agent-2' })
    const rooms = [{ id: 'room-1', unreadCount: 3 }] as RoomSummary[]

    expect(
      getUnreadNavigationSummary([normal, roomAgent, standaloneAgent], rooms, {
        normal: 2,
        'room-agent': 4,
        'standalone-agent': 8,
      }),
    ).toEqual({
      projectSessionCount: 2,
      agentSessionCount: 0,
      roomMessageCount: 1,
      tabs: { projects: 2, rooms: 1, agents: 0 },
    })
  })

  it('does not treat working state as unread', () => {
    const working = session('working', {
      userState: {
        userId: 'user-1',
        sessionId: 'working',
        manualUnread: false,
        pinnedAt: null,
        lastReadAt: '2026-08-29T10:02:00.000Z',
        updatedAt: '2026-08-29T10:02:00.000Z',
      },
      activity: {
        sessionId: 'working',
        runId: 'run-1',
        runPhase: 'thinking',
        startedAt: '2026-08-29T10:01:00.000Z',
        updatedAt: '2026-08-29T10:01:00.000Z',
      },
    })

    expect(getUnreadNavigationSummary([working], [], { working: 0 }).tabs).toEqual({
      projects: 0,
      rooms: 0,
      agents: 0,
    })
  })
})

describe('project back unread badge', () => {
  it('counts only other projects on accessible ordinary sessions', () => {
    const sessions = [
      session('current'),
      session('other-dir', { workDir: '/other' }),
      session('other-machine', { machineId: 'machine-2' }),
      session('managed', { workDir: '/other', agentIdentityId: 'agent-1' }),
    ]
    const counts = { current: 9, 'other-dir': 2, 'other-machine': 3, managed: 20, stale: 99 }
    const currentProject = { machineId: 'machine-1', workDir: '/repo' }
    expect(getOtherProjectsUnreadCount(sessions, currentProject, counts)).toBe(5)
    expect(getOtherProjectsUnreadCount(sessions, currentProject, {})).toBe(0)
    expect(getOtherProjectsUnreadCount(sessions, currentProject, {
      ...counts, 'other-dir': 0, 'other-machine': 0,
    })).toBe(0)
  })

  it('normalizes Windows paths without collapsing different machines', () => {
    const sessions = [
      session('current', { workDir: 'C:\\repo' }),
      session('other', { machineId: 'machine-2', workDir: 'C:/repo' }),
    ]
    expect(getOtherProjectsUnreadCount(
      sessions,
      { machineId: 'machine-1', workDir: 'C:/repo' },
      { current: 5, other: 2 },
    )).toBe(2)
  })
})

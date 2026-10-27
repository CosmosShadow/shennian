// @arch docs/features/unread-notification-center.md
// @test src/__tests__/unread-navigation.test.ts

import { buildProjectKey, filterProjectSessions } from '@shennian/shared'
import type { NianSession, RoomSummary } from '@shennian/wire'

export type UnreadNavigationSummary = {
  projectSessionCount: number
  agentSessionCount: number
  roomMessageCount: number
  tabs: { projects: number; rooms: number; agents: number }
}

export function getUnreadNavigationSummary(
  sessions: NianSession[],
  rooms: Pick<RoomSummary, 'unreadCount'>[],
  sessionUnreadCounts: Readonly<Record<string, number>>,
  ownerDirectUnread: Readonly<Record<string, number>> = {},
): UnreadNavigationSummary {
  const projectSessionIds = new Set(filterProjectSessions(sessions).map((session) => session.id))
  const projectSessionCount = sessions.reduce(
    (total, session) =>
      total + (projectSessionIds.has(session.id) ? (sessionUnreadCounts[session.id] ?? 0) : 0),
    0,
  )
  const agentSessionCount = 0
  // A room-bound Agent reply is persisted both in its internal Session and in
  // the Room stream. The Room sequence is the only user-facing unread source;
  // counting the internal Session would turn one visible reply into two.
  const roomMessageCount = rooms.reduce(
    (total, room) => total + ((room.unreadCount ?? 0) > 0 ? 1 : 0),
    0,
  )

  return {
    projectSessionCount,
    agentSessionCount,
    roomMessageCount,
    tabs: {
      projects: projectSessionCount,
      rooms: roomMessageCount,
      agents: Object.values(ownerDirectUnread).reduce((sum, count) => sum + count, 0),
    },
  }
}

// Parent navigation advertises only sibling projects, never the current project
// or managed/Room sessions. Reuse the same normalized identity and count cache
// as the project rows rather than deriving a second unread truth from activity.
export function getOtherProjectsUnreadCount(
  sessions: NianSession[],
  currentProject: { machineId: string; workDir: string },
  sessionUnreadCounts: Readonly<Record<string, number>>,
): number {
  const currentKey = buildProjectKey(currentProject.machineId, currentProject.workDir)
  return filterProjectSessions(sessions).reduce(
    (total, session) =>
      buildProjectKey(session.machineId, session.workDir) === currentKey
        ? total
        : total + (sessionUnreadCounts[session.id] ?? 0),
    0,
  )
}

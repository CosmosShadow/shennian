// @arch docs/features/desktop-local-first-client.md#7-信息架构
// @test ../../__tests__/desktop-shell-controller.test.ts

import {
  filterProjectSessions,
  groupSessionsIntoProjects,
  sortProjects,
} from '@shennian/shared'
import type { Machine, NianProject, NianSession } from '@shennian/wire'
import { getProjectPrefsSnapshot } from '../projects/utils/projectPrefs'

type DesktopProjectPrefs = ReturnType<typeof getProjectPrefsSnapshot>

export function selectDesktopRootSession(input: {
  sessions: NianSession[]
  machines: Machine[]
  projects: NianProject[]
  prefs: DesktopProjectPrefs
}): string | null {
  const machineNames = new Map(input.machines.map((machine) => [machine.id, machine.name]))
  const sessions = filterProjectSessions(input.sessions).map((session) => ({
    ...session,
    machineName: machineNames.get(session.machineId)?.trim() || session.machineName,
  }))
  const projects = sortProjects(groupSessionsIntoProjects(sessions, input.projects), {
    isPinned: (project) => Boolean(input.prefs[project.key]?.pinnedAt),
  })
  return projects[0]?.latestSessionId || sessions[0]?.id || null
}

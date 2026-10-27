// @arch docs/architecture/session-organization.md#端侧形态
// @test packages/app/src/__tests__/desktop-project-navigation.test.ts

import {
  filterProjectSessions,
  groupSessionsIntoProjects,
  type SessionProject,
} from '@shennian/shared'
import type { Machine, NianProject, NianSession } from '@shennian/wire'

export type DesktopProjectNavigation = {
  projects: SessionProject[]
  sessions: NianSession[]
  showMachineName: boolean
}

/**
 * Builds Desktop project navigation only from the current account's visible
 * machine inventory. Cached project/session rows cannot retain a machine after
 * its grant is revoked, and inventory ordering cannot change prefix behavior.
 */
export function buildDesktopProjectNavigation(
  sessions: NianSession[],
  projectRecords: NianProject[],
  visibleMachines: Machine[],
): DesktopProjectNavigation {
  const machinesById = new Map<string, Machine>()
  for (const machine of visibleMachines) machinesById.set(machine.id, machine)

  const visibleSessions: NianSession[] = []
  for (const session of filterProjectSessions(sessions)) {
    const machine = machinesById.get(session.machineId)
    if (!machine) continue
    const machineName = machine.name.trim()
    visibleSessions.push(
      machineName && machineName !== session.machineName ? { ...session, machineName } : session,
    )
  }
  const visibleProjectRecords = projectRecords
    .filter((project) => machinesById.has(project.machineId))
    .map((project) => {
      const machineName = machinesById.get(project.machineId)?.name.trim()
      return machineName && machineName !== project.machineName
        ? { ...project, machineName }
        : project
    })

  return {
    projects: groupSessionsIntoProjects(visibleSessions, visibleProjectRecords),
    sessions: visibleSessions,
    showMachineName: machinesById.size > 1,
  }
}

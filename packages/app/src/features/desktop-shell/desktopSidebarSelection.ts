// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-sidebar-width.test.ts

import { buildProjectKey } from '@shennian/shared'

type ProjectSession = { id: string; machineId: string; workDir: string }

function routeValue(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value ? value : Array.isArray(value) && value.length === 1
    ? value[0] ?? null
    : null
}

export function getActiveSidebarProjectKey(input: {
  pathname: string
  machineId?: string | string[]
  workDir?: string | string[]
  sessions: ProjectSession[]
}): string | null {
  const activeSession = input.sessions.find((session) => input.pathname.includes(`/chat/${session.id}`))
  if (activeSession) return buildProjectKey(activeSession.machineId, activeSession.workDir)
  if (!input.pathname.includes('/project')) return null
  const machineId = routeValue(input.machineId)
  const workDir = routeValue(input.workDir)
  return machineId && workDir ? buildProjectKey(machineId, workDir) : null
}

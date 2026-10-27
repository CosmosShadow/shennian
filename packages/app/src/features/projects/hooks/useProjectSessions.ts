// @arch docs/architecture/session-organization.md
// @test packages/app/src/__tests__/project-list-performance.test.ts
import { useMemo } from 'react'
import type { NianSession } from '@shennian/wire'
import { useShallow } from 'zustand/react/shallow'
import { buildProjectKey, filterProjectSessions, useSessionsStore } from '@shennian/shared'

/** Store selectors also run on preview/loading writes; only scan a new index. */
export function createProjectSessionSelector(machineId: string, workDir: string) {
  const key = buildProjectKey(machineId, workDir)
  let previous: NianSession[] | undefined
  let result: NianSession[] = []
  return (store: { sessions: NianSession[] }) => {
    if (store.sessions !== previous) {
      result = filterProjectSessions(store.sessions).filter(
        session => buildProjectKey(session.machineId, session.workDir) === key,
      )
      previous = store.sessions
    }
    return result
  }
}

/** Unrelated project activity must not invalidate this page's session array. */
export function useProjectSessions(machineId: string, workDir: string) {
  const select = useMemo(() => createProjectSessionSelector(machineId, workDir), [machineId, workDir])
  return useSessionsStore(useShallow(select))
}

// @arch docs/architecture/session-organization.md
// @test ../../../__tests__/desktop-project-boundary.test.ts
import { useEffect, useMemo, useState } from 'react'
import { buildProjectKey, useMachinesStore, useProjectsStore } from '@shennian/shared'
import { useAuthStore } from '../../../config/auth'
import { desktopAccountActions } from '../../desktop-control/useDesktopAccountSync'
import type { DesktopProjectAlias } from '../../desktop-control/desktopProjectContracts'
import { rememberProjectAlias } from '../utils/projectPrefs'
import { loadDesktopProjectAliases, visibleDesktopProjects } from '../utils/desktopProjectAliasProjection'

export function useVisibleProjectRecords() {
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const records = useProjectsStore((state) => state.projects)
  const machines = useMachinesStore((state) => state.machines)
  const [projection, setProjection] = useState<{ accountId: string; aliases: DesktopProjectAlias[] }>({ accountId: '', aliases: [] })
  useEffect(() => {
    if (!accountId) return
    let active = true
    void loadDesktopProjectAliases({
      resolve: () => desktopAccountActions.resolveProjectAliases(),
      isCurrent: () => active && useAuthStore.getState().user?.id === accountId,
      records: () => useProjectsStore.getState().projects,
      commit: (aliases) => {
        for (const alias of aliases) {
          rememberProjectAlias(accountId, buildProjectKey(alias.machineId, alias.aliasWorkDir),
            buildProjectKey(alias.machineId, alias.workDir), { id: alias.projectId, workDir: alias.workDir })
        }
        setProjection({ accountId, aliases })
      },
    }).catch(() => {
      // Failed discovery never rewrites projects; a later projects/machines revision retries.
    })
    return () => { active = false }
  }, [accountId, machines, records])
  return useMemo(() => visibleDesktopProjects(records, projection.accountId === accountId ? projection.aliases : []),
    [accountId, projection, records])
}

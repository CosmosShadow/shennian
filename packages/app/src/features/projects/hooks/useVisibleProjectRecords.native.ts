// @arch docs/architecture/session-organization.md
// @test packages/app/src/__tests__/project-alias-projection.test.ts
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { buildProjectKey, useMachinesStore, useProjectsStore } from '@shennian/shared'
import { useAuthStore } from '../../../config/auth'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import { isHomeDirectoryAlias, resolveProjectDirectory } from '../../machines/utils/projectDirectory'
import { getProjectPrefsSnapshot, hydrateProjectPrefs, rememberProjectAlias, subscribeProjectPrefs } from '../utils/projectPrefs'
import { projectAliasProjection } from '../utils/projectAliasProjection'

const pending = new Set<string>()

export function useVisibleProjectRecords() {
  const accountId = useAuthStore((s) => s.user?.id ?? '')
  const records = useProjectsStore((s) => s.projects)
  const machines = useMachinesStore((s) => s.machines)
  const prefs = useSyncExternalStore(subscribeProjectPrefs, getProjectPrefsSnapshot, getProjectPrefsSnapshot)
  useEffect(() => {
    if (!accountId) return
    for (const alias of records) {
      if (!isHomeDirectoryAlias(alias.workDir)) continue
      if (!machines.some((m) => m.id === alias.machineId && m.online)) continue
      const aliasKey = buildProjectKey(alias.machineId, alias.workDir)
      const key = `${accountId}\u0000${aliasKey}`
      if (prefs[key]?.resolvedProject || pending.has(key)) continue
      pending.add(key)
      void (async () => {
        const path = await resolveProjectDirectory(alias.machineId, alias.workDir, accountRuntime)
        if (useAuthStore.getState().user?.id !== accountId) return
        // Discovery never creates or deletes server projects. Missing targets stay visible.
        const canonical = useProjectsStore.getState().projects.find((p) =>
          p.machineId === alias.machineId && buildProjectKey(p.machineId, p.workDir) === buildProjectKey(alias.machineId, path),
        )
        if (!canonical || canonical.id === alias.id) return
        await hydrateProjectPrefs()
        if (useAuthStore.getState().user?.id !== accountId) return
        rememberProjectAlias(accountId, aliasKey, buildProjectKey(canonical.machineId, canonical.workDir), {
          id: canonical.id, workDir: canonical.workDir,
        })
      })().catch(() => {
        // Offline/denied paths stay visible and can retry through the existing project entry.
      }).finally(() => pending.delete(key))
    }
  }, [accountId, machines, prefs, records])
  return useMemo(() => projectAliasProjection(records, accountId, prefs), [accountId, prefs, records])
}

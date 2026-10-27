// @arch docs/architecture/session-organization.md
// @test packages/app/src/__tests__/project-alias-projection.test.ts
import type { NianProject } from '@shennian/wire'
import { buildProjectKey } from '@shennian/shared'
import type { ProjectPref } from './projectPrefs'
import { isHomeDirectoryAlias } from '../../machines/utils/projectDirectory'

/** Hide only a machine-verified alias whose canonical record is still accessible. */
export function projectAliasProjection(
  records: NianProject[],
  accountId: string,
  prefs: Record<string, ProjectPref>,
): NianProject[] {
  if (!accountId) return records
  return records.filter((alias) => {
    if (!isHomeDirectoryAlias(alias.workDir)) return true
    const target = prefs[`${accountId}\u0000${buildProjectKey(alias.machineId, alias.workDir)}`]?.resolvedProject
    if (!target) return true
    return !records.some((canonical) =>
      canonical.id === target.id && canonical.id !== alias.id &&
      canonical.machineId === alias.machineId && canonical.workDir === target.workDir &&
      !isHomeDirectoryAlias(canonical.workDir),
    )
  })
}

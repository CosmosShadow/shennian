// @arch docs/architecture/session-organization.md
// @test ../../../__tests__/desktop-project-boundary.test.ts
import type { NianProject } from '@shennian/wire'
import type { DesktopProjectAlias } from '../../desktop-control/desktopProjectContracts'

/** Main verifies directories. Renderer only joins still-visible canonical records. */
export function verifiedDesktopProjectAliases(records: NianProject[], aliases: DesktopProjectAlias[]) {
  return aliases.filter((entry) => entry.aliasId !== entry.projectId &&
    records.some((project) => project.id === entry.aliasId && project.machineId === entry.machineId && project.workDir === entry.aliasWorkDir) &&
    records.some((project) => project.id === entry.projectId && project.machineId === entry.machineId && project.workDir === entry.workDir))
}

export function visibleDesktopProjects(records: NianProject[], aliases: DesktopProjectAlias[]) {
  const hidden = new Set(verifiedDesktopProjectAliases(records, aliases).map((entry) => entry.aliasId))
  return records.filter((project) => !hidden.has(project.id))
}

export async function loadDesktopProjectAliases(options: {
  resolve(): Promise<{ aliases: DesktopProjectAlias[] }>
  isCurrent(): boolean
  records(): NianProject[]
  commit(aliases: DesktopProjectAlias[]): void
}): Promise<void> {
  const { aliases } = await options.resolve()
  if (!options.isCurrent()) return
  options.commit(verifiedDesktopProjectAliases(options.records(), aliases))
}

// @arch docs/architecture/session-organization.md
// @test ../../__tests__/desktop-project-boundary.test.ts
import type { NianProject } from '@shennian/wire'

export type DesktopProjectAlias = {
  aliasId: string; machineId: string; aliasWorkDir: string; projectId: string; workDir: string
}
export type DesktopCanonicalProjectInput = { machineId: string; workDir: string }

export function readDesktopProjectAliases(value: unknown): { aliases: DesktopProjectAlias[] } {
  const aliases = object(value).aliases
  if (!Array.isArray(aliases) || aliases.some((item) => {
    const entry = object(item)
    return ['aliasId', 'machineId', 'aliasWorkDir', 'projectId', 'workDir'].some((key) => !nonempty(entry[key]))
  })) throw new Error('desktop_project_invalid_aliases')
  return { aliases: aliases as DesktopProjectAlias[] }
}

export function readDesktopCanonicalProject(value: unknown): { project: NianProject } {
  const project = object(object(value).project)
  if (['id', 'machineId', 'workDir', 'displayName', 'createdAt', 'updatedAt', 'lastActivityAt']
    .some((key) => !nonempty(project[key]))) throw new Error('desktop_project_invalid_result')
  return { project: project as unknown as NianProject }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('desktop_project_invalid_result')
  return value as Record<string, unknown>
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }

// @arch docs/architecture/session-organization.md
// @test packages/app/src/__tests__/project-prefs.test.ts

import type { SessionProject } from '@shennian/shared'

function pinnedAtMillis(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Put pinned projects at the top across all machines, newest pin first. Keep the
 * remaining projects grouped by machine inventory order while preserving the
 * caller-provided activity order inside each machine.
 */
export function orderMobileProjects<T extends Pick<SessionProject, 'machineId'>>(
  projects: readonly T[],
  machineIds: readonly string[],
  getPinnedAt: (project: T) => string | null | undefined,
): T[] {
  const entries = projects
    .map((project, index) => ({ project, index, pinnedAt: pinnedAtMillis(getPinnedAt(project)) }))
  const pinned = entries
    .filter(({ pinnedAt }) => pinnedAt > 0)
    .sort((left, right) => right.pinnedAt - left.pinnedAt || left.index - right.index)
    .map(({ project }) => project)

  const buckets = new Map<string, T[]>()
  for (const { project, pinnedAt } of entries) {
    if (pinnedAt > 0) continue
    const bucket = buckets.get(project.machineId)
    if (bucket) bucket.push(project)
    else buckets.set(project.machineId, [project])
  }

  const ordered: T[] = [...pinned]
  for (const machineId of machineIds) {
    const bucket = buckets.get(machineId)
    if (!bucket) continue
    ordered.push(...bucket)
    buckets.delete(machineId)
  }

  // Inventory can briefly lag project hydration. Keep those projects grouped too.
  for (const bucket of buckets.values()) ordered.push(...bucket)
  return ordered
}

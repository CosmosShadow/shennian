// @arch docs/features/desktop-local-first-client.md#项目展开偏好
// @test ../../__tests__/desktop-shell-window-state.test.ts

export function isDesktopProjectExpanded(
  expandedKeys: Record<string, boolean>,
  projectKey: string,
  projectCount: number,
): boolean {
  return expandedKeys[projectKey] ?? projectCount <= 2
}

/** Freeze defaults only after the initial inventory is ready; never reset known branches. */
export function initializeDesktopProjectExpansion(
  current: Record<string, boolean>,
  projects: readonly { key: string }[],
  ready: boolean,
): Record<string, boolean> {
  if (!ready) return current
  const missing = projects.filter((project) => current[project.key] === undefined)
  if (!missing.length) return current
  const next = { ...current }
  for (const project of missing) next[project.key] = projects.length <= 2
  return next
}

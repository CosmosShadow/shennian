// @arch open-source/docs/wire.md
// @test src/__tests__/project-path.test.ts

/** Matching only: never changes persisted project IDs or directory spelling. */
export function normalizeProjectMatchPath(workDir: string): string {
  const trimmed = workDir.trim()
  const windows = /^[a-z]:[\\/]/i.test(trimmed) || /^\\\\/.test(trimmed) || /^\/\//.test(trimmed)
  const path = windows ? trimmed.replace(/\\/g, '/') : trimmed
  return path === '/' || path === '~' ? path : path.replace(/[\\/]+$/, '')
}

/** Include both existing Windows spellings in one paginated database query. */
export function projectSessionPathCandidates(workDir: string): string[] {
  const path = normalizeProjectMatchPath(workDir)
  if (path === '/' || path === '~') return [path]
  const paths = /^[a-z]:(?:\/|$)/i.test(path) || path.startsWith('//')
    ? [path, path.replace(/\//g, '\\')]
    : [path]
  const candidates = new Set<string>()
  for (const value of paths) {
    candidates.add(value)
    candidates.add(`${value}/`)
    candidates.add(`${value}\\`)
  }
  return [...candidates]
}

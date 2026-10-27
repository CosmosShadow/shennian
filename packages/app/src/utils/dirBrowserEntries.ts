// @arch docs/architecture/compatibility.md
// @test packages/app/src/__tests__/dir-browser-entries.test.ts

import type { FsEntry } from '@shennian/wire'

export const DIR_BROWSER_WEB_PAGE_SIZE = 100

export function filterDirBrowserEntries(entries: FsEntry[], query: string): FsEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()

  return entries
    .filter((entry) => entry.isDir && !entry.name.startsWith('.'))
    .filter((entry) => !normalizedQuery || entry.name.toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function getVisibleDirBrowserEntries(entries: FsEntry[], visibleCount: number): FsEntry[] {
  return entries.slice(0, Math.max(0, visibleCount))
}

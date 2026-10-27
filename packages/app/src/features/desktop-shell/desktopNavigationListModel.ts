// @arch docs/features/desktop-local-first-client.md#7-信息架构
// @test src/__tests__/desktop-sidebar-virtualization.test.ts
import type { SidebarTreeItem } from '../../components/sidebarTreeModel'

export function estimateNavigationRowHeight(item: SidebarTreeItem): number {
  switch (item.kind) {
    case 'session': return 32
    case 'project': return 36
    case 'room': return item.room.conversationKind === 'published_ai' ? 68 : 56
    case 'section': return 40
    case 'project-more': return 40
    default: return 54
  }
}

export function navigationOffsets(items: SidebarTreeItem[], heights: ReadonlyMap<string, number>): number[] {
  const offsets = [4]
  for (const item of items) {
    offsets.push(offsets[offsets.length - 1] + (heights.get(item.key) ?? estimateNavigationRowHeight(item)))
  }
  return offsets
}

export function navigationIndexAt(offsets: readonly number[], offset: number): number {
  let low = 0
  let high = Math.max(0, offsets.length - 2)
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (offsets[middle + 1] <= offset) low = middle + 1
    else high = middle
  }
  return low
}

export function navigationRange(offsets: readonly number[], top: number, height: number) {
  const count = Math.max(0, offsets.length - 1)
  return {
    start: navigationIndexAt(offsets, Math.max(0, top - 600)),
    end: count === 0 ? 0 : Math.min(count, navigationIndexAt(offsets, top + height + 600) + 1),
  }
}

export function navigationTargetOffset(offsets: readonly number[], index: number, viewport: number, position = 0.5) {
  const bounded = Math.max(0, Math.min(index, offsets.length - 2))
  const top = offsets[bounded] ?? 0
  const height = (offsets[bounded + 1] ?? top) - top
  return Math.max(0, top - Math.max(0, viewport - height) * position)
}

/** Preserve compositor progress: compensate geometry, never replay an old scrollTop. */
export function navigationAnchorCorrection(currentTop: number, previousRowTop: number, nextRowTop: number): number | null {
  const delta = nextRowTop - previousRowTop
  return Math.abs(delta) > 0.5 ? Math.max(0, currentTop + delta) : null
}

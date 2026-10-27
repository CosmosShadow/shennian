// @covers src/components/sidebarTreeModel.ts
// @covers src/features/desktop-files/DesktopProjectFileSidebarRow.tsx

import { describe, expect, it } from 'vitest'
import type { SessionProject } from '@shennian/shared'
import type { NianSession } from '@shennian/wire'
import { buildSidebarTreeItems, type BuildSidebarTreeInput } from '../components/sidebarTreeModel'
import type { ProjectFileSidebarRow } from '../features/desktop-files/model/desktopProjectFilesUiState'

const project = {
  id: 'project-1',
  key: 'machine-1:/legacy',
  machineId: 'machine-1',
} as SessionProject
const session = { id: 'session-1' } as NianSession
const fileRows: ProjectFileSidebarRow[] = [
  { kind: 'toggle', key: 'project-1:files', projectId: 'project-1', expanded: true },
  {
    kind: 'entry',
    key: 'project-1:entry:file',
    projectId: 'project-1',
    entry: { handle: 'file_' + 'x'.repeat(40), name: 'README.md', kind: 'file' },
    depth: 1,
    expanded: false,
    selected: false,
  },
]

function input(): BuildSidebarTreeInput {
  return {
    projectsOpen: true,
    projectsLoading: false,
    projectBranches: [
      { project, sessions: [session], expanded: true, visibleSessionCount: 10, fileRows },
    ],
    roomsOpen: false,
    roomsLoading: false,
    roomsFailed: false,
    pendingRequests: [],
    rooms: [],
    includeMachines: false,
    machinesOpen: false,
    machines: [],
  }
}

describe('Desktop sidebar project file integration', () => {
  it('keeps project sessions and the inline file tree in one virtualized ordered sequence', () => {
    const items = buildSidebarTreeItems(input())
    expect(items.slice(0, 5).map((item) => item.kind)).toEqual([
      'section',
      'project',
      'session',
      'project-file',
      'project-file',
    ])
    expect(items.filter((item) => item.kind === 'project-file')).toEqual([
      {
        kind: 'project-file',
        key: 'project:machine-1:/legacy:file:project-1:files',
        machineId: 'machine-1',
        row: fileRows[0],
      },
      {
        kind: 'project-file',
        key: 'project:machine-1:/legacy:file:project-1:entry:file',
        machineId: 'machine-1',
        row: fileRows[1],
      },
    ])
  })

  it('does not mount file rows while the parent project itself is folded', () => {
    const collapsed = input()
    collapsed.projectBranches[0] = { ...collapsed.projectBranches[0], expanded: false }
    expect(buildSidebarTreeItems(collapsed).some((item) => item.kind === 'project-file')).toBe(
      false,
    )
  })
})

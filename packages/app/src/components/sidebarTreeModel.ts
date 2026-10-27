// @arch docs/features/desktop-local-first-client.md#84-desktop-信息架构
// @test src/__tests__/desktop-sidebar-virtualization.test.ts

import type { SessionProject } from '@shennian/shared'
import type { Machine, NianSession } from '@shennian/wire'
import type { PendingJoinRequest, RoomListItem } from '../features/rooms/roomListCache'
import type { ProjectFileSidebarRow } from '../features/desktop-files/model/desktopProjectFilesUiState'

export type SidebarSection = 'projects' | 'rooms' | 'machines'

export type SidebarProjectBranch = {
  project: SessionProject
  sessions: NianSession[]
  expanded: boolean
  visibleSessionCount: number
  fileRows?: ProjectFileSidebarRow[]
}

export type SidebarTreeItem =
  | { key: `section:${SidebarSection}`; kind: 'section'; section: SidebarSection }
  | { key: `project-skeleton:${number}`; kind: 'project-skeleton' }
  | { key: 'projects:empty'; kind: 'projects-empty' }
  | { key: `project:${string}`; kind: 'project'; branch: SidebarProjectBranch }
  | {
      key: `project:${string}:session:${string}`
      kind: 'session'
      projectKey: string
      session: NianSession
    }
  | {
      key: `project:${string}:more`
      kind: 'project-more'
      branch: SidebarProjectBranch
    }
  | {
      key: `project:${string}:file:${string}`
      kind: 'project-file'
      machineId: string
      row: ProjectFileSidebarRow
    }
  | { key: 'rooms:loading'; kind: 'rooms-loading' }
  | { key: 'rooms:error'; kind: 'rooms-error' }
  | { key: 'rooms:empty'; kind: 'rooms-empty' }
  | { key: 'rooms:pending:header'; kind: 'room-pending-header' }
  | {
      key: `rooms:pending:${string}`
      kind: 'room-pending'
      request: PendingJoinRequest
    }
  | { key: `room:${string}`; kind: 'room'; room: RoomListItem }
  | { key: 'machines:empty'; kind: 'machines-empty' }
  | { key: `machine:${string}`; kind: 'machine'; machine: Machine }

export type BuildSidebarTreeInput = {
  projectsOpen: boolean
  projectsLoading: boolean
  projectBranches: SidebarProjectBranch[]
  roomsOpen: boolean
  roomsLoading: boolean
  roomsFailed: boolean
  pendingRequests: PendingJoinRequest[]
  rooms: RoomListItem[]
  includeMachines: boolean
  machinesOpen: boolean
  machines: Machine[]
}

/**
 * Produces one ordered, key-stable navigation sequence for the Desktop FlatList.
 * Social identities live in the top-level Contacts destination. Agent workspaces
 * remain reachable from each owned AI there, without a second sidebar list.
 * Collapsed descendants are absent instead of hidden so the virtualizer owns the
 * only vertical scroll surface and never mounts nested same-axis lists.
 */
export function buildSidebarTreeItems(input: BuildSidebarTreeInput): SidebarTreeItem[] {
  const items: SidebarTreeItem[] = [
    { key: 'section:projects', kind: 'section', section: 'projects' },
  ]

  if (input.projectsOpen) {
    if (input.projectsLoading) {
      for (let index = 0; index < 3; index += 1) {
        items.push({ key: `project-skeleton:${index}`, kind: 'project-skeleton' })
      }
    } else if (input.projectBranches.length === 0) {
      items.push({ key: 'projects:empty', kind: 'projects-empty' })
    } else {
      for (const branch of input.projectBranches) {
        items.push({ key: `project:${branch.project.key}`, kind: 'project', branch })
        if (!branch.expanded) continue
        const visibleSessions = branch.sessions.slice(0, branch.visibleSessionCount)
        for (const session of visibleSessions) {
          items.push({
            key: `project:${branch.project.key}:session:${session.id}`,
            kind: 'session',
            projectKey: branch.project.key,
            session,
          })
        }
        if (visibleSessions.length < branch.sessions.length) {
          items.push({
            key: `project:${branch.project.key}:more`,
            kind: 'project-more',
            branch,
          })
        }
        for (const row of branch.fileRows ?? []) {
          items.push({
            key: `project:${branch.project.key}:file:${row.key}`,
            kind: 'project-file',
            machineId: branch.project.machineId,
            row,
          })
        }
      }
    }
  }

  items.push({ key: 'section:rooms', kind: 'section', section: 'rooms' })
  if (input.roomsOpen) {
    if (input.roomsLoading) {
      items.push({ key: 'rooms:loading', kind: 'rooms-loading' })
    } else if (input.roomsFailed) {
      items.push({ key: 'rooms:error', kind: 'rooms-error' })
    } else if (input.rooms.length === 0 && input.pendingRequests.length === 0) {
      items.push({ key: 'rooms:empty', kind: 'rooms-empty' })
    } else {
      if (input.pendingRequests.length > 0) {
        items.push({ key: 'rooms:pending:header', kind: 'room-pending-header' })
        for (const request of input.pendingRequests) {
          items.push({ key: `rooms:pending:${request.id}`, kind: 'room-pending', request })
        }
      }
      for (const room of input.rooms) {
        items.push({ key: `room:${room.id}`, kind: 'room', room })
      }
    }
  }

  if (input.includeMachines) {
    items.push({ key: 'section:machines', kind: 'section', section: 'machines' })
    if (input.machinesOpen) {
      if (input.machines.length === 0) {
        items.push({ key: 'machines:empty', kind: 'machines-empty' })
      } else {
        for (const machine of input.machines) {
          items.push({ key: `machine:${machine.id}`, kind: 'machine', machine })
        }
      }
    }
  }

  return items
}

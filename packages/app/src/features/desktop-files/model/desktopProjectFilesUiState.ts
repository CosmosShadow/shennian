// @arch docs/features/desktop-project-files-opaque-protocol.md
// @test src/__tests__/project-files-ui-state.test.ts

import type { ProjectFsClientErrorState, ProjectFsClientState } from './desktopProjectFsState'
import type { ProjectFsEntry } from '@shennian/wire'

export type ProjectFileOperationError = ProjectFsClientErrorState & {
  target: string
}

export type ProjectFilesUiBranch = {
  expanded: boolean
  expandedDirectories: Readonly<Record<string, boolean>>
  pendingTargets: Readonly<Record<string, boolean>>
  errors: Readonly<Record<string, ProjectFileOperationError>>
  clientState: ProjectFsClientState | null
}

export type ProjectFilePreviewState = {
  projectId: string
  fileHandle: string
  filename: string
  loading: boolean
  content: string | null
  data: string | null
  error: ProjectFsClientErrorState | null
  requestId: number
  returnFocusTestId: string
}

export type ProjectFilesUiState = {
  scopeGeneration: number
  branches: Readonly<Record<string, ProjectFilesUiBranch>>
  preview: ProjectFilePreviewState | null
}

export type ProjectFileSidebarRow =
  | { kind: 'toggle'; key: string; projectId: string; expanded: boolean }
  | {
      kind: 'status'
      key: string
      projectId: string
      status: 'loading' | 'empty' | 'offline' | 'permission' | 'unavailable' | 'error'
      retryable: boolean
      depth: number
      target: string
    }
  | {
      kind: 'entry'
      key: string
      projectId: string
      entry: ProjectFsEntry
      depth: number
      expanded: boolean
      selected: boolean
    }
  | {
      kind: 'more'
      key: string
      projectId: string
      directoryHandle: string
      depth: number
      loading: boolean
    }

export type ProjectFilesUiAction =
  | { type: 'reset_scope' }
  | { type: 'remove_project'; projectId: string }
  | { type: 'toggle_group'; projectId: string }
  | { type: 'client_state'; projectId: string; state: ProjectFsClientState }
  | { type: 'toggle_directory'; projectId: string; directoryHandle: string }
  | { type: 'request_started'; projectId: string; target: string }
  | { type: 'request_finished'; projectId: string; target: string }
  | { type: 'request_failed'; projectId: string; error: ProjectFileOperationError }
  | {
      type: 'preview_started'
      preview: Omit<ProjectFilePreviewState, 'loading' | 'content' | 'data' | 'error'>
    }
  | {
      type: 'preview_succeeded'
      projectId: string
      requestId: number
      content: string | null
      data: string | null
    }
  | {
      type: 'preview_failed'
      projectId: string
      requestId: number
      error: ProjectFsClientErrorState
    }
  | { type: 'preview_closed' }

export function createProjectFilesUiState(): ProjectFilesUiState {
  return { scopeGeneration: 0, branches: {}, preview: null }
}

export function reduceProjectFilesUiState(
  state: ProjectFilesUiState,
  action: ProjectFilesUiAction,
): ProjectFilesUiState {
  if (action.type === 'reset_scope') {
    return { scopeGeneration: state.scopeGeneration + 1, branches: {}, preview: null }
  }
  if (action.type === 'preview_closed') return { ...state, preview: null }
  if (action.type === 'preview_started') {
    return {
      ...state,
      preview: { ...action.preview, loading: true, content: null, data: null, error: null },
    }
  }
  if (action.type === 'preview_succeeded' || action.type === 'preview_failed') {
    if (
      !state.preview ||
      state.preview.projectId !== action.projectId ||
      state.preview.requestId !== action.requestId
    ) {
      return state
    }
    return action.type === 'preview_succeeded'
      ? {
          ...state,
          preview: {
            ...state.preview,
            loading: false,
            content: action.content,
            data: action.data,
            error: null,
          },
        }
      : {
          ...state,
          preview: {
            ...state.preview,
            loading: false,
            content: null,
            data: null,
            error: action.error,
          },
        }
  }

  if (action.type === 'remove_project') {
    const branches = { ...state.branches }
    delete branches[action.projectId]
    return {
      ...state,
      branches,
      preview: state.preview?.projectId === action.projectId ? null : state.preview,
    }
  }

  const current = state.branches[action.projectId] ?? createBranch()
  let next = current
  if (action.type === 'toggle_group') {
    next = { ...current, expanded: !current.expanded }
  } else if (action.type === 'toggle_directory') {
    next = {
      ...current,
      expandedDirectories: {
        ...current.expandedDirectories,
        [action.directoryHandle]: !current.expandedDirectories[action.directoryHandle],
      },
    }
  } else if (action.type === 'request_started') {
    const errors = { ...current.errors }
    delete errors[action.target]
    next = {
      ...current,
      pendingTargets: { ...current.pendingTargets, [action.target]: true },
      errors,
    }
  } else if (action.type === 'request_finished') {
    const pendingTargets = { ...current.pendingTargets }
    delete pendingTargets[action.target]
    next = { ...current, pendingTargets }
  } else if (action.type === 'request_failed') {
    const pendingTargets = { ...current.pendingTargets }
    delete pendingTargets[action.error.target]
    next = {
      ...current,
      pendingTargets,
      errors: { ...current.errors, [action.error.target]: action.error },
    }
  } else {
    const lostLease = current.clientState?.leaseId != null && action.state.leaseId == null
    next = {
      ...current,
      clientState: action.state,
      expandedDirectories: lostLease ? {} : current.expandedDirectories,
      pendingTargets: lostLease ? {} : current.pendingTargets,
      errors: lostLease ? {} : current.errors,
    }
  }
  return {
    ...state,
    branches: { ...state.branches, [action.projectId]: next },
    preview:
      action.type === 'client_state' &&
      action.state.leaseId == null &&
      state.preview?.projectId === action.projectId
        ? null
        : state.preview,
  }
}

export function buildProjectFileSidebarRows(
  projectId: string,
  branch: ProjectFilesUiBranch | undefined,
  selectedFileHandle: string | null,
): ProjectFileSidebarRow[] {
  const current = branch ?? createBranch()
  const rows: ProjectFileSidebarRow[] = [
    { kind: 'toggle', key: `${projectId}:files`, projectId, expanded: current.expanded },
  ]
  if (!current.expanded) return rows

  const client = current.clientState
  if (!client) return [...rows, statusRow(projectId, 'unavailable', false)]
  if (client.availability === 'offline') return [...rows, statusRow(projectId, 'offline', true)]
  if (client.availability === 'permission_denied') {
    return [...rows, statusRow(projectId, 'permission', false)]
  }
  if (client.availability === 'unavailable') {
    return [...rows, statusRow(projectId, 'unavailable', false)]
  }
  if (!client.rootHandle || !client.leaseId) {
    if (client.availability === 'loading' || current.pendingTargets.root) {
      return [...rows, statusRow(projectId, 'loading', false)]
    }
    return [...rows, statusRow(projectId, 'error', true)]
  }

  const rootPage = client.pages[client.rootHandle]
  if (!rootPage) return [...rows, statusRow(projectId, 'loading', false)]
  if (rootPage.entries.length === 0 && rootPage.nextCursor === null) {
    return [...rows, statusRow(projectId, 'empty', false)]
  }
  appendPageRows(rows, projectId, client.rootHandle, 1, current, selectedFileHandle)
  return rows
}

function appendPageRows(
  rows: ProjectFileSidebarRow[],
  projectId: string,
  directoryHandle: string,
  depth: number,
  branch: ProjectFilesUiBranch,
  selectedFileHandle: string | null,
): void {
  const page = branch.clientState?.pages[directoryHandle]
  if (!page) return
  for (const entry of page.entries) {
    const expanded = entry.kind === 'directory' && Boolean(branch.expandedDirectories[entry.handle])
    rows.push({
      kind: 'entry',
      key: `${projectId}:entry:${entry.handle}`,
      projectId,
      entry,
      depth,
      expanded,
      selected: entry.kind === 'file' && entry.handle === selectedFileHandle,
    })
    if (expanded) {
      if (branch.pendingTargets[entry.handle] && !branch.clientState?.pages[entry.handle]) {
        rows.push(statusRow(projectId, 'loading', false, depth + 1, entry.handle))
      } else if (branch.errors[entry.handle] && !branch.clientState?.pages[entry.handle]) {
        rows.push(statusRow(projectId, 'error', true, depth + 1, entry.handle))
      } else {
        const childPage = branch.clientState?.pages[entry.handle]
        if (childPage?.entries.length === 0 && childPage.nextCursor === null) {
          rows.push(statusRow(projectId, 'empty', false, depth + 1, entry.handle))
        } else {
          appendPageRows(rows, projectId, entry.handle, depth + 1, branch, selectedFileHandle)
        }
      }
    }
  }
  if (page.nextCursor !== null) {
    rows.push({
      kind: 'more',
      key: `${projectId}:more:${directoryHandle}:${page.nextCursor}`,
      projectId,
      directoryHandle,
      depth,
      loading: Boolean(branch.pendingTargets[directoryHandle]),
    })
  }
  if (branch.errors[directoryHandle] && page.entries.length > 0) {
    rows.push(statusRow(projectId, 'error', true, depth, directoryHandle))
  }
}

function statusRow(
  projectId: string,
  status: Extract<ProjectFileSidebarRow, { kind: 'status' }>['status'],
  retryable: boolean,
  depth = 1,
  suffix = 'root',
): Extract<ProjectFileSidebarRow, { kind: 'status' }> {
  return {
    kind: 'status',
    key: `${projectId}:status:${suffix}:${status}`,
    projectId,
    status,
    retryable,
    depth,
    target: suffix,
  }
}

function createBranch(): ProjectFilesUiBranch {
  return {
    expanded: false,
    expandedDirectories: {},
    pendingTargets: {},
    errors: {},
    clientState: null,
  }
}

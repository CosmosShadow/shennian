// @arch docs/features/desktop-project-files-opaque-protocol.md
// @test src/__tests__/project-fs-state.test.ts

import type {
  ProjectFsDirectoryPage,
  ProjectFsErrorCode,
  ProjectFsReadResult,
  ProjectFsRequiredAction,
} from '@shennian/wire'

export type ProjectFsAvailability =
  | 'unavailable'
  | 'offline'
  | 'ready'
  | 'loading'
  | 'permission_denied'
  | 'error'

export type ProjectFsClientErrorState = {
  code: ProjectFsErrorCode | 'protocol_error'
  retryable: boolean
  requiredAction: ProjectFsRequiredAction
}

export type ProjectFsClientState = {
  generation: number
  accountId: string | null
  machineId: string | null
  projectId: string | null
  availability: ProjectFsAvailability
  unavailableReason:
    | 'missing_scope'
    | 'missing_project_ref'
    | 'missing_daemon_identity'
    | 'capability_required'
    | null
  leaseId: string | null
  rootHandle: string | null
  rootName: string | null
  expiresAt: number | null
  pages: Readonly<Record<string, ProjectFsDirectoryPage>>
  reads: Readonly<Record<string, readonly ProjectFsReadResult[]>>
  pendingRequests: number
  error: ProjectFsClientErrorState | null
}

export type ProjectFsStateAction =
  | {
      type: 'replace_scope'
      accountId: string | null
      machineId: string | null
      projectId: string | null
      availability: Exclude<ProjectFsAvailability, 'loading' | 'error'>
      unavailableReason: ProjectFsClientState['unavailableReason']
    }
  | { type: 'request_started'; generation: number }
  | {
      type: 'open_succeeded'
      generation: number
      leaseId: string
      rootHandle: string
      rootName: string
      page: ProjectFsDirectoryPage
      expiresAt: number
    }
  | {
      type: 'list_succeeded'
      generation: number
      page: ProjectFsDirectoryPage
      expiresAt: number
    }
  | { type: 'read_succeeded'; generation: number; page: ProjectFsReadResult }
  | { type: 'closed'; generation: number }
  | { type: 'request_failed'; generation: number; error: ProjectFsClientErrorState }

export function createProjectFsClientState(): ProjectFsClientState {
  return {
    generation: 0,
    accountId: null,
    machineId: null,
    projectId: null,
    availability: 'unavailable',
    unavailableReason: 'missing_scope',
    leaseId: null,
    rootHandle: null,
    rootName: null,
    expiresAt: null,
    pages: {},
    reads: {},
    pendingRequests: 0,
    error: null,
  }
}

/**
 * In-memory authority-generation reducer. Every scope/transport replacement
 * clears opaque handles and makes responses from the previous generation inert.
 */
export function reduceProjectFsClientState(
  state: ProjectFsClientState,
  action: ProjectFsStateAction,
): ProjectFsClientState {
  if (action.type === 'replace_scope') {
    return {
      ...createProjectFsClientState(),
      generation: state.generation + 1,
      accountId: action.accountId,
      machineId: action.machineId,
      projectId: action.projectId,
      availability: action.availability,
      unavailableReason: action.unavailableReason,
    }
  }
  if (action.generation !== state.generation) return state

  if (action.type === 'request_started') {
    return {
      ...state,
      availability: 'loading',
      pendingRequests: state.pendingRequests + 1,
      error: null,
    }
  }
  if (action.type === 'open_succeeded') {
    return {
      ...state,
      availability: 'ready',
      unavailableReason: null,
      leaseId: action.leaseId,
      rootHandle: action.rootHandle,
      rootName: action.rootName,
      expiresAt: action.expiresAt,
      pages: { [action.page.directoryHandle]: action.page },
      reads: {},
      pendingRequests: Math.max(0, state.pendingRequests - 1),
      error: null,
    }
  }
  if (action.type === 'list_succeeded') {
    const prior = state.pages[action.page.directoryHandle]
    const entries =
      action.page.cursor === 0
        ? action.page.entries
        : [...(prior?.entries ?? []), ...action.page.entries]
    return {
      ...state,
      availability: 'ready',
      expiresAt: action.expiresAt,
      pages: {
        ...state.pages,
        [action.page.directoryHandle]: { ...action.page, cursor: 0, entries },
      },
      pendingRequests: Math.max(0, state.pendingRequests - 1),
      error: null,
    }
  }
  if (action.type === 'read_succeeded') {
    const prior = action.page.offset === 0 ? [] : (state.reads[action.page.fileHandle] ?? [])
    return {
      ...state,
      availability: 'ready',
      expiresAt: action.page.expiresAt,
      reads: { ...state.reads, [action.page.fileHandle]: [...prior, action.page] },
      pendingRequests: Math.max(0, state.pendingRequests - 1),
      error: null,
    }
  }
  if (action.type === 'closed') {
    return {
      ...state,
      availability: 'ready',
      leaseId: null,
      rootHandle: null,
      rootName: null,
      expiresAt: null,
      pages: {},
      reads: {},
      pendingRequests: Math.max(0, state.pendingRequests - 1),
      error: null,
    }
  }

  const failClosed = shouldClearOpaqueState(action.error.code)
  return {
    ...state,
    generation: failClosed ? state.generation + 1 : state.generation,
    availability:
      action.error.code === 'permission_denied'
        ? 'permission_denied'
        : action.error.code === 'machine_offline'
          ? 'offline'
          : action.error.code === 'capability_required'
            ? 'unavailable'
            : 'error',
    unavailableReason:
      action.error.code === 'capability_required' ? 'capability_required' : state.unavailableReason,
    leaseId: failClosed ? null : state.leaseId,
    rootHandle: failClosed ? null : state.rootHandle,
    rootName: failClosed ? null : state.rootName,
    expiresAt: failClosed ? null : state.expiresAt,
    pages: failClosed ? {} : state.pages,
    reads: failClosed ? {} : state.reads,
    pendingRequests: failClosed ? 0 : Math.max(0, state.pendingRequests - 1),
    error: action.error,
  }
}

function shouldClearOpaqueState(code: ProjectFsClientErrorState['code']): boolean {
  return (
    code === 'capability_required' ||
    code === 'machine_offline' ||
    code === 'permission_denied' ||
    code === 'project_not_found' ||
    code === 'project_scope_changed' ||
    code === 'handle_invalid' ||
    code === 'handle_expired' ||
    code === 'protocol_error'
  )
}

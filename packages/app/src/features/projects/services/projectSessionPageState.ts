// @arch docs/features/desktop-page-state-matrix.md#project-and-personal-session-closure
// @test src/__tests__/project-session-page-state.test.ts

export type ProjectSessionPageFailure = 'offline' | 'forbidden' | 'error'

export type ProjectSessionPageSurfaceState =
  | 'pending'
  | 'ready'
  | 'empty'
  | 'offline'
  | 'forbidden'
  | 'error'

export function classifyProjectSessionPageFailure(
  error: unknown,
  connectivity: 'connected' | 'disconnected',
): ProjectSessionPageFailure {
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0
  if (status === 401 || status === 403 || status === 404) return 'forbidden'
  if (connectivity === 'disconnected') return 'offline'
  return 'error'
}

export function resolveProjectSessionPageSurfaceState(input: {
  projectAvailable: boolean
  sessionCount: number
  localIndexLoading: boolean
  pageLoading: boolean
  remoteAttempted: boolean
  failure: ProjectSessionPageFailure | null
}): ProjectSessionPageSurfaceState {
  if (input.failure === 'forbidden') return 'forbidden'
  if (input.sessionCount > 0) {
    // Local rows are ready independently of background refresh/pagination.
    if (input.failure === 'offline') return 'offline'
    if (input.failure === 'error') return 'error'
    return 'ready'
  }
  if (input.failure === 'offline') return 'offline'
  if (input.failure === 'error') return 'error'
  if (input.localIndexLoading || (input.projectAvailable && input.pageLoading)) {
    return 'pending'
  }
  if (!input.projectAvailable && input.remoteAttempted) return 'forbidden'
  if (!input.remoteAttempted) return 'pending'
  return 'empty'
}

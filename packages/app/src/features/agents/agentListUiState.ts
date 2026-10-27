// @arch docs/design/patterns.md#3-列表详情
// @test src/__tests__/desktop-page-state-coverage.test.ts

export type AgentListUiState =
  | 'initial-loading'
  | 'ready'
  | 'empty'
  | 'offline'
  | 'recoverable-error'

export function resolveAgentListUiState(input: {
  count: number
  initialLoadPending: boolean
  refreshFailed: boolean
  offline: boolean
}): AgentListUiState {
  if (input.initialLoadPending && input.count === 0) return 'initial-loading'
  if (input.offline) return 'offline'
  if (input.refreshFailed) return 'recoverable-error'
  return input.count === 0 ? 'empty' : 'ready'
}

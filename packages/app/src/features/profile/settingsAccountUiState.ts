// @arch docs/features/desktop-settings-information-architecture.md
// @test src/__tests__/desktop-page-state-coverage.test.ts

export type SettingsAccountUiState =
  | 'initial-loading'
  | 'ready'
  | 'empty'
  | 'offline'
  | 'recoverable-error'

export function resolveSettingsAccountUiState(input: {
  desktop: boolean
  initialLoadPending: boolean
  cachedItemCount: number
  offline: boolean
  refreshFailed: boolean
}): SettingsAccountUiState {
  if (!input.desktop) return 'ready'
  if (input.offline) return 'offline'
  if (input.refreshFailed) return 'recoverable-error'
  if (input.initialLoadPending && input.cachedItemCount === 0) return 'initial-loading'
  return input.cachedItemCount === 0 ? 'empty' : 'ready'
}

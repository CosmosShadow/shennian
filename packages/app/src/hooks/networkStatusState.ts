// @arch docs/features/network-rooms/ui.md#六移动端
// @test src/__tests__/network-status-state.test.ts

export type NetworkStatus = 'online' | 'offline' | 'unknown'

export function nativeNetworkStatus(state: { isConnected: boolean | null }): NetworkStatus {
  if (state.isConnected === null) return 'unknown'
  return state.isConnected ? 'online' : 'offline'
}

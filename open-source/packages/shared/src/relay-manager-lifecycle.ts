// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/relay-manager-lifecycle.test.ts

import type { RelayConnectivitySnapshot } from '@shennian/wire'
import type { RelayManager } from './relay-manager'

let manager: RelayManager | null = null
const listeners = new Set<(snapshot: RelayConnectivitySnapshot | null) => void>()
let unsubscribe: (() => void) | undefined

export function getRelayManager(): RelayManager | null {
  return manager
}

/** Account subscribers outlive a socket/manager (startup, token refresh, logout). */
export function setRelayManager(next: RelayManager | null): void {
  if (manager === next) return
  unsubscribe?.()
  manager = next
  unsubscribe = next?.onUserConnectivityChange(publish)
  publish(next?.getUserConnectivitySnapshot() ?? null)
}

function publish(snapshot: RelayConnectivitySnapshot | null): void {
  for (const listener of listeners) listener(snapshot)
}

export function subscribeRelayConnectivity(
  listener: (snapshot: RelayConnectivitySnapshot | null) => void,
): () => void {
  listeners.add(listener)
  listener(manager?.getUserConnectivitySnapshot() ?? null)
  return () => { listeners.delete(listener) }
}

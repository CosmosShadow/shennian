// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-mirror-sync-service.test.ts

import type { RoomSessionRegistration, RoomSessionRegistry } from './session-registry.js'
import type { RemoteRoomAgentStatus } from './room-action-client.js'

export function isCurrentRegistration(
  registry: RoomSessionRegistry,
  snapshot: RoomSessionRegistration,
): boolean {
  const current = registry.getByRegistryKey(snapshot.registryKey)
  return Boolean(current &&
    current.lifecycleState !== 'closed' &&
    current.registrationEpoch === snapshot.registrationEpoch &&
    current.binding?.bindingId === snapshot.binding?.bindingId &&
    (current.binding?.status === 'active' || current.binding?.status === 'paused'))
}

export function matchesRoomOwner(
  registration: RoomSessionRegistration,
  remote: Pick<RemoteRoomAgentStatus, 'nianSessionId' | 'sessionRegistryKey'>,
): boolean {
  // Old servers omit these additive fields. Local retirement/epoch checks and
  // deletion tombstones still apply; never infer a different session by recency.
  return (remote.nianSessionId === undefined || remote.nianSessionId === registration.nianSessionId) &&
    (remote.sessionRegistryKey === undefined || remote.sessionRegistryKey === registration.registryKey)
}

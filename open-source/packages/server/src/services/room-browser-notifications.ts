// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-browser-notifications.test.ts
import { connections } from '../relay/connections.js'
import { pubsub } from '../relay/pubsub.js'

// Private invalidation: never disclose one member's browser access to other members.
// Reuse the backwards-compatible room refresh frame; it does not create a chat message.
export function notifyRoomBrowserAccessChanged(userId: string, roomId: string) {
  const data = JSON.stringify({ type: 'event', event: 'room.updated', payload: {
    event: 'room.updated', roomId, entityId: roomId,
  } })
  if (pubsub.isActive) pubsub.publishToUser(userId, data)
  else connections.broadcastToClientsOfUser(userId, data)
}

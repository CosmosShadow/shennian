// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-managed-delivery.test.ts

import type { RoomMessageView } from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import { sendServerReqToMachine } from '../relay/server-requests.js'

const LIVE_DELIVERY_CAPABILITY = 'room_message_delivery_v1'

/**
 * Deliver the committed message body directly to every capable machine that
 * owns an active managed Binding in this Room. The daemon ACK means the event
 * has crossed into its durable Room/session queue; Provider completion is a
 * separate lifecycle.
 */
export async function deliverRoomMessageToManagedMachines(
  roomId: string,
  message: RoomMessageView,
): Promise<void> {
  const bindings = await prisma.roomBinding.findMany({
    where: {
      roomId,
      status: 'active',
      activationMode: { not: 'paused' },
      activationCapability: 'managed',
      machine: { paired: true },
    },
    select: {
      machineId: true,
      machine: { select: { sessionSyncCapabilities: true } },
    },
  })
  const machineIds = new Set<string>()
  for (const binding of bindings) {
    const capabilities = Array.isArray(binding.machine.sessionSyncCapabilities)
      ? binding.machine.sessionSyncCapabilities as unknown[]
      : []
    if (capabilities.includes(LIVE_DELIVERY_CAPABILITY)) machineIds.add(binding.machineId)
  }
  const acknowledgements = [...machineIds].map((machineId) =>
    sendServerReqToMachine(machineId, {
      type: 'req',
      method: 'room.message.deliver',
      params: { message },
    }, 10_000),
  )
  // Target discovery and socket dispatch are part of the caller's request;
  // ACK waiting remains best-effort so a slow/offline daemon never delays the
  // human send/update response by the full delivery timeout.
  void Promise.allSettled(acknowledgements)
}

// @arch open-source/docs/server-runtime.md
// @test src/__tests__/connection-control.test.ts

import { closeRoomBrowserSessionSockets } from '../services/room-browser-events.js'
import { connections } from './connections.js'
import { pubsub } from './pubsub.js'

type ConnectionControlEvent =
  | { version: 1; type: 'device.revoke'; deviceId: string }
  | { version: 1; type: 'user.logout'; userId: string }
  | { version: 1; type: 'room_browser_session.revoke'; sessionId: string }
  | { version: 1; type: 'machine_access.revoke'; machineId: string; userId: string }
  | { version: 1; type: 'machine_access.pause'; machineId: string }

let unsubscribe = () => {}

function isScopedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 191
}

export function applyConnectionControlEvent(data: string): boolean {
  let event: Partial<ConnectionControlEvent>
  try {
    event = JSON.parse(data) as Partial<ConnectionControlEvent>
  } catch {
    return false
  }
  if (event.version !== 1) return false

  switch (event.type) {
    case 'device.revoke':
      if (!('deviceId' in event) || !isScopedId(event.deviceId)) return false
      connections.closeByDeviceId(event.deviceId)
      return true
    case 'user.logout':
      if (!('userId' in event) || !isScopedId(event.userId)) return false
      connections.closeByUserId(event.userId)
      return true
    case 'room_browser_session.revoke':
      if (!('sessionId' in event) || !isScopedId(event.sessionId)) return false
      closeRoomBrowserSessionSockets(event.sessionId)
      return true
    case 'machine_access.revoke':
      if (!('machineId' in event) || !isScopedId(event.machineId) ||
          !('userId' in event) || !isScopedId(event.userId)) return false
      connections.revokeMachineAccess(event.machineId, event.userId)
      return true
    case 'machine_access.pause':
      if (!('machineId' in event) || !isScopedId(event.machineId)) return false
      connections.revokeAllMachineAccess(event.machineId)
      return true
    default:
      return false
  }
}

export async function initConnectionControl(): Promise<void> {
  unsubscribe()
  unsubscribe = await pubsub.subscribeConnectionControl(applyConnectionControlEvent)
}

export function destroyConnectionControl(): void {
  unsubscribe()
  unsubscribe = () => {}
}

function publish(event: ConnectionControlEvent): void {
  const data = JSON.stringify(event)
  // Apply synchronously on the origin so revocation does not wait for Redis
  // loopback. Redis fans the same idempotent close out to every other Server.
  applyConnectionControlEvent(data)
  pubsub.publishConnectionControl(data)
}

export function publishDeviceRevoked(deviceId: string): void {
  publish({ version: 1, type: 'device.revoke', deviceId })
}

export function publishUserLogout(userId: string): void {
  publish({ version: 1, type: 'user.logout', userId })
}

export function publishRoomBrowserSessionRevoked(sessionId: string): void {
  publish({ version: 1, type: 'room_browser_session.revoke', sessionId })
}

export function publishMachineAccessRevoked(machineId: string, userId: string): void {
  publish({ version: 1, type: 'machine_access.revoke', machineId, userId })
}

export function publishMachineAccessPaused(machineId: string): void {
  publish({ version: 1, type: 'machine_access.pause', machineId })
}

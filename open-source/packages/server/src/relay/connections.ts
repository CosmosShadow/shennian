import type { WebSocket } from 'ws'

const MAX_CLIENTS_PER_MACHINE = 50

export type ConnectionStats = {
  totalMachines: number
  totalClients: number
  perMachine: Array<{ machineId: string; clients: number }>
}

type ClientMeta = {
  userId: string
  deviceId: string
  platform: string
  mode: 'legacy' | 'multiplex'
}

class ConnectionManager {
  private machineConnections = new Map<string, WebSocket>()
  private clientConnections = new Map<string, Set<WebSocket>>()
  private machineOwner = new Map<string, string>()
  private machineRegion = new Map<string, string>()
  private clientMeta = new Map<WebSocket, ClientMeta>()
  private deviceToWs = new Map<string, Set<WebSocket>>()
  private machineAccessRevokers = new Map<string, Set<() => void>>()

  private machineAccessKey(machineId: string, userId: string): string {
    return `${machineId}\u0000${userId}`
  }

  registerMachineAccessRevoker(machineId: string, userId: string, revoke: () => void): () => void {
    const key = this.machineAccessKey(machineId, userId)
    let callbacks = this.machineAccessRevokers.get(key)
    if (!callbacks) {
      callbacks = new Set()
      this.machineAccessRevokers.set(key, callbacks)
    }
    callbacks.add(revoke)
    return () => {
      callbacks?.delete(revoke)
      if (callbacks?.size === 0) this.machineAccessRevokers.delete(key)
    }
  }

  revokeMachineAccess(machineId: string, userId: string): number {
    const callbacks = this.machineAccessRevokers.get(this.machineAccessKey(machineId, userId))
    if (!callbacks) return 0
    let revoked = 0
    for (const callback of [...callbacks]) {
      try {
        callback()
        revoked++
      } catch {
        // A concurrent socket close may already have removed the subscription.
      }
    }
    return revoked
  }

  revokeAllMachineAccess(machineId: string): number {
    let revoked = 0
    const prefix = `${machineId}\u0000`
    for (const [key, callbacks] of [...this.machineAccessRevokers]) {
      if (!key.startsWith(prefix)) continue
      for (const callback of [...callbacks]) {
        try { callback(); revoked++ } catch { /* concurrent close */ }
      }
    }
    return revoked
  }

  addMachine(machineId: string, ws: WebSocket, userId?: string, region?: string): void {
    const previous = this.machineConnections.get(machineId)
    this.machineConnections.set(machineId, ws)
    if (userId) {
      this.machineOwner.set(machineId, userId)
    }
    if (region) {
      this.machineRegion.set(machineId, region)
    }
    if (previous && previous !== ws) {
      previous.close(4410, 'ownership_replaced')
    }
  }

  removeMachine(machineId: string, ws?: WebSocket): boolean {
    if (ws && this.machineConnections.get(machineId) !== ws) {
      return false
    }
    this.machineConnections.delete(machineId)
    this.machineOwner.delete(machineId)
    this.machineRegion.delete(machineId)
    return true
  }

  getMachineRegion(machineId: string): string | undefined {
    return this.machineRegion.get(machineId)
  }

  getMachine(machineId: string): WebSocket | undefined {
    return this.machineConnections.get(machineId)
  }

  getMachineOwner(machineId: string): string | undefined {
    return this.machineOwner.get(machineId)
  }

  addClient(
    machineId: string,
    ws: WebSocket,
    userId?: string,
    deviceId?: string,
    platform?: string,
    mode: 'legacy' | 'multiplex' = 'legacy',
  ): boolean {
    let set = this.clientConnections.get(machineId)
    if (!set) {
      set = new Set()
      this.clientConnections.set(machineId, set)
    }
    if (set.size >= MAX_CLIENTS_PER_MACHINE) {
      return false
    }
    set.add(ws)
    if (userId) {
      this.clientMeta.set(ws, { userId, deviceId: deviceId ?? '', platform: platform ?? '', mode })
    }
    if (deviceId) {
      let dSet = this.deviceToWs.get(deviceId)
      if (!dSet) {
        dSet = new Set()
        this.deviceToWs.set(deviceId, dSet)
      }
      dSet.add(ws)
    }
    return true
  }

  removeClient(machineId: string, ws: WebSocket): void {
    const set = this.clientConnections.get(machineId)
    if (!set) return
    set.delete(ws)
    const stillRegistered = [...this.clientConnections.values()].some((clients) => clients.has(ws))
    if (!stillRegistered) {
      const meta = this.clientMeta.get(ws)
      if (meta?.deviceId) {
        const dSet = this.deviceToWs.get(meta.deviceId)
        if (dSet) {
          dSet.delete(ws)
          if (dSet.size === 0) this.deviceToWs.delete(meta.deviceId)
        }
      }
      this.clientMeta.delete(ws)
    }
    if (set.size === 0) {
      this.clientConnections.delete(machineId)
    }
  }

  getClients(machineId: string): Set<WebSocket> | undefined {
    return this.clientConnections.get(machineId)
  }

  broadcastToClients(machineId: string, data: string): number {
    const clients = this.clientConnections.get(machineId)
    if (!clients) return 0
    let sent = 0
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(this.formatForClient(ws, machineId, data))
        sent++
      }
    }
    return sent
  }

  /** Broadcast to all clients of a machine EXCEPT the sender socket */
  broadcastToOtherClients(machineId: string, data: string, excludeWs: WebSocket): number {
    const clients = this.clientConnections.get(machineId)
    if (!clients) return 0
    let sent = 0
    for (const ws of clients) {
      if (ws !== excludeWs && ws.readyState === ws.OPEN) {
        ws.send(this.formatForClient(ws, machineId, data))
        sent++
      }
    }
    return sent
  }

  broadcastToClientsOfUser(userId: string, data: string): number {
    let sent = 0
    for (const [, clients] of this.clientConnections) {
      for (const ws of clients) {
        if (this.clientMeta.get(ws)?.userId === userId && ws.readyState === ws.OPEN) {
          ws.send(data)
          sent++
        }
      }
    }
    return sent
  }

  hasAnyClientForUser(userId: string): boolean {
    for (const [, clients] of this.clientConnections) {
      for (const ws of clients) {
        const meta = this.clientMeta.get(ws)
        if (meta?.userId === userId && ws.readyState === ws.OPEN) return true
      }
    }
    return false
  }

  hasAnyMobileClientForUser(userId: string): boolean {
    for (const [, clients] of this.clientConnections) {
      for (const ws of clients) {
        const meta = this.clientMeta.get(ws)
        if (
          meta?.userId === userId &&
          (meta.platform === 'ios' || meta.platform === 'android') &&
          ws.readyState === ws.OPEN
        ) {
          return true
        }
      }
    }
    return false
  }

  sendToMachine(machineId: string, data: string): boolean {
    const ws = this.machineConnections.get(machineId)
    if (!ws || ws.readyState !== ws.OPEN) return false
    ws.send(data)
    return true
  }

  private formatForClient(ws: WebSocket, machineId: string, data: string): string {
    if (this.clientMeta.get(ws)?.mode !== 'multiplex') return data
    try {
      return JSON.stringify({
        type: 'relay',
        machineId,
        frame: JSON.parse(data),
      })
    } catch {
      return data
    }
  }

  /** Close all WebSocket connections belonging to a specific device */
  closeByDeviceId(deviceId: string): number {
    const sockets = this.deviceToWs.get(deviceId)
    if (!sockets) return 0
    let closed = 0
    for (const ws of sockets) {
      try {
        ws.close(4009, 'Device revoked')
        closed++
      } catch {
        // already closed
      }
    }
    return closed
  }

  /** Close every local client connection belonging to an authenticated user. */
  closeByUserId(userId: string): number {
    let closed = 0
    for (const [ws, meta] of this.clientMeta) {
      if (meta.userId !== userId) continue
      try {
        ws.close(4009, 'User logged out')
        closed++
      } catch {
        // already closed
      }
    }
    return closed
  }

  getStats(): ConnectionStats {
    const perMachine: ConnectionStats['perMachine'] = []
    for (const [machineId, clients] of this.clientConnections) {
      perMachine.push({ machineId, clients: clients.size })
    }
    return {
      totalMachines: this.machineConnections.size,
      totalClients: perMachine.reduce((sum, m) => sum + m.clients, 0),
      perMachine,
    }
  }
}

export const connections = new ConnectionManager()

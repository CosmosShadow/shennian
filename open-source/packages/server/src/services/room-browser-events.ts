// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-browser-session.test.ts

type ScopedSocket = {
  readyState: number
  OPEN: number
  send(data: string): void
  close(code?: number, reason?: string): void
}

type ScopedConnection = {
  sessionId: string
  membershipId: string
  expiresAt: number
  socket: ScopedSocket
}
const socketsByRoom = new Map<string, Set<ScopedConnection>>()

export function addRoomBrowserSocket(
  roomId: string,
  sessionId: string,
  membershipId: string,
  expiresAt: Date,
  socket: ScopedSocket,
): () => void {
  const sockets = socketsByRoom.get(roomId) ?? new Set<ScopedConnection>()
  const connection = { sessionId, membershipId, expiresAt: expiresAt.getTime(), socket }
  sockets.add(connection)
  socketsByRoom.set(roomId, sockets)
  return () => {
    sockets.delete(connection)
    if (sockets.size === 0) socketsByRoom.delete(roomId)
  }
}

export function broadcastRoomBrowserEvent(
  roomId: string,
  activeMembershipIds: ReadonlySet<string>,
  data: string,
): void {
  for (const connection of socketsByRoom.get(roomId) ?? []) {
    if (connection.expiresAt <= Date.now()) {
      connection.socket.close(4401, 'Room access expired')
      continue
    }
    if (!activeMembershipIds.has(connection.membershipId)) {
      connection.socket.close(4403, 'Room membership revoked')
      continue
    }
    if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(data)
  }
}

export function closeRoomBrowserSockets(
  roomId: string,
  code = 4403,
  reason = 'Room access unavailable',
): void {
  for (const connection of socketsByRoom.get(roomId) ?? []) {
    connection.socket.close(code, reason)
  }
  socketsByRoom.delete(roomId)
}

export function closeRoomBrowserSessionSockets(
  sessionId: string,
  code = 4403,
  reason = 'Room browser session revoked',
): void {
  for (const [roomId, connections] of socketsByRoom) {
    for (const connection of [...connections]) {
      if (connection.sessionId !== sessionId) continue
      connection.socket.close(code, reason)
      connections.delete(connection)
    }
    if (connections.size === 0) socketsByRoom.delete(roomId)
  }
}

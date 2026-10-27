// @covers packages/app/src/features/agents/agentAccountClient.native.ts
// @covers packages/app/src/features/rooms/roomInvitationClient.native.ts
// @covers packages/app/src/features/rooms/removeRoomAgent.native.ts
// Standalone mobile contracts; no imports from the paused Desktop main process.
import { beforeEach, expect, it, vi } from 'vitest'
import { agentAccountClient } from '../features/agents/agentAccountClient.native'
import { roomInvitationClient } from '../features/rooms/roomInvitationClient.native'
import { removeRoomAgent } from '../features/rooms/removeRoomAgent.native'
const { authApi, db, removeSession, publishRoomRelayEvent, publishAgentRefreshEvent, publishRoomReplicaRevision } = vi.hoisted(() => ({
  authApi: vi.fn(), db: { getAgent: vi.fn(), upsertAgent: vi.fn(), deleteSession: vi.fn() },
  removeSession: vi.fn(), publishRoomRelayEvent: vi.fn(), publishAgentRefreshEvent: vi.fn(), publishRoomReplicaRevision: vi.fn(),
}))
vi.mock('../config/api', () => ({ authApi }))
vi.mock('../storage/db.native', () => ({ db }))
vi.mock('@shennian/shared', () => ({ useSessionsStore: { getState: () => ({ removeSession }) } }))
vi.mock('../features/rooms/roomEvents', () => ({ publishRoomRelayEvent, publishRoomReplicaRevision }))
vi.mock('../features/agents/agentEvents', () => ({ publishAgentRefreshEvent }))
const input = { accountId: 'a1', roomId: 'r1', membershipId: 'member1', agentId: 'agent1', sessionId: 'session1' }
beforeEach(() => {
  vi.resetAllMocks()
  authApi.mockResolvedValue({})
  db.getAgent.mockResolvedValue({ id: 'agent1', sessions: [{ id: 'session1' }, { id: 'other' }] })
})
it('preserves assignment intent and encodes the Agent ID', async () => {
  authApi.mockResolvedValue({ session: { id: 'session1' } })
  await expect(agentAccountClient.createRoomSession('agent/1', 'intent-1')).resolves.toEqual({ id: 'session1' })
  expect(authApi).toHaveBeenCalledWith('/agents/agent%2F1/sessions', { method: 'POST', body: JSON.stringify({ assignmentIntentId: 'intent-1' }) })
})
it('keeps native invitation endpoints and optional fields', async () => {
  await roomInvitationClient.exchange({ token: 'invite' })
  expect(authApi).toHaveBeenLastCalledWith('/room-invites/native/exchange', { method: 'POST', body: JSON.stringify({ token: 'invite' }) })
  await roomInvitationClient.join({ joinHandle: 'handle' })
  expect(authApi).toHaveBeenLastCalledWith('/room-invites/native/join', { method: 'POST', body: JSON.stringify({ joinHandle: 'handle' }) })
})
it('removes only the acknowledged assignment and emits sync events', async () => {
  await removeRoomAgent(input, () => true)
  expect(authApi).toHaveBeenCalledWith('/rooms/r1/members/member1', { method: 'DELETE' })
  expect(db.upsertAgent).toHaveBeenCalledWith('a1', { id: 'agent1', sessions: [{ id: 'other' }] })
  expect(db.deleteSession).toHaveBeenCalledWith('session1')
  expect(removeSession).toHaveBeenCalledWith('session1')
  expect(publishRoomRelayEvent).toHaveBeenCalledTimes(1)
  expect(publishAgentRefreshEvent).toHaveBeenCalledTimes(1)
  expect(publishRoomReplicaRevision).toHaveBeenCalledWith('r1', ['members'])
})
it('does not mutate caches after rejected authorization or changed account context', async () => {
  authApi.mockRejectedValueOnce(new Error('denied'))
  await expect(removeRoomAgent(input, () => true)).rejects.toThrow('denied')
  expect(db.getAgent).not.toHaveBeenCalled()
  let current = true
  db.getAgent.mockImplementationOnce(async () => { current = false; return { sessions: [] } })
  await expect(removeRoomAgent(input, () => current)).rejects.toThrow('context changed')
  expect(db.upsertAgent).not.toHaveBeenCalled()
  expect(db.deleteSession).not.toHaveBeenCalled()
  expect(publishRoomRelayEvent).not.toHaveBeenCalled()
})
it('keeps server success when cache repair is needed', async () => {
  db.upsertAgent.mockRejectedValueOnce(new Error('disk'))
  await expect(removeRoomAgent(input, () => true)).resolves.toBeUndefined()
  expect(publishRoomReplicaRevision).toHaveBeenCalledWith('r1', ['members'])
})

// @covers packages/app/src/features/rooms/roomAccountClient.web.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopRoomAccountError,
  roomAccountClient,
} from '../features/rooms/roomAccountClient.web'
import {
  isRoomAccountForbidden,
  isRoomAccountNotFound,
} from '../features/rooms/roomAccountClient.types'
import { setDesktopRoomReplicaAccountId } from '../features/rooms/desktopRoomReplicaProjection.web'

type DesktopRoot = typeof globalThis & { shennianDesktop?: unknown }

beforeEach(() => setDesktopRoomReplicaAccountId('account-1'))

afterEach(() => {
  setDesktopRoomReplicaAccountId(null)
  delete (globalThis as DesktopRoot).shennianDesktop
})

describe('Desktop Room account client', () => {
  it('fails closed when the main-process account bridge is absent', async () => {
    await expect(roomAccountClient.getRoom('room-1')).rejects.toEqual(
      expect.objectContaining<Partial<DesktopRoomAccountError>>({
        name: 'DesktopRoomAccountError',
        code: 'BRIDGE_UNAVAILABLE',
      }),
    )
  })

  it('reads replicated Room detail and messages from DesktopDataService', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        value: { status: 'active', activationMode: 'mention_only' },
      })
    const query = vi.fn(async ({ method }: { method: string }) => ({
      ok: true,
      value: method === 'getRoomSummaries'
        ? [{
            id: 'room-1', name: 'Build room', status: 'active', visibility: 'private',
            joinPolicy: 'open', lastSequence: '5', updatedAt: '2026-09-10T00:00:00.000Z',
            membershipId: 'member-1',
            roomDetail: {
              id: 'room-1', name: 'Build room', status: 'active', visibility: 'private',
              joinPolicy: 'open', description: '', lastSequence: '4', historyFromSequence: '1',
            },
          }]
        : method === 'getRoomMessages' ? [] : null,
    }))
    ;(globalThis as DesktopRoot).shennianDesktop = {
      account: { execute }, data: { query, mutate: vi.fn(), subscribe: vi.fn() },
    }

    await expect(roomAccountClient.getRoom('room-1')).resolves.toEqual(
      expect.objectContaining({ membershipId: 'member-1', room: expect.objectContaining({ lastSequence: '5' }) }),
    )
    await expect(roomAccountClient.listMessages('room-1', { after: '4', limit: 50 }))
      .resolves.toEqual({ messages: [], hasMore: false })
    await expect(roomAccountClient.updateAgentMode('room-1', 'member-2', {
      activationMode: 'mention_only',
    })).resolves.toEqual({ status: 'active', activationMode: 'mention_only' })

    expect(query.mock.calls.map(([request]) => request.method)).toEqual([
      'getRoomSummaries', 'getRoomMessages', 'getRoomSyncState',
    ])
    expect(execute).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^room-account-/),
      operation: 'room.agentMode.update',
      input: { roomId: 'room-1', membershipId: 'member-2', activationMode: 'mentions' },
    })
    expect(JSON.stringify(execute.mock.calls)).not.toContain('/rooms')
    expect(JSON.stringify(execute.mock.calls)).not.toContain('PATCH')
  })

  it('preserves Desktop domain error codes for Room state branches', async () => {
    const query = vi.fn(async () => ({ ok: true, value: [] }))
    ;(globalThis as DesktopRoot).shennianDesktop = {
      data: { query, mutate: vi.fn(), subscribe: vi.fn() },
    }

    const error = await roomAccountClient.getRoom('missing').catch((reason: unknown) => reason)
    expect(isRoomAccountNotFound(error)).toBe(true)
    expect(isRoomAccountForbidden({ code: 'FORBIDDEN' })).toBe(true)
    expect(isRoomAccountForbidden({ status: 403 })).toBe(true)
  })

  it('recovers a temporarily missing summary membership only from the signed-in human member projection', async () => {
    const query = vi.fn(async ({ method }: { method: string }) => ({
      ok: true,
      value: method === 'getRoomSummaries'
        ? [{
            id: 'room-1', name: 'Build room', status: 'active', visibility: 'private',
            joinPolicy: 'open', lastSequence: '4', updatedAt: '2026-09-10T00:00:00.000Z',
            roomDetail: {
              id: 'room-1', name: 'Build room', status: 'active', visibility: 'private',
              joinPolicy: 'open', description: '', lastSequence: '4', historyFromSequence: '1',
            },
          }]
        : method === 'getRoomMembers'
          ? [
              { id: 'agent-member', payload: { id: 'agent-member', principalType: 'agent', ownerUserId: 'account-1', parentHumanMembershipId: 'human-member', displayAlias: 'Agent', role: 'member', joinedAt: 'now', avatar: null, ownerAvatar: null } },
              { id: 'other-member', payload: { id: 'other-member', principalType: 'human', ownerUserId: 'account-2', parentHumanMembershipId: null, displayAlias: 'Other', role: 'member', joinedAt: 'now', avatar: null, ownerAvatar: null } },
              { id: 'human-member', payload: { id: 'human-member', principalType: 'human', ownerUserId: 'account-1', parentHumanMembershipId: null, displayAlias: 'Me', role: 'member', joinedAt: 'now', avatar: null, ownerAvatar: null } },
            ]
          : null,
    }))
    ;(globalThis as DesktopRoot).shennianDesktop = {
      data: { query, mutate: vi.fn(), subscribe: vi.fn() },
    }

    await expect(roomAccountClient.getRoom('room-1')).resolves.toEqual(
      expect.objectContaining({ membershipId: 'human-member' }),
    )
    expect(query.mock.calls.map(([request]) => request.method)).toEqual([
      'getRoomSummaries', 'getRoomMembers',
    ])
  })

  it('loads the Desktop Room sidebar locally and keeps mutations on fixed operations', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, value: { pinnedAt: null } })
    const query = vi.fn(async ({ method }: { method: string }) => ({
      ok: true,
      value: method === 'getRoomSummaries'
        ? [{ id: 'room-1', name: 'Build' }]
        : [{
            id: 'request-1', roomId: 'room-2', roomName: 'Review', status: 'pending',
            createdAt: '2026-09-10T00:00:00.000Z',
          }],
    }))
    ;(globalThis as DesktopRoot).shennianDesktop = {
      account: { execute }, data: { query, mutate: vi.fn(), subscribe: vi.fn() },
    }

    await expect(roomAccountClient.listRooms()).resolves.toHaveLength(1)
    await expect(roomAccountClient.listMyJoinRequests()).resolves.toHaveLength(1)
    await expect(roomAccountClient.updatePreference('room-1', false)).resolves.toBeNull()

    expect(execute.mock.calls.map(([command]) => command.operation)).toEqual([
      'room.preferences.update',
    ])
    expect(query.mock.calls.map(([request]) => request.method)).toEqual([
      'getRoomSummaries', 'getRoomJoinRequests',
    ])
    expect(JSON.stringify(execute.mock.calls)).not.toContain('/rooms')
    expect(JSON.stringify(execute.mock.calls)).not.toContain('PATCH')
  })
})

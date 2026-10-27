// @covers open-source/packages/server/src/services/room-session-cleanup.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { commitDeletion, finalizeDeletion } = vi.hoisted(() => ({
  commitDeletion: vi.fn(),
  finalizeDeletion: vi.fn(),
}))

vi.mock('../services/sessions.js', () => ({
  commitSessionDeletionInTransaction: commitDeletion,
  finalizeCommittedSessionDeletion: finalizeDeletion,
}))

import {
  commitExclusiveRoomSessionDeletions,
  finalizeExclusiveRoomSessionDeletions,
} from '../services/room-session-cleanup.js'

describe('Room dedicated session cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    commitDeletion.mockImplementation(async (_tx, sessionId: string, userId: string) => ({
      sessionId,
      userId,
      machineId: 'machine_1',
      deletedAt: '2026-09-03T00:00:00.000Z',
      alreadyDeleted: false,
      deletionRevision: 1,
    }))
  })

  it('deduplicates exact binding targets and requests native cleanup', async () => {
    await expect(
      commitExclusiveRoomSessionDeletions({} as never, [
        { sessionId: 'session_1', userId: 'user_1' },
        { sessionId: 'session_1', userId: 'user_1' },
        { sessionId: 'session_2', userId: 'user_2' },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ sessionId: 'session_1', userId: 'user_1' }),
      expect.objectContaining({ sessionId: 'session_2', userId: 'user_2' }),
    ])

    expect(commitDeletion).toHaveBeenNthCalledWith(1, expect.anything(), 'session_1', 'user_1', {
      nativeCleanupPolicy: 'auto',
      deletedAt: undefined,
    })
    expect(commitDeletion).toHaveBeenNthCalledWith(2, expect.anything(), 'session_2', 'user_2', {
      nativeCleanupPolicy: 'auto',
      deletedAt: undefined,
    })

    const committed = await commitExclusiveRoomSessionDeletions({} as never, [
      { sessionId: 'session_1', userId: 'user_1' },
    ])
    expect(finalizeExclusiveRoomSessionDeletions(committed)).toEqual(['session_1'])
    expect(finalizeDeletion).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session_1' }))
  })

  it('fails closed when one Session is attributed to two users', async () => {
    await expect(
      commitExclusiveRoomSessionDeletions({} as never, [
        { sessionId: 'session_1', userId: 'user_1' },
        { sessionId: 'session_1', userId: 'user_2' },
      ]),
    ).rejects.toThrow('room_session_cleanup_identity_conflict')
    expect(commitDeletion).not.toHaveBeenCalled()
  })
})

// @covers packages/app/src/features/rooms/roomCreateWorkflow.ts

import { ApiError, type User } from '@shennian/shared'
import type { RoomSummary } from '@shennian/wire'
import { describe, expect, it, vi } from 'vitest'
import { completeRoomCreation, RoomCreateWorkflowError } from '../features/rooms/roomCreateWorkflow'

const USER = { id: 'user_1', name: '李辰' } satisfies User
const ROOM = { id: 'room_1', name: '产品协作' } as RoomSummary

function workflow(overrides: Partial<Parameters<typeof completeRoomCreation>[0]> = {}) {
  return {
    name: ' 产品协作 ',
    nickname: ' 李辰 ',
    nicknameRequired: true,
    updateProfile: vi.fn(async () => USER),
    persistProfile: vi.fn(),
    createRoom: vi.fn(async () => ROOM),
    ...overrides,
  }
}

describe('Room create workflow', () => {
  it('saves a required nickname before creating the Room', async () => {
    const updateProfile = vi.fn(async () => USER)
    const createRoom = vi.fn(async () => ROOM)
    const input = workflow({ updateProfile, createRoom })
    await expect(completeRoomCreation(input)).resolves.toBe(ROOM)
    expect(updateProfile).toHaveBeenCalledWith('李辰')
    expect(input.persistProfile).toHaveBeenCalledWith(USER)
    expect(createRoom).toHaveBeenCalledWith('产品协作')
    expect(updateProfile.mock.invocationCallOrder[0]).toBeLessThan(
      createRoom.mock.invocationCallOrder[0],
    )
  })

  it('keeps the one-step path for an account that already has a nickname', async () => {
    const input = workflow({ nicknameRequired: false })
    await completeRoomCreation(input)
    expect(input.updateProfile).not.toHaveBeenCalled()
    expect(input.createRoom).toHaveBeenCalledOnce()
  })

  it('does not create a Room when profile saving fails', async () => {
    const input = workflow({
      updateProfile: vi.fn(async () => Promise.reject(new Error('offline'))),
    })
    await expect(completeRoomCreation(input)).rejects.toEqual(
      new RoomCreateWorkflowError('profile_update_failed'),
    )
    expect(input.createRoom).not.toHaveBeenCalled()
  })

  it('turns a stale-profile conflict into an inline nickname request', async () => {
    const input = workflow({
      nicknameRequired: false,
      createRoom: vi.fn(async () =>
        Promise.reject(
          new ApiError(409, '{"error":"profile_name_required","message":"Set a name"}'),
        ),
      ),
    })
    await expect(completeRoomCreation(input)).rejects.toEqual(
      new RoomCreateWorkflowError('nickname_required'),
    )
  })
})

// @arch docs/features/network-rooms/ui.md#六移动端
// @test src/__tests__/room-create-workflow.test.ts

import { ApiError, type User } from '@shennian/shared'
import type { RoomSummary } from '@shennian/wire'

export type RoomCreateFailure = 'nickname_required' | 'profile_update_failed' | 'room_create_failed'

export class RoomCreateWorkflowError extends Error {
  constructor(public readonly reason: RoomCreateFailure) {
    super(reason)
    this.name = 'RoomCreateWorkflowError'
  }
}

type Input = {
  name: string
  nickname: string
  nicknameRequired: boolean
  updateProfile: (nickname: string) => Promise<User>
  persistProfile: (user: User) => void | Promise<void>
  createRoom: (name: string) => Promise<RoomSummary>
}

export async function completeRoomCreation(input: Input): Promise<RoomSummary> {
  if (input.nicknameRequired) {
    const nickname = input.nickname.trim()
    if (!nickname) throw new RoomCreateWorkflowError('nickname_required')
    try {
      const user = await input.updateProfile(nickname)
      await input.persistProfile(user)
    } catch {
      throw new RoomCreateWorkflowError('profile_update_failed')
    }
  }

  try {
    return await input.createRoom(input.name.trim())
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 409 &&
      error.message.includes('profile_name_required')
    ) {
      throw new RoomCreateWorkflowError('nickname_required')
    }
    throw new RoomCreateWorkflowError('room_create_failed')
  }
}

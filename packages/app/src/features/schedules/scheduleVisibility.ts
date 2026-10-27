// @arch docs/features/conversation-schedules.md#二已确认的产品边界
// @test src/__tests__/session-details-modal.test.ts

import type { LinkedRoomBindingView } from '../rooms/types'
import type { ConversationSchedule } from '@shennian/wire'

/** A schedule remains manageable from the UI until it reaches its terminal state. */
export function hasActiveSchedule(tasks: ConversationSchedule[]): boolean {
  return tasks.some((task) => task.state === 'active' || task.state === 'paused')
}

export function canShowSessionSchedules(
  canManage: boolean,
  agentIdentityId: string | null | undefined,
  binding: LinkedRoomBindingView | null,
): boolean {
  return canManage && Boolean(agentIdentityId) && binding?.status === 'active' && binding.room.status === 'active'
}

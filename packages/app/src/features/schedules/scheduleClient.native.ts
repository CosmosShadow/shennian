// @arch docs/features/conversation-schedules.md
// @test src/__tests__/schedule-worker-client.test.ts
import type { ConversationSchedule, ScheduleAction } from '@shennian/wire'
import { authApi } from '../../config/api'
export const scheduleClient = {
  ensureDefaultDiary: (timezone: string) => authApi('/schedules/default-diary', { method: 'POST', body: JSON.stringify({ timezone }) }),

  async create(machineId: string, input: { operationId: string; prompt: string; timeDescription: string; timezone: string; executionMode?: 'main' | 'worker' }) {
    const result = await authApi<{ task?: ConversationSchedule }>('/schedules/steward', { method: 'POST', body: JSON.stringify({ ...input, machineId, action: 'create' }) })
    if (input.executionMode === 'worker' && result.task?.executionMode !== 'worker') throw new Error('schedule_server_upgrade_required')
    return result
  },

  async list(scope: { sessionId?: string; roomId?: string; stewardMachineId?: string; allSteward?: boolean }): Promise<ConversationSchedule[]> {
    const query = new URLSearchParams()
    if (scope.sessionId) query.set('sessionId', scope.sessionId)
    if (scope.roomId) query.set('roomId', scope.roomId)
    if (scope.stewardMachineId) query.set('stewardMachineId', scope.stewardMachineId)
    if (scope.allSteward) query.set('allSteward', '1')
    return (await authApi<{ tasks: ConversationSchedule[] }>(`/schedules?${query}`)).tasks
  },
  async mutate(task: ConversationSchedule, action: ScheduleAction, changes: Record<string, unknown> = {}) {
    // A steward task has no live "current Session" to act through from the settings page
    // (the creating Session may since be abandoned or deleted); machine ownership suffices.
    if (task.scope === 'steward') {
      const result = await authApi<{ tasks?: ConversationSchedule }>('/schedules/steward', { method: 'POST', body: JSON.stringify({ ...changes, machineId: task.machineId, id: task.id, version: task.version, action }) })
      if (changes.executionMode === 'worker' && result.tasks?.executionMode !== 'worker') throw new Error('schedule_server_upgrade_required')
      return
    }
    await authApi('/schedules', { method: 'POST', body: JSON.stringify({ ...changes, sessionId: task.sessionId, id: task.id, version: task.version, action }) })
  },
}

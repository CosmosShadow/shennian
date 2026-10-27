// @arch docs/features/conversation-schedules.md
import { scopedRoomApi } from '../rooms/scopedRoomApi'
import type { ConversationSchedule, ScheduleAction } from '@shennian/wire'
import { scheduleClient as browserClient } from './scheduleClient.native'
type Bridge = { execute(command: { requestId: string; operation: string; input: Record<string, unknown> }): Promise<{ ok: boolean; value?: unknown; error?: { message: string } }> }
function bridge() { return (globalThis as typeof globalThis & { shennianDesktop?: { account?: Bridge } }).shennianDesktop?.account }
async function execute(operation: string, input: Record<string, unknown>) {
  const result = await bridge()!.execute({ requestId: `schedule-${crypto.randomUUID()}`, operation, input })
  if (!result.ok) throw new Error(result.error?.message ?? 'schedules_unavailable')
  return result.value
}
export const scheduleClient = {
  ensureDefaultDiary: browserClient.ensureDefaultDiary,

  create: browserClient.create,

  async list(scope: { sessionId?: string; roomId?: string }): Promise<ConversationSchedule[]> {
    if (!bridge() && scope.roomId) return (await scopedRoomApi<{ tasks: ConversationSchedule[] }>(scope.roomId, '/schedules')).tasks
    if (!bridge()) return browserClient.list(scope)
    return (await execute('schedule.list', scope) as { tasks: ConversationSchedule[] }).tasks
  },
  async mutate(task: ConversationSchedule, action: ScheduleAction, changes: Record<string, unknown> = {}) {
    if (!bridge() && task.roomId) { await scopedRoomApi(task.roomId, '/schedules', { method: 'POST', body: JSON.stringify({ ...changes, id: task.id, version: task.version, action }) }); return }
    if (!bridge()) return browserClient.mutate(task, action, changes)
    await execute('schedule.mutate', { ...changes, sessionId: task.sessionId, id: task.id, version: task.version, action })
  },
}

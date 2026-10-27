// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-reminder-command.test.ts
import { DaemonIpcError } from '../daemon-ipc/protocol.js'
import type { DaemonIpcHandler } from '../daemon-ipc/server.js'
import type { RoomSessionRegistry } from '../room/session-registry.js'
import type { JsonValue } from '../daemon-ipc/json.js'
import { loadConfig } from '../config/index.js'
import { isStewardSessionId } from '../steward/session.js'
import { resolvePersonalScheduleContext } from './personal-context.js'
import { executeServerSchedule } from './server-client.js'
import { executeServerReminder } from './reminder-client.js'
export function personalScheduleHandlers(
  serverUrl: string,
  registry: RoomSessionRegistry,
): Record<string, DaemonIpcHandler> {
  function trusted(params: JsonValue | undefined) {
    const args = params as Record<string, unknown>
    let sessionId: string
    try { sessionId = resolvePersonalScheduleContext(args?.context) }
    catch { throw new DaemonIpcError('schedule_context_expired', 'schedule_context_expired: 本次日程操作授权已过期，请重新发送请求；不要原样循环重试。') }
    // Grants are issued only to the steward. Recheck the live session before either API.
    if (registry.getByNianSessionId(sessionId)?.binding || !isStewardSessionId(sessionId))
      throw new DaemonIpcError('schedule_personal_context_required', 'schedule_personal_context_required: 此操作仅供个人管家使用，请返回神念对话重试。')
    return { serverUrl, machineToken: loadConfig().machineToken!, sessionId, args }
  }
  return {
    'schedule.personal': async (params) => {
      const input = trusted(params)
      return (await executeServerSchedule({
        ...input,
        action: input.args.operation as import('@shennian/wire').ScheduleAction,
      })) as JsonValue
    },
    'reminder.personal': async (params) =>
      (await executeServerReminder(trusted(params))) as JsonValue,
  }
}

// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-reminder-agent.test.ts
import { scheduleSession } from '../conversation-schedules.js'
import * as store from './store.js'
import { object, reminder, text } from './domain.js'
import { completeModuleJson } from './model.js'
export async function previewReminder(input: unknown) {
  const b = object(input),
    timezone = text(b.timezone, 100)
  const result = await completeModuleJson(
    '你是日程解析器。用户只是在创建或编辑一条日程待办或备忘，不一定需要提醒时间。根据输入的当前时间与时区解释相对日期，只返回JSON {"content":"要提醒的事","when":"含时区的ISO时间或每天09:00/每周一09:00/每月1日09:00规则"}。保留明确给出的时间与重复规则。同一事项每天多个提醒时间必须合为一条，例如吃药每天9点、12点半、18点半返回 {"content":"吃药","when":"每天09:00、12:30、18:30"}，不要丢掉任一时间。用户未提供时间或明确取消时间时，直接返回 {"content":"事项内容","when":""}，保存为无时间备忘；不要追问、猜测或补成当前时间。用户明确要求定时提醒但时间表述有歧义时才返回 {"error":"need_time"}。content 只放事项内容，不要重复拼入 ISO 时间。不执行任何动作。',
    { input: text(b.text, 2000), timezone, now: new Date().toISOString() },
  )
  return reminder({ ...result, timezone })
}
export async function executeReminderAgent(userId: string, machineId: string, input: unknown) {
  const b = object(input)
  const session = await scheduleSession(userId, text(b.sessionId), machineId)
  if (
    session.sessionScope !== 'steward' ||
    session.roomBinding ||
    session.machine.remoteAccessDisabledAt
  )
    throw new Error('invalid_reminder_context')
  const operation = text(b.operation, 30)
  if (operation === 'list') {
    const rows = await store.records.findMany({
      where: {
        userId,
        kind: 'reminder',
        state: { not: 'deleted' },
        ...(b.before ? { key: { lt: text(b.before) } } : {}),
      },
      orderBy: { key: 'desc' },
      take: 201,
    })
    return { items: rows.slice(0, 200), nextBefore: rows.length > 200 ? rows[199]!.key : null }
  }
  if (operation === 'preview') return previewReminder(b)
  const key = text(b.id)
  if (operation === 'create') return store.saveReminder(userId, key, b)
  if (!Number.isSafeInteger(b.revision) || Number(b.revision) < 1)
    throw new Error('invalid_revision')
  if (operation === 'update') return store.saveReminder(userId, key, b, Number(b.revision))
  const state = (
    { complete: 'completed', restore: 'active', delete: 'deleted' } as Record<string, string>
  )[operation]
  if (!state) throw new Error('invalid_operation')
  return store.reminderState(userId, key, state, Number(b.revision))
}

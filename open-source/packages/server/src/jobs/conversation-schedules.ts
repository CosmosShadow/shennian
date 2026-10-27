// @arch open-source/docs/server-runtime.md
// @test src/__tests__/conversation-schedules.test.ts
import { prisma } from '../lib/prisma.js'
import type { ScheduleRule } from '@shennian/wire'
import { nextScheduleTime } from '../services/schedule-time.js'
import { sendServerReqToMachine } from '../relay/server-requests.js'
import { resolveDeliveryTarget } from '../services/conversation-schedules.js'
let timer: ReturnType<typeof setInterval> | undefined
let running: Promise<void> | undefined
const startedAt = Date.now()
export async function runConversationSchedules(now = Date.now()) {
  await prisma.conversationSchedule.updateMany({ where: { lastState: 'dispatching', deliveryAt: { lt: new Date(now - 30000) } }, data: { lastState: 'failed', lastReason: 'delivery_unconfirmed' } })
  const tasks = await prisma.conversationSchedule.findMany({ where: { state: 'active', nextDueAt: { lte: new Date(now) } }, take: 100, orderBy: { nextDueAt: 'asc' }, include: { session: { include: { machine: true, roomBinding: { include: { room: true } } } } } })
  await Promise.all(tasks.map(async task => {
    const at = task.nextDueAt!.getTime()
    const steward = task.scope === 'steward'
    // A steward delivery target is resolved fresh each tick: the Session that created
    // the task may already be abandoned (machine/tool/model/strength switch). A 'room'
    // task's Session is permanent, so the eager include above is already current.
    const session = steward ? await resolveDeliveryTarget(task) : task.session
    const binding = session?.roomBinding
    const ended = Boolean(session && (steward ? session.machine.userId !== task.userId : (session.deletedAt || session.machine.userId !== task.userId ||
      (task.bindingId && (binding?.id !== task.bindingId || binding.status === 'detached' || binding.room.status !== 'active')))))
    const offline = !session || !session.machine.online || !session.machine.paired || Boolean(session.machine.remoteAccessDisabledAt) ||
      Boolean(!steward && task.bindingId && binding?.status !== 'active')
    const missed = at < startedAt || now - at > 5000
    const next = ended ? null : nextScheduleTime(task.rule as ScheduleRule, task.timezone, now)
    const messageId = `schedule:${task.id}:${task.version}:${at}`
    // Compare-and-swap is the authority across Worker instances. Advance before
    // sending: a crashed Worker skips its claimed occurrence rather than replaying it.
    const claimed = await prisma.conversationSchedule.updateMany({ where: { id: task.id, version: task.version, state: 'active', nextDueAt: task.nextDueAt }, data: {
      nextDueAt: next === null ? null : new Date(next), state: next === null ? 'ended' : 'active',
      deliveryId: messageId, deliveryAt: new Date(at), lastState: ended || offline || missed ? 'skipped' : 'dispatching',
      lastReason: ended ? 'ended' : offline ? 'offline' : missed ? 'missed' : null,
    } })
    if (!claimed.count || ended || offline || missed || !session) return
    let state = 'failed'
    try {
      const res = await sendServerReqToMachine(session.machineId, { type: 'req', method: 'schedule.deliver', params: { id: task.id, deliveryId: messageId } }, 15000)
      state = res.ok ? 'delivered' : 'failed'
    } catch { /* No retry: the durable queue may already own the message. */ }
    await prisma.conversationSchedule.updateMany({ where: { id: task.id, deliveryId: messageId }, data: { lastState: state, lastReason: state === 'failed' ? 'delivery_unconfirmed' : null } })
  }))
}
export function startConversationSchedulesJob() {
  if (timer) return
  timer = setInterval(() => {
    if (running) return
    running = runConversationSchedules().catch(() => console.error('[schedules] tick failed')).finally(() => { running = undefined })
  }, 1000)
  timer.unref?.()
}
export async function stopConversationSchedulesJob() { clearInterval(timer); timer = undefined; await running }

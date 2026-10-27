// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-modules.test.ts
import { prisma } from '../lib/prisma.js'
import { advanceReminder } from '../services/personal-modules/domain.js'
import { sendPushNotification } from '../services/push.js'
let timer: ReturnType<typeof setInterval> | undefined
let running: Promise<void> | undefined
export async function runPersonalReminders(now = Date.now()) {
  const rows = await prisma.personalModuleRecord.findMany({
    where: { kind: 'reminder', state: 'active', dueAt: { not: null, lte: new Date(now) } },
    orderBy: { dueAt: 'asc' },
    take: 100,
  })
  for (const row of rows) {
    const next = advanceReminder(row.payload, now)
    // CAS claims each occurrence across Worker instances before any external delivery.
    const claim = await prisma.personalModuleRecord.updateMany({
      where: { id: row.id, state: 'active', revision: row.revision, dueAt: row.dueAt },
      data: {
        state: next === null ? 'notified' : 'active',
        dueAt: next === null ? null : new Date(next),
        revision: { increment: 1 },
      },
    })
    if (!claim.count) continue
    try {
      await sendPushNotification(
        row.userId,
        '神念 · 日程提醒',
        String((row.payload as { content: string }).content),
        { personalReminderKey: row.key },
        {
          audience: 'mobile',
          requireDelivery: true,
          traceId: `reminder:${row.id}:${row.revision}`,
        },
      )
    } catch {
      // Do not retry an ambiguous external push: preserve a durable visible delivery error.
      await prisma.personalModuleRecord.updateMany({
        where: { id: row.id, revision: row.revision + 1 },
        data: {
          payload: { ...(row.payload as Record<string, string>), deliveryError: true },
        },
      })
    }
  }
}
export function startPersonalRemindersJob() {
  if (timer) return
  timer = setInterval(() => {
    if (!running)
      running = runPersonalReminders()
        .catch(() => console.error('[personal-reminders] tick failed'))
        .finally(() => {
          running = undefined
        })
  }, 1000)
  timer.unref?.()
}
export async function stopPersonalRemindersJob() {
  clearInterval(timer)
  timer = undefined
  await running
}

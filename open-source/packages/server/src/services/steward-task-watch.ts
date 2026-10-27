import { getSessionActivity } from './session-activity.js'
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/steward-task-watch.test.ts
import { createHash } from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { ownedMachine } from './local-apps/gateway.js'
import { sendServerReqToMachine } from '../relay/server-requests.js'
const KIND = 'steward-task-watch'
type Watch = { taskId: string; stewardSessionId: string; machineId: string; cursorAt: string; cursorId: string; lastProgressKey?: string; pending?: { eventId: string; notificationId: string; at: string; progressKey?: string; title: string; summary: string; state: string }; leaseUntil?: number }
export async function registerStewardTaskWatch(userId: string, machineId: string, taskId: string, stewardSessionId: unknown) {
  if (typeof stewardSessionId !== 'string' || !/^[\w-]{1,191}$/.test(stewardSessionId)) throw new Error('task_watch_invalid')
  await ownedMachine(userId, machineId)
  const [origin, task] = await Promise.all([
    prisma.nianSession.findFirst({ where: { id: stewardSessionId, userId, machineId, sessionScope: 'steward', deletedAt: null } }),
    prisma.nianSession.findFirst({ where: { id: taskId, userId, sessionScope: 'personal', agentIdentityId: null, deletedAt: null, roomBinding: { is: null } } }),
  ])
  if (!origin || !task) throw new Error('task_watch_forbidden')
  await ownedMachine(userId, task.machineId)
  const capability = await sendServerReqToMachine(machineId, { type: 'req', method: 'personal.workspace', params: { action: 'info' } }, 10000)
  if (!capability.ok || (capability.payload as { projectTaskEvents?: boolean })?.projectTaskEvents !== true) throw new Error('task_watch_client_upgrade_required')
  const key = createHash('sha256').update(`${stewardSessionId}:${taskId}`).digest('hex')
  const record = await prisma.personalModuleRecord.upsert({ where: { userId_kind_key: { userId, kind: KIND, key } },
    create: { userId, kind: KIND, key, payload: { taskId, stewardSessionId, machineId, cursorAt: task.createdAt.toISOString(), cursorId: '' } }, update: {} })
  return { enabled: true, watchId: record.id, taskId, stewardSessionId }
}
export async function readStewardTaskEvent(userId: string, machineId: string, raw: unknown) {
  const b = raw as Record<string, unknown>
  if (!b || typeof b.watchId !== 'string' || typeof b.eventId !== 'string') throw new Error('task_watch_invalid')
  await ownedMachine(userId, machineId)
  const row = await prisma.personalModuleRecord.findFirst({ where: { id: b.watchId, userId, kind: KIND } })
  const watch = row?.payload as Watch | undefined
  if (!watch || watch.machineId !== machineId || watch.pending?.eventId !== b.eventId) throw new Error('task_watch_forbidden')
  const [origin, task] = await Promise.all([
    prisma.nianSession.findFirst({ where: { id: watch.stewardSessionId, userId, machineId, sessionScope: 'steward', deletedAt: null } }),
    prisma.nianSession.findFirst({ where: { id: watch.taskId, userId, agentIdentityId: null, deletedAt: null, roomBinding: { is: null } } }),
  ])
  if (!origin || !task) throw new Error('task_watch_forbidden')
  await ownedMachine(userId, task.machineId)
  return { sessionId: origin.id, taskId: task.id, ...watch.pending }
}
let scanCursor = ''
export async function drainStewardTaskEvents(now = Date.now()) {
  const rows = await prisma.personalModuleRecord.findMany({ where: { kind: KIND, ...(scanCursor ? { id: { gt: scanCursor } } : {}) }, orderBy: { id: 'asc' }, take: 100 })
  scanCursor = rows.at(-1)?.id ?? ''
  for (const row of rows) {
    const watch = row.payload as Watch
    if (!watch?.taskId || !watch.stewardSessionId || !watch.machineId || (watch.leaseUntil ?? 0) > now) continue
    try {
      const machine = await ownedMachine(row.userId, watch.machineId)
      if (!machine.online) continue
      let pending = watch.pending
      if (!pending) {
        const notification = await prisma.sessionTerminalNotification.findFirst({ where: {
          userId: row.userId, sessionId: watch.taskId,
          OR: [{ createdAt: { gt: new Date(watch.cursorAt) } }, { createdAt: new Date(watch.cursorAt), id: { gt: watch.cursorId } }],
        }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
        if (!notification) {
          const activity = await getSessionActivity(watch.taskId)
          const progressKey = activity && `${activity.runId}:${activity.runPhase}`
          if (!activity || !['waiting_approval', 'waiting_user_input'].includes(activity.runPhase) || progressKey === watch.lastProgressKey) continue
          pending = { eventId: `project-progress:${row.id}:${progressKey}`, notificationId: '', progressKey: progressKey!, at: new Date(now).toISOString(), title: '项目任务需要处理', summary: activity.runPhase === 'waiting_approval' ? '原任务等待权限确认，请核对授权；不要替用户绕过权限。' : '原任务等待用户输入，请读取原任务后说明需要的决定。', state: activity.runPhase }
        } else pending = { eventId: `project-result:${row.id}:${notification.id}`, notificationId: notification.id, at: notification.createdAt.toISOString(), title: notification.notificationTitle ?? '', summary: notification.notificationBody ?? '', state: notification.terminalState }
      }
      const claimed = await prisma.personalModuleRecord.updateMany({ where: { id: row.id, revision: row.revision }, data: { payload: { ...watch, pending, leaseUntil: now + 30000 }, revision: { increment: 1 } } })
      if (!claimed.count) continue
      let acknowledged = false
      try {
        const result = await sendServerReqToMachine(watch.machineId, { type: 'req', method: 'project.taskEvent', params: { watchId: row.id, eventId: pending.eventId } }, 20000)
        acknowledged = result.ok
      } catch { /* Keep the same frozen event and ID for recovery after an ambiguous ACK. */ }
      const settled = { ...watch }; delete settled.pending
      await prisma.personalModuleRecord.updateMany({ where: { id: row.id, revision: row.revision + 1 }, data: {
        payload: acknowledged ? { ...settled, ...(pending.progressKey ? { lastProgressKey: pending.progressKey } : { cursorAt: pending.at, cursorId: pending.notificationId }), leaseUntil: 0 } : { ...watch, pending, leaseUntil: now + 30000 }, revision: { increment: 1 },
      } })
    } catch { /* Revoked/offline targets never get rerouted to a different user or machine. */ }
  }
}

// @arch open-source/docs/server-runtime.md
// @test src/__tests__/conversation-schedules.test.ts
// @test src/__tests__/schedule-worker-delivery.test.ts
import type { FastifyInstance } from 'fastify'
import type { ScheduleAction, ScheduleRule } from '@shennian/wire'
import { requireAuth, requireUserOrMachineAuth } from '../middleware/auth.js'
import { createMachineSchedule, executeSchedule, executeStewardSettingsSchedule, listSchedules, resolveDeliveryTarget } from '../services/conversation-schedules.js'
import { ensureDefaultDiarySchedule } from '../services/default-diary-schedule.js'
import { prisma } from '../lib/prisma.js'
export async function conversationScheduleRoutes(app: FastifyInstance) {
  app.post<{ Body: { timezone: string } }>('/schedules/default-diary', { preHandler: requireAuth }, async (req, reply) => {
    try {
      if (typeof req.body?.timezone !== 'string' || req.body.timezone.length > 100) throw new Error('schedule_time_invalid')
      return { task: await ensureDefaultDiarySchedule(req.userId, req.body.timezone) }
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'schedules_unavailable' }) }
  })
  app.get<{ Querystring: { sessionId?: string; roomId?: string; stewardMachineId?: string; allSteward?: string } }>('/schedules', { preHandler: requireAuth }, async (req, reply) => {
    try {
      return { tasks: await listSchedules(req.userId, { ...req.query, allSteward: req.query.allSteward === '1' }) }
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'schedules_unavailable' }) }
  })
  app.post<{ Body: Record<string, unknown> }>('/schedules', { preHandler: requireUserOrMachineAuth }, async (req, reply) => {
    try { return { tasks: await executeSchedule(req.userId, String(req.body.sessionId ?? ''), req.body.action as ScheduleAction, req.body, req.machineId) } }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'schedules_unavailable' }) }
  })
  // The steward settings page manages tasks across every machine; there is no "current
  // Session" there (the user may be looking at a machine with no open conversation at all).
  app.post<{ Body: Record<string, unknown> }>('/schedules/steward', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const action = req.body.action as ScheduleAction
      if (action === 'create') return { task: await createMachineSchedule(req.userId, String(req.body.machineId ?? ''), req.body) }
      return { tasks: await executeStewardSettingsSchedule(req.userId, String(req.body.machineId ?? ''), action, req.body) }
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'schedules_unavailable' }) }
  })
  app.post<{ Body: { id: string; deliveryId: string; workerDelivery?: boolean } }>('/schedules/delivery', { preHandler: requireUserOrMachineAuth, schema: { body: { type: 'object', required: ['id', 'deliveryId'], properties: { workerDelivery: { type: 'boolean' }, id: { type: 'string', minLength: 1, maxLength: 191 }, deliveryId: { type: 'string', minLength: 1, maxLength: 191 } } } } }, async (req, reply) => {
    if (!req.machineId) return reply.code(403).send({ error: 'machine_required' })
    const task = await prisma.conversationSchedule.findFirst({ where: { id: req.body.id, userId: req.userId, deliveryId: req.body.deliveryId, lastState: 'dispatching' } })
    if (!task || !task.deliveryAt || Date.now() - task.deliveryAt.getTime() > 30000) return reply.code(409).send({ error: 'schedule_delivery_expired' })
    // Steward resolution picks whichever Session on the bound machine is currently
    // active, which may not be task.sessionId (the one that created the task).
    const session = await resolveDeliveryTarget(task)
    if (!session || session.machineId !== req.machineId || session.machine.userId !== req.userId) return reply.code(409).send({ error: 'schedule_session_unavailable' })
    if (task.scope !== 'steward' && task.bindingId && (session.roomBinding?.id !== task.bindingId || session.roomBinding.status !== 'active' || session.roomBinding.room.status !== 'active')) return reply.code(409).send({ error: 'schedule_binding_unavailable' })
    const executionMode = (task.rule as ScheduleRule).executionMode ?? 'main'
    if (executionMode === 'worker' && req.body.workerDelivery !== true) return reply.code(409).send({ error: 'schedule_client_upgrade_required' })
    return { executionMode, sessionId: session.id, prompt: task.prompt, bindingId: task.scope === 'steward' ? undefined : task.bindingId ?? undefined, roomId: task.scope === 'steward' ? undefined : task.roomId ?? undefined, messageId: task.deliveryId }
  })
}

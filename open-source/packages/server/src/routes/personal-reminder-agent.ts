// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-reminder-agent.test.ts
import type { FastifyInstance } from 'fastify'
import { requireUserOrMachineAuth } from '../middleware/auth.js'
import { executeReminderAgent } from '../services/personal-modules/reminder-agent.js'
export async function personalReminderAgentRoutes(app: FastifyInstance) {
  for (const url of ['/personal-reminders/agent', '/api/personal-reminders/agent']) app.post(
    url,
    { preHandler: requireUserOrMachineAuth },
    async (req, reply) => {
      if (!req.machineId) return reply.code(403).send({ error: 'machine_required' })
      try {
        return await executeReminderAgent(req.userId, req.machineId, req.body)
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        const safe = /^(invalid_|not_found$|revision_conflict$|schedule_session_unavailable$)/.test(
          message,
        )
        return reply
          .code(message === 'revision_conflict' ? 409 : safe ? 422 : 503)
          .send({ error: safe ? message : 'reminders_unavailable' })
      }
    },
  )
}

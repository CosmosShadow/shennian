// @arch open-source/docs/server-runtime.md
// @test src/__tests__/adapter-submissions.test.ts

import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  registerAuthDecorators,
  requireActivePlan,
  requireUserOrMachineAuth,
} from '../middleware/auth.js'
import {
  AdapterSubmissionError,
  createAdapterSubmission,
  type AdapterSubmissionInput,
} from '../services/adapter-submissions.js'

export async function adapterSubmissionRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  app.post<{ Body: AdapterSubmissionInput }>(
    '/',
    { preHandler: [requireUserOrMachineAuth, requireActivePlan] },
    async (request, reply) => {
      if (!request.machineId) {
        return reply.code(403).send({ error: 'machine_auth_required' })
      }
      try {
        const result = await createAdapterSubmission({
          userId: request.userId,
          machineId: request.machineId,
          body: request.body ?? {},
        })
        return reply.code(result.duplicate ? 200 : 201).send({
          submissionId: result.submission.id,
          status: result.submission.status,
          sha256: result.submission.sha256,
          duplicate: result.duplicate,
          officialAdapterRegistered: false,
        })
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AdapterSubmissionError) {
    return reply.code(error.statusCode).send({
      error: error.code,
      message: error.message,
      ...(error.issues ? { issues: error.issues } : {}),
    })
  }
  throw error
}

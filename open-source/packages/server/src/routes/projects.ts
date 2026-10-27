// @arch open-source/docs/server-runtime.md
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/projects.test.ts

import type { FastifyInstance } from 'fastify'
import { filterAvailableAgentTypes } from '@shennian/wire'
import { registerAuthDecorators, requireActivePlan, requireAuth } from '../middleware/auth.js'
import {
  createProjectForUser,
  getUserProject,
  listUserProjects,
  removeProjectForUser,
  updateProjectLaunchDefaults,
} from '../services/projects.js'
import { deleteSessionForUser, listProjectSessions } from '../services/sessions.js'
import { pruneOldestProjectSessions } from '../services/project-session-pruning.js'
import { requirePersonalSyncHttpEpoch } from '../middleware/personal-sync-http.js'
import { requireNonReviewMachineAccess } from '../services/review-account-policy.js'

export async function projectRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  const machineUserAuth = [requireAuth, requireActivePlan, requireNonReviewMachineAccess]
  app.addHook('preHandler', requirePersonalSyncHttpEpoch)
  app.get('/', { preHandler: machineUserAuth }, async (request) => ({
    projects: await listUserProjects(request.userId),
  }))

  app.post<{ Body: { machineId?: string; workDir?: string } }>(
    '/',
    { preHandler: machineUserAuth },
    async (request, reply) => {
      const machineId = request.body?.machineId?.trim()
      const workDir = request.body?.workDir?.trim()
      if (!machineId || !workDir)
        return reply.code(400).send({ error: 'machineId and workDir are required' })
      try {
        return {
          project: await createProjectForUser({ userId: request.userId, machineId, workDir }),
        }
      } catch (error) {
        const message = (error as Error).message
        if (message === 'Machine not found') return reply.code(404).send({ error: message })
        if (message === 'Invalid project directory') return reply.code(400).send({ error: message })
        throw error
      }
    },
  )

  app.get<{
    Params: { projectId: string }
    Querystring: { limit?: string; before?: string }
  }>(
    '/:projectId/sessions',
    { preHandler: machineUserAuth },
    async (request, reply) => {
      try {
        const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 100)
        const before = request.query.before ? new Date(Number(request.query.before)) : undefined
        const project = await getUserProject(request.userId, request.params.projectId)
        const sessions = await listProjectSessions({
          machineId: project.machineId,
          workDir: project.workDir,
          userId: request.userId,
          limit: limit + 1,
          before,
        })
        return { sessions: sessions.slice(0, limit), hasMore: sessions.length > limit }
      } catch (error) {
        if ((error as Error).message === 'Project not found') {
          return reply.code(404).send({ error: 'Project not found' })
        }
        throw error
      }
    },
  )

  app.patch<{
    Params: { projectId: string }
    Body: { defaultAgentType?: string; defaultModelId?: string | null }
  }>(
    '/:projectId/defaults',
    { preHandler: machineUserAuth },
    async (request, reply) => {
      const agentType = request.body?.defaultAgentType
        ? filterAvailableAgentTypes([request.body.defaultAgentType])[0]
        : undefined
      if (!agentType) return reply.code(400).send({ error: 'Valid defaultAgentType is required' })
      const modelId = request.body?.defaultModelId?.trim() || null
      try {
        return {
          project: await updateProjectLaunchDefaults({
            userId: request.userId,
            projectId: request.params.projectId,
            agentType,
            modelId,
          }),
        }
      } catch (error) {
        if ((error as Error).message === 'Project not found') {
          return reply.code(404).send({ error: 'Project not found' })
        }
        throw error
      }
    },
  )

  app.post<{
    Params: { projectId: string }
    Body: { count?: number }
  }>(
    '/:projectId/sessions/prune-oldest',
    { preHandler: machineUserAuth },
    async (request, reply) => {
      const count = Math.min(Math.max(Math.floor(Number(request.body?.count) || 20), 1), 20)
      try {
        const project = await getUserProject(request.userId, request.params.projectId)
        return await pruneOldestProjectSessions({
          machineId: project.machineId,
          workDir: project.workDir,
          userId: request.userId,
          count,
        })
      } catch (error) {
        const message = (error as Error).message
        if (message === 'Project not found') return reply.code(404).send({ error: message })
        if (message === 'Not authorized') return reply.code(403).send({ error: message })
        throw error
      }
    },
  )

  app.delete<{ Params: { projectId: string } }>(
    '/:projectId',
    { preHandler: machineUserAuth },
    async (request, reply) => {
      try {
        const result = await removeProjectForUser(
          request.userId,
          request.params.projectId,
          deleteSessionForUser,
        )
        return { ok: true, ...result }
      } catch (error) {
        const message = (error as Error).message
        if (message === 'Project not found') return reply.code(404).send({ error: message })
        if (message === 'Not authorized') return reply.code(403).send({ error: message })
        throw error
      }
    },
  )
}

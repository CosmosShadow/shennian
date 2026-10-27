// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-workspace.test.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { registerAuthDecorators, requireAuth, requireActivePlan, requireUserOrMachineAuth } from '../middleware/auth.js'
import { requireNonReviewMachineAccess } from '../services/review-account-policy.js'
import { ownedMachine } from '../services/local-apps/gateway.js'
import { primaryMachine, setPrimaryMachine, readPrimaryWorkspace } from '../services/personal-workspace/primary-machine.js'
export async function personalWorkspaceRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  app.addHook('onSend', async (_request, reply) => { reply.header('Cache-Control', 'no-store') })
  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : ''
    const code = /^personal_[a-z_]+$/.test(message) || message === 'machine_owner_required' ? message : 'personal_unavailable'
    return reply.code(code === 'machine_owner_required' ? 403 : ['personal_primary_conflict', 'personal_file_changed'].includes(code) ? 409 : code === 'personal_invalid_request' ? 400 : 503).send({ error: code })
  })
  const deviceAuth = [requireAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const device = await prisma.device.findUnique({ where: { id: request.deviceId }, select: { userId: true } })
    if (device?.userId !== request.userId) return reply.code(401).send({ error: 'personal_device_expired' })
  }, requireActivePlan, requireNonReviewMachineAccess]
  app.get('/primary-machine', { preHandler: deviceAuth }, request => primaryMachine(request.userId))
  app.put('/primary-machine', { preHandler: deviceAuth, bodyLimit: 1000 }, request => setPrimaryMachine(request.userId, request.body))
  app.post('/primary', { preHandler: deviceAuth, bodyLimit: 3200000 }, request => readPrimaryWorkspace(request.userId, request.body))
  const cliAuth = [requireUserOrMachineAuth, requireActivePlan, requireNonReviewMachineAccess, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.machineId) return reply.code(403).send({ error: 'machine_owner_required' })
    await ownedMachine(request.userId, request.machineId)
  }]
  app.get('/primary-machine-cli', { preHandler: cliAuth }, request => primaryMachine(request.userId))
  app.put('/primary-machine-cli', { preHandler: cliAuth, bodyLimit: 1000 }, request => {
    const input = request.body as Record<string, unknown>
    if (!input || input.machineId !== request.machineId) throw new Error('personal_invalid_request')
    return setPrimaryMachine(request.userId, input)
  })
}

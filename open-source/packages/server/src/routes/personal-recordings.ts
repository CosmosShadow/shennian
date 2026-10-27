// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-recordings.test.ts
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { registerAuthDecorators, requireAuth, requireActivePlan } from '../middleware/auth.js'
import { requireNonReviewMachineAccess } from '../services/review-account-policy.js'
import { primaryMachine } from '../services/personal-workspace/primary-machine.js'
import { ownedMachine } from '../services/local-apps/gateway.js'
import { sendServerReqToMachine } from '../relay/server-requests.js'

const validId = (value: unknown) => typeof value === 'string' && /^[\w-]{1,100}$/.test(value)
const validChunk = (b: Record<string, unknown>) => Number.isInteger(b.index) && Number(b.index) >= 0 && Number(b.index) < 400 && typeof b.base64 === 'string' && b.base64.length <= 180000 && /^[A-Za-z0-9+/]*={0,2}$/.test(b.base64) && Number.isInteger(b.size) && Number(b.size) > 0 && Number(b.size) <= 128000 && typeof b.sha256 === 'string' && /^[a-f0-9]{64}$/.test(b.sha256)
export async function personalRecordingRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  app.addHook('onSend', async (_request, reply) => { reply.header('Cache-Control', 'no-store') })
  const ownerDevice = async (request: { deviceId: string; userId: string }, reply: { code: (n: number) => { send: (v: unknown) => unknown } }) => {
    const device = await prisma.device.findUnique({ where: { id: request.deviceId }, select: { userId: true } })
    if (device?.userId !== request.userId) return reply.code(401).send({ error: 'recording_device_expired' })
  }
  app.post<{ Params: { machineId: string }; Body: Record<string, unknown> }>('/machines/:machineId', {
    bodyLimit: 260000,
    preHandler: [requireAuth, ownerDevice, requireActivePlan, requireNonReviewMachineAccess],
  }, async (request, reply) => {
    const b = request.body
    if (!b || typeof b !== 'object' || Array.isArray(b) || !['chunk', 'commit'].includes(String(b.action)) || !validId(b.sessionKey) || !validId(b.batchKey) || !validId(b.initialMachineId) || b.initialMachineId !== request.params.machineId || !Number.isSafeInteger(b.initialPrimaryRevision) || Number(b.initialPrimaryRevision) < 0 || !(b.confirmedPrimaryRevision === null || Number.isSafeInteger(b.confirmedPrimaryRevision) && Number(b.confirmedPrimaryRevision) >= 0) || (b.action === 'chunk' ? !validChunk(b) : !Array.isArray(b.chunks) || b.chunks.length < 1 || b.chunks.length > 400 || !Array.isArray(b.transcript) || JSON.stringify(b.transcript).length > 200000)) return reply.code(400).send({ error: 'recording_invalid_request' })
    try {
      // The outbox binds the first selected computer and CAS revision. A later
      // setting change requires explicit confirmation, but never retargets audio.
      const primary = await primaryMachine(request.userId)
      const unchanged = primary.machine?.id === b.initialMachineId && primary.revision === b.initialPrimaryRevision
      if (!primary.machine || !unchanged && b.confirmedPrimaryRevision !== primary.revision) return reply.code(409).send({ error: 'recording_target_changed' })
      // Never route through grants or public resources.
      const machine = await ownedMachine(request.userId, request.params.machineId)
      if (!machine.online) return reply.code(503).send({ error: 'recording_machine_offline' })
      const result = await sendServerReqToMachine(machine.id, { type: 'req', method: 'personal.recording', params: { ...b, userId: request.userId } }, 20000)
      if (!result.ok) return reply.code(result.error === 'recording_storage_full' ? 507 : 503).send({ error: /^recording_[a-z_]+$/.test(result.error ?? '') ? result.error : 'recording_client_upgrade_required' })
      if ((result.payload as { persisted?: boolean })?.persisted !== true) return reply.code(503).send({ error: 'recording_ack_invalid' })
      // If the setting changes in flight, retry remains idempotent. Do not
      // acknowledge a stale confirmation as a successful phone sync.
      const after = await primaryMachine(request.userId)
      if (after.machine?.id !== primary.machine.id || after.revision !== primary.revision) return reply.code(409).send({ error: 'recording_target_changed' })
      return result.payload
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      return reply.code(code === 'machine_owner_required' ? 403 : 503).send({ error: code === 'machine_owner_required' ? code : 'recording_unavailable' })
    }
  })
}

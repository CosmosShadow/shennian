import { PLATFORM_TEXT_MODEL } from './platform-model.js'
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-model-gateway.test.ts
import { createHash, randomBytes } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { redis } from '../lib/redis.js'
import { verifyMachineToken } from './jwt.js'
import { requireMachineOrUserAuth } from './agent-proxy.js'
import { prisma } from '../lib/prisma.js'

// Only old preview Clients need an expiresAt field. Keys have no time-based expiry.
export const LEGACY_CREDENTIAL_COMPAT_VALID_UNTIL = Date.UTC(9999, 0, 1)
export const OFFICIAL_PERSONAL_MODEL = PLATFORM_TEXT_MODEL
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const credentialKey = (token: string) => `personal-model:credential:${hash(token)}`
type Grant = { userId: string; machineId: string; machineTokenHash: string }
export async function issueModelCredential(request: FastifyRequest, reply: FastifyReply) {
  if (!request.machineId) return reply.code(403).send({ error: 'machine_owner_required' })
  const rateKey = `personal-model:issue:${request.machineId}:${Math.floor(Date.now() / 60000)}`
  const count = await redis.incr(rateKey)
  if (count === 1) await redis.expire(rateKey, 120)
  if (count > 10) return reply.code(429).header('Retry-After', '60').send({ error: 'model_credential_rate_limit' })
  const source = request.headers.authorization!.slice(7)
  const token = `snm_${randomBytes(32).toString('base64url')}`
  const grant: Grant = { userId: request.userId, machineId: request.machineId, machineTokenHash: hash(source) }
  await redis.set(credentialKey(token), JSON.stringify(grant))
  return reply.send({ token, expiresAt: LEGACY_CREDENTIAL_COMPAT_VALID_UNTIL, model: OFFICIAL_PERSONAL_MODEL })
}
/** New Clients use their paired long-lived key; legacy opaque model keys remain model-only. */
export async function requireModelCredential(request: FastifyRequest, reply: FastifyReply) {
  const token = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
  if (verifyMachineToken(token)) {
    await requireMachineOrUserAuth(request, reply)
    if (reply.sent) return
    const machine = await prisma.machine.findUnique({ where: { id: request.machineId }, select: { userId: true, machineToken: true, paired: true, remoteAccessDisabledAt: true } })
    if (!machine || !machine.paired || machine.userId !== request.userId || machine.machineToken !== token || machine.remoteAccessDisabledAt) return reply.code(401).send({ error: 'model_credential_revoked' })
    return
  }
  if (!/^snm_[\w-]{43}$/.test(token)) return reply.code(401).send({ error: 'model_credential_invalid' })
  const value = await redis.get(credentialKey(token))
  if (!value) return reply.code(401).send({ error: 'model_credential_expired' })
  let grant: Grant
  try {
    grant = JSON.parse(value) as Grant
    if (!grant || typeof grant.userId !== 'string' || typeof grant.machineId !== 'string' || !/^[a-f0-9]{64}$/.test(grant.machineTokenHash)) throw new Error()
  } catch { return reply.code(401).send({ error: 'model_credential_invalid' }) }
  const machine = await prisma.machine.findUnique({ where: { id: grant.machineId }, select: { userId: true, machineToken: true, paired: true, remoteAccessDisabledAt: true } })
  if (!machine || !machine.paired || machine.userId !== grant.userId || machine.remoteAccessDisabledAt || !machine.machineToken || hash(machine.machineToken) !== grant.machineTokenHash) {
    await redis.del(credentialKey(token))
    return reply.code(401).send({ error: 'model_credential_revoked' })
  }
  request.userId = grant.userId
  request.machineId = grant.machineId
}
export async function revokeModelCredential(request: FastifyRequest) {
  const token = request.headers.authorization!.slice(7)
  if (!token.startsWith('snm_')) return { ok: false, error: 'paired_key_requires_machine_revocation' }
  await redis.del(credentialKey(token))
  return { ok: true }
}

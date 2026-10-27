// @arch open-source/docs/server-runtime.md
// @test src/__tests__/grants.test.ts

import crypto from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { registerAuthDecorators, requireActivePlan, requireAuth } from '../middleware/auth.js'
import { publishMachineAccessRevoked } from '../relay/connection-control.js'
import { machineInviteUrl } from '../services/public-web-url.js'
import { requireNonReviewMachineAccess } from '../services/review-account-policy.js'
import { publicUserAvatar } from '../services/user-avatar.js'

const MAX_PENDING_INVITES = 10
const MIN_EXPIRY_MS = 5 * 60_000
const MAX_EXPIRY_MS = 365 * 86_400_000

function activeGrantWhere(now = new Date()) {
  return { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
}

function parseExpiry(value: unknown): Date | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return 'invalid'
  const expiresAt = new Date(value)
  const delta = expiresAt.getTime() - Date.now()
  return Number.isFinite(delta) && delta >= MIN_EXPIRY_MS && delta <= MAX_EXPIRY_MS
    ? expiresAt
    : 'invalid'
}

export async function grantRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)

  app.post<{ Params: { id: string }; Body: { permission?: string; expiresAt?: string } }>(
    '/:id/grants',
    { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] },
    async (request, reply) => {
      if (request.body?.permission && request.body.permission !== 'use') {
        return reply.code(400).send({ error: 'unsupported_machine_permission' })
      }
      const expiresAt = parseExpiry(request.body?.expiresAt)
      if (expiresAt === 'invalid') return reply.code(400).send({ error: 'invalid_grant_expiry' })
      const machine = await prisma.machine.findUnique({
        where: { id: request.params.id }, select: { id: true, userId: true },
      })
      if (!machine || machine.userId !== request.userId) {
        return reply.code(404).send({ error: 'Machine not found' })
      }
      const pending = await prisma.machineGrant.count({
        where: { machineId: machine.id, granteeId: null, ...activeGrantWhere() },
      })
      if (pending >= MAX_PENDING_INVITES) {
        return reply.code(409).send({ error: 'too_many_pending_machine_invites' })
      }
      const token = crypto.randomBytes(32).toString('base64url')
      const grant = await prisma.machineGrant.create({
        data: { machineId: machine.id, granterId: request.userId, permission: 'use', token, expiresAt },
        select: { id: true, expiresAt: true },
      })
      return {
        grantId: grant.id,
        inviteUrl: machineInviteUrl(request, token),
        expiresAt: grant.expiresAt?.toISOString() ?? null,
      }
    },
  )

  app.get<{ Params: { token: string } }>('/grants/:token/preview', async (request, reply) => {
    const grant = await prisma.machineGrant.findUnique({
      where: { token: request.params.token },
      select: {
        granteeId: true, expiresAt: true, revokedAt: true,
        machine: { select: { name: true } },
        granter: { select: { name: true } },
      },
    })
    if (!grant) return reply.code(404).send({ error: 'machine_invite_not_found' })
    if (grant.revokedAt) return reply.code(410).send({ error: 'machine_invite_cancelled' })
    if (grant.expiresAt && grant.expiresAt <= new Date()) {
      return reply.code(410).send({ error: 'machine_invite_expired' })
    }
    if (grant.granteeId) return reply.code(409).send({ error: 'machine_invite_used' })
    return {
      machineName: grant.machine.name,
      ownerName: grant.granter.name,
      expiresAt: grant.expiresAt?.toISOString() ?? null,
    }
  })

  app.post<{ Body: { shareToken: string } }>(
    '/grants/redeem',
    { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] },
    async (request, reply) => {
      const shareToken = request.body?.shareToken?.trim()
      if (!shareToken) return reply.code(400).send({ error: 'share_token_required' })
      try {
        const result = await prisma.$transaction(async (tx) => {
          const grant = await tx.machineGrant.findUnique({
            where: { token: shareToken },
            select: { id: true, machineId: true, granterId: true, granteeId: true, expiresAt: true, revokedAt: true },
          })
          if (!grant) return { error: 'machine_invite_not_found', status: 404 } as const
          if (grant.revokedAt) return { error: 'machine_invite_cancelled', status: 410 } as const
          if (grant.expiresAt && grant.expiresAt <= new Date()) {
            return { error: 'machine_invite_expired', status: 410 } as const
          }
          if (grant.granterId === request.userId) {
            return { error: 'cannot_accept_own_machine_invite', status: 409 } as const
          }
          if (grant.granteeId === request.userId) {
            return { grantId: grant.id, machineId: grant.machineId, alreadyRedeemed: true } as const
          }
          if (grant.granteeId) return { error: 'machine_invite_used', status: 409 } as const
          const existing = await tx.machineGrant.findFirst({
            where: { machineId: grant.machineId, granteeId: request.userId, ...activeGrantWhere() },
            select: { id: true },
          })
          if (existing) {
            return { grantId: existing.id, machineId: grant.machineId, alreadyRedeemed: true } as const
          }
          const claimed = await tx.machineGrant.updateMany({
            where: { id: grant.id, granteeId: null, ...activeGrantWhere() },
            data: { granteeId: request.userId },
          })
          if (claimed.count !== 1) return { error: 'machine_invite_used', status: 409 } as const
          return { grantId: grant.id, machineId: grant.machineId, alreadyRedeemed: false } as const
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
        if ('error' in result) {
          return reply.code(result.status as 404 | 409 | 410).send({ error: result.error })
        }
        return result
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          return reply.code(409).send({ error: 'machine_invite_conflict' })
        }
        throw error
      }
    },
  )

  app.get('/granted', { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] }, async (request) => {
    const grants = await prisma.machineGrant.findMany({
      where: { granteeId: request.userId, ...activeGrantWhere() }, include: { machine: true },
    })
    return { machines: grants.map((grant) => ({
      id: grant.machine.id, name: grant.machine.name, os: grant.machine.os,
      agentList: grant.machine.agentList, online: grant.machine.online, permission: grant.permission,
    })) }
  })

  app.get<{ Params: { id: string } }>(
    '/:id/grants',
    { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] },
    async (request, reply) => {
      const machine = await prisma.machine.findUnique({ where: { id: request.params.id } })
      if (!machine || machine.userId !== request.userId) {
        return reply.code(404).send({ error: 'Machine not found' })
      }
      const grants = await prisma.machineGrant.findMany({
        where: { machineId: machine.id },
        select: {
          id: true, granteeId: true, permission: true, expiresAt: true, revokedAt: true, createdAt: true,
          grantee: { select: { id: true, name: true, avatarVersion: true, avatarUpdatedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      return { grants: grants.map((grant) => ({
        id: grant.id, granteeId: grant.granteeId, granteeName: grant.grantee?.name ?? null,
        granteeAvatar: publicUserAvatar(grant.grantee), permission: grant.permission,
        expiresAt: grant.expiresAt?.toISOString() ?? null,
        revokedAt: grant.revokedAt?.toISOString() ?? null,
        createdAt: grant.createdAt.toISOString(), redeemed: grant.granteeId !== null,
      })) }
    },
  )

  app.delete<{ Params: { id: string; gid: string } }>(
    '/:id/grants/:gid',
    { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] },
    async (request, reply) => {
      const machine = await prisma.machine.findUnique({ where: { id: request.params.id } })
      if (!machine || machine.userId !== request.userId) {
        return reply.code(404).send({ error: 'Machine not found' })
      }
      const grant = await prisma.machineGrant.findUnique({ where: { id: request.params.gid } })
      if (!grant || grant.machineId !== machine.id) {
        return reply.code(404).send({ error: 'Grant not found' })
      }
      if (!grant.revokedAt) {
        await prisma.machineGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } })
        if (grant.granteeId) publishMachineAccessRevoked(machine.id, grant.granteeId)
      }
      return {}
    },
  )
}

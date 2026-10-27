// @arch open-source/docs/server-runtime.md
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/organizations.test.ts

import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { registerAuthDecorators, requireActivePlan, requireAuth } from '../middleware/auth.js'
import { isBillingLive } from '../services/billing-mode.js'
import { EntitlementError, requireEntitlement } from '../services/entitlements.js'
import {
  createOrganizationInviteCode,
  ensureDefaultOrganization,
  isOrganizationRole,
  requireOrganizationAdmin,
} from '../services/organizations.js'
import { refreshTeamSeatsForOwner } from '../services/team-seats.js'
import { requireNonReviewMachineAccess } from '../services/review-account-policy.js'

function sendOrganizationError(
  reply: { code: (statusCode: number) => { send: (payload: { error: string }) => unknown } },
  error: unknown,
) {
  if (error instanceof EntitlementError) {
    return reply.code(403).send({ error: error.message })
  }
  throw error
}

function shapeOrganization(org: {
  id: string
  name: string
  ownerId: string
  inviteCode: string
  createdAt: Date
  updatedAt: Date
  members?: Array<{ id: string; userId: string; role: string }>
}) {
  return {
    id: org.id,
    name: org.name,
    ownerId: org.ownerId,
    inviteCode: org.inviteCode,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
    members: org.members?.map((member) => ({ id: member.id, userId: member.userId, role: member.role })),
  }
}

function shapeMember(member: {
  id: string
  userId: string
  role: string
  seatStatus?: string
  seatSource?: string | null
  seatExpiresAt?: Date | null
  createdAt: Date
  user?: { name: string; phone: string | null; email: string | null }
}) {
  return {
    id: member.id,
    userId: member.userId,
    name: member.user?.name ?? '',
    phone: member.user?.phone ?? null,
    email: member.user?.email ?? null,
    role: member.role,
    seatStatus: member.seatStatus ?? 'active',
    seatSource: member.seatSource ?? null,
    seatExpiresAt: member.seatExpiresAt?.toISOString() ?? null,
    createdAt: member.createdAt.toISOString(),
  }
}

function shapeMachineAssignment(machine: {
  id: string
  name: string
  os: string
  online: boolean
  paired: boolean
  lastSeen: Date
  cliVersion: string | null
  userId: string | null
  user?: { name: string; phone: string | null; email: string | null } | null
  grants?: Array<{
    id: string
    granteeId: string | null
    permission: string
    grantee?: { name: string; phone: string | null; email: string | null } | null
  }>
}, membersByUserId: Map<string, { id: string; userId: string; role: string }>) {
  return {
    id: machine.id,
    name: machine.name,
    os: machine.os,
    online: machine.online,
    paired: machine.paired,
    lastSeen: machine.lastSeen.toISOString(),
    cliVersion: machine.cliVersion,
    ownerId: machine.userId,
    ownerName: machine.user?.name ?? '',
    ownerPhone: machine.user?.phone ?? null,
    ownerEmail: machine.user?.email ?? null,
    assignedMembers: (machine.grants ?? [])
      .filter((grant) => grant.granteeId && membersByUserId.has(grant.granteeId))
      .map((grant) => {
        const member = membersByUserId.get(grant.granteeId ?? '')
        return {
          grantId: grant.id,
          memberId: member?.id ?? null,
          userId: grant.granteeId,
          name: grant.grantee?.name ?? '',
          phone: grant.grantee?.phone ?? null,
          email: grant.grantee?.email ?? null,
          organizationRole: member?.role ?? 'member',
          permission: grant.permission,
        }
      }),
  }
}

export async function organizationRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)

  app.get('/', { preHandler: [requireAuth, requireActivePlan] }, async (request) => {
    const organizations = await prisma.organization.findMany({
      where: { members: { some: { userId: request.userId } } },
      include: { members: true },
      orderBy: { createdAt: 'asc' },
    })
    return { organizations: organizations.map(shapeOrganization) }
  })

  app.post<{ Body: { name?: string } }>('/', { preHandler: [requireAuth, requireActivePlan] }, async (request, reply) => {
    try {
      await requireEntitlement(request.userId, 'machine_sharing')
    } catch (error) {
      return sendOrganizationError(reply, error)
    }
    const name = request.body.name?.trim() || '新组织'
    const organization = await ensureDefaultOrganization(request.userId, name)
    return reply.code(201).send({ organization: shapeOrganization(organization) })
  })

  app.post<{ Params: { id: string }; Body: { expiresAt?: string } }>(
    '/:id/invites',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      const admin = await requireOrganizationAdmin(request.userId, request.params.id)
      if (!admin) return reply.code(403).send({ error: 'Not authorized' })
      const invite = await prisma.organizationInvite.create({
        data: {
          organizationId: request.params.id,
          createdById: request.userId,
          code: createOrganizationInviteCode(),
          expiresAt: request.body.expiresAt ? new Date(request.body.expiresAt) : null,
        },
      })
      return { code: invite.code, inviteId: invite.id }
    },
  )

  app.post<{ Body: { code: string } }>('/invites/redeem', { preHandler: [requireAuth, requireActivePlan] }, async (request, reply) => {
    const code = request.body.code?.trim().toUpperCase()
    if (!code) return reply.code(400).send({ error: 'code is required' })

    const invite = await prisma.organizationInvite.findUnique({
      where: { code },
      include: { organization: true },
    })
    const usableInvite = invite && !invite.revokedAt && (!invite.expiresAt || invite.expiresAt > new Date())
    const organization = usableInvite
      ? invite.organization
      : await prisma.organization.findUnique({ where: { inviteCode: code } })
    if (!organization) return reply.code(400).send({ error: 'Invalid invite code' })

    const member = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: request.userId } },
      create: { organizationId: organization.id, userId: request.userId, role: 'member' },
      update: {},
      include: { user: { select: { name: true, phone: true, email: true } } },
    })
    if (isBillingLive()) {
      await refreshTeamSeatsForOwner({ ownerId: organization.ownerId })
    }

    return { organization: shapeOrganization({ ...organization, members: [] }), member: shapeMember(member) }
  })

  app.get<{ Params: { id: string } }>('/:id/members', { preHandler: [requireAuth, requireActivePlan] }, async (request, reply) => {
    const ownMember = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: request.params.id, userId: request.userId } },
    })
    if (!ownMember) return reply.code(403).send({ error: 'Not authorized' })
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: request.params.id },
      include: { user: { select: { name: true, phone: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return { members: members.map(shapeMember) }
  })

  app.get<{ Params: { id: string } }>(
    '/:id/machines',
    { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] },
    async (request, reply) => {
    const ownMember = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: request.params.id, userId: request.userId } },
    })
    if (!ownMember) return reply.code(403).send({ error: 'Not authorized' })
    const canManage = ownMember.role === 'owner' || ownMember.role === 'admin'

    const members = await prisma.organizationMember.findMany({
      where: { organizationId: request.params.id },
      include: { user: { select: { name: true, phone: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const membersByUserId = new Map(members.map((member) => [member.userId, member]))
    const adminUserIds = members
      .filter((member) => member.role === 'owner' || member.role === 'admin')
      .map((member) => member.userId)

    const [adminMachines, organizationGrants] = await Promise.all([
      canManage && adminUserIds.length > 0
        ? prisma.machine.findMany({
            where: { userId: { in: adminUserIds }, paired: true },
            include: {
              user: { select: { name: true, phone: true, email: true } },
              grants: {
                where: {
                  organizationId: request.params.id,
                  revokedAt: null,
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
                include: { grantee: { select: { name: true, phone: true, email: true } } },
                orderBy: { createdAt: 'asc' },
              },
            },
            orderBy: { lastSeen: 'desc' },
          })
        : Promise.resolve([]),
      prisma.machineGrant.findMany({
        where: {
          organizationId: request.params.id,
          ...(canManage ? {} : { granteeId: request.userId }),
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        include: {
          machine: {
            include: {
              user: { select: { name: true, phone: true, email: true } },
              grants: {
                where: {
                  organizationId: request.params.id,
                  revokedAt: null,
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
                include: { grantee: { select: { name: true, phone: true, email: true } } },
                orderBy: { createdAt: 'asc' },
              },
            },
          },
        },
      }),
    ])

    const machines = new Map<string, (typeof adminMachines)[number]>()
    for (const machine of adminMachines) machines.set(machine.id, machine)
    for (const grant of organizationGrants) machines.set(grant.machine.id, grant.machine)

    return {
      machines: [...machines.values()].map((machine) => shapeMachineAssignment(machine, membersByUserId)),
      members: members.map(shapeMember),
    }
    },
  )

  app.post<{
    Params: { id: string; machineId: string; memberId: string }
    Body: { permission?: string }
  }>(
    '/:id/machines/:machineId/members/:memberId',
    { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] },
    async (_request, reply) => {
      return reply.code(410).send({ error: 'machine_sharing_retired' })
      /* Historical implementation intentionally retained in git history.
      const admin = await requireOrganizationAdmin(request.userId, request.params.id)
      if (!admin) return reply.code(403).send({ error: 'Not authorized' })
      const member = await prisma.organizationMember.findFirst({
        where: { id: request.params.memberId, organizationId: request.params.id },
      })
      if (!member) return reply.code(404).send({ error: 'Member not found' })
      const permission = request.body.permission ?? 'use'
      if (!['view', 'use', 'full', 'admin'].includes(permission)) {
        return reply.code(400).send({ error: 'Invalid permission' })
      }
      const machine = await prisma.machine.findUnique({ where: { id: request.params.machineId } })
      if (!machine || !machine.paired) return reply.code(404).send({ error: 'Machine not found' })
      if (machine.userId !== request.userId) return reply.code(403).send({ error: 'Not authorized' })
      const affected = await prisma.machineGrant.findMany({
        where: {
          machineId: machine.id,
          organizationId: request.params.id,
          granteeId: member.userId,
          revokedAt: null,
        },
        select: { granteeId: true },
      })

      const existing = await prisma.machineGrant.findFirst({
        where: {
          machineId: machine.id,
          organizationId: request.params.id,
          granteeId: member.userId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      })
      for (const grant of affected) {
        if (grant.granteeId) publishMachineAccessRevoked(machine.id, grant.granteeId)
      }
      const grant = existing
        ? await prisma.machineGrant.update({
            where: { id: existing.id },
            data: { permission },
          })
        : await prisma.machineGrant.create({
            data: {
              machineId: machine.id,
              organizationId: request.params.id,
              granterId: request.userId,
              granteeId: member.userId,
              permission,
              token: crypto.randomBytes(24).toString('base64url'),
            },
          })
      return { grantId: grant.id, ok: true }
      */
    },
  )

  app.delete<{ Params: { id: string; machineId: string; memberId: string } }>(
    '/:id/machines/:machineId/members/:memberId',
    { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] },
    async (request, reply) => {
      const admin = await requireOrganizationAdmin(request.userId, request.params.id)
      if (!admin) return reply.code(403).send({ error: 'Not authorized' })
      const member = await prisma.organizationMember.findFirst({
        where: { id: request.params.memberId, organizationId: request.params.id },
      })
      if (!member) return reply.code(404).send({ error: 'Member not found' })
      const machine = await prisma.machine.findUnique({ where: { id: request.params.machineId } })
      if (!machine) return reply.code(404).send({ error: 'Machine not found' })
      if (machine.userId !== request.userId) {
        const adminGrant = await prisma.machineGrant.findFirst({
          where: {
            machineId: machine.id,
            granteeId: request.userId,
            permission: 'admin',
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        })
        if (!adminGrant) return reply.code(403).send({ error: 'Not authorized' })
      }
      await prisma.machineGrant.updateMany({
        where: {
          machineId: machine.id,
          organizationId: request.params.id,
          granteeId: member.userId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      })
      return { ok: true }
    },
  )

  app.patch<{ Params: { id: string; memberId: string }; Body: { role: string } }>(
    '/:id/members/:memberId',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      const admin = await requireOrganizationAdmin(request.userId, request.params.id)
      if (!admin) return reply.code(403).send({ error: 'Not authorized' })
      if (!isOrganizationRole(request.body.role)) return reply.code(400).send({ error: 'Invalid role' })
      const existing = await prisma.organizationMember.findFirst({
        where: { id: request.params.memberId, organizationId: request.params.id },
      })
      if (!existing) return reply.code(404).send({ error: 'Member not found' })
      if (existing.role === 'owner' && existing.userId !== request.userId) {
        return reply.code(400).send({ error: 'Owner role cannot be changed by another member' })
      }
      const member = await prisma.organizationMember.update({
        where: { id: existing.id },
        data: { role: request.body.role },
        include: { user: { select: { name: true, phone: true, email: true } } },
      })
      return { member: shapeMember(member) }
    },
  )

  app.delete<{ Params: { id: string; memberId: string } }>(
    '/:id/members/:memberId',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      const admin = await requireOrganizationAdmin(request.userId, request.params.id)
      if (!admin) return reply.code(403).send({ error: 'Not authorized' })
      const existing = await prisma.organizationMember.findFirst({
        where: { id: request.params.memberId, organizationId: request.params.id },
      })
      if (!existing) return reply.code(404).send({ error: 'Member not found' })
      if (existing.role === 'owner') return reply.code(400).send({ error: 'Owner cannot be removed' })
      await prisma.$transaction(async (tx) => {
        await tx.machineGrant.updateMany({
          where: {
            organizationId: request.params.id,
            granteeId: existing.userId,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        })
        await tx.organizationMember.delete({ where: { id: existing.id } })
      })
      return { ok: true }
    },
  )
}

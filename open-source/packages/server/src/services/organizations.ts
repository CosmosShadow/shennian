// @arch open-source/docs/server-runtime.md
// @test src/__tests__/organizations.test.ts

import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'

export const VALID_ORGANIZATION_MEMBER_ROLES = ['owner', 'admin', 'member'] as const
export type OrganizationMemberRole = (typeof VALID_ORGANIZATION_MEMBER_ROLES)[number]

export function createOrganizationInviteCode(): string {
  return crypto.randomBytes(8).toString('base64url').toUpperCase()
}

export function isOrganizationRole(value: unknown): value is OrganizationMemberRole {
  return typeof value === 'string' && (VALID_ORGANIZATION_MEMBER_ROLES as readonly string[]).includes(value)
}

export async function ensureDefaultOrganization(userId: string, fallbackName = '个人组织') {
  const existing = await prisma.organization.findFirst({
    where: { members: { some: { userId } } },
    orderBy: { createdAt: 'asc' },
    include: { members: true },
  })
  if (existing) return existing

  return prisma.organization.create({
    data: {
      name: fallbackName,
      ownerId: userId,
      inviteCode: createOrganizationInviteCode(),
      members: {
        create: { userId, role: 'owner' },
      },
    },
    include: { members: true },
  })
}

export async function requireOrganizationAdmin(userId: string, organizationId: string) {
  const member = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { organization: true },
  })
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) return null
  return member
}


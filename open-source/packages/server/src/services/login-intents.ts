// @arch open-source/docs/server-runtime.md
// @test src/__tests__/login-intents.test.ts src/__tests__/login-intent-routes.test.ts

import crypto from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { connections } from '../relay/connections.js'
import { personalAccountNamespaceId } from './personal-account-namespace.js'
import { signMachineToken } from './jwt.js'
import { isReviewAccountUserId, REVIEW_ACCOUNT_MACHINE_ACCESS_ERROR } from './review-account-policy.js'

const LOGIN_INTENT_TTL_MS = 40 * 60 * 1000
const SHA256_HEX = /^[a-f0-9]{64}$/
const ACTION_TYPE = /^[a-z][a-z0-9_.-]{0,63}$/
const SAFE_RETURN_TO = /^\/spaces(?:\/[A-Za-z0-9_-]+)?$/
const MAX_AGENT_COUNT = 32

export class LoginIntentError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'LoginIntentError'
  }
}

function normalizeBoundedText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new LoginIntentError(`invalid_${field}`, 400, `${field} must be a string.`)
  }
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized || normalized.length > maxLength) {
    throw new LoginIntentError(
      `invalid_${field}`,
      400,
      `${field} must be between 1 and ${maxLength} characters.`,
    )
  }
  return normalized
}

function normalizeHash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) {
    throw new LoginIntentError(`invalid_${field}`, 400, `${field} must be a lowercase SHA-256 hash.`)
  }
  return value
}

export function normalizeLoginIntentReturnTo(value: unknown): string {
  if (value == null || value === '') return '/spaces'
  if (typeof value !== 'string' || !SAFE_RETURN_TO.test(value)) {
    throw new LoginIntentError(
      'invalid_return_to',
      400,
      'returnTo must be an allowed Shennian spaces route.',
    )
  }
  return value
}

function normalizeAgentList(value: unknown): string[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > MAX_AGENT_COUNT) {
    throw new LoginIntentError('invalid_agent_list', 400, `agentList must contain at most ${MAX_AGENT_COUNT} items.`)
  }
  return value.map((item) => normalizeBoundedText(item, 'agent', 64))
}

export function hashDeviceSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex')
}

function secretMatches(actualSecret: unknown, expectedHash: string): boolean {
  if (typeof actualSecret !== 'string' || actualSecret.length < 32 || actualSecret.length > 256) return false
  const actual = Buffer.from(hashDeviceSecret(actualSecret), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function publicMetadata(intent: {
  id: string
  machineName: string
  machineOs: string
  agentList: unknown
  actionType: string
  actionSummary: string
  actionPayloadHash: string
  returnTo: string
  expiresAt: Date
  createdAt: Date
}) {
  return {
    id: intent.id,
    machineName: intent.machineName,
    machineOs: intent.machineOs,
    agentList: intent.agentList,
    actionType: intent.actionType,
    actionSummary: intent.actionSummary,
    actionPayloadHash: intent.actionPayloadHash,
    returnTo: intent.returnTo,
    expiresAt: intent.expiresAt,
    createdAt: intent.createdAt,
  }
}

export async function createLoginIntent(input: {
  deviceSecretHash?: unknown
  daemonInstallationId?: unknown
  machineName?: unknown
  machineOs?: unknown
  agentList?: unknown
  actionType?: unknown
  actionSummary?: unknown
  actionPayloadHash?: unknown
  returnTo?: unknown
}) {
  const deviceSecretHash = normalizeHash(input.deviceSecretHash, 'device_secret_hash')
  const actionPayloadHash = normalizeHash(input.actionPayloadHash, 'action_payload_hash')
  const actionType = normalizeBoundedText(input.actionType, 'action_type', 64)
  if (!ACTION_TYPE.test(actionType)) {
    throw new LoginIntentError('invalid_action_type', 400, 'actionType has an invalid format.')
  }

  try {
    return await prisma.loginIntent.create({
      data: {
        deviceSecretHash,
        daemonInstallationId: input.daemonInstallationId == null
          ? null
          : normalizeBoundedText(input.daemonInstallationId, 'daemon_installation_id', 191),
        machineName: normalizeBoundedText(input.machineName, 'machine_name', 120),
        machineOs: normalizeBoundedText(input.machineOs, 'machine_os', 64),
        agentList: normalizeAgentList(input.agentList),
        actionType,
        actionSummary: normalizeBoundedText(input.actionSummary, 'action_summary', 255),
        actionPayloadHash,
        returnTo: normalizeLoginIntentReturnTo(input.returnTo),
        expiresAt: new Date(Date.now() + LOGIN_INTENT_TTL_MS),
      },
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new LoginIntentError('device_secret_reused', 409, 'Create a new device authorization request.')
    }
    throw error
  }
}

export async function getPublicLoginIntent(id: string) {
  const intent = await prisma.loginIntent.findUnique({ where: { id } })
  if (!intent) throw new LoginIntentError('login_intent_not_found', 404, 'Authorization request not found.')
  return {
    ...publicMetadata(intent),
    expired: intent.expiresAt <= new Date(),
  }
}

export async function getLoginIntentApproval(id: string, userId: string) {
  const intent = await prisma.loginIntent.findUnique({ where: { id } })
  if (!intent) throw new LoginIntentError('login_intent_not_found', 404, 'Authorization request not found.')
  const expired = intent.expiresAt <= new Date()
  return {
    ...publicMetadata(intent),
    status: expired && intent.status === 'waiting_user' ? 'expired' : intent.status,
    canApprove: !expired && intent.status === 'waiting_user',
    approvedByCurrentUser: intent.approvedUserId === userId,
  }
}

export async function approveLoginIntent(id: string, userId: string) {
  if (await isReviewAccountUserId(userId)) {
    throw new LoginIntentError(
      REVIEW_ACCOUNT_MACHINE_ACCESS_ERROR,
      403,
      'Review accounts cannot authorize machines.',
    )
  }
  const now = new Date()
  const updated = await prisma.loginIntent.updateMany({
    where: { id, status: 'waiting_user', expiresAt: { gt: now } },
    data: { status: 'approved', approvedUserId: userId, approvedAt: now },
  })
  if (updated.count === 1) return getLoginIntentApproval(id, userId)

  const existing = await prisma.loginIntent.findUnique({ where: { id } })
  if (!existing) throw new LoginIntentError('login_intent_not_found', 404, 'Authorization request not found.')
  if (existing.expiresAt <= now) {
    await prisma.loginIntent.updateMany({
      where: { id, status: 'waiting_user' },
      data: { status: 'expired' },
    })
    throw new LoginIntentError('login_intent_expired', 410, 'Authorization request expired.')
  }
  if (existing.status === 'approved' && existing.approvedUserId === userId) {
    return getLoginIntentApproval(id, userId)
  }
  throw new LoginIntentError('login_intent_unavailable', 409, 'Authorization request is no longer available.')
}

export async function denyLoginIntent(id: string, userId: string) {
  const now = new Date()
  const updated = await prisma.loginIntent.updateMany({
    where: { id, status: 'waiting_user', expiresAt: { gt: now } },
    data: { status: 'denied', deniedAt: now },
  })
  if (updated.count === 1) return getLoginIntentApproval(id, userId)

  const existing = await prisma.loginIntent.findUnique({ where: { id } })
  if (!existing) throw new LoginIntentError('login_intent_not_found', 404, 'Authorization request not found.')
  if (existing.expiresAt <= now) {
    await prisma.loginIntent.updateMany({
      where: { id, status: 'waiting_user' },
      data: { status: 'expired' },
    })
    throw new LoginIntentError('login_intent_expired', 410, 'Authorization request expired.')
  }
  if (existing.status === 'denied') return getLoginIntentApproval(id, userId)
  throw new LoginIntentError('login_intent_unavailable', 409, 'Authorization request is no longer available.')
}

export async function getPrivateLoginIntentStatus(id: string, deviceSecret: unknown) {
  const intent = await prisma.loginIntent.findUnique({ where: { id } })
  if (!intent || !secretMatches(deviceSecret, intent.deviceSecretHash)) {
    throw new LoginIntentError('invalid_device_authorization', 401, 'Invalid device authorization.')
  }
  const expired = intent.expiresAt <= new Date()
  if (expired && intent.status === 'waiting_user') {
    await prisma.loginIntent.updateMany({
      where: { id, status: 'waiting_user' },
      data: { status: 'expired' },
    })
  }
  return {
    status: expired && intent.status === 'waiting_user' ? 'expired' : intent.status,
    actionPayloadHash: intent.actionPayloadHash,
    expiresAt: intent.expiresAt,
  }
}

export async function cancelLoginIntent(id: string, deviceSecret: unknown) {
  const intent = await prisma.loginIntent.findUnique({ where: { id } })
  if (!intent || !secretMatches(deviceSecret, intent.deviceSecretHash)) {
    throw new LoginIntentError('invalid_device_authorization', 401, 'Invalid device authorization.')
  }
  const result = await prisma.loginIntent.updateMany({
    where: { id, status: { in: ['waiting_user', 'approved'] } },
    data: { status: 'denied', deniedAt: new Date() },
  })
  return { status: result.count === 1 ? 'denied' : intent.status }
}

export async function claimLoginIntent(id: string, deviceSecret: unknown) {
  const result = await prisma.$transaction(
    async (tx) => {
      const intent = await tx.loginIntent.findUnique({ where: { id } })
      if (!intent || !secretMatches(deviceSecret, intent.deviceSecretHash)) {
        throw new LoginIntentError('invalid_device_authorization', 401, 'Invalid device authorization.')
      }
      if (intent.status === 'claimed') {
        return { status: 'claimed' as const, actionPayloadHash: intent.actionPayloadHash }
      }
      if (intent.expiresAt <= new Date()) {
        await tx.loginIntent.updateMany({
          where: { id, status: { in: ['waiting_user', 'approved'] } },
          data: { status: 'expired' },
        })
        throw new LoginIntentError('login_intent_expired', 410, 'Authorization request expired.')
      }
      if (intent.status !== 'approved' || !intent.approvedUserId) {
        throw new LoginIntentError('login_intent_not_approved', 409, 'Authorization request is not approved.')
      }
      if (await isReviewAccountUserId(intent.approvedUserId)) {
        throw new LoginIntentError(
          REVIEW_ACCOUNT_MACHINE_ACCESS_ERROR,
          403,
          'Review accounts cannot authorize machines.',
        )
      }

      const locked = await tx.loginIntent.updateMany({
        where: { id, status: 'approved', machineId: null },
        data: { status: 'claiming' },
      })
      if (locked.count !== 1) {
        return { status: 'claimed' as const, actionPayloadHash: intent.actionPayloadHash }
      }

      const existing = intent.daemonInstallationId
        ? await tx.machine.findUnique({ where: { daemonInstallationId: intent.daemonInstallationId } })
        : null
      const ownershipTransferred = Boolean(
        existing?.userId && existing.userId !== intent.approvedUserId,
      )
      const machine = existing
        ? await tx.machine.update({
            where: { id: existing.id },
            data: {
              userId: intent.approvedUserId,
              name: intent.machineName,
              os: intent.machineOs,
              agentList: intent.agentList ?? [],
              paired: true,
              pairToken: null,
            },
          })
        : await tx.machine.create({
            data: {
              userId: intent.approvedUserId,
              name: intent.machineName,
              os: intent.machineOs,
              agentList: intent.agentList ?? [],
              daemonInstallationId: intent.daemonInstallationId,
              paired: true,
            },
          })
      const machineToken = signMachineToken(machine.id)
      await tx.machine.update({ where: { id: machine.id }, data: { machineToken } })
      await tx.loginIntent.updateMany({
        where: { machineId: machine.id },
        data: { machineId: null },
      })
      if (ownershipTransferred) {
        await tx.machineGrant.deleteMany({ where: { machineId: machine.id } })
        await tx.nianSession.deleteMany({
          where: {
            machineId: machine.id,
            roomBinding: { is: null },
            roomNativeSources: { none: {} },
          },
        })
      }
      await tx.loginIntent.update({
        where: { id },
        data: { status: 'claimed', machineId: machine.id, claimedAt: new Date() },
      })
      return {
        status: 'claimed' as const,
        machineToken,
        machineId: machine.id,
        accountNamespaceId: personalAccountNamespaceId(intent.approvedUserId),
        actionPayloadHash: intent.actionPayloadHash,
        ownershipTransferred,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
  if ('ownershipTransferred' in result && result.ownershipTransferred) {
    connections.getMachine(result.machineId)?.close(4403, 'ownership_transferred')
    for (const client of connections.getClients(result.machineId) ?? []) {
      client.close(4403, 'ownership_transferred')
    }
    connections.removeMachine(result.machineId)
    await redis.del(`machine:${result.machineId}:region`)
  }
  if (!('machineToken' in result)) return result
  const { ownershipTransferred: _ownershipTransferred, ...publicResult } = result
  return publicResult
}

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

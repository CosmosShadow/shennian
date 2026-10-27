// @arch open-source/docs/server-runtime.md
// @test src/__tests__/project-fs-authority.test.ts

import crypto from 'node:crypto'
import {
  PROJECT_FS_AUTHORITY_PARAM,
  PROJECT_FS_OPAQUE_CAPABILITY,
  parseProjectFsCloseParams,
  parseProjectFsListParams,
  parseProjectFsOpenParams,
  parseProjectFsReadParams,
  projectFsAuthoritySigningPayload,
  type ProjectFsAuthority,
  type ProjectFsMethod,
  type ProjectFsRejection,
  type ProjectFsTrustedEnvelope,
  type ReqFrame,
} from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import { historicalPermissionAllowsUse } from './machine-access.js'

const AUTHORITY_TTL_MS = 10 * 60_000

type ProjectRecord = {
  id: string
  machineId: string
  workDir: string
  createdAt: Date
  updatedAt: Date
}

export class ProjectFsAuthorizationError extends Error {
  constructor(readonly rejection: ProjectFsRejection) {
    super(rejection.code)
    this.name = 'ProjectFsAuthorizationError'
  }
}

export function mintProjectFsReference(
  userId: string,
  project: Pick<ProjectRecord, 'id' | 'machineId' | 'createdAt'>,
): string {
  return keyedDigest('reference', [userId, project.machineId, project.id, project.createdAt.toISOString()])
}

export async function createAuthorizedProjectFsFrame(input: {
  userId: string
  machineId: string
  frame: Extract<ReqFrame, { type: 'req' }>
  now?: Date
}): Promise<Extract<ReqFrame, { type: 'req' }>> {
  const method = input.frame.method as ProjectFsMethod
  const params = method === 'project.fs.open'
    ? parseProjectFsOpenParams(input.frame.params)
    : method === 'project.fs.list'
      ? parseProjectFsListParams(input.frame.params)
      : method === 'project.fs.read'
        ? parseProjectFsReadParams(input.frame.params)
        : method === 'project.fs.close'
          ? parseProjectFsCloseParams(input.frame.params)
          : null
  if (!params) throw denied('permission_denied', false, 'none')

  const now = input.now ?? new Date()
  const machine = await prisma.machine.findUnique({
    where: { id: input.machineId },
    select: {
      id: true,
      userId: true,
      online: true,
      paired: true,
      machineToken: true,
      remoteAccessDisabledAt: true,
      sessionSyncCapabilities: true,
      daemonInstallationId: true,
    },
  })
  if (!machine || !machine.paired || machine.remoteAccessDisabledAt) {
    throw denied('permission_denied', false, 'reauthenticate')
  }
  if (!machine.online || !machine.daemonInstallationId || !machine.machineToken) {
    throw denied('machine_offline', true, 'retry')
  }
  const capabilities = Array.isArray(machine.sessionSyncCapabilities)
    ? machine.sessionSyncCapabilities as string[]
    : []
  if (!capabilities.includes(PROJECT_FS_OPAQUE_CAPABILITY)) {
    throw denied('capability_required', false, 'upgrade_daemon')
  }

  const grant = machine.userId === input.userId
    ? null
    : await prisma.machineGrant.findFirst({
        where: {
          machineId: input.machineId,
          granteeId: input.userId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true, permission: true, expiresAt: true, createdAt: true },
      })
  const owner = machine.userId === input.userId
  if (!owner && (!grant || !historicalPermissionAllowsUse(grant.permission))) {
    throw denied('permission_denied', false, 'reauthenticate')
  }

  const projects = await prisma.sessionProject.findMany({
    where: { machineId: input.machineId },
    select: { id: true, machineId: true, workDir: true, createdAt: true, updatedAt: true },
  })
  const project = projects.find((candidate) => safeTokenEqual(
    mintProjectFsReference(input.userId, candidate),
    params.projectRef,
  ))
  if (!project) throw denied('project_not_found', false, 'refresh_project')

  const accessIdentity = owner
    ? `owner:${input.userId}`
    : `grant:${grant!.id}:${grant!.createdAt.toISOString()}:${grant!.permission}:${grant!.expiresAt?.toISOString() ?? ''}`
  const rootDigest = keyedDigest('root', [project.machineId, project.workDir])
  const authorizationEpoch = numericDigest([accessIdentity, project.createdAt.toISOString()])
  const generation = keyedDigest('generation', [
    accessIdentity,
    project.id,
    rootDigest,
    project.updatedAt.toISOString(),
    machine.daemonInstallationId,
  ])
  const expiresAt = Math.min(
    now.getTime() + AUTHORITY_TTL_MS,
    grant?.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER,
  )
  const authority: ProjectFsAuthority = {
    projectRef: params.projectRef,
    scopeId: keyedDigest('scope', [input.userId, input.machineId, project.id]),
    accountScope: keyedDigest('account', [input.userId]),
    machineId: input.machineId,
    projectId: project.id,
    rootPath: project.workDir,
    rootDigest,
    authorizationEpoch,
    daemonInstallationId: machine.daemonInstallationId,
    generation,
    expiresAt,
  }
  const unsigned: Omit<ProjectFsTrustedEnvelope, 'signature'> = {
    version: 1,
    requestId: input.frame.id,
    method,
    params,
    authority,
  }
  const envelope: ProjectFsTrustedEnvelope = {
    ...unsigned,
    signature: crypto.createHmac('sha256', machine.machineToken)
      .update(projectFsAuthoritySigningPayload(unsigned))
      .digest('base64url'),
  }
  return {
    type: 'req',
    id: input.frame.id,
    method,
    params: { [PROJECT_FS_AUTHORITY_PARAM]: envelope },
    ...(input.frame.traceId ? { traceId: input.frame.traceId } : {}),
  }
}

function secret(): string {
  return process.env.PROJECT_FS_REF_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret-change-me'
}

function keyedDigest(domain: string, values: string[]): string {
  return crypto.createHmac('sha256', secret()).update([domain, ...values].join('\0')).digest('base64url')
}

function numericDigest(values: string[]): number {
  const hex = crypto.createHmac('sha256', secret()).update(values.join('\0')).digest('hex').slice(0, 13)
  return Number.parseInt(hex, 16)
}

function safeTokenEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes)
}

function denied(
  code: ProjectFsRejection['code'],
  retryable: boolean,
  requiredAction: ProjectFsRejection['requiredAction'],
): ProjectFsAuthorizationError {
  return new ProjectFsAuthorizationError({ code, retryable, requiredAction })
}

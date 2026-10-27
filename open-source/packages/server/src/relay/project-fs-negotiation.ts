// @arch open-source/docs/server-runtime.md
// @test src/__tests__/project-fs-negotiation.test.ts

import crypto from 'node:crypto'
import {
  parseProjectFsNegotiationResponse,
  projectFsNegotiationProofPayload,
  PROJECT_FS_NEGOTIATION_METHOD,
  PROJECT_FS_OPAQUE_CAPABILITY,
  PROJECT_FS_SENSITIVE_AUTHORITY_VERSION,
  type ReqFrame,
  type ResFrame,
  type SessionSyncCapability,
} from '@shennian/wire'

export type ProjectFsNegotiation = {
  request: ReqFrame
  machineId: string
  daemonInstallationId: string
}

/** Client-originated requests matching this method must be rejected, never relayed. */
export function isProjectFsNegotiationRequest(frame: ReqFrame): boolean {
  return frame.method === PROJECT_FS_NEGOTIATION_METHOD
}

export function isProjectFsSensitiveAuthorityConfigured(): boolean {
  return Boolean(process.env.PROJECT_FS_REF_SECRET?.trim() || process.env.JWT_SECRET?.trim())
}

export function withoutProjectFsCapability(
  capabilities: readonly string[],
): SessionSyncCapability[] {
  return capabilities.filter(
    (capability) => capability !== PROJECT_FS_OPAQUE_CAPABILITY,
  ) as SessionSyncCapability[]
}

export function createProjectFsNegotiation(input: {
  machineId: string
  daemonInstallationId: string
}): ProjectFsNegotiation {
  return {
    machineId: input.machineId,
    daemonInstallationId: input.daemonInstallationId,
    request: {
      type: 'req',
      id: `project-fs-negotiate-${crypto.randomBytes(24).toString('base64url')}`,
      method: PROJECT_FS_NEGOTIATION_METHOD,
      params: {
        version: PROJECT_FS_SENSITIVE_AUTHORITY_VERSION,
        nonce: crypto.randomBytes(32).toString('base64url'),
        daemonInstallationId: input.daemonInstallationId,
      },
    },
  }
}

export function verifyProjectFsNegotiation(input: {
  negotiation: ProjectFsNegotiation
  response: ResFrame
  machineId: string
  daemonInstallationId: string
  machineToken: string
}): boolean {
  const { negotiation, response } = input
  if (
    input.machineId !== negotiation.machineId ||
    input.daemonInstallationId !== negotiation.daemonInstallationId ||
    response.id !== negotiation.request.id ||
    !response.ok
  )
    return false
  const challenge = negotiation.request.params
  const parsed = parseProjectFsNegotiationResponse(response.payload)
  if (
    !parsed ||
    parsed.nonce !== challenge.nonce ||
    parsed.daemonInstallationId !== negotiation.daemonInstallationId
  )
    return false
  const expected = crypto
    .createHmac('sha256', input.machineToken)
    .update(
      projectFsNegotiationProofPayload(negotiation.request.id, {
        version: PROJECT_FS_SENSITIVE_AUTHORITY_VERSION,
        nonce: parsed.nonce,
        daemonInstallationId: parsed.daemonInstallationId,
      }),
    )
    .digest()
  let proof: Buffer
  try {
    proof = Buffer.from(parsed.proof, 'base64url')
  } catch {
    return false
  }
  return proof.length === expected.length && crypto.timingSafeEqual(proof, expected)
}

export function withNegotiatedProjectFsCapability(
  capabilities: readonly string[],
): SessionSyncCapability[] {
  return [...withoutProjectFsCapability(capabilities), PROJECT_FS_OPAQUE_CAPABILITY]
}

// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/project-fs-handler.test.ts

import crypto from 'node:crypto'
import {
  PROJECT_FS_AUTHORITY_PARAM,
  isProjectFsMethod,
  parseProjectFsCloseParams,
  parseProjectFsListParams,
  parseProjectFsOpenParams,
  parseProjectFsReadParams,
  parseProjectFsTrustedEnvelope,
  projectFsAuthoritySigningPayload,
  type ProjectFsRejection,
  type ReqFrame,
} from '@shennian/wire'
import type { CliRelayClient } from '../../relay/client.js'
import {
  ProjectFsHandleStore,
  ProjectFsStoreError,
  type TrustedProjectFsAuthority,
} from '../project-fs-store.js'

/** Only a future Server-verifying relay adapter may implement this resolver. */
export type TrustedProjectFsRequestResolver = (
  req: ReqFrame,
) => { authority: TrustedProjectFsAuthority; params: unknown } | null

/** Verifies that the authority was signed by Server with this machine's credential. */
export function createTrustedProjectFsRequestResolver(
  machineToken: string,
  now: () => number = Date.now,
): TrustedProjectFsRequestResolver {
  return (req) => {
    const envelope = parseProjectFsTrustedEnvelope(req.params[PROJECT_FS_AUTHORITY_PARAM])
    if (
      !envelope || envelope.requestId !== req.id || envelope.method !== req.method ||
      envelope.authority.expiresAt <= now()
    ) return null
    const expected = crypto.createHmac('sha256', machineToken)
      .update(projectFsAuthoritySigningPayload(envelope))
      .digest()
    let supplied: Buffer
    try { supplied = Buffer.from(envelope.signature, 'base64url') } catch { return null }
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null
    return { authority: envelope.authority, params: envelope.params }
  }
}

export async function handleProjectFsRequest(
  client: CliRelayClient,
  store: ProjectFsHandleStore,
  req: ReqFrame,
  resolveTrustedRequest: TrustedProjectFsRequestResolver | null,
): Promise<void> {
  const trusted = resolveTrustedRequest?.(req) ?? null
  if (!trusted || !isProjectFsMethod(req.method)) {
    sendRejected(client, req.id, {
      code: 'permission_denied',
      retryable: false,
      requiredAction: 'reauthenticate',
    })
    return
  }
  try {
    let payload: unknown
    switch (req.method) {
      case 'project.fs.open': {
        const params = parseProjectFsOpenParams(trusted.params)
        if (!params) throw invalidRequest()
        payload = await store.open(trusted.authority, params)
        break
      }
      case 'project.fs.list': {
        const params = parseProjectFsListParams(trusted.params)
        if (!params) throw invalidRequest()
        payload = await store.list(trusted.authority, params)
        break
      }
      case 'project.fs.read': {
        const params = parseProjectFsReadParams(trusted.params)
        if (!params) throw invalidRequest()
        payload = await store.read(trusted.authority, params)
        break
      }
      case 'project.fs.close': {
        const params = parseProjectFsCloseParams(trusted.params)
        if (!params) throw invalidRequest()
        store.close(trusted.authority, params.projectRef, params.leaseId)
        payload = { closed: true }
        break
      }
    }
    client.sendRes({ type: 'res', id: req.id, ok: true, payload })
  } catch (error) {
    const rejection: ProjectFsRejection = error instanceof ProjectFsStoreError
      ? { code: error.code, retryable: error.retryable, requiredAction: error.requiredAction }
      : { code: 'io_error', retryable: true, requiredAction: 'retry' }
    sendRejected(client, req.id, rejection)
  }
}

function invalidRequest(): ProjectFsStoreError {
  return new ProjectFsStoreError('handle_invalid', false, 'none')
}

function sendRejected(client: CliRelayClient, id: string, rejection: ProjectFsRejection): void {
  client.sendRes({ type: 'res', id, ok: false, error: rejection.code, payload: { rejection } })
}

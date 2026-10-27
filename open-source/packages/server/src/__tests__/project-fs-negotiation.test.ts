// @covers src/relay/project-fs-negotiation.ts

import crypto from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { PROJECT_FS_OPAQUE_CAPABILITY, projectFsNegotiationProofPayload } from '@shennian/wire'
import {
  createProjectFsNegotiation,
  isProjectFsNegotiationRequest,
  isProjectFsSensitiveAuthorityConfigured,
  verifyProjectFsNegotiation,
  withNegotiatedProjectFsCapability,
  withoutProjectFsCapability,
} from '../relay/project-fs-negotiation.js'

const originalProjectSecret = process.env.PROJECT_FS_REF_SECRET
const originalJwtSecret = process.env.JWT_SECRET

afterEach(() => {
  if (originalProjectSecret === undefined) delete process.env.PROJECT_FS_REF_SECRET
  else process.env.PROJECT_FS_REF_SECRET = originalProjectSecret
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = originalJwtSecret
})

describe('Project FS per-connection capability negotiation', () => {
  it('offers the sensitive signal only with configured signing authority', () => {
    delete process.env.PROJECT_FS_REF_SECRET
    delete process.env.JWT_SECRET
    expect(isProjectFsSensitiveAuthorityConfigured()).toBe(false)
    process.env.PROJECT_FS_REF_SECRET = 'configured-for-test'
    expect(isProjectFsSensitiveAuthorityConfigured()).toBe(true)
  })

  it('keeps initial and old-daemon capability projections disabled', () => {
    expect(withoutProjectFsCapability(['session_index_v1', PROJECT_FS_OPAQUE_CAPABILITY])).toEqual([
      'session_index_v1',
    ])
    expect(withoutProjectFsCapability(['session_index_v1'])).toEqual(['session_index_v1'])
  })

  it('classifies a forged client negotiation signal as Server-only traffic', () => {
    expect(
      isProjectFsNegotiationRequest({
        type: 'req',
        id: 'forged',
        method: 'project.fs.negotiate',
        params: {},
      }),
    ).toBe(true)
    expect(
      isProjectFsNegotiationRequest({
        type: 'req',
        id: 'browse',
        method: 'project.fs.open',
        params: {},
      }),
    ).toBe(false)
  })

  it('activates new-new only after proof of the current machine identity', () => {
    const negotiation = createProjectFsNegotiation({
      machineId: 'machine-1',
      daemonInstallationId: 'install-1',
    })
    const challenge = negotiation.request.params as {
      version: 1
      nonce: string
      daemonInstallationId: string
    }
    const proof = crypto
      .createHmac('sha256', 'machine-secret')
      .update(projectFsNegotiationProofPayload(negotiation.request.id, challenge))
      .digest('base64url')
    const response = {
      type: 'res' as const,
      id: negotiation.request.id,
      ok: true,
      payload: { ...challenge, capability: PROJECT_FS_OPAQUE_CAPABILITY, proof },
    }
    expect(
      verifyProjectFsNegotiation({
        negotiation,
        response,
        machineId: 'machine-1',
        daemonInstallationId: 'install-1',
        machineToken: 'machine-secret',
      }),
    ).toBe(true)
    expect(withNegotiatedProjectFsCapability(['session_index_v1'])).toEqual([
      'session_index_v1',
      PROJECT_FS_OPAQUE_CAPABILITY,
    ])
    for (const forged of [
      { ...response, id: 'client-forged' },
      { ...response, payload: { ...response.payload, nonce: 'x'.repeat(32) } },
      { ...response, payload: { ...response.payload, proof: 'x'.repeat(32) } },
    ]) {
      expect(
        verifyProjectFsNegotiation({
          negotiation,
          response: forged,
          machineId: 'machine-1',
          daemonInstallationId: 'install-1',
          machineToken: 'machine-secret',
        }),
      ).toBe(false)
    }
    expect(
      verifyProjectFsNegotiation({
        negotiation,
        response,
        machineId: 'machine-1',
        daemonInstallationId: 'install-restarted',
        machineToken: 'machine-secret',
      }),
    ).toBe(false)
  })
})

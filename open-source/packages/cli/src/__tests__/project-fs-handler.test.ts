// @arch open-source/docs/cli-runtime.md
// @covers src/session/handlers/project-fs.ts

import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROJECT_FS_AUTHORITY_PARAM,
  projectFsAuthoritySigningPayload,
  type ProjectFsTrustedEnvelope,
  type ReqFrame,
  type ResFrame,
} from '@shennian/wire'
import type { CliRelayClient } from '../relay/client.js'
import {
  createTrustedProjectFsRequestResolver,
  handleProjectFsRequest,
} from '../session/handlers/project-fs.js'
import { ProjectFsHandleStore, type TrustedProjectFsAuthority } from '../session/project-fs-store.js'

const PROJECT_REF = 'q'.repeat(32)

describe('project fs daemon handler authority boundary', () => {
  let root = ''
  let responses: ResFrame[] = []
  let client: CliRelayClient
  let authority: TrustedProjectFsAuthority

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-project-handler-'))
    fs.writeFileSync(path.join(root, 'visible.txt'), 'visible')
    responses = []
    client = { sendRes: vi.fn((frame: ResFrame) => responses.push(frame)) } as unknown as CliRelayClient
    authority = {
      projectRef: PROJECT_REF,
      scopeId: 's'.repeat(32),
      accountScope: 'a'.repeat(32),
      machineId: 'machine-1',
      projectId: 'project-1',
      rootPath: fs.realpathSync.native(root),
      rootDigest: 'r'.repeat(32),
      authorizationEpoch: 1,
      daemonInstallationId: 'daemon-1',
      generation: 'g'.repeat(32),
      expiresAt: Date.now() + 60_000,
    }
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('rejects production-style frames when no trusted Server resolver is installed', async () => {
    const req: ReqFrame = {
      type: 'req',
      id: 'untrusted',
      method: 'project.fs.open',
      params: { projectRef: PROJECT_REF, rootPath: root },
    }
    await handleProjectFsRequest(client, new ProjectFsHandleStore(), req, null)
    expect(responses[0]).toMatchObject({
      ok: false,
      error: 'permission_denied',
      payload: { rejection: { code: 'permission_denied', requiredAction: 'reauthenticate' } },
    })
    expect(JSON.stringify(responses[0])).not.toContain(root)
  })

  it('uses only resolver-sanitized params and returns opaque data without local paths', async () => {
    const req: ReqFrame = {
      type: 'req',
      id: 'trusted',
      method: 'project.fs.open',
      params: { projectRef: PROJECT_REF, rootPath: '/renderer/forged/path' },
    }
    await handleProjectFsRequest(client, new ProjectFsHandleStore(), req, () => ({
      authority,
      params: { projectRef: PROJECT_REF },
    }))
    expect(responses[0]?.ok).toBe(true)
    expect(JSON.stringify(responses[0])).not.toContain(root)
    expect(JSON.stringify(responses[0])).not.toContain('/renderer/forged/path')
  })

  it('rejects traversal and absolute-path fields instead of passing them to the store', async () => {
    for (const extra of [{ path: '../outside' }, { rootPath: '/outside' }]) {
      responses = []
      const req: ReqFrame = {
        type: 'req',
        id: 'invalid',
        method: 'project.fs.open',
        params: { projectRef: PROJECT_REF },
      }
      await handleProjectFsRequest(client, new ProjectFsHandleStore(), req, () => ({
        authority,
        params: { projectRef: PROJECT_REF, ...extra },
      }))
      expect(responses[0]).toMatchObject({ ok: false, error: 'handle_invalid' })
    }
  })

  it('accepts only an untampered machine-credential signature from Server', () => {
    const params = { projectRef: PROJECT_REF }
    const unsigned: Omit<ProjectFsTrustedEnvelope, 'signature'> = {
      version: 1,
      requestId: 'signed',
      method: 'project.fs.open',
      params,
      authority,
    }
    const envelope: ProjectFsTrustedEnvelope = {
      ...unsigned,
      signature: crypto.createHmac('sha256', 'machine-secret')
        .update(projectFsAuthoritySigningPayload(unsigned)).digest('base64url'),
    }
    const req: ReqFrame = {
      type: 'req', id: 'signed', method: 'project.fs.open',
      params: { [PROJECT_FS_AUTHORITY_PARAM]: envelope },
    }
    const resolve = createTrustedProjectFsRequestResolver('machine-secret')
    expect(resolve(req)).toMatchObject({ authority, params })
    envelope.authority = { ...authority, projectId: 'forged-project' }
    expect(resolve(req)).toBeNull()
  })
})

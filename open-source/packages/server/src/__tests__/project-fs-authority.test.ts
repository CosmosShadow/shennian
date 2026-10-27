// @arch open-source/docs/server-runtime.md
// @covers src/services/project-fs-authority.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseProjectFsTrustedEnvelope,
  PROJECT_FS_AUTHORITY_PARAM,
  PROJECT_FS_OPAQUE_CAPABILITY,
  type ReqFrame,
} from '@shennian/wire'

const { prisma } = vi.hoisted(() => ({ prisma: {
  machine: { findUnique: vi.fn() },
  machineGrant: { findFirst: vi.fn() },
  sessionProject: { findMany: vi.fn() },
} }))
vi.mock('../lib/prisma.js', () => ({ prisma }))

import {
  createAuthorizedProjectFsFrame,
  mintProjectFsReference,
} from '../services/project-fs-authority.js'

const createdAt = new Date('2026-09-01T00:00:00.000Z')
const updatedAt = new Date('2026-09-02T00:00:00.000Z')
const now = new Date('2026-09-10T00:00:00.000Z')
const project = {
  id: 'project-1', machineId: 'machine-1', workDir: '/private/project', createdAt, updatedAt,
}

function request(projectRef: string, params: Record<string, unknown> = {}): ReqFrame {
  return {
    type: 'req', id: 'request-1', method: 'project.fs.open',
    params: { projectRef, ...params },
  }
}

function machine(userId: string | null = 'owner-1') {
  return {
    id: 'machine-1', userId, online: true, paired: true,
    machineToken: 'machine-secret', remoteAccessDisabledAt: null,
    sessionSyncCapabilities: [PROJECT_FS_OPAQUE_CAPABILITY],
    daemonInstallationId: 'daemon-1',
  }
}

describe('project fs Server authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.machine.findUnique.mockResolvedValue(machine())
    prisma.sessionProject.findMany.mockResolvedValue([project])
  })

  it('mints a stable opaque account-bound project reference', () => {
    const ownerRef = mintProjectFsReference('owner-1', project)
    expect(ownerRef).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(ownerRef).toBe(mintProjectFsReference('owner-1', project))
    expect(ownerRef).not.toBe(mintProjectFsReference('other-user', project))
    expect(ownerRef).not.toContain(project.id)
    expect(ownerRef).not.toContain(project.workDir)
  })

  it('re-authorizes an owner and replaces the entire client params object with signed authority', async () => {
    const projectRef = mintProjectFsReference('owner-1', project)
    const authorized = await createAuthorizedProjectFsFrame({
      userId: 'owner-1', machineId: 'machine-1', frame: request(projectRef), now,
    })
    expect(Object.keys(authorized.params)).toEqual([PROJECT_FS_AUTHORITY_PARAM])
    const envelope = parseProjectFsTrustedEnvelope(authorized.params[PROJECT_FS_AUTHORITY_PARAM])
    expect(envelope).toMatchObject({
      requestId: 'request-1', method: 'project.fs.open', params: { projectRef },
      authority: {
        projectRef, machineId: 'machine-1', projectId: 'project-1',
        daemonInstallationId: 'daemon-1', rootPath: '/private/project',
      },
    })
    expect(envelope?.signature).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('rejects forged path, authority, traversal, and cross-account references before forwarding', async () => {
    const projectRef = mintProjectFsReference('owner-1', project)
    for (const forged of [
      { rootPath: '/forged' },
      { path: '../outside' },
      { [PROJECT_FS_AUTHORITY_PARAM]: { rootPath: '/forged' } },
    ]) {
      await expect(createAuthorizedProjectFsFrame({
        userId: 'owner-1', machineId: 'machine-1', frame: request(projectRef, forged), now,
      })).rejects.toMatchObject({ rejection: { code: 'permission_denied' } })
    }
    await expect(createAuthorizedProjectFsFrame({
      userId: 'other-user', machineId: 'machine-1', frame: request(projectRef), now,
    })).rejects.toMatchObject({ rejection: { code: 'permission_denied' } })
  })

  it('allows use grants but rejects view-only, revoked, expired, and removed project authority', async () => {
    prisma.machine.findUnique.mockResolvedValue(machine('owner-1'))
    const granteeRef = mintProjectFsReference('grantee-1', project)
    prisma.machineGrant.findFirst.mockResolvedValue({
      id: 'grant-1', permission: 'use', expiresAt: new Date(now.getTime() + 60_000), createdAt,
    })
    await expect(createAuthorizedProjectFsFrame({
      userId: 'grantee-1', machineId: 'machine-1', frame: request(granteeRef), now,
    })).resolves.toBeTruthy()

    prisma.machineGrant.findFirst.mockResolvedValue({
      id: 'grant-1', permission: 'view', expiresAt: null, createdAt,
    })
    await expect(createAuthorizedProjectFsFrame({
      userId: 'grantee-1', machineId: 'machine-1', frame: request(granteeRef), now,
    })).rejects.toMatchObject({ rejection: { code: 'permission_denied' } })
    prisma.machineGrant.findFirst.mockResolvedValue(null)
    await expect(createAuthorizedProjectFsFrame({
      userId: 'grantee-1', machineId: 'machine-1', frame: request(granteeRef), now,
    })).rejects.toMatchObject({ rejection: { code: 'permission_denied' } })
    prisma.sessionProject.findMany.mockResolvedValue([])
    prisma.machine.findUnique.mockResolvedValue(machine('grantee-1'))
    await expect(createAuthorizedProjectFsFrame({
      userId: 'grantee-1', machineId: 'machine-1', frame: request(granteeRef), now,
    })).rejects.toMatchObject({ rejection: { code: 'project_not_found' } })
  })

  it('fails closed for offline, paused, and old daemons without leaking a root path', async () => {
    const projectRef = mintProjectFsReference('owner-1', project)
    for (const override of [
      { online: false },
      { remoteAccessDisabledAt: now },
      { sessionSyncCapabilities: [] },
      { daemonInstallationId: null },
    ]) {
      prisma.machine.findUnique.mockResolvedValue({ ...machine(), ...override })
      let failure: unknown
      try {
        await createAuthorizedProjectFsFrame({
          userId: 'owner-1', machineId: 'machine-1', frame: request(projectRef), now,
        })
      } catch (error) { failure = error }
      expect(failure).toBeTruthy()
      expect(JSON.stringify(failure)).not.toContain(project.workDir)
    }
  })

  it('changes handle generation when a grant is replaced', async () => {
    prisma.machine.findUnique.mockResolvedValue(machine('owner-1'))
    const projectRef = mintProjectFsReference('grantee-1', project)
    prisma.machineGrant.findFirst.mockResolvedValue({
      id: 'grant-old', permission: 'use', expiresAt: null, createdAt,
    })
    const first = await createAuthorizedProjectFsFrame({
      userId: 'grantee-1', machineId: 'machine-1', frame: request(projectRef), now,
    })
    prisma.machineGrant.findFirst.mockResolvedValue({
      id: 'grant-new', permission: 'use', expiresAt: null, createdAt: updatedAt,
    })
    const second = await createAuthorizedProjectFsFrame({
      userId: 'grantee-1', machineId: 'machine-1', frame: request(projectRef), now,
    })
    const firstEnvelope = parseProjectFsTrustedEnvelope(first.params[PROJECT_FS_AUTHORITY_PARAM])!
    const secondEnvelope = parseProjectFsTrustedEnvelope(second.params[PROJECT_FS_AUTHORITY_PARAM])!
    expect(secondEnvelope.authority.generation).not.toBe(firstEnvelope.authority.generation)
    expect(secondEnvelope.authority.authorizationEpoch)
      .not.toBe(firstEnvelope.authority.authorizationEpoch)
  })
})

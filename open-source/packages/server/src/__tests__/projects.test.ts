// @covers open-source/packages/server/src/services/projects.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  sessionProject: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  machine: {
    findMany: vi.fn(),
  },
  machineGrant: {
    findMany: vi.fn(),
  },
  nianSession: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))

import {
  createProjectForUser,
  getUserProject,
  isPersistentProjectWorkDir,
  listUserProjects,
  normalizeProjectWorkDir,
  projectDisplayName,
  projectIdFor,
  removeProjectForUser,
  updateProjectLaunchDefaults,
  upsertSessionProject,
} from '../services/projects.js'

describe('project projection helpers', () => {
  beforeEach(() => vi.clearAllMocks())
  it('normalizes directory identity and creates stable ids', () => {
    expect(normalizeProjectWorkDir('/Users/test/code/demo/')).toBe('/Users/test/code/demo')
    expect(normalizeProjectWorkDir('C:\\code\\demo\\')).toBe('C:\\code\\demo')
    expect(projectIdFor('machine-1', '/Users/test/code/demo/')).toBe(
      projectIdFor('machine-1', '/Users/test/code/demo'),
    )
  })

  it('uses the final directory segment as display name', () => {
    expect(projectDisplayName('/Users/test/Documents/学习')).toBe('学习')
    expect(projectDisplayName('C:\\code\\shennian')).toBe('shennian')
  })

  it('does not persist operating-system temporary directories as projects', () => {
    expect(isPersistentProjectWorkDir('/Users/test/code/shennian')).toBe(true)
    expect(isPersistentProjectWorkDir('/tmp/e2e-project')).toBe(false)
    expect(isPersistentProjectWorkDir('/private/tmp/e2e-project')).toBe(false)
    expect(isPersistentProjectWorkDir('/var/folders/xx/T/e2e-project')).toBe(false)
  })

  it('does not create a project projection for a managed Agent session', async () => {
    await upsertSessionProject({
      machineId: 'machine-1',
      workDir: '/Users/test/code/demo',
      agentIdentityId: 'agent-1',
    })

    expect(mockPrisma.sessionProject.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.sessionProject.create).not.toHaveBeenCalled()
    expect(mockPrisma.sessionProject.update).not.toHaveBeenCalled()
  })

  it('backfills projects from ordinary sessions only', async () => {
    mockPrisma.machine.findMany.mockResolvedValue([{ id: 'machine-1', name: 'Mac', online: true }])
    mockPrisma.machineGrant.findMany.mockResolvedValue([])
    mockPrisma.nianSession.groupBy.mockResolvedValue([])
    mockPrisma.sessionProject.findMany.mockResolvedValue([])

    await expect(listUserProjects('user-1')).resolves.toEqual([])

    expect(mockPrisma.nianSession.groupBy).toHaveBeenCalledWith({
      by: ['machineId', 'workDir'],
      where: {
        machineId: { in: ['machine-1'] },
        agentIdentityId: null,
        sessionScope: { not: 'steward' },
        deletedAt: null,
        workDir: { not: '' },
      },
      _max: { lastActivityAt: true },
      _min: { createdAt: true },
    })
  })

  it('keeps source-unknown legacy project records instead of guessing they are managed artifacts', async () => {
    const createdAt = new Date('2026-08-25T01:00:00.000Z')
    mockPrisma.machine.findMany.mockResolvedValue([{ id: 'machine-1', name: 'Mac', online: true }])
    mockPrisma.machineGrant.findMany.mockResolvedValue([])
    mockPrisma.nianSession.groupBy.mockResolvedValue([])
    mockPrisma.sessionProject.findMany.mockResolvedValue([
      {
        id: projectIdFor('machine-1', '/code/legacy-empty'),
        machineId: 'machine-1',
        workDir: '/code/legacy-empty',
        displayName: 'legacy-empty',
        lastActivityAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      },
    ])

    await expect(listUserProjects('user-1')).resolves.toEqual([
      expect.objectContaining({ displayName: 'legacy-empty' }),
    ])
  })

  it('creates an empty project without creating an Agent session', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z')
    mockPrisma.machine.findMany.mockResolvedValue([{ id: 'machine-1', name: 'Mac', online: true }])
    mockPrisma.machineGrant.findMany.mockResolvedValue([])
    mockPrisma.sessionProject.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: projectIdFor('machine-1', '/Users/test/code/demo'),
      machineId: 'machine-1',
      workDir: '/Users/test/code/demo',
      displayName: 'demo',
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    })

    await expect(
      createProjectForUser({
        userId: 'user-1',
        machineId: 'machine-1',
        workDir: '/Users/test/code/demo/',
      }),
    ).resolves.toMatchObject({
      machineId: 'machine-1',
      machineName: 'Mac',
      workDir: '/Users/test/code/demo',
      displayName: 'demo',
    })

    expect(mockPrisma.sessionProject.create).toHaveBeenCalledOnce()
    expect(mockPrisma.nianSession.findMany).not.toHaveBeenCalled()
  })

  it('resolves a project only when its machine is accessible', async () => {
    mockPrisma.machine.findMany.mockResolvedValue([{ id: 'machine-1', name: 'Mac', online: true }])
    mockPrisma.machineGrant.findMany.mockResolvedValue([])
    mockPrisma.sessionProject.findUnique.mockResolvedValue({
      id: 'project-1',
      machineId: 'machine-1',
      workDir: '/code/demo',
    })

    await expect(getUserProject('user-1', 'project-1')).resolves.toMatchObject({
      id: 'project-1',
      machineId: 'machine-1',
    })

    mockPrisma.machine.findMany.mockResolvedValue([])
    await expect(getUserProject('user-2', 'project-1')).rejects.toThrow('Project not found')
  })

  it('persists an explicit project Agent and model default', async () => {
    const now = new Date('2026-08-29T00:00:00.000Z')
    const existing = {
      id: 'project-1',
      machineId: 'machine-1',
      workDir: '/code/demo',
      displayName: 'demo',
      defaultAgentType: null,
      defaultModelId: null,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    }
    mockPrisma.machine.findMany.mockResolvedValue([{ id: 'machine-1', name: 'Mac', online: true }])
    mockPrisma.machineGrant.findMany.mockResolvedValue([])
    mockPrisma.sessionProject.findUnique.mockResolvedValue(existing)
    mockPrisma.sessionProject.update.mockResolvedValue({
      ...existing,
      defaultAgentType: 'codex',
      defaultModelId: 'gpt-5.6-sol',
    })

    await expect(
      updateProjectLaunchDefaults({
        userId: 'user-1',
        projectId: 'project-1',
        agentType: 'codex',
        modelId: 'gpt-5.6-sol',
      }),
    ).resolves.toMatchObject({
      defaultAgentType: 'codex',
      defaultModelId: 'gpt-5.6-sol',
    })
    expect(mockPrisma.sessionProject.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { defaultAgentType: 'codex', defaultModelId: 'gpt-5.6-sol' },
    })
  })

  it('removes an owned project and only its ordinary conversations', async () => {
    mockPrisma.sessionProject.findUnique.mockResolvedValue({
      id: 'project-1',
      machineId: 'machine-1',
      workDir: '/Users/test/code/demo',
      machine: { userId: 'user-1' },
    })
    mockPrisma.nianSession.findMany.mockResolvedValue([{ id: 'session-1' }, { id: 'session-2' }])
    const deleteSession = vi.fn(async () => {})

    await expect(removeProjectForUser('user-1', 'project-1', deleteSession)).resolves.toEqual({
      deletedSessionIds: ['session-1', 'session-2'],
    })

    expect(mockPrisma.nianSession.findMany).toHaveBeenCalledWith({
      where: {
        machineId: 'machine-1',
        workDir: {
          in: ['/Users/test/code/demo', '/Users/test/code/demo/', '/Users/test/code/demo\\'],
        },
        agentIdentityId: null,
        deletedAt: null,
      },
      select: { id: true },
    })
    expect(deleteSession).toHaveBeenNthCalledWith(1, 'session-1', 'user-1')
    expect(deleteSession).toHaveBeenNthCalledWith(2, 'session-2', 'user-1')
    expect(mockPrisma.sessionProject.delete).toHaveBeenCalledWith({ where: { id: 'project-1' } })
  })

  it('removes an empty project without invoking session deletion', async () => {
    mockPrisma.sessionProject.findUnique.mockResolvedValue({
      id: 'project-1',
      machineId: 'machine-1',
      workDir: '/Users/test/code/demo',
      machine: { userId: 'user-1' },
    })
    mockPrisma.nianSession.findMany.mockResolvedValue([])
    const deleteSession = vi.fn(async () => {})

    await expect(removeProjectForUser('user-1', 'project-1', deleteSession)).resolves.toEqual({
      deletedSessionIds: [],
    })
    expect(deleteSession).not.toHaveBeenCalled()
    expect(mockPrisma.sessionProject.delete).toHaveBeenCalledWith({ where: { id: 'project-1' } })
  })

  it('rejects removal by a user who does not own the machine', async () => {
    mockPrisma.sessionProject.findUnique.mockResolvedValue({
      id: 'project-1',
      machineId: 'machine-1',
      workDir: '/Users/test/code/demo',
      machine: { userId: 'owner-1' },
    })

    await expect(removeProjectForUser('grantee-1', 'project-1', vi.fn())).rejects.toThrow(
      'Not authorized',
    )
    expect(mockPrisma.nianSession.findMany).not.toHaveBeenCalled()
  })
})
